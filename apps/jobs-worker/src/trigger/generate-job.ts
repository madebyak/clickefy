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
import { eq } from 'drizzle-orm';

import {
  jobs,
  templates,
  type JobError,
  type JobInputValue,
  type JobResult,
  type MediaRef,
  type StreamRef,
} from '@clickfy/db';
import {
  compile,
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

import { env } from '../env';
import { getDb } from '../lib/db';
import { resolveJobInputs } from '../lib/input-resolver';
import { reportStage, updateJobProgress } from '../lib/progress';
import { writeOutputObject } from '../lib/r2';
import { isRefundable, refundForJob } from '../lib/refund';

interface GenerateJobPayload {
  /** UUID of the row in the `jobs` table to execute. */
  jobId: string;
}

export const generateJob = task({
  id: 'generate-job',
  // Per-run cap. Gemini single-image ≤ 10s; Kling video ≤ 90s; two
  // stages stacked ≤ 120s. 5 min ceiling absorbs upstream slow days
  // and still lets us notice a truly stuck task before retention
  // would care.
  maxDuration: 300,

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

    // We could read `template_versions.snapshot` for a perfect
    // historical replay, but the working `templates` row is
    // identical in shape and lives in a hot index. For mobile-driven
    // jobs (where the version was just published moments earlier
    // and rarely diverges in seconds), reading the live row is fine
    // — and saves a JSONB deserialisation.
    const template = await db.query.templates.findFirst({
      where: eq(templates.id, jobRow.templateId),
    });
    if (!template) {
      return failJob(jobId, {
        code: 'template_missing',
        message: 'Template no longer exists.',
        stage: 0,
        retryCount: 0,
      });
    }

    // ── Resolve inputs (R2 reads in parallel) ────────────────────
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

    // ── Walk the stages ──────────────────────────────────────────
    const stages = [...template.generation.stages].sort((a, b) => a.order - b.order);
    const totalStages = stages.length;
    const previousOutputs: StageOutputRef[] = [];
    const allOutputKeys: Array<{
      stageIndex: number;
      r2Key: string;
      mimeType: string;
      kind: 'image' | 'video';
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
        templateInputs: template.userInputs,
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
        result = await waitForAsync(result.taskId, result.variant, providerEnv, {
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
        allOutputKeys.push({
          stageIndex: stageNumber,
          r2Key: persisted.r2Key,
          mimeType: mime,
          kind: out.type,
        });
      }
    }

    // ── Mark completed + assemble JobResult ──────────────────────
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    // Which stage outputs are user-facing depends on the template's
    // declared output shape:
    //   • output.type === 'image'  → only the final stage's images
    //   • output.type === 'video'  → only the final stage's videos
    //   • output.type === 'both'   → every stage that produced media
    //     (e.g. `image_then_video`: the stage-1 still + the stage-2
    //     animated video are both shown on the result screen).
    //
    // Previously we always returned only the final stage, which
    // hid the image half of a `both`-type pipeline. With the new
    // result screen rendering mixed outputs in an aspect-aware
    // grid, surfacing both reads naturally.
    // ── User-visible outputs ──────────────────────────────────────
    // Rule: every stage's output is user-visible. If the admin built
    // N stages, each stage is intentional and should appear in the
    // result. This handles all template shapes uniformly:
    //
    //   • single image stage         → 1 image
    //   • 4 parallel image variants  → 4 images (e.g. Luxury set)
    //   • image_then_video chain     → image + video (e.g. Elegant)
    //   • N video stages             → N videos
    //
    // The previous "final-stage only" filter was wrong for parallel
    // pipelines (it kept only stage N) and the per-type filter
    // depended on `template.output.type` being correctly set, which
    // proved fragile in practice (admin UI didn't expose it; created
    // templates inherited stale defaults). Surfacing every produced
    // artifact removes a class of zero-output / one-output bugs and
    // matches user expectations ("I configured 4 stages, give me 4").
    //
    // If we ever need an "internal intermediate" stage (e.g. an
    // upscale step that should NOT be shown to the user), we'll add
    // an explicit per-stage `hidden: true` flag rather than re-add
    // type-based heuristics.
    const userVisibleKeys = allOutputKeys;

    const images: MediaRef[] = userVisibleKeys
      .filter((k) => k.kind === 'image')
      .map((k) => ({
        r2Key: k.r2Key,
        // We don't measure width/height here — that's a downstream
        // optimisation (sharp / imagemagick in a follow-up). Mobile
        // works fine with 0/0 because we hand back the URL and let
        // Cloudflare Images / native layout figure it out.
        width: 0,
        height: 0,
        blurhash: '',
      }));
    const videos: StreamRef[] = userVisibleKeys
      .filter((k) => k.kind === 'video')
      .map((k) => ({
        // For now Kling URLs aren't fronted by Cloudflare Stream, so
        // we slot the R2 key into `streamId` and set duration to 0.
        // Once Stream is wired (post-launch), this populates from
        // the Stream API response.
        streamId: k.r2Key,
        durationSec: 0,
        posterR2Key: k.r2Key,
      }));

    const jobResult: JobResult = {
      images,
      videos,
      durationMs,
      costCredits: template.costCredits,
    };

    await db
      .update(jobs)
      .set({
        status: 'completed',
        result: jobResult,
        completedAt,
        progress: { stage: totalStages, totalStages, message: 'Done' },
      })
      .where(eq(jobs.id, jobId));

    logger.info('generate-job:done', { jobId, durationMs, outputCount: userVisibleKeys.length });
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
  provider: 'gemini' | 'kling',
  _model: string,
  stage: number,
  total: number,
): string {
  if (total > 1) {
    return provider === 'kling'
      ? `Animating (step ${stage} of ${total})`
      : `Generating image (step ${stage} of ${total})`;
  }
  return provider === 'kling' ? 'Generating video' : 'Generating image';
}

function buildProviderEnv(): ProviderEnv {
  return {
    gemini: env.GEMINI_API_KEY ? { apiKey: env.GEMINI_API_KEY } : undefined,
    kling:
      env.KLING_ACCESS_KEY && env.KLING_SECRET_KEY
        ? { accessKey: env.KLING_ACCESS_KEY, secretKey: env.KLING_SECRET_KEY }
        : undefined,
  };
}

/**
 * Block on a Kling async task until it completes or we hit the
 * per-stage poll budget. The provider's own task TTL is in minutes,
 * so the upper bound here is mostly a safety net.
 *
 * Backoff: 2s for the first 30s, then 5s. Keeps the dashboard
 * responsive and avoids burning rate-limit budget on long videos.
 */
async function waitForAsync(
  taskId: string,
  variant: 'image2video' | 'omni',
  providerEnv: ProviderEnv,
  ctx: { jobId: string; stageNumber: number; totalStages: number },
): Promise<ExecuteResult> {
  const start = Date.now();
  const maxMs = 5 * 60 * 1000; // 5 minutes
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

    const result = await pollAsyncTask(taskId, 'kling', variant, providerEnv);
    if (result.status === 'completed') {
      logger.info('generate-job:async-completed', { taskId, attempts: attempt });
      return result;
    }
  }

  logger.error('generate-job:async-timeout', { taskId });
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
  await getDb()
    .update(jobs)
    .set({
      status: 'failed',
      error,
      completedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));

  // Refund credits for infra-class failures only. User-fault codes
  // (bad inputs, unknown_model) stay debited so the user has to
  // correct their submission rather than retrying for free.
  if (isRefundable(error.code)) {
    try {
      await refundForJob(jobId);
    } catch (refundErr) {
      // A refund failure shouldn't mask the original job failure —
      // log loudly and continue. The recovery cron picks up missed
      // refunds on its next sweep.
      logger.error('generate-job:refund-failed', {
        jobId,
        err: String(refundErr),
      });
    }
  }

  return { status: 'failed', error };
}
