/**
 * `deriveDeliverables` — compute the user-facing "What you'll get"
 * summary for a template **directly from its pipeline**.
 *
 * Why not just read `templates.output` from the row?
 *   That JSONB column is admin-edited, easy to drift from the actual
 *   pipeline, and in practice every row sits at the default
 *   `{ type: 'image', count: 1 }` — so mobile shows "1 image" forever.
 *
 * Approach (matches the agreed UX contract — option A):
 *
 *   1. Walk `generation.stages[]` and identify which stages are
 *      *consumed* by a later stage (their output is plumbing, not a
 *      deliverable). Two ways a stage gets consumed:
 *        a) Prompt placeholders: `{{stage_N_output}}` or `{{previous}}`
 *           in any later stage's `prompt`.
 *        b) Seedance config slot bindings — `frameSlots.firstFrame`,
 *           `frameSlots.lastFrame`, `referenceSlots[].source` — when
 *           their `kind === 'stage_output'`.
 *
 *   2. Anything *not* consumed is a terminal stage → user receives it.
 *
 *   3. Group terminals by output kind (image | video) using
 *      `MODEL_CAPABILITIES[stage.model].kind`, and sum the per-stage
 *      `numberOfOutputs` (clamped to that model's allowed range, same
 *      logic the compiler uses) to get the count per kind.
 *
 *   4. Cross-check the result against `generation.mode`. If the walk
 *      produces something the mode doesn't agree with (e.g. mode says
 *      `image_then_video` but only video stages are terminal), fall
 *      back to the mode-derived contract — `mode` is the admin's
 *      explicit promise to the user.
 *
 *   5. As a last resort (no stages, unknown models, total mismatch),
 *      fall back to `kind`. Keeps drafts and legacy rows rendering.
 *
 * The output type is the existing wire shape `MobileTemplateOutputSummary[]`
 * — mobile renders one row per kind, ordered image-then-video for the
 * common `image_then_video` case.
 */

import type { Template as DbTemplate } from '@clickfy/db';
import { MODEL_CAPABILITIES } from '@clickfy/providers';
import type {
  GenerationStage,
  MobileTemplateOutputSummary,
  SeedanceFrameSlots,
  SeedanceReferenceSlot,
  SeedanceSlotBinding,
  TemplateGeneration,
} from '@clickfy/types';

/** Order images before videos in the mobile list. */
const KIND_SORT: Record<'image' | 'video', number> = { image: 0, video: 1 };

export function deriveDeliverables(row: DbTemplate): MobileTemplateOutputSummary[] {
  const fromPipeline = derivedFromStages(row.generation);
  if (fromPipeline) return fromPipeline;

  // No usable pipeline (draft, or every stage uses an unknown model).
  // Fall back to the explicit `mode` field — the admin's stated contract.
  const fromMode = derivedFromMode(row.generation?.mode);
  if (fromMode) return fromMode;

  // Last resort: the template's surface kind. Image-set templates map
  // to image; video to video. Count defaults to whatever sits in the
  // legacy `output.count` (≥1).
  const fallbackKind = row.kind === 'video' ? 'video' : 'image';
  const fallbackCount = Math.max(1, row.output?.count ?? 1);
  return [{ kind: fallbackKind, count: fallbackCount }];
}

/** Step 1–3 of the contract above. Returns null if not derivable. */
function derivedFromStages(
  generation: TemplateGeneration | undefined,
): MobileTemplateOutputSummary[] | null {
  if (!generation || generation.stages.length === 0) return null;

  const stages = [...generation.stages].sort((a, b) => a.order - b.order);
  const consumed = collectConsumedStages(stages);

  const byKind = new Map<'image' | 'video', number>();
  let recognised = 0;

  for (const stage of stages) {
    if (consumed.has(stage.order)) continue;
    const cap = MODEL_CAPABILITIES[stage.model];
    if (!cap) continue;
    recognised++;
    const kind = cap.kind;
    const count = clampOutputs(stage, cap.outputs);
    byKind.set(kind, (byKind.get(kind) ?? 0) + count);
  }

  // Every terminal stage uses an unknown model — bail and let the
  // mode-based fallback take over.
  if (recognised === 0) return null;

  const list = [...byKind.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => KIND_SORT[a.kind] - KIND_SORT[b.kind]);

  // Step 4 — sanity-check against mode.
  if (!agreesWithMode(list, generation.mode)) {
    const fromMode = derivedFromMode(generation.mode);
    if (fromMode) return fromMode;
  }

  return list;
}

/** Step 1: which stage `order`s are referenced as plumbing downstream. */
function collectConsumedStages(stages: GenerationStage[]): Set<number> {
  const consumed = new Set<number>();

  // (a) Prompt placeholders. We scan every stage including stage 1 —
  // a self-reference would still mark itself consumed, which is the
  // right call (we'd never count it as a deliverable).
  const stageOutputRe = /\{\{\s*stage_(\d+)_output\s*\}\}/g;
  for (const s of stages) {
    for (const match of s.prompt.matchAll(stageOutputRe)) {
      consumed.add(Number(match[1]));
    }
    if (/\{\{\s*previous\s*\}\}/.test(s.prompt)) {
      // `{{previous}}` resolves to `s.order - 1`. Only meaningful when
      // there *is* a previous stage; for stage 1 it's a no-op.
      if (s.order > 1) consumed.add(s.order - 1);
    }
  }

  // (b) Seedance config slot bindings. Both `frameSlots` and
  // `referenceSlots` may sit at the top level of `stage.config`.
  for (const s of stages) {
    const cfg = s.config as Record<string, unknown>;

    const frameSlots = cfg.frameSlots as SeedanceFrameSlots | undefined;
    if (frameSlots) {
      maybeMarkConsumed(frameSlots.firstFrame, consumed);
      maybeMarkConsumed(frameSlots.lastFrame, consumed);
    }

    const refSlots = cfg.referenceSlots as SeedanceReferenceSlot[] | undefined;
    if (Array.isArray(refSlots)) {
      for (const slot of refSlots) maybeMarkConsumed(slot.source, consumed);
    }
  }

  return consumed;
}

function maybeMarkConsumed(
  binding: SeedanceSlotBinding | undefined,
  consumed: Set<number>,
): void {
  if (binding && binding.kind === 'stage_output') {
    consumed.add(binding.stageIndex);
  }
}

/** Step 3 helper — match the compiler's clamp semantics. */
function clampOutputs(
  stage: GenerationStage,
  outputs: { min: number; max: number; default: number },
): number {
  const raw = (stage.config as Record<string, unknown>).numberOfOutputs;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(outputs.min, Math.min(outputs.max, Math.trunc(raw)));
  }
  return outputs.default;
}

function agreesWithMode(
  list: MobileTemplateOutputSummary[],
  mode: TemplateGeneration['mode'],
): boolean {
  const hasImage = list.some((o) => o.kind === 'image');
  const hasVideo = list.some((o) => o.kind === 'video');
  switch (mode) {
    case 'image':
      return hasImage && !hasVideo;
    case 'video':
      return hasVideo && !hasImage;
    case 'image_then_video':
      return hasImage && hasVideo;
    default:
      return true;
  }
}

/** Step 4 fallback — derive from the explicit `mode` contract. */
function derivedFromMode(
  mode: TemplateGeneration['mode'] | undefined,
): MobileTemplateOutputSummary[] | null {
  switch (mode) {
    case 'image':
      return [{ kind: 'image', count: 1 }];
    case 'video':
      return [{ kind: 'video', count: 1 }];
    case 'image_then_video':
      return [
        { kind: 'image', count: 1 },
        { kind: 'video', count: 1 },
      ];
    default:
      return null;
  }
}
