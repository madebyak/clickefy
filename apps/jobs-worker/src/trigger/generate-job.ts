/**
 * `generateJob` — the Trigger.dev task that runs a single user
 * generation request.
 *
 * Lifecycle (matches the contract in `jobs.status_enum`):
 *
 *   queued ── (Worker triggers) ──▶ task starts
 *                                       │
 *                                       ▼
 *                                  set 'processing'
 *                                       │
 *                                       ▼
 *                                  for each stage:
 *                                    1. reportStage(...)            ← mobile sees label
 *                                    2. compile(stage, ctx)         ← @clickfy/providers
 *                                    3. executeStage(req, env)      ← Gemini/Kling
 *                                    4. (kling) pollAsyncTask loop
 *                                    5. writeOutputObject(...)      ← R2 PUT
 *                                    6. record output for next stage
 *                                       │
 *                                       ▼
 *                                  set 'completed' + JobResult
 *
 * Errors at any point flip the row to `failed` with a structured
 * `JobError`. Credit refunds for infra-class failures are issued by
 * the same SQL CTE pattern as the debit (see `refund-credits.ts`,
 * planned for a follow-up commit) — for B3 we just persist the
 * error and leave refunds as a TODO in the orchestrator.
 */

import { logger, task } from '@trigger.dev/sdk';
import { and, eq } from 'drizzle-orm';

import {
  jobs,
  projectAssets,
  projects,
  templateVersions,
  type JobError,
  type JobInputValue,
  type JobResult,
  type MediaRef,
  type StreamRef,
  type Template,
} from '@clickfy/db';
import {
  buildCreateStage,
  compile,
  CREATE_END_FRAME_KEY,
  CREATE_PROMPT_KEY,
  CREATE_START_FRAME_KEY,
  executeStage,
  findCapabilities,
  pollAsyncTask,
  type CompileContext,
  type ExecuteOutput,
  type ExecuteResult,
  // (kept) ExecuteOutput type used inside outputBytes helper signature
  type ProviderEnv,
  type RuntimeInputValue,
  type StageOutputRef,
} from '@clickfy/providers';
import type { GenerationStage, Provider, TemplateInputField } from '@clickfy/types';

import { env } from '../env';
import { getDb } from '../lib/db';
import { resolveJobInputs } from '../lib/input-resolver';
import { reportStage, updateJobProgress } from '../lib/progress';
import { pushUser } from '../lib/push';
import { aspectRatioToNumber, probeImageDimensions } from '../lib/media-dimensions';
import { writeOutputObject } from '../lib/r2';
import { isRefundable, refundForJob } from '../lib/refund';

interface GenerateJobPayload {
  /** UUID of the row in the `jobs` table to execute. */
  jobId: string;
}

export const generateJob = task({
  id: 'generate-job',
  // Per-run cap. Sized for the worst-case Seedance stage (15 min
  // wait — see `waitForAsync()`) plus headroom for intake, R2 upload,
  // and an earlier image stage chained in front of it (e.g. Gemini →
  // Seedance template). Gemini-only image jobs still complete in
  // seconds; this only changes what we tolerate before declaring a
  // task truly stuck.
  //
  // Breakdown of the 20 min budget:
  //   - 15 min — Seedance async wait (1080p/10s, 2K, queue contention)
  //   -  2 min — earlier image stage (Gemini / Imagen)
  //   -  2 min — outputs fetch + R2 upload + notification fan-out
  //   -  1 min — slack
  maxDuration: 1200,

  run: async (payload: GenerateJobPayload) => {
    const { jobId } = payload;
    const db = getDb();

    logger.info('generate-job:start', { jobId });

    // ── Load the job row + its frozen template snapshot ──────────
    const jobRow = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
    if (!jobRow) {
      // Shouldn't happen: the Worker only triggers right after the
      // INSERT, but if a row was deleted between trigger and run we
      // log loudly and exit cleanly (no DB side-effect to clean up).
      logger.error('generate-job:job-row-missing', { jobId });
      return { status: 'aborted' as const, reason: 'job_row_missing' };
    }
    if (jobRow.status === 'completed' || jobRow.status === 'failed') {
      // Idempotency: a manual re-trigger should not re-run a finished
      // job. The Worker's idempotency lookup makes this unlikely; the
      // guard here is defence-in-depth.
      logger.warn('generate-job:already-terminal', { jobId, status: jobRow.status });
      return { status: 'skipped' as const, reason: 'already_terminal' };
    }

    // ── Mark as processing ──────────────────────────────────────
    const startedAt = new Date();
    await db
      .update(jobs)
      .set({ status: 'processing', startedAt, progress: emptyProgress() })
      .where(eq(jobs.id, jobId));

    // ── Resolve inputs (R2 reads in parallel) ────────────────────
    // Shared by both paths — hydrates every image/text value in
    // `jobs.inputs` (bytes + url) for the compiler and adapters.
    let inputs: Record<string, RuntimeInputValue>;
    try {
      inputs = await resolveJobInputs(jobRow.inputs as Record<string, JobInputValue>);
    } catch (err) {
      logger.error('generate-job:input-resolve-failed', { jobId, err: String(err) });
      return failJob(jobId, {
        code: 'r2_input_missing',
        message: 'A referenced upload was not found in storage.',
        stage: 0,
        retryCount: 0,
      });
    }

    // ── Build the pipeline (template snapshot OR synthetic create stage) ─
    // Template jobs read frozen stages from a template-version snapshot.
    // Create jobs (source='user') have no template — we synthesize a
    // single stage from the stored model + prompt + attachments via
    // `buildCreateStage`, then run the SAME stage loop / engine.
    let stages: GenerationStage[];
    let stageTemplateInputs: TemplateInputField[];
    let jobCostCredits: number;
    let notifyTitle: string;

    if (jobRow.source === 'user') {
      if (!jobRow.modelKey) {
        return failJob(jobId, {
          code: 'unknown_model',
          message: 'Create job is missing its model.',
          stage: 0,
          retryCount: 0,
        });
      }
      const promptValue = inputs[CREATE_PROMPT_KEY];
      const prompt = promptValue?.kind === 'text' ? promptValue.value : '';
      const opts = (jobRow.options ?? {}) as {
        aspectRatio?: string;
        duration?: number;
        sound?: boolean;
        // The billed tier. Deliberately a plain string: the key vocabulary
        // is per-provider (Kling std/pro/4k, Seedance 480p/720p/1080p/4k,
        // Gemini 1K/2K/4K, OpenAI low/medium/high) and the old Kling-shaped
        // union described only one of them.
        mode?: string;
        // Omni sub-task (Seedance 2.5 edit/extend).
        task?: 'edit' | 'extend';
        // Studio tool request (Camera Angle / Storyboard) — the
        // engineered prompt is composed in buildCreateStage from this.
        tool?: import('@clickfy/providers').CreateToolRequest;
      };
      const rawInputs = jobRow.inputs as Record<string, { kind?: string }>;
      const rawInputKeys = Object.keys(rawInputs);
      // `ref_i` keys in index order, each carrying its media kind — the
      // stage's Seedance reference slots route video/audio clips to the
      // right content[] role from this.
      const refKeys = rawInputKeys
        .filter((k) => k.startsWith('ref_'))
        .sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
      const referenceKinds = refKeys.map((k): 'image' | 'video' | 'audio' => {
        const kind = rawInputs[k]?.kind;
        return kind === 'video' || kind === 'audio' ? kind : 'image';
      });
      try {
        const built = buildCreateStage({
          modelKey: jobRow.modelKey,
          prompt,
          aspectRatio: opts.aspectRatio,
          duration: opts.duration,
          sound: opts.sound,
          mode: opts.mode,
          hasStartFrame: rawInputKeys.includes(CREATE_START_FRAME_KEY),
          hasEndFrame: rawInputKeys.includes(CREATE_END_FRAME_KEY),
          referenceCount: refKeys.length,
          referenceKinds,
          task: opts.task,
          tool: opts.tool,
        });
        stages = [built.stage];
        stageTemplateInputs = built.templateInputs;
      } catch (err) {
        logger.error('generate-job:create-build-failed', { jobId, err: String(err) });
        return failJob(jobId, {
          code: 'unknown_model',
          message: `Model "${jobRow.modelKey}" is not registered.`,
          stage: 0,
          retryCount: 0,
        });
      }
      jobCostCredits = jobRow.costCredits ?? 0;
      notifyTitle = 'Your creation';
    } else {
      // Read from `template_versions.snapshot` (not the live `templates`
      // row) so a published edit between submit and pickup can't change
      // what the user paid for. The jsonb column is typed `unknown`; the
      // cast documents that every snapshot is a `Template` at publish time.
      if (!jobRow.templateVersionId) {
        return failJob(jobId, {
          code: 'template_missing',
          message: 'Template version reference is missing.',
          stage: 0,
          retryCount: 0,
        });
      }
      const versionRow = await db.query.templateVersions.findFirst({
        where: eq(templateVersions.id, jobRow.templateVersionId),
      });
      if (!versionRow) {
        return failJob(jobId, {
          code: 'template_missing',
          message: 'Template version no longer exists.',
          stage: 0,
          retryCount: 0,
        });
      }
      const template = versionRow.snapshot as Template;
      stages = [...template.generation.stages].sort((a, b) => a.order - b.order);

      // Apply the aspect ratio the user picked, when the template offers
      // the choice.
      //
      // Until now this branch never read `jobs.options` at all: the ratio
      // was collected, validated against the first stage's model, and
      // persisted — then ignored, so the user was served whatever the
      // admin froze in. Only `source='user'` jobs honoured it.
      //
      // Three guards make this safe for every template that does NOT use
      // the feature — which today is all of them:
      //   1. `userCanChooseAspectRatio` is read from the FROZEN snapshot,
      //      so a template that never offered the choice can't be altered
      //      even if the live row is edited later.
      //   2. `POST /v1/jobs` already rejects an `aspectRatio` outright
      //      when the flag is off, so `options.aspectRatio` cannot be set
      //      on such a job in the first place.
      //   3. No option → the stage list is passed through untouched.
      //
      // Only the FIRST stage is overridden: that is the stage whose model
      // bounded the choice at validation time, and later stages inherit
      // the frame from its output rather than re-deciding shape.
      const templateOpts = (jobRow.options ?? {}) as { aspectRatio?: string };
      const chosenRatio = templateOpts.aspectRatio;
      if (template.userCanChooseAspectRatio && chosenRatio && stages.length > 0) {
        const first = stages[0]!;
        // Clone rather than mutate — `stages` holds objects owned by the
        // parsed snapshot, and the compiler is handed them directly.
        stages = [
          { ...first, config: { ...first.config, aspectRatio: chosenRatio } },
          ...stages.slice(1),
        ];
        logger.info('generate-job:user-aspect-ratio', {
          jobId,
          aspectRatio: chosenRatio,
          stage: first.id,
        });
      }

      stageTemplateInputs = template.userInputs;
      jobCostCredits = template.costCredits;
      notifyTitle = template.title;
    }

    // ── Walk the stages ──────────────────────────────────────────
    const totalStages = stages.length;
    const previousOutputs: StageOutputRef[] = [];
    const allOutputKeys: Array<{
      stageIndex: number;
      r2Key: string;
      mimeType: string;
      kind: 'image' | 'video';
      /** Probed from the bytes (images). */
      width?: number;
      height?: number;
      /** Real provider-reported duration (videos). */
      durationSec?: number;
      /** Probed (images) or requested `stage.config.aspectRatio` fallback. */
      aspectRatio?: number;
    }> = [];

    const providerEnv = buildProviderEnv();

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i]!;
      const stageNumber = i + 1;

      await reportStage(jobId, {
        stage: stageNumber,
        totalStages,
        message: stageMessage(stage.provider, stage.model, stageNumber, totalStages),
      });

      const capabilities = findCapabilities(stage.model);
      if (!capabilities) {
        return failJob(jobId, {
          code: 'unknown_model',
          message: `Model "${stage.model}" is not registered.`,
          stage: stageNumber,
          retryCount: 0,
        });
      }

      // Compile prompt + references into the provider-native shape.
      // `compile()` is total — anything ambiguous comes back as a
      // `CompileWarning` (the admin form treats those as soft errors,
      // but the runtime executor proceeds with the best-effort request
      // because aborting here would charge the user for nothing).
      const ctx: CompileContext = {
        stage,
        templateInputs: stageTemplateInputs,
        inputValues: inputs,
        previousOutputs,
        capabilities,
      };
      const compileResult = compile(ctx);
      if (compileResult.warnings.length > 0) {
        logger.warn('generate-job:compile-warnings', {
          jobId,
          stage: stageNumber,
          warnings: compileResult.warnings,
        });
      }

      // Fire the adapter. Synchronous providers return outputs
      // immediately; Kling returns `pending` + taskId so we poll.
      let result: ExecuteResult;
      try {
        result = await executeStage(compileResult.request, providerEnv);
      } catch (err) {
        logger.error('generate-job:execute-failed', {
          jobId,
          stage: stageNumber,
          err: String(err),
        });
        return failJob(jobId, {
          code: 'provider_error',
          message: errorToMessage(err),
          stage: stageNumber,
          retryCount: 0,
        });
      }

      if (result.status === 'pending') {
        // Both Kling and Seedance are async; the variant only matters
        // for Kling's two endpoint shapes. Seedance has a single
        // poll endpoint, so we pass a sentinel value the dispatcher
        // ignores.
        const pendingProvider = result.provider;
        const variant = pendingProvider === 'kling' ? result.variant : 'image2video';
        const api2 = pendingProvider === 'kling' ? result.api2 === true : false;
        result = await waitForAsync(result.taskId, pendingProvider, variant, providerEnv, api2, {
          jobId,
          stageNumber,
          totalStages,
        });
        if (result.status !== 'completed') {
          return failJob(jobId, {
            code: 'provider_timeout',
            message: 'Provider took too long to return a result.',
            stage: stageNumber,
            retryCount: 0,
          });
        }
      }

      // Persist each output piece to R2. We need a `StageOutputRef`
      // for the next stage's compile context — that's what carries
      // the binary forward in multi-stage pipelines.
      for (let j = 0; j < result.outputs.length; j++) {
        const out = result.outputs[j]!;
        const bytes = await outputBytes(out);
        const mime = out.mimeType ?? defaultMimeFor(out.type);
        const persisted = await writeOutputObject({
          jobId,
          stageIndex: stageNumber,
          outputIndex: j,
          bytes,
          mimeType: mime,
        });

        previousOutputs.push({
          stageIndex: stageNumber,
          kind: out.type,
          r2Key: persisted.r2Key,
          bytes,
          mimeType: mime,
          url: out.url,
        });
        // Capture real dimensions while the bytes are in memory: images
        // are header-probed (PNG/JPEG/WebP, no decode); videos fall back
        // to the ratio the stage REQUESTED (`stage.config.aspectRatio`) —
        // good enough for true-shape layout on mobile. Without this the
        // result screen guessed 4:5/9:16 and cropped everything else.
        const probed = out.type === 'image' ? probeImageDimensions(bytes) : null;
        const requestedRatio = aspectRatioToNumber(stage.config?.aspectRatio);
        allOutputKeys.push({
          stageIndex: stageNumber,
          r2Key: persisted.r2Key,
          mimeType: mime,
          kind: out.type,
          width: probed?.width,
          height: probed?.height,
          durationSec: out.durationSec,
          aspectRatio: probed ? probed.width / probed.height : (requestedRatio ?? undefined),
        });
      }
    }

    // ── Mark completed + assemble JobResult ──────────────────────
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    // ── User-visible outputs ──────────────────────────────────────
    //
    // Default: every stage's output reaches the user. If the admin built
    // N stages, each was intentional — 4 parallel image variants give 4
    // images, an image→video chain gives both. This deliberately does
    // NOT consult `template.kind`, `generation.mode` or `output.type`:
    // those describe how a template is LABELLED, and earlier versions
    // that keyed visibility off them produced zero-output and
    // one-output bugs whenever a label drifted from the pipeline.
    //
    // The single exception is `stage.hidden`, set per stage by the
    // admin. A hidden stage still runs, still persists to R2, still
    // feeds later stages via `previousOutputs`, and is still billed —
    // only its artifact is withheld. That covers the "generate a still,
    // then animate it, deliver only the video" shape, where the still
    // is scaffolding rather than a deliverable.
    //
    // Keyed on the same 1-based sorted position `allOutputKeys.stageIndex`
    // was built from, NOT on `stage.order`, so the two cannot drift if a
    // template ever carries a non-contiguous order.
    const hiddenStageNumbers = new Set<number>();
    stages.forEach((s, i) => {
      if (s.hidden) hiddenStageNumbers.add(i + 1);
    });

    // Every stage hidden means an empty result screen. The API refuses
    // to publish a template in that shape, but a snapshot frozen before
    // that guard existed could still reach here — show everything
    // rather than hand back nothing.
    const allHidden =
      hiddenStageNumbers.size > 0 && hiddenStageNumbers.size >= stages.length;
    if (allHidden) {
      logger.warn('generate-job:all-stages-hidden', {
        jobId,
        stages: stages.length,
        note: 'showing every output instead of returning nothing',
      });
    }

    const userVisibleKeys =
      hiddenStageNumbers.size === 0 || allHidden
        ? allOutputKeys
        : allOutputKeys.filter((k) => !hiddenStageNumbers.has(k.stageIndex));

    const images: MediaRef[] = userVisibleKeys
      .filter((k) => k.kind === 'image')
      .map((k) => ({
        r2Key: k.r2Key,
        // Header-probed at persist time (PNG/JPEG/WebP). 0 only when the
        // probe couldn't recognise the format — mobile then letterboxes
        // via its contain fallback instead of cropping.
        width: k.width ?? 0,
        height: k.height ?? 0,
        blurhash: '',
      }));
    const videos: StreamRef[] = userVisibleKeys
      .filter((k) => k.kind === 'video')
      .map((k) => ({
        // For now Kling URLs aren't fronted by Cloudflare Stream, so
        // we slot the R2 key into `streamId`. Once Stream is wired
        // (post-launch), this populates from the Stream API response.
        streamId: k.r2Key,
        durationSec: k.durationSec ?? 0,
        posterR2Key: k.r2Key,
        width: k.width,
        height: k.height,
        // Requested-ratio fallback — lets mobile render the true shape.
        aspectRatio: k.aspectRatio,
      }));

    const jobResult: JobResult = {
      images,
      videos,
      durationMs,
      costCredits: jobCostCredits,
    };

    // Gated on `status = 'processing'`: if the stuck-job sweeper already
    // declared this run dead (marked failed + refunded), completing now
    // would hand the user both the refund AND the finished output. When
    // the guard misses we keep the sweeper's verdict and skip the push.
    const completedRows = await db
      .update(jobs)
      .set({
        status: 'completed',
        result: jobResult,
        completedAt,
        progress: { stage: totalStages, totalStages, message: 'Done' },
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, 'processing')))
      .returning();

    if (completedRows.length === 0) {
      logger.warn('generate-job:finalize-skipped', {
        jobId,
        reason: 'row no longer processing (sweeper likely refunded it)',
      });
      return { status: 'superseded' as const, durationMs };
    }

    // ── Materialize project assets (web studio) ────────────────────
    // Only when the job is filed into a project (`project_id` set by
    // POST /v1/jobs/create; NULL for all mobile jobs). Runs inside the
    // finalize-winner branch so a sweeper-refunded run never files
    // assets, and `onConflictDoNothing` on the unique
    // (project_id, job_id, output_index) makes Trigger.dev retries
    // idempotent. Ordering matches the client-visible outputs array
    // (images first, then videos).
    const completedProjectId = completedRows[0]!.projectId;
    if (completedProjectId) {
      try {
        const assetRows = [
          ...images.map((img, i) => ({
            projectId: completedProjectId,
            userId: jobRow.userId,
            jobId,
            outputIndex: i,
            kind: 'image' as const,
            r2Key: img.r2Key,
            width: img.width || null,
            height: img.height || null,
          })),
          ...videos.map((vid, i) => ({
            projectId: completedProjectId,
            userId: jobRow.userId,
            jobId,
            outputIndex: images.length + i,
            kind: 'video' as const,
            r2Key: vid.streamId,
            width: vid.width ?? null,
            height: vid.height ?? null,
            durationSec: vid.durationSec || null,
            posterR2Key: vid.posterR2Key,
          })),
        ];
        if (assetRows.length > 0) {
          await db.insert(projectAssets).values(assetRows).onConflictDoNothing();
          // Bump the project's recency so it surfaces at the top of the
          // studio sidebar the moment its new assets land.
          await db
            .update(projects)
            .set({ updatedAt: new Date() })
            .where(eq(projects.id, completedProjectId));
        }
      } catch (err) {
        // Filing must never flip a completed job's status — the outputs
        // exist and the user paid; the web app also falls back to job
        // history. Log loudly and move on.
        logger.error('generate-job:project-assets-failed', {
          jobId,
          projectId: completedProjectId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info('generate-job:done', { jobId, durationMs, outputCount: userVisibleKeys.length });

    // Ping the user that the generation is ready. Fire-and-forget —
    // a push failure must not flip a completed job's status. Done
    // here (rather than in a trailing cron) so the user sees the
    // notification within seconds of the last R2 PUT landing.
    void pushUser({
      userId: jobRow.userId,
      title: 'Your creation is ready',
      body:
        notifyTitle.length > 0
          ? `${notifyTitle} is done. Tap to view.`
          : 'Tap to view your latest generation.',
      // Payload the mobile handler uses to deep-link straight into
      // the result screen instead of the home tab.
      data: { type: 'job_completed', jobId },
    });

    return { status: 'completed' as const, durationMs, outputs: userVisibleKeys.length };
  },
});

// ─── Helpers ────────────────────────────────────────────────────────

function emptyProgress() {
  return { stage: 0, totalStages: 0, message: 'Starting…' };
}

/**
 * Friendly, present-tense label per stage. Mobile renders this
 * verbatim, so we keep it short and avoid technical jargon
 * (no "Calling Gemini 2.5 Flash Image API" — just "Generating image").
 */
function stageMessage(
  provider: Provider,
  _model: string,
  stage: number,
  total: number,
): string {
  const isVideo = provider === 'kling' || provider === 'seedance';
  if (total > 1) {
    return isVideo
      ? `Animating (step ${stage} of ${total})`
      : `Generating image (step ${stage} of ${total})`;
  }
  return isVideo ? 'Generating video' : 'Generating image';
}

function buildProviderEnv(): ProviderEnv {
  return {
    gemini: env.GEMINI_API_KEY ? { apiKey: env.GEMINI_API_KEY } : undefined,
    kling:
      env.KLING_ACCESS_KEY && env.KLING_SECRET_KEY
        ? { accessKey: env.KLING_ACCESS_KEY, secretKey: env.KLING_SECRET_KEY }
        : undefined,
    klingApi2: env.KLING_API_KEY ? { apiKey: env.KLING_API_KEY } : undefined,
    seedance: env.SEEDANCE_API_KEY ? { apiKey: env.SEEDANCE_API_KEY } : undefined,
    openai: env.OPENAI_API_KEY ? { apiKey: env.OPENAI_API_KEY } : undefined,
  };
}

/**
 * Block on a Kling / Seedance async task until it completes or we hit
 * the per-stage poll budget. The provider's own task TTL is in the
 * hours range, so the upper bound here is purely a safety net.
 *
 * Per-provider budgets:
 *   - kling    →  5 min  (most Kling v2.x videos finish in 60–120s)
 *   - seedance → 15 min  (1080p/10s commonly takes 6–10 min;
 *                          2K can push past 10 min; account-level
 *                          queueing adds more on busy days)
 *
 * Backoff: 2s for the first 30s, then 5s. Keeps the dashboard
 * responsive and avoids burning rate-limit budget on long videos.
 */
async function waitForAsync(
  taskId: string,
  provider: 'kling' | 'seedance',
  variant: 'text2video' | 'image2video' | 'omni',
  providerEnv: ProviderEnv,
  /** Kling API 2.0 task — polls `GET /tasks` instead of the legacy URL. */
  api2: boolean,
  ctx: { jobId: string; stageNumber: number; totalStages: number },
): Promise<ExecuteResult> {
  const start = Date.now();
  const maxMs = provider === 'seedance' ? 15 * 60 * 1000 : 5 * 60 * 1000;
  let attempt = 0;

  while (Date.now() - start < maxMs) {
    attempt += 1;
    const elapsed = Math.round((Date.now() - start) / 1000);
    await updateJobProgress(ctx.jobId, {
      stage: ctx.stageNumber,
      totalStages: ctx.totalStages,
      message: `Animating (${elapsed}s elapsed)`,
    });

    const delayMs = elapsed < 30 ? 2_000 : 5_000;
    await new Promise((r) => setTimeout(r, delayMs));

    const result = await pollAsyncTask(taskId, provider, variant, providerEnv, api2);
    if (result.status === 'completed') {
      logger.info('generate-job:async-completed', { taskId, provider, attempts: attempt });
      return result;
    }
  }

  logger.error('generate-job:async-timeout', { taskId, provider });
  // Return a synthetic pending result so the caller's `if (result.status !==
  // 'completed')` branch trips and converts this to a `provider_timeout`
  // failure. The variant only matters for Kling; for Seedance it's ignored.
  if (provider === 'seedance') {
    return { status: 'pending', taskId, provider: 'seedance' };
  }
  return { status: 'pending', taskId, provider: 'kling', variant };
}

/**
 * Turn an `ExecuteOutput` into the raw bytes we PUT to R2. Gemini
 * returns base64, Kling returns a URL we need to fetch. Hosted-URL
 * outputs from other providers will land here too.
 */
async function outputBytes(out: ExecuteOutput): Promise<Uint8Array> {
  if (out.base64) {
    return Uint8Array.from(Buffer.from(out.base64, 'base64'));
  }
  if (out.url) {
    const res = await fetch(out.url);
    if (!res.ok) {
      throw new Error(`Failed to fetch provider output ${out.url}: ${res.status}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }
  throw new Error('ExecuteOutput has neither base64 nor url — cannot persist.');
}

function defaultMimeFor(kind: 'image' | 'video'): string {
  return kind === 'image' ? 'image/png' : 'video/mp4';
}

function errorToMessage(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 280);
  return String(err).slice(0, 280);
}

async function failJob(jobId: string, error: JobError): Promise<{ status: 'failed'; error: JobError }> {
  const [row] = await getDb()
    .update(jobs)
    .set({
      status: 'failed',
      error,
      completedAt: new Date(),
    })
    .where(eq(jobs.id, jobId))
    .returning();

  // Refund credits for infra-class failures only. User-fault codes
  // (bad inputs, unknown_model) stay debited so the user has to
  // correct their submission rather than retrying for free.
  //
  // `refunded` reflects the ACTUAL outcome, not eligibility — the push
  // copy below must never claim a refund that didn't happen. A return
  // of 0 from refundForJob means the refund already applied on an
  // earlier attempt (idempotent re-call), which still counts: the user
  // has their credits either way. Only a throw leaves refunded=false.
  let refunded = false;
  if (isRefundable(error.code)) {
    try {
      await refundForJob(jobId);
      refunded = true;
    } catch (refundErr) {
      // A refund failure shouldn't mask the original job failure — log
      // loudly and continue. NOTE: nothing retries a missed refund
      // automatically (the stuck-job sweeper only touches `processing`
      // rows, never `failed` ones), so this log line is the only trace.
      logger.error('generate-job:refund-failed', {
        jobId,
        err: String(refundErr),
      });
    }
  }

  // Push the user about the failure too — silent failures (job
  // sitting in "failed" forever with no notification) are the worst
  // possible UX. Copy is intentionally generic: we don't surface the
  // internal error code, and the deep-link sends them to the result
  // screen where they can hit "Try again".
  if (row?.userId) {
    void pushUser({
      userId: row.userId,
      title: 'Generation didn’t complete',
      body: refunded
        ? 'Something went wrong on our end — your credits were refunded.'
        : 'Something went wrong. Tap to see what happened.',
      data: { type: 'job_failed', jobId, refunded },
    });
  }

  return { status: 'failed', error };
}
