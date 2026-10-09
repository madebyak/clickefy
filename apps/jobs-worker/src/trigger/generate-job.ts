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

import { logger, task, wait } from '@trigger.dev/sdk';
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
  AD_SCRIPT_COST_USD,
  buildCreateStage,
  compile,
  CREATE_END_FRAME_KEY,
  CREATE_PROMPT_KEY,
  CREATE_START_FRAME_KEY,
  executeStage,
  failedStageCost,
  findCapabilities,
  isProviderTaskFailedError,
  stageCost,
  summariseJobCost,
  type StageCost,
  pollAsyncTask,
  type CompileContext,
  type ExecuteOutput,
  type ExecuteResult,
  // (kept) ExecuteOutput type used inside outputBytes helper signature
  type ProviderEnv,
  type RuntimeInputValue,
  type StageOutputRef,
} from '@clickfy/providers';
import {
  type AudioRef,
  type ContentItemLabeller,
  explainProviderError,
  type GenerationStage,
  isJobErrorReason,
  type JobErrorReason,
  jobErrorMessage,
  type Provider,
  type TemplateInputField,
  aspectRatioToNumber,
  probeImageDimensions,
} from '@clickfy/types';

import { env } from '../env';
import { getDb } from '../lib/db';
import { loadDynamicModels } from '../lib/dynamic-models';
import { resolveJobInputs } from '../lib/input-resolver';
import { reportStage, updateJobProgress } from '../lib/progress';
import { pushUser } from '../lib/push';
import { writeOutputObject } from '../lib/r2';
import { isRefundable, refundForJob } from '../lib/refund';
import { persistOutputRenditions } from '../lib/renditions';

interface GenerateJobPayload {
  /** UUID of the row in the `jobs` table to execute. */
  jobId: string;
}

export const generateJob = task({
  id: 'generate-job',
  // Every crash in the run history is `TASK_PROCESS_OOM_KILLED` on the
  // platform default (small-1x, 0.5 GB). A video stage holds the provider
  // download, its R2 copy and any earlier stage's bytes at once, and a 4K
  // image goes through base64 on the way to Gemini — none of which fits
  // in half a gigabyte. medium-1x (1 vCPU / 2 GB) is 2.5x the price of
  // small-1x on a run that costs a fraction of a cent; presets are not
  // gated by plan. The crons stay on the default — they touch rows, not
  // media.
  machine: 'medium-1x',
  // An OOM is a crash, not a failure: the config-level `retries` never
  // fire for it (every crashed run in history shows attemptNumber 1).
  // This is the dedicated hook — the retry re-runs on a bigger machine,
  // and costs nothing unless a run actually hits the ceiling.
  retry: { outOfMemory: { machine: 'large-1x' } },
  // Per-run cap. Sized for the worst-case async video stage (15 min
  // wait for Kling or Seedance — see `ASYNC_POLL_BUDGET_MS`) plus
  // headroom for intake, R2 upload, and an earlier image stage chained
  // in front of it (e.g. Gemini → Seedance template). Gemini-only image
  // jobs still complete in seconds; this only changes what we tolerate
  // before declaring a task truly stuck. Trigger.dev measures this in
  // CPU time, and the poll loop's `wait.for` sleeps are excluded.
  //
  // Breakdown of the 20 min budget:
  //   - 15 min — async video wait (Kling or Seedance)
  //   -  2 min — earlier image stage (Gemini / Imagen)
  //   -  2 min — outputs fetch + R2 upload + notification fan-out
  //   -  1 min — slack
  maxDuration: 1200,

  run: async (payload: GenerateJobPayload) => {
    const { jobId } = payload;
    const db = getDb();

    logger.info('generate-job:start', { jobId });

    // Database-driven fal models join the registry before any lookup.
    // A failure here is logged, not fatal: code-registry models still run.
    try {
      const n = await loadDynamicModels();
      if (n > 0) logger.info('generate-job:dynamic-models', { registered: n });
    } catch (err) {
      logger.warn('generate-job:dynamic-models failed', { err: String(err) });
    }

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
    // Names the attachment a provider error points at (`content[3]`), so
    // the user reads "Image 2 is too small" rather than an array index.
    const contentLabel = contentItemLabeller(jobRow.inputs as Record<string, { kind?: string }>);

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
        // Seedance Draft mode: a 480p preview, or the final generated
        // from a finished draft's provider task id.
        draft?: boolean;
        draftTaskId?: string;
        // Kling multi-shot storyboard.
        shots?: Array<{ seconds: number; text: string }>;
        // Studio tool request (Camera Angle / Storyboard) — the
        // engineered prompt is composed in buildCreateStage from this.
        tool?: import('@clickfy/providers').CreateToolRequest;
        // Video Upscaler settings, as charged for at submit.
        upscale?: import('@clickfy/types').UpscaleOptions;
        // Audio models: voice and settings from the Audio page.
        audio?: import('@clickfy/providers').BuildCreateStageInput['audio'];
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
          draft: opts.draft,
          draftTaskId: opts.draftTaskId,
          shots: opts.shots,
          tool: opts.tool,
          upscale: opts.upscale,
          audio: opts.audio,
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
      kind: 'image' | 'video' | 'audio';
      /** Probed from the bytes (images: header; videos: ffprobe). */
      width?: number;
      height?: number;
      /** Probed clip length, else the provider-reported one (videos). */
      durationSec?: number;
      /** Probed (images) or requested `stage.config.aspectRatio` fallback. */
      aspectRatio?: number;
      /** Grid companions — see lib/renditions.ts. Null when a step failed. */
      posterR2Key: string | null;
      previewR2Key: string | null;
      thumbhash: string | null;
      sizeBytes?: number;
    }> = [];

    const providerEnv = buildProviderEnv();

    // ── Cost accounting ──────────────────────────────────────────
    // What each stage cost us, worked out from the rate card and the
    // units it consumed the moment it finishes, and frozen on the row
    // at completion or failure. See `@clickfy/types/provider-cost`.
    const stageCosts: StageCost[] = [];
    const requestIds: string[] = [];
    const costOpts = (jobRow.options ?? {}) as {
      mode?: string; duration?: number; sound?: boolean; inputVideoSeconds?: number; sourceSeconds?: number;
      aspectRatio?: string; upscale?: { fps?: number; tier?: string };
      /** Audio jobs: the text's length and the voice changer's source length, as billed at submit. */
      textChars?: number; inputAudioSeconds?: number;
      tool?: { kind?: string; writer?: string };
    };
    // One-Click Ad: the prompt-writing call on the API is part of what
    // this job cost us, so it rides along as a stage-0 unit.
    if (costOpts.tool?.kind === 'ad') {
      stageCosts.push({
        stage: 0, model: costOpts.tool.writer ?? 'gemini', provider: 'gemini', unit: 'call', quantity: 1,
        unitPriceUsd: AD_SCRIPT_COST_USD, usd: AD_SCRIPT_COST_USD, mode: null, basis: 'estimated', note: 'ad brief written by a vision model',
      });
    }
    const referenceCount = Object.values((jobRow.inputs ?? {}) as Record<string, { kind?: string } | undefined>)
      .filter((v) => v && v.kind !== 'text').length;
    const costFactsFor = (stage: GenerationStage) => {
      const cfg = (stage.config ?? {}) as { mode?: string; duration?: number; sound?: boolean | string; aspectRatio?: string };
      return {
        modelKey: stage.model,
        provider: stage.provider,
        mode: cfg.mode ?? costOpts.mode ?? null,
        durationSeconds: cfg.duration ?? costOpts.duration ?? null,
        inputVideoSeconds: costOpts.inputVideoSeconds ?? costOpts.sourceSeconds ?? null,
        textChars: costOpts.textChars ?? (stage.provider === 'elevenlabs' ? stage.prompt?.length ?? null : null),
        sound: cfg.sound === true || cfg.sound === 'on' || costOpts.sound === true,
        aspectRatio: cfg.aspectRatio ?? costOpts.aspectRatio ?? null,
        upscale: costOpts.upscale ?? null,
        references: referenceCount,
      };
    };
    /** Fail the job, charging the failing stage by the provider's failure rule plus every stage already done. */
    const failWithCost = (stageNumber: number, error: JobError, reachedProvider: boolean) => {
      const stage = stages[stageNumber - 1];
      const failing = stage
        ? failedStageCost(stageNumber, costFactsFor(stage), findCapabilities(stage.model), {
            reachedProvider,
            reason: error.reason ?? null,
            errorCode: error.code,
          })
        : null;
      const all = failing ? [...stageCosts, failing] : stageCosts;
      return failJob(jobId, error, {
        provider: stages[0]?.provider ?? null,
        requestIds,
        ...summariseJobCost(all),
      });
    };
    // The provider's id for the last async stage, kept on the result: a
    // Seedance Draft's final is generated from it, and nothing else
    // records which provider task produced an output.
    let providerTaskId: string | undefined;

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
        return failWithCost(stageNumber, providerJobError(err, stageNumber, contentLabel), true);
      }

      if (result.status === 'pending') {
        // Both Kling and Seedance are async; the variant only matters
        // for Kling's two endpoint shapes. Seedance has a single
        // poll endpoint, so we pass a sentinel value the dispatcher
        // ignores.
        const pendingProvider = result.provider;
        providerTaskId = result.taskId;
        requestIds.push(result.taskId);
        const variant = pendingProvider === 'kling' ? result.variant : 'image2video';
        const api2 = pendingProvider === 'kling' ? result.api2 === true : false;
        try {
          result = await waitForAsync(
            result.taskId,
            pendingProvider,
            variant,
            providerEnv,
            api2,
            { jobId, stageNumber, totalStages },
            // fal addresses a queued task by endpoint + id, unlike Kling
            // and Seedance where the id alone is enough.
            pendingProvider === 'fal' ? result.endpoint : undefined,
          );
        } catch (err) {
          // The provider said the task failed (e.g. Seedance classifying a
          // References prompt as an edit), or polling kept erroring. Fail
          // the job HERE — letting the throw escape the run makes Trigger.dev
          // re-run the whole job, which submits the generation again.
          logger.error('generate-job:async-failed', {
            jobId,
            stage: stageNumber,
            err: String(err),
          });
          return failWithCost(stageNumber, providerJobError(err, stageNumber, contentLabel), true);
        }
        if (result.status !== 'completed') {
          return failWithCost(
            stageNumber,
            { code: 'provider_timeout', message: 'Provider took too long to return a result.', stage: stageNumber, retryCount: 0 },
            true,
          );
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
        // Grid renditions while the bytes are in memory: a poster frame,
        // a muted preview clip and a ThumbHash for videos, a ThumbHash
        // for images. Best-effort by contract — a failure logs and the
        // output keeps its original only, never delaying or failing the
        // job over a thumbnail.
        const renditions = await persistOutputRenditions({
          r2Key: persisted.r2Key,
          kind: out.type,
          bytes,
          onWarn: (message, detail) =>
            logger.warn('generate-job:renditions', { jobId, stage: stageNumber, message, ...detail }),
        });

        // Real dimensions: images are header-probed (PNG/JPEG/WebP, no
        // decode); videos come from ffprobe when the rendition step got
        // that far, else fall back to the ratio the stage REQUESTED
        // (`stage.config.aspectRatio`) — good enough for true-shape
        // layout. Without this the result screen guessed 4:5/9:16.
        const probed =
          out.type === 'image'
            ? probeImageDimensions(bytes)
            : renditions.width && renditions.height
              ? { width: renditions.width, height: renditions.height }
              : null;
        const requestedRatio = aspectRatioToNumber(stage.config?.aspectRatio);
        allOutputKeys.push({
          stageIndex: stageNumber,
          r2Key: persisted.r2Key,
          mimeType: mime,
          kind: out.type,
          width: probed?.width,
          height: probed?.height,
          durationSec: renditions.durationSec ?? out.durationSec,
          aspectRatio: probed ? probed.width / probed.height : (requestedRatio ?? undefined),
          posterR2Key: renditions.posterR2Key,
          previewR2Key: renditions.previewR2Key,
          thumbhash: renditions.thumbhash,
          sizeBytes: bytes.byteLength,
        });
      }

      // The stage is done: price it from what it consumed and returned.
      const stageOutputs = allOutputKeys.filter((k) => k.stageIndex === stageNumber);
      const usage = (result as { usage?: { videoTokens?: number | null; durationSec?: number | null } }).usage ?? null;
      const cost = stageCost(
        stageNumber,
        {
          ...costFactsFor(stage),
          outputs: Math.max(1, result.outputs.length),
          outputDurationSec: stageOutputs.find((k) => k.kind === 'video' || k.kind === 'audio')?.durationSec ?? null,
          usage,
        },
        capabilities,
      );
      if (cost) stageCosts.push(cost);
      else logger.warn('generate-job:cost-unpriced', { jobId, stage: stageNumber, model: stage.model });
    }
    const jobCost = summariseJobCost(stageCosts);

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
        thumbhash: k.thumbhash,
      }));
    const videos: StreamRef[] = userVisibleKeys
      .filter((k) => k.kind === 'video')
      .map((k) => ({
        // For now Kling URLs aren't fronted by Cloudflare Stream, so
        // we slot the R2 key into `streamId`. Once Stream is wired
        // (post-launch), this populates from the Stream API response.
        streamId: k.r2Key,
        durationSec: k.durationSec ?? 0,
        // A real frame, or null — never the video's own key (rows before
        // migration 0038 hold that, and every reader treats it as none).
        posterR2Key: k.posterR2Key,
        previewR2Key: k.previewR2Key,
        thumbhash: k.thumbhash,
        width: k.width,
        height: k.height,
        // Requested-ratio fallback — lets mobile render the true shape.
        aspectRatio: k.aspectRatio,
      }));

    const audios: AudioRef[] = userVisibleKeys
      .filter((k) => k.kind === 'audio')
      .map((k) => ({
        r2Key: k.r2Key,
        mimeType: k.mimeType,
        durationSec: k.durationSec ?? 0,
        sizeBytes: k.sizeBytes ?? 0,
      }));

    const jobResult: JobResult = {
      images,
      videos,
      ...(audios.length ? { audios } : {}),
      durationMs,
      costCredits: jobCostCredits,
      ...(providerTaskId ? { providerTaskId } : {}),
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
        provider: stages[0]?.provider ?? null,
        providerCostUsd: jobCost.usd.toFixed(5),
        providerBilledUnits: jobCost.units,
        providerRequestIds: requestIds.length ? requestIds : null,
        costBasis: stageCosts.length ? jobCost.basis : null,
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
            thumbhash: img.thumbhash ?? null,
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
            previewR2Key: vid.previewR2Key ?? null,
            thumbhash: vid.thumbhash ?? null,
          })),
          ...audios.map((aud, i) => ({
            projectId: completedProjectId,
            userId: jobRow.userId,
            jobId,
            outputIndex: images.length + videos.length + i,
            kind: 'audio' as const,
            r2Key: aud.r2Key,
            durationSec: aud.durationSec || null,
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
    fal: env.FAL_KEY ? { apiKey: env.FAL_KEY } : undefined,
    elevenlabs: env.ELEVENLABS_API_KEY ? { apiKey: env.ELEVENLABS_API_KEY } : undefined,
  };
}

/**
 * How long to wait on an async video task before declaring it timed out.
 *
 *   - kling    → 15 min. It was 5, sized for Kling 2.x's 60–120s renders.
 *                The 3.0 family is slower: in production a 4s/1080p clip
 *                took up to 218s, a 3s Omni clip 403s — and we sell 15s
 *                and 4K. EVERY failed Kling job in production was this
 *                timeout firing at 301–306s. The user was refunded, yet
 *                Kling still rendered (and very likely billed) the video.
 *   - seedance → 15 min (1080p/10s commonly takes 6–10 min; 2K can push
 *                past 10; account-level queueing adds more on busy days).
 *
 * Waiting longer is nearly free: past the first 30s the loop sleeps in
 * `wait.for`, which is checkpointed and does NOT count toward the task's
 * `maxDuration` (that measures CPU time) or its compute bill.
 */
const ASYNC_POLL_BUDGET_MS: Record<'kling' | 'seedance' | 'fal', number> = {
  kling: 15 * 60 * 1000,
  seedance: 15 * 60 * 1000,
  // fal's upscaler runs at roughly 24x realtime AT 1080p ON THE STANDARD
  // TIER — a measured 242 seconds for a 10-second clip. Neither number
  // holds at the top of the range: 4K is four times the pixels and the
  // `pro` tier is large-model restoration (fal's own note: "longer
  // processing time"). With the source capped at 60 seconds, the worst
  // combination plausibly runs for over an hour.
  //
  // Two hours, then. A budget that expires is worse than a long one: the
  // job is failed and refunded while fal keeps working and still bills
  // us, so we pay for a render nobody receives. The `wait.for` sleeps
  // are unbilled CPU time, so patience here is free.
  fal: 120 * 60 * 1000,
};

/** Polling errors in a row (≈30s at the 6s cadence) before the job is failed. */
const MAX_CONSECUTIVE_POLL_ERRORS = 5;

/**
 * Block on a Kling / Seedance async task until it completes or we hit
 * the per-stage poll budget (`ASYNC_POLL_BUDGET_MS`). The provider's own
 * task TTL is in the hours range, so the upper bound here is purely a
 * safety net.
 *
 * Backoff: 2s for the first 30s, then 6s. Keeps the dashboard
 * responsive and avoids burning rate-limit budget on long videos.
 */
async function waitForAsync(
  taskId: string,
  provider: 'kling' | 'seedance' | 'fal',
  variant: 'text2video' | 'image2video' | 'omni',
  providerEnv: ProviderEnv,
  /** Kling API 2.0 task — polls `GET /tasks` instead of the legacy URL. */
  api2: boolean,
  ctx: { jobId: string; stageNumber: number; totalStages: number },
  /** fal only: the endpoint the task belongs to — its poll path needs it. */
  endpoint?: string,
): Promise<ExecuteResult> {
  const start = Date.now();
  const maxMs = ASYNC_POLL_BUDGET_MS[provider];
  let attempt = 0;
  let consecutivePollErrors = 0;

  while (Date.now() - start < maxMs) {
    attempt += 1;
    const elapsed = Math.round((Date.now() - start) / 1000);
    await updateJobProgress(ctx.jobId, {
      stage: ctx.stageNumber,
      totalStages: ctx.totalStages,
      message: `Animating (${elapsed}s elapsed)`,
    });

    // Short polls in the first half-minute keep fast jobs snappy. Past
    // that, use the platform's `wait.for` instead of a timer: waits over
    // five seconds are not billed and the run is checkpointed while it
    // sleeps, so a ten-minute Seedance render stops costing ten minutes
    // of compute for a handful of HTTP polls. Local state survives the
    // checkpoint — the loop resumes exactly here.
    if (elapsed < 30) {
      await new Promise((r) => setTimeout(r, 2_000));
    } else {
      await wait.for({ seconds: 6 });
    }

    let result: ExecuteResult;
    try {
      result = await pollAsyncTask(taskId, provider, variant, providerEnv, api2, endpoint);
      consecutivePollErrors = 0;
    } catch (err) {
      // A task the provider reports as failed is final — hand it to the
      // caller to fail the job with its reason. Anything else (a network
      // blip, a 5xx from the status endpoint) says nothing about the task,
      // so poll again on the next tick; only a run of them gives up.
      if (isProviderTaskFailedError(err)) throw err;
      consecutivePollErrors += 1;
      logger.warn('generate-job:poll-error', {
        taskId,
        provider,
        consecutive: consecutivePollErrors,
        err: String(err),
      });
      if (consecutivePollErrors >= MAX_CONSECUTIVE_POLL_ERRORS) throw err;
      continue;
    }
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
    // A Buffer IS a Uint8Array view; the previous `Uint8Array.from(...)`
    // walked it element by element into a second full copy, so a 4K PNG
    // sat in memory three times (base64 string, Buffer, copy).
    return Buffer.from(out.base64, 'base64');
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

function defaultMimeFor(kind: 'image' | 'video' | 'audio'): string {
  return kind === 'image' ? 'image/png' : kind === 'audio' ? 'audio/mpeg' : 'video/mp4';
}

function errorToMessage(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 280);
  return String(err).slice(0, 280);
}

/**
 * Seedance addresses attachments by their position in `content[]`: the
 * prompt is item 0, then the start frame, the end frame, and the
 * references in the order they were sent. Labels follow the composer's
 * own numbering (per kind: Image 1, Image 2, Video 1), which is what the
 * user sees on the tray.
 */
function contentItemLabeller(rawInputs: Record<string, { kind?: string }>): ContentItemLabeller {
  const items: string[] = [];
  if (rawInputs[CREATE_START_FRAME_KEY]) items.push('Start frame');
  if (rawInputs[CREATE_END_FRAME_KEY]) items.push('End frame');
  const counts = { image: 0, video: 0, audio: 0 };
  const refKeys = Object.keys(rawInputs)
    .filter((k) => k.startsWith('ref_'))
    .sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
  for (const k of refKeys) {
    const kind = rawInputs[k]?.kind;
    const key = kind === 'video' || kind === 'audio' ? kind : 'image';
    counts[key] += 1;
    items.push(`${key.charAt(0).toUpperCase()}${key.slice(1)} ${counts[key]}`);
  }
  return (contentIndex) => (contentIndex >= 1 ? items[contentIndex - 1] : undefined);
}

/**
 * The `JobError` for a provider failure. A cause we recognise (see
 * `explainProviderError`) gets a plain-language message, a stable
 * `reason` the apps translate and the specifics behind it; anything
 * else keeps the provider's own text, as before. Always
 * `provider_error`, so refunds are unchanged.
 */
function providerJobError(err: unknown, stage: number, label?: ContentItemLabeller): JobError {
  const raw = err instanceof Error ? err.message : String(err);
  const explained = explainProviderError(raw, label);
  return {
    code: 'provider_error',
    message: explained ? jobErrorMessage(explained.reason, explained.params) : errorToMessage(err),
    stage,
    retryCount: 0,
    ...(explained ? { reason: explained.reason, params: explained.params } : {}),
    // The admin needs the provider's exact words even when the user gets
    // a friendlier sentence; the public API strips this field.
    ...(explained && raw ? { detail: raw.slice(0, 1000) } : {}),
  };
}

/**
 * Every failure carries a reason the apps can translate. Provider
 * failures explain themselves above; the worker's own codes map here —
 * a timeout is a timeout, everything else (a missing upload, an
 * unregistered model, a lost template) is our problem to fix and is
 * told to the user as such, with the technical sentence kept in
 * `detail` for admins.
 */
const REASON_FOR_CODE: Record<string, JobErrorReason> = {
  provider_timeout: 'provider_timeout',
  r2_input_missing: 'system',
  internal_error: 'system',
  unknown_model: 'system',
  template_missing: 'system',
};

function withReason(error: JobError): JobError {
  if (isJobErrorReason(error.reason)) return error;
  const reason = REASON_FOR_CODE[error.code];
  if (!reason) return error;
  return {
    ...error,
    reason,
    message: jobErrorMessage(reason),
    detail: error.detail ?? error.message.slice(0, 1000),
  };
}

async function failJob(
  jobId: string,
  rawError: JobError,
  cost?: { provider: string | null; requestIds: string[]; usd: number; basis: 'exact' | 'computed' | 'estimated'; units: StageCost[] },
): Promise<{ status: 'failed'; error: JobError }> {
  const error = withReason(rawError);
  const [row] = await getDb()
    .update(jobs)
    .set({
      status: 'failed',
      error,
      completedAt: new Date(),
      // A failure before any provider was reached costs nothing; say so
      // explicitly rather than leaving the column null (= unknown).
      provider: cost?.provider ?? null,
      providerCostUsd: (cost?.usd ?? 0).toFixed(5),
      providerBilledUnits: cost?.units ?? [],
      providerRequestIds: cost?.requestIds.length ? cost.requestIds : null,
      costBasis: cost?.basis ?? 'computed',
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
      // Recorded only now that it happened — the apps print "credits
      // returned" from this flag, so it must never run ahead of the refund.
      await getDb()
        .update(jobs)
        .set({ error: { ...error, refunded: true } })
        .where(eq(jobs.id, jobId));
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
