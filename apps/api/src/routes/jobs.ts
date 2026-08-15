/**
 * /v1/jobs — user-initiated generation submission.
 *
 *   POST /v1/jobs                — create a queued job (auth required)
 *
 * Lifecycle (B2 scope only — B3 wires Trigger.dev, B4 adds polling):
 *
 *     ┌─────────────────────┐
 *     │ POST /v1/jobs       │  pre-validate → atomic debit+insert → 201
 *     │   status: 'queued'  │
 *     └──────────┬──────────┘
 *                │  (B3) dispatcher picks it up
 *                ▼
 *     ┌─────────────────────┐
 *     │ status: 'processing'│
 *     └──────────┬──────────┘
 *                │  Gemini / Kling adapters
 *                ▼
 *     ┌─────────────────────┐
 *     │ 'completed'/'failed'│  (B4) mobile polls GET /v1/jobs/:id
 *     └─────────────────────┘
 *
 * Idempotency: clients SHOULD send `Idempotency-Key: <uuid>`. When
 * present, we look up `(userId, idempotencyKey)` first — if a row
 * matches, we return its job-id without a second debit. This makes
 * retries from flaky networks safe.
 *
 * The atomic credit-debit-plus-insert lives in `lib/job-create.ts`
 * because the `neon-http` driver can't do interactive transactions
 * (see that file's header for the gory details).
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, lt, or } from 'drizzle-orm';

import { jobs, projects, providerModels, templates } from '@clickfy/db';
import {
  aspectRatiosFor,
  CREATE_END_FRAME_KEY,
  CREATE_PROMPT_KEY,
  CREATE_START_FRAME_KEY,
  createReferenceKey,
  findCapabilities,
} from '@clickfy/providers';

import type { AppEnv } from '../types';
import { withAuth, withCurrentUser } from '../middleware/with-auth';
import { byClerkUserId, withRateLimit } from '../middleware/with-rate-limit';
import { DEFAULT_PROJECT_NAME, titleFromPrompt } from '../lib/project-title';
import { createJobSchema, createUserJobSchema, type JobInputValueParsed } from '../lib/job-schemas';
import { validateCreateSubmission, validateJobSubmission } from '../lib/job-validation';
import { createJobAtomically, createUserJobAtomically } from '../lib/job-create';
import { getCreateModelDef, isCreateEligible } from '../lib/create-models';
import { dispatchJob } from '../lib/dispatch-job';
import { resolveOwnMediaUrl } from '../lib/template-dto';

export const jobsRoute = new Hono<AppEnv>();

// ─── POST /v1/jobs ──────────────────────────────────────────────────

jobsRoute.post(
  '/',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_JOB, byClerkUserId),
  withCurrentUser(),
  zValidator('json', createJobSchema),
  async (c) => {
    const user = c.var.user;
    if (!user) {
      // `withCurrentUser` upstream guarantees this, but TypeScript
      // doesn't know that; the explicit guard also produces a clearer
      // error if the middleware order is ever changed by mistake.
      return c.json(
        { error: { code: 'unauthenticated', message: 'Sign in required.' } },
        401,
      );
    }

    const body = c.req.valid('json');
    const idempotencyKey = c.req.header('Idempotency-Key') ?? null;

    // ── Idempotency short-circuit ──────────────────────────────────
    if (idempotencyKey) {
      const existing = await c.var.db.query.jobs.findFirst({
        where: and(
          eq(jobs.userId, user.id),
          eq(jobs.idempotencyKey, idempotencyKey),
        ),
        columns: { id: true, status: true },
      });
      if (existing) {
        return c.json({
          data: {
            jobId: existing.id,
            status: existing.status,
            creditsRemaining: user.creditsBalance,
            idempotent: true,
          },
        });
      }
    }

    // ── Load template ──────────────────────────────────────────────
    const template = await c.var.db.query.templates.findFirst({
      where: eq(templates.id, body.templateId),
    });
    if (!template) {
      return c.json(
        { error: { code: 'template_not_found', message: 'Template not found.' } },
        404,
      );
    }

    // A zero/negative cost means the template's pipeline references
    // unpriced models (seed default is 0 until an admin prices them).
    // Refuse rather than run a free generation with no ledger trail —
    // the create path has the same guard (`model_unpriced`).
    if (template.costCredits <= 0) {
      return c.json(
        {
          error: {
            code: 'template_unpriced',
            message: 'This template is temporarily unavailable.',
          },
        },
        422,
      );
    }

    // ── Resolve allowed aspect ratios from the first stage's model ─
    // Mobile lets the user pick an aspect ratio; that choice is bounded
    // by what the *first* stage's model supports (the model that will
    // see the choice — downstream stages inherit whatever frame the
    // first stage produced).
    const firstStage = template.generation?.stages?.[0];
    const allowedAspectRatios: string[] = (() => {
      if (!firstStage) return [];
      const caps = findCapabilities(firstStage.model);
      if (!caps) return [];
      if (caps.sizing.mode === 'aspect') return [...caps.sizing.values];
      return [];
    })();

    // ── R2 bucket binding (mandatory in production) ────────────────
    const uploads = c.env.UPLOADS;
    if (!uploads) {
      return c.json(
        { error: { code: 'r2_not_configured', message: 'Uploads bucket binding missing.' } },
        503,
      );
    }

    // ── Validate inputs against the template ───────────────────────
    const validationError = await validateJobSubmission(body, {
      userId: user.id,
      uploadsBucket: uploads,
      template: {
        id: template.id,
        status: template.status,
        userInputs: template.userInputs,
        userCanChooseAspectRatio: template.userCanChooseAspectRatio,
        defaultAspectRatio: template.defaultAspectRatio,
        costCredits: template.costCredits,
      },
      currentCreditsBalance: user.creditsBalance,
      allowedAspectRatios,
    });

    if (validationError) {
      // 402 reserved for payment-related rejections so the mobile app
      // can show a "Get more credits" CTA distinct from generic 4xx.
      const status = validationError.code === 'insufficient_credits' ? 402 : 422;
      return c.json({ error: validationError }, status);
    }

    // ── Project ownership (web studio) ─────────────────────────────
    // Verified BEFORE the debit so a bad id can never cost credits.
    // Same compound (id, user_id) scoping as the create-flow path.
    if (body.projectId) {
      const ownedProject = await c.var.db.query.projects.findFirst({
        where: and(eq(projects.id, body.projectId), eq(projects.userId, user.id)),
        columns: { id: true },
      });
      if (!ownedProject) {
        return c.json(
          { error: { code: 'project_not_found', message: 'Project not found.' } },
          404,
        );
      }
    }

    // ── Atomic debit + insert ──────────────────────────────────────
    // Wrap in try/catch so a future schema regression or Postgres
    // error surfaces as a structured `internal_error` to the client
    // instead of leaking the raw exception message into the mobile
    // Alert. The full error is still logged server-side via Hono's
    // onError handler.
    let result;
    try {
      result = await createJobAtomically(c.var.db, {
        userId: user.id,
        templateId: template.id,
        cost: template.costCredits,
        inputs: body.inputs,
        options: body.options ?? {},
        idempotencyKey,
        projectId: body.projectId ?? null,
      });
    } catch (err) {
      // Unique-violation on (user_id, idempotency_key): a concurrent
      // retry with the same key already created this job. The whole CTE
      // is one atomic statement, so the losing side's debit rolled back
      // with the failed INSERT — no double charge. Return the winner.
      if (idempotencyKey && isUniqueViolation(err)) {
        const existing = await c.var.db.query.jobs.findFirst({
          where: and(eq(jobs.userId, user.id), eq(jobs.idempotencyKey, idempotencyKey)),
          columns: { id: true, status: true },
        });
        if (existing) {
          return c.json({
            data: {
              jobId: existing.id,
              status: existing.status,
              creditsRemaining: user.creditsBalance,
              idempotent: true,
            },
          });
        }
      }
      console.error('createJobAtomically failed:', err);
      return c.json(
        {
          error: {
            code: 'internal_error',
            message:
              'We could not start your generation. Please try again in a moment.',
          },
        },
        500,
      );
    }

    if (!result) {
      // CTE returned 0 rows. We pre-checked balance + template, so
      // this almost certainly means a concurrent submit ate the
      // credits between our SELECT and the UPDATE. Surface it as
      // `insufficient_credits` rather than a misleading 500.
      return c.json(
        {
          error: {
            code: 'insufficient_credits',
            message: 'Credits changed during submission. Try again.',
          },
        },
        402,
      );
    }

    // ── Hand the job off to Trigger.dev ─────────────────────────
    // We've already debited credits, so on dispatch failure we
    // CANNOT just 500 the client — that would charge them for a
    // job that never runs. Instead we leave the row at `queued`
    // and return success; a follow-up recovery cron sweeps queued
    // rows older than ~30s and re-fires the dispatch (B3 follow-up).
    // The mobile app's polling screen will reflect the `queued`
    // state harmlessly until either the dispatch retry lands or
    // the user is refunded.
    if (c.env.TRIGGER_SECRET_KEY) {
      const dispatch = await dispatchJob({
        jobId: result.jobId,
        triggerSecretKey: c.env.TRIGGER_SECRET_KEY,
      });
      if (dispatch.ok) {
        // Persist the run id so /v1/jobs/:id can show Trigger.dev
        // run logs / cancel a live run later.
        await c.var.db
          .update(jobs)
          .set({ triggerRunId: dispatch.runId })
          .where(eq(jobs.id, result.jobId));
      } else {
        console.error('dispatchJob failed:', dispatch.status, dispatch.message);
        // Intentionally NOT failing the request — see comment above.
      }
    } else {
      // Local dev without Trigger.dev creds — log loudly so the
      // missing config is obvious, but still return success so
      // the rest of the path (B1, B2) remains testable in isolation.
      console.warn(
        '[jobs] TRIGGER_SECRET_KEY missing — job queued but not dispatched. Set it in .dev.vars to run end-to-end.',
      );
    }

    // 201 Created — clients (mobile + SDK) treat any 2xx as success.
    return c.json(
      {
        data: {
          jobId: result.jobId,
          status: 'queued' as const,
          creditsRemaining: result.creditsRemaining,
        },
      },
      201,
    );
  },
);

// ─── POST /v1/jobs/create ───────────────────────────────────────────
//
// Prompt-first "create from scratch" generation. Fully isolated from the
// template path above: its own schema, validation, and atomic debit. A
// create job has no template — it carries the user's model + prompt +
// attachments and is billed at the model's flat `cost_credits`.
jobsRoute.post(
  '/create',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_JOB, byClerkUserId),
  withCurrentUser(),
  zValidator('json', createUserJobSchema),
  async (c) => {
    const user = c.var.user;
    if (!user) {
      return c.json(
        { error: { code: 'unauthenticated', message: 'Sign in required.' } },
        401,
      );
    }

    const body = c.req.valid('json');
    const idempotencyKey = c.req.header('Idempotency-Key') ?? null;

    // ── Idempotency short-circuit ──────────────────────────────────
    if (idempotencyKey) {
      const existing = await c.var.db.query.jobs.findFirst({
        where: and(eq(jobs.userId, user.id), eq(jobs.idempotencyKey, idempotencyKey)),
        columns: { id: true, status: true },
      });
      if (existing) {
        return c.json({
          data: {
            jobId: existing.id,
            status: existing.status,
            creditsRemaining: user.creditsBalance,
            idempotent: true,
          },
        });
      }
    }

    // ── Resolve model + create-eligibility ─────────────────────────
    const caps = findCapabilities(body.modelKey);
    const def = getCreateModelDef(body.modelKey);
    if (!caps || !def || !isCreateEligible(body.modelKey)) {
      return c.json(
        { error: { code: 'unknown_model', message: 'That model is not available.' } },
        404,
      );
    }

    // ── Price (per-tier when the model has quality modes) ──────────
    const priceRows = await c.var.db
      .select({
        costCredits: providerModels.costCredits,
        tierPricing: providerModels.tierPricing,
        status: providerModels.status,
      })
      .from(providerModels)
      .where(
        and(
          eq(providerModels.provider, caps.provider),
          eq(providerModels.modelKey, body.modelKey),
        ),
      )
      .limit(1);
    const priceRow = priceRows[0];

    // Resolve the quality tier: an explicit request is validated against
    // the model's mode list; absent → the model's default (which is what
    // pre-tier clients get, at exactly the pre-tier price). A `quality`
    // sent for a fixed-quality model is a 422, not a silent ignore —
    // otherwise a user could believe they bought 4K they didn't get.
    let mode: string | undefined;
    if (caps.modes) {
      if (body.quality && !caps.modes.values.includes(body.quality)) {
        return c.json(
          {
            error: {
              code: 'quality_not_supported',
              message: `Quality "${body.quality}" is not available for this model.`,
            },
          },
          422,
        );
      }
      mode = body.quality ?? caps.modes.default;
    } else if (body.quality) {
      return c.json(
        {
          error: {
            code: 'quality_not_supported',
            message: 'This model has a fixed quality.',
          },
        },
        422,
      );
    }

    const baseCost = (mode ? priceRow?.tierPricing?.[mode] : undefined) ?? priceRow?.costCredits ?? 0;

    // Video providers bill per SECOND of output, so a flat per-job price
    // only breaks even at one length. Prices are quoted at the model's
    // default duration; anything longer scales linearly from there.
    // Without this a 15s job costs us 3x a 5s one and bills the same.
    const refDuration = caps.kind === 'video' ? caps.duration?.default : undefined;
    const chosenDuration = typeof body.duration === 'number' ? body.duration : refDuration;
    const durationFactor =
      refDuration && chosenDuration && refDuration > 0 ? chosenDuration / refDuration : 1;
    const cost = Math.ceil(baseCost * durationFactor);
    if (!priceRow || baseCost <= 0 || cost <= 0) {
      return c.json(
        { error: { code: 'model_unpriced', message: 'That model is not available right now.' } },
        422,
      );
    }

    // ── R2 bucket binding ──────────────────────────────────────────
    const uploads = c.env.UPLOADS;
    if (!uploads) {
      return c.json(
        { error: { code: 'r2_not_configured', message: 'Uploads bucket binding missing.' } },
        503,
      );
    }

    // ── Semantic validation (model-adaptive) ───────────────────────
    // Same accessor the roster uses — otherwise the picker can offer a
    // ratio that validation then rejects.
    const allowedAspectRatios = aspectRatiosFor(caps);
    const allowedDurations =
      caps.kind === 'video' && caps.duration ? [...caps.duration.values] : [];
    const validationError = await validateCreateSubmission(body, {
      userId: user.id,
      uploadsBucket: uploads,
      model: {
        modelKey: body.modelKey,
        kind: caps.kind,
        maxImagesTotal: caps.maxImagesTotal,
        maxPromptChars: caps.maxPromptChars,
        allowedAspectRatios,
        allowedDurations,
        requiresStartFrame: def.requiresStartFrame,
        acceptsStartEndImage: caps.acceptsStartEndImage ?? false,
        cost,
      },
      currentCreditsBalance: user.creditsBalance,
    });
    if (validationError) {
      const status = validationError.code === 'insufficient_credits' ? 402 : 422;
      return c.json({ error: validationError }, status);
    }

    // ── Project ownership (web studio) ─────────────────────────────
    // Verified BEFORE the debit so a bad id can never cost credits. A
    // foreign/unknown project 404s (no existence leak — same compound
    // (id, user_id) scoping as everywhere else).
    let autoTitle: string | null = null;
    if (body.projectId) {
      const ownedProject = await c.var.db.query.projects.findFirst({
        where: and(eq(projects.id, body.projectId), eq(projects.userId, user.id)),
        columns: { id: true, name: true },
      });
      if (!ownedProject) {
        return c.json(
          { error: { code: 'project_not_found', message: 'Project not found.' } },
          404,
        );
      }
      // Name the project after the prompt that fills it, but only while
      // it still carries the server-assigned default — a title the user
      // (or an earlier prompt) chose is never overwritten. Only the
      // prompt-first flow has a prompt to name it from; template jobs
      // keep the default.
      if (ownedProject.name === DEFAULT_PROJECT_NAME) {
        autoTitle = titleFromPrompt(body.prompt);
      }
    }

    // ── Assemble jobs.inputs with canonical create field keys ──────
    const inputs: Record<string, JobInputValueParsed> = {
      [CREATE_PROMPT_KEY]: { kind: 'text', value: body.prompt },
    };
    if (body.startFrame) inputs[CREATE_START_FRAME_KEY] = body.startFrame;
    if (body.endFrame) inputs[CREATE_END_FRAME_KEY] = body.endFrame;
    body.references.forEach((ref, i) => {
      inputs[createReferenceKey(i)] = ref;
    });

    const options = {
      aspectRatio: body.aspectRatio,
      duration: body.duration,
      sound: body.sound,
      // Resolved quality tier — persisted so the worker compiles the
      // stage at exactly the tier the user was charged for.
      mode,
    };

    // ── Atomic debit + insert (isolated create CTE) ────────────────
    let result;
    try {
      result = await createUserJobAtomically(c.var.db, {
        userId: user.id,
        cost,
        modelKey: body.modelKey,
        inputs,
        options,
        idempotencyKey,
        projectId: body.projectId ?? null,
      });
    } catch (err) {
      // Same idempotency-conflict handling as the template path: the
      // losing concurrent retry's debit rolled back with its INSERT.
      if (idempotencyKey && isUniqueViolation(err)) {
        const existing = await c.var.db.query.jobs.findFirst({
          where: and(eq(jobs.userId, user.id), eq(jobs.idempotencyKey, idempotencyKey)),
          columns: { id: true, status: true },
        });
        if (existing) {
          return c.json({
            data: {
              jobId: existing.id,
              status: existing.status,
              creditsRemaining: user.creditsBalance,
              idempotent: true,
            },
          });
        }
      }
      console.error('createUserJobAtomically failed:', err);
      return c.json(
        {
          error: {
            code: 'internal_error',
            message: 'We could not start your generation. Please try again in a moment.',
          },
        },
        500,
      );
    }

    if (!result) {
      return c.json(
        {
          error: {
            code: 'insufficient_credits',
            message: 'Credits changed during submission. Try again.',
          },
        },
        402,
      );
    }

    // Title the project from its first prompt. Deliberately after the
    // job is committed — a submission rejected for credits or
    // idempotency must not leave a renamed project behind. Still guarded
    // on the default name so a concurrent manual rename wins.
    if (autoTitle && body.projectId) {
      try {
        await c.var.db
          .update(projects)
          .set({ name: autoTitle, updatedAt: new Date() })
          .where(
            and(
              eq(projects.id, body.projectId),
              eq(projects.userId, user.id),
              eq(projects.name, DEFAULT_PROJECT_NAME),
            ),
          );
      } catch (err) {
        // Cosmetic: never fail a paid generation over a title.
        console.error('project auto-title failed:', err);
      }
    }

    // ── Dispatch to Trigger.dev (same path as the template flow) ───
    if (c.env.TRIGGER_SECRET_KEY) {
      const dispatch = await dispatchJob({
        jobId: result.jobId,
        triggerSecretKey: c.env.TRIGGER_SECRET_KEY,
      });
      if (dispatch.ok) {
        await c.var.db
          .update(jobs)
          .set({ triggerRunId: dispatch.runId })
          .where(eq(jobs.id, result.jobId));
      } else {
        console.error('dispatchJob (create) failed:', dispatch.status, dispatch.message);
      }
    } else {
      console.warn(
        '[jobs] TRIGGER_SECRET_KEY missing — create job queued but not dispatched.',
      );
    }

    return c.json(
      {
        data: {
          jobId: result.jobId,
          status: 'queued' as const,
          creditsRemaining: result.creditsRemaining,
        },
      },
      201,
    );
  },
);

// ─── GET /v1/jobs ───────────────────────────────────────────────────
//
// Paginated list of the current user's generations, newest first.
// Powers the mobile Projects + Library tabs.
//
// We embed a small slice of the producing template (name, cover
// image, kind) onto each row so the mobile screen renders without
// a second round-trip per item — and so the list still shows
// something sensible even if the template was later archived or
// deleted.
//
// Cursor: opaque "<createdAt-ISO>|<id>" pair. The id-tiebreaker
// avoids skipped rows when several jobs share a millisecond.
// Limit: clamped 1..50 (default 20).
//
// Auth: required. The query joins to `users.clerkUserId` so a
// caller can never read another user's history even by guessing.
jobsRoute.get(
  '/',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_READ, byClerkUserId),
  withCurrentUser(),
  async (c) => {
    const userRow = c.var.user!;

    const limitRaw = Number(c.req.query('limit') ?? '20');
    const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, Math.floor(limitRaw))) : 20;
    const cursor = c.req.query('cursor');

    // Resolve cursor into a `(createdAt, id)` tuple. The format is
    // `<isoTs>|<uuid>`. Anything malformed is treated as "no cursor"
    // rather than 400ing — clients then naturally restart from the top.
    let cursorTs: Date | null = null;
    let cursorId: string | null = null;
    if (cursor) {
      const idx = cursor.indexOf('|');
      if (idx > 0) {
        const ts = new Date(cursor.slice(0, idx));
        const id = cursor.slice(idx + 1);
        if (!Number.isNaN(ts.getTime()) && id) {
          cursorTs = ts;
          cursorId = id;
        }
      }
    }

    // Drizzle's joined query keeps the snapshot lean (only the
    // columns we serialise). We sort by createdAt DESC + id DESC so
    // pagination is total-ordered and stable across same-millisecond
    // inserts.
    const rows = await c.var.db.query.jobs.findMany({
      where: cursorTs && cursorId
        ? and(
            eq(jobs.userId, userRow.id),
            // Either strictly older, or same timestamp but lower id.
            // Drizzle doesn't have a clean "row-tuple comparison" so we
            // build the OR inline.
            or(
              lt(jobs.createdAt, cursorTs),
              and(eq(jobs.createdAt, cursorTs), lt(jobs.id, cursorId)),
            ),
          )
        : eq(jobs.userId, userRow.id),
      orderBy: [desc(jobs.createdAt), desc(jobs.id)],
      limit: limit + 1, // request one extra so we know if there's a next page
      columns: {
        id: true,
        templateId: true,
        status: true,
        result: true,
        createdAt: true,
        // Create-flow provenance + fields for the "Custom" badge / title.
        source: true,
        modelKey: true,
        inputs: true,
      },
      with: {
        template: {
          columns: {
            id: true,
            title: true,
            kind: true,
            coverMedia: true,
          },
        },
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const origin = new URL(c.req.url).origin;
    const items = page.map((j) => {
      const finalImages = j.result?.images ?? [];
      const finalVideos = j.result?.videos ?? [];
      // Each output is tagged with its media kind so mobile renders
      // images with <Image> and videos with the player without
      // having to sniff URLs or guess from extensions.
      // Aspect ratio is sourced from the stored MediaRef per output —
      // never hardcoded client-side. Image dimensions come straight off
      // the asset; video dims aren't tracked in StreamRef yet, so those
      // remain undefined and mobile falls back to its 9:16 default.
      const outputs: Array<{
        url: string;
        kind: 'image' | 'video';
        width?: number;
        height?: number;
        aspectRatio?: number;
      }> = [
        ...finalImages.map((i) => ({
          url: `${origin}/v1/outputs/${i.r2Key}`,
          kind: 'image' as const,
          width: i.width || undefined,
          height: i.height || undefined,
          aspectRatio: i.width && i.height ? i.width / i.height : undefined,
        })),
        ...finalVideos.map((v) => ({
          url: `${origin}/v1/outputs/${v.streamId}`,
          kind: 'video' as const,
          // Dims/ratio persisted by the worker (probed or requested-ratio
          // fallback) so mobile lays videos out at their true shape.
          width: v.width || undefined,
          height: v.height || undefined,
          aspectRatio:
            v.aspectRatio ?? (v.width && v.height ? v.width / v.height : undefined),
        })),
      ];

      // Map DB status to the SDK's slightly different enum
      // (`ready` instead of `completed` — historical from the mock).
      const sdkStatus: 'queued' | 'processing' | 'ready' | 'failed' =
        j.status === 'completed' ? 'ready' : (j.status as 'queued' | 'processing' | 'failed');

      // A `source='user'` job has no template — its display fields come
      // from the chosen model + the user's prompt instead. Template jobs
      // keep the existing template-embed behavior unchanged.
      const isUserJob = j.source === 'user';
      let templateName: string;
      let templateKind: 'image' | 'video' | 'set';
      let title: string;
      let coverUrl: string;

      if (isUserJob) {
        const modelCaps = j.modelKey ? findCapabilities(j.modelKey) : undefined;
        const promptVal = j.inputs?.[CREATE_PROMPT_KEY];
        const promptText = promptVal?.kind === 'text' ? promptVal.value.trim() : '';
        templateName =
          (j.modelKey ? getCreateModelDef(j.modelKey)?.name : undefined) ??
          modelCaps?.displayName ??
          'Custom';
        templateKind = modelCaps?.kind === 'video' ? 'video' : 'image';
        // The prompt is the natural title for a user creation; the client
        // renders `outputs[0]` as the thumbnail (no template cover).
        title = promptText.length > 0 ? promptText : 'Custom generation';
        coverUrl = '';
      } else {
        // Template can be null in theory if it was hard-deleted; we
        // never delete in practice (status='archived' instead) but
        // guarding here keeps the response sane no matter what.
        const tpl = j.template;
        const coverRef = tpl?.coverMedia;
        coverUrl = coverRef ? resolveOwnMediaUrl(coverRef, origin) : '';
        // SDK's `kind` enum uses 'set' but DB uses 'image_set' — translate.
        // `video_image` down-maps to 'video' (old installed builds don't
        // know the new kind; the project row's primary asset is the video).
        templateKind =
          tpl?.kind === 'image_set'
            ? 'set'
            : tpl?.kind === 'video_image'
              ? 'video'
              : ((tpl?.kind ?? 'image') as 'image' | 'video');
        templateName = tpl?.title ?? 'Unknown template';
        title = tpl?.title ?? 'Untitled';
      }

      return {
        id: j.id,
        templateId: j.templateId,
        templateName,
        templateCoverImage: coverUrl,
        templateKind,
        title,
        // Provenance — drives the mobile "Custom" badge.
        source: isUserJob ? ('user' as const) : ('template' as const),
        createdAt: j.createdAt.toISOString(),
        whenLabel: '', // formatted by the SDK on the client
        status: sdkStatus,
        count: outputs.length,
        outputs,
      };
    });

    const nextCursor = hasMore
      ? `${page[page.length - 1]!.createdAt.toISOString()}|${page[page.length - 1]!.id}`
      : null;

    // Short edge cache. The list mutates every time a job completes
    // (~30s typical), so a tiny TTL keeps the cold-start cost low
    // without showing stale data for long. Mobile's React-Query
    // staleTime is the real cache control.
    c.header('Cache-Control', 'private, max-age=5');

    return c.json({
      data: {
        items,
        nextCursor,
      },
    });
  },
);

// ─── GET /v1/jobs/:id ───────────────────────────────────────────────
//
// Polled by the mobile app's `generating` screen ~once per second
// while a job is in flight. We return a lean snapshot of the row
// (no template snapshot, no inputs blob) so the response is small
// and HTTP/2 keeps the connection hot.
//
// Auth: the caller must be the job's owner. We don't need a role
// check — Clerk sessions can never read another user's job.
//
// Cache-Control: no-store. Polling endpoints must never sit in any
// shared cache; the whole point is freshness. Edge caching would
// also hide status transitions for `s-maxage` seconds, defeating
// the purpose.
//
// Output URL minting: when the job is complete, we materialize
// `result.images[].r2Key` into full URLs the mobile <Image> tag can
// fetch (via GET /v1/outputs/:key). The SDK could do this client-side,
// but doing it here keeps mobile dumb and lets the Worker swap
// delivery strategies (custom domain, signed URLs) later without a
// mobile release.
jobsRoute.get(
  '/:id',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_READ, byClerkUserId),
  withCurrentUser(),
  async (c) => {
    const jobId = c.req.param('id');

    // Quick UUID sanity check — Hono's path-matcher accepts anything,
    // so we filter out clearly-malformed ids before hitting the DB.
    // The lookup itself is keyed by (id, userId) so an attacker can't
    // probe whether a UUID exists for a different user.
    if (!isUuid(jobId)) {
      return c.json(
        { error: { code: 'invalid_job_id', message: 'Job id is malformed.' } },
        400,
      );
    }

    const userRow = c.var.user!;

    const job = await c.var.db.query.jobs.findFirst({
      where: and(eq(jobs.id, jobId), eq(jobs.userId, userRow.id)),
      columns: {
        id: true,
        templateId: true,
        status: true,
        progress: true,
        result: true,
        error: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
      },
    });

    if (!job) {
      return c.json(
        { error: { code: 'job_not_found', message: 'Job not found.' } },
        404,
      );
    }

    // Materialize output URLs only when there are results to show.
    // `result` is JSONB so it's typed as the persisted shape — we
    // map images first, videos second. Each is tagged with its
    // media kind so mobile picks the right player. The Worker's
    // own host name comes from the request URL so we don't have
    // to thread an env-var in just for this.
    const origin = new URL(c.req.url).origin;
    // Mirror the list endpoint's output shape: surface stored dimensions
    // and the convenience `aspectRatio` so the mobile result hero can lay
    // the asset out at its real ratio instead of guessing 4:5 vs 9:16.
    const outputs: Array<{
      url: string;
      kind: 'image' | 'video';
      width?: number;
      height?: number;
      aspectRatio?: number;
    }> = [];
    if (job.status === 'completed' && job.result) {
      for (const img of job.result.images ?? []) {
        outputs.push({
          url: `${origin}/v1/outputs/${img.r2Key}`,
          kind: 'image',
          width: img.width || undefined,
          height: img.height || undefined,
          aspectRatio: img.width && img.height ? img.width / img.height : undefined,
        });
      }
      for (const vid of job.result.videos ?? []) {
        outputs.push({
          url: `${origin}/v1/outputs/${vid.streamId}`,
          kind: 'video',
          width: vid.width || undefined,
          height: vid.height || undefined,
          aspectRatio:
            vid.aspectRatio ?? (vid.width && vid.height ? vid.width / vid.height : undefined),
        });
      }
    }

    c.header('Cache-Control', 'no-store');
    return c.json({
      data: {
        jobId: job.id,
        // Surfaced so a result screen opened cold (push deep-link, no
        // template id in the route) can still offer Regenerate / Tweak.
        templateId: job.templateId,
        status: job.status,
        progress: job.progress ?? null,
        outputs: outputs.length > 0 ? outputs : undefined,
        error: job.error ?? undefined,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString() ?? null,
        completedAt: job.completedAt?.toISOString() ?? null,
      },
    });
  },
);

// ─── DELETE /v1/jobs/:id ────────────────────────────────────────────
//
// Soft-delete a user's own job from the Projects list. We delete the
// row outright (rather than flipping a `deleted_at`) because:
//   • The credit ledger preserves the financial record via FK — even
//     after deleting `jobs.id`, the ledger rows survive (the FK uses
//     ON DELETE SET NULL on credit_ledger.job_id; if we ever need to
//     restore a per-job audit, that points to "this generation was
//     deleted by the user on <date>").
//   • Output artifacts in R2 stay live until the retention cron
//     cleans them (purge_at-driven). The mobile UI calls this
//     endpoint as a "hide from my history" action, not a destructive
//     wipe — the URL-bearer can still view them.
//
// Idempotency: a delete that finds no row is still a 204. The mobile
// UX optimistically removes the row from the list before this
// network call resolves; the no-op delete makes a retry safe.
//
// Refund policy: we do NOT refund credits on delete. The job was
// authorised and (presumably) ran — the user chose to remove it
// from their list, not request a chargeback.
jobsRoute.delete(
  '/:id',
  withAuth({ required: true }),
  withRateLimit((env) => env.RL_USER_WRITE, byClerkUserId),
  withCurrentUser(),
  async (c) => {
    const jobId = c.req.param('id');
    if (!isUuid(jobId)) {
      return c.json(
        { error: { code: 'invalid_job_id', message: 'Job id is malformed.' } },
        400,
      );
    }

    const userRow = c.var.user!;

    // Compound WHERE clause is the security boundary: an attacker
    // who guesses a job-id from another user gets a no-op delete
    // because the userId filter never matches.
    await c.var.db
      .delete(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.userId, userRow.id)));

    return c.body(null, 204);
  },
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

/**
 * Postgres unique-violation (SQLSTATE 23505). Neon's driver surfaces
 * `.code`; the message check is a belt-and-suspenders fallback for
 * wrapped errors.
 */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === '23505' || /duplicate key value/i.test(e?.message ?? '');
}
