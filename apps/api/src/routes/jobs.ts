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

import { jobs, templates, users as usersTable } from '@clickfy/db';
import { findCapabilities } from '@clickfy/providers';

import type { AppEnv } from '../types';
import { withAuth, withCurrentUser } from '../middleware/with-auth';
import { createJobSchema } from '../lib/job-schemas';
import { validateJobSubmission } from '../lib/job-validation';
import { createJobAtomically } from '../lib/job-create';
import { dispatchJob } from '../lib/dispatch-job';

export const jobsRoute = new Hono<AppEnv>();

// ─── POST /v1/jobs ──────────────────────────────────────────────────

jobsRoute.post(
  '/',
  withAuth({ required: true }),
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
      });
    } catch (err) {
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
  async (c) => {
    const clerkUserId = c.var.clerkUserId;
    if (!clerkUserId) {
      return c.json(
        { error: { code: 'unauthenticated', message: 'Sign in required.' } },
        401,
      );
    }

    const userRow = await c.var.db.query.users.findFirst({
      where: eq(usersTable.clerkUserId, clerkUserId),
      columns: { id: true },
    });
    if (!userRow) {
      return c.json(
        { error: { code: 'user_not_provisioned', message: 'Account not provisioned.' } },
        401,
      );
    }

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
      const outputs: Array<{ url: string; kind: 'image' | 'video' }> = [
        ...finalImages.map((i) => ({
          url: `${origin}/v1/outputs/${i.r2Key}`,
          kind: 'image' as const,
        })),
        ...finalVideos.map((v) => ({
          url: `${origin}/v1/outputs/${v.streamId}`,
          kind: 'video' as const,
        })),
      ];

      // Map DB status to the SDK's slightly different enum
      // (`ready` instead of `completed` — historical from the mock).
      const sdkStatus: 'queued' | 'processing' | 'ready' | 'failed' =
        j.status === 'completed' ? 'ready' : (j.status as 'queued' | 'processing' | 'failed');

      // Template can be null in theory if it was hard-deleted; we
      // never delete in practice (status='archived' instead) but
      // guarding here keeps the response sane no matter what.
      const tpl = j.template;
      const coverRef = tpl?.coverMedia;
      const coverUrl = coverRef
        ? (coverRef.cdnUrl ?? `${origin}/v1/uploads/${coverRef.r2Key}`)
        : '';
      // SDK's `kind` enum uses 'set' but DB uses 'image_set' — translate.
      const sdkKind: 'image' | 'video' | 'set' =
        tpl?.kind === 'image_set' ? 'set' : ((tpl?.kind ?? 'image') as 'image' | 'video');
      return {
        id: j.id,
        templateId: j.templateId,
        templateName: tpl?.title ?? 'Unknown template',
        templateCoverImage: coverUrl,
        templateKind: sdkKind,
        title: tpl?.title ?? 'Untitled',
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
  async (c) => {
    const clerkUserId = c.var.clerkUserId;
    if (!clerkUserId) {
      return c.json(
        { error: { code: 'unauthenticated', message: 'Sign in required.' } },
        401,
      );
    }

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

    // Resolve Clerk subject → users.id. We don't need the full row
    // here (no credit operations), just the FK to scope the lookup.
    const userRow = await c.var.db.query.users.findFirst({
      where: eq(usersTable.clerkUserId, clerkUserId),
      columns: { id: true },
    });
    if (!userRow) {
      return c.json(
        { error: { code: 'user_not_provisioned', message: 'Account not provisioned.' } },
        401,
      );
    }

    const job = await c.var.db.query.jobs.findFirst({
      where: and(eq(jobs.id, jobId), eq(jobs.userId, userRow.id)),
      columns: {
        id: true,
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
    const outputs: Array<{ url: string; kind: 'image' | 'video' }> = [];
    if (job.status === 'completed' && job.result) {
      for (const img of job.result.images ?? []) {
        outputs.push({ url: `${origin}/v1/outputs/${img.r2Key}`, kind: 'image' });
      }
      for (const vid of job.result.videos ?? []) {
        outputs.push({ url: `${origin}/v1/outputs/${vid.streamId}`, kind: 'video' });
      }
    }

    c.header('Cache-Control', 'no-store');
    return c.json({
      data: {
        jobId: job.id,
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
  async (c) => {
    const clerkUserId = c.var.clerkUserId;
    if (!clerkUserId) {
      return c.json(
        { error: { code: 'unauthenticated', message: 'Sign in required.' } },
        401,
      );
    }

    const jobId = c.req.param('id');
    if (!isUuid(jobId)) {
      return c.json(
        { error: { code: 'invalid_job_id', message: 'Job id is malformed.' } },
        400,
      );
    }

    const userRow = await c.var.db.query.users.findFirst({
      where: eq(usersTable.clerkUserId, clerkUserId),
      columns: { id: true },
    });
    if (!userRow) {
      return c.json(
        { error: { code: 'user_not_provisioned', message: 'Account not provisioned.' } },
        401,
      );
    }

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
