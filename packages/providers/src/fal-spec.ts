/**
 * Declarative fal model spec — the thing that makes "add a model without
 * a deploy" true for fal.
 *
 * WHY A SPEC AND NOT A COMPILE BRANCH
 *   Every fal model has its own input schema, but the DIFFERENCES between
 *   the ones we sell are small and regular: the prompt field is called
 *   `prompt`, the start image is `image_url` or `image`, the length is a
 *   number of seconds or the string "5" or a frame count, the resolution
 *   is `720p` on one model and `1080p` on another. A branch per model in
 *   `compile.ts` encodes that in code, which means a deploy per model.
 *   A spec encodes it in data, which means an admin screen.
 *
 *   What the spec does NOT try to be: a general schema language. It maps
 *   OUR normalised request (prompt, negative prompt, aspect ratio, tier,
 *   duration, start/end frame, references, output count, seed) onto the
 *   endpoint's field names and enum spellings, plus a bag of constants.
 *   A model whose body cannot be expressed that way gets a compile
 *   branch, as the Video Upscaler has today.
 *
 * ENDPOINT CHOICE
 *   One Clickefy model may front several fal endpoints — Wan 3.0 has
 *   text-to-video, image-to-video and reference-to-video. The task picks
 *   the endpoint from what the user attached, the same way the Seedance
 *   model already presents one model for several tasks:
 *     references attached        → `reference` (or `image` with the first
 *                                  reference as the start frame, if the
 *                                  model has no reference endpoint)
 *     a start frame, no refs     → `image`
 *     nothing attached           → `text`
 *
 * This file is pure: no fetch, no DB. The compiler calls `buildFalInput`
 * with already-resolved URLs; the API validates specs with the Zod
 * schema in `apps/api/src/lib/fal-model-schema.ts`.
 */

export interface FalEndpointSet {
  /** Prompt-only generation (text-to-image / text-to-video). */
  text?: string;
  /** One start image (image-to-video, or image edit on image models). */
  image?: string;
  /** Several reference images (reference-to-video, multi-image edit). */
  reference?: string;
}

/** How a duration is spelled on the wire. */
export type FalDurationEncoding =
  /** `duration: 5` */
  | { field: string; as: 'number' }
  /** `duration: "5"` (WAN 2.5, Kling via fal) */
  | { field: string; as: 'string' }
  /** `num_frames: 81` — seconds × fps (+1 where the model counts the first frame) */
  | { field: string; as: 'frames'; fps: number; plusOne?: boolean };

export interface FalInputMap {
  /** Field for the prompt. Default `prompt`. */
  prompt?: string;
  /** Field for the negative prompt. Absent = never sent. */
  negativePrompt?: string;
  /**
   * Aspect ratio field, with an optional spelling map from our values
   * (`16:9`) to the endpoint's (`16:9` is the common case, so the map is
   * usually omitted). Absent = never sent.
   */
  aspectRatio?: { field: string; values?: Record<string, string> };
  /**
   * The billed tier (`stage.config.mode`, one of `capabilities.modes.values`)
   * written to a resolution/quality field, with an optional spelling map
   * (`'1080p' → '1080p'`, or `'high' → 'hd'`). Absent = never sent.
   */
  mode?: { field: string; values?: Record<string, string> };
  duration?: FalDurationEncoding;
  /** Start-frame URL field (`image_url`). */
  imageUrl?: string;
  /** End-frame URL field (`end_image_url`, `tail_image_url`). */
  endImageUrl?: string;
  /** Reference image URLs: an array field, or one field per index (`image_url_1`…). */
  referenceImages?: { field: string; max: number; style?: 'array' | 'indexed' };
  /** Output count field (`num_images`). Absent = one output, never sent. */
  numOutputs?: string;
  /** Seed field. Absent = never sent. */
  seed?: string;
  /** Constants sent on every request (`enable_safety_checker: true`). */
  extra?: Record<string, unknown>;
}

export interface FalSpec {
  endpoints: FalEndpointSet;
  input: FalInputMap;
}

/** What the compiler has resolved for one request. */
export interface FalResolvedRequest {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  mode?: string;
  durationSeconds?: number;
  startImageUrl?: string;
  endImageUrl?: string;
  referenceImageUrls: string[];
  numOutputs?: number;
  seed?: number;
}

export type FalTask = 'text' | 'image' | 'reference';

/**
 * Which endpoint this request goes to, and whether the first reference
 * must stand in for a start frame.
 *
 * Returns `undefined` when the model cannot serve the request at all
 * (a video model with only an image endpoint and nothing attached).
 */
export function pickFalEndpoint(
  spec: FalSpec,
  req: Pick<FalResolvedRequest, 'startImageUrl' | 'referenceImageUrls'>,
): { task: FalTask; endpoint: string; promoteFirstReference: boolean } | undefined {
  const { text, image, reference } = spec.endpoints;
  const hasRefs = req.referenceImageUrls.length > 0;
  if (hasRefs && reference) return { task: 'reference', endpoint: reference, promoteFirstReference: false };
  if (hasRefs && image) return { task: 'image', endpoint: image, promoteFirstReference: !req.startImageUrl };
  if (req.startImageUrl && image) return { task: 'image', endpoint: image, promoteFirstReference: false };
  if (text) return { task: 'text', endpoint: text, promoteFirstReference: false };
  // No text endpoint: an image-only model can still run from a start frame.
  if (req.startImageUrl && image) return { task: 'image', endpoint: image, promoteFirstReference: false };
  return undefined;
}

/**
 * The request body for one fal endpoint, from the resolved request and
 * the spec. Only fields the spec names are written, so a model that has
 * no `negative_prompt` never receives one.
 */
export function buildFalInput(spec: FalSpec, task: FalTask, req: FalResolvedRequest): Record<string, unknown> {
  const m = spec.input;
  const body: Record<string, unknown> = { ...(m.extra ?? {}) };

  body[m.prompt ?? 'prompt'] = req.prompt;
  if (m.negativePrompt && req.negativePrompt) body[m.negativePrompt] = req.negativePrompt;
  if (m.aspectRatio && req.aspectRatio) {
    body[m.aspectRatio.field] = m.aspectRatio.values?.[req.aspectRatio] ?? req.aspectRatio;
  }
  if (m.mode && req.mode) body[m.mode.field] = m.mode.values?.[req.mode] ?? req.mode;
  if (m.duration && typeof req.durationSeconds === 'number') {
    const d = m.duration;
    if (d.as === 'number') body[d.field] = req.durationSeconds;
    else if (d.as === 'string') body[d.field] = String(req.durationSeconds);
    else body[d.field] = Math.round(req.durationSeconds * d.fps) + (d.plusOne ? 1 : 0);
  }
  if (m.numOutputs && typeof req.numOutputs === 'number') body[m.numOutputs] = req.numOutputs;
  if (m.seed && typeof req.seed === 'number') body[m.seed] = req.seed;

  if (task === 'image') {
    if (m.imageUrl && req.startImageUrl) body[m.imageUrl] = req.startImageUrl;
    if (m.endImageUrl && req.endImageUrl) body[m.endImageUrl] = req.endImageUrl;
  } else if (task === 'reference' && m.referenceImages) {
    const urls = req.referenceImageUrls.slice(0, m.referenceImages.max);
    if (m.referenceImages.style === 'indexed') {
      urls.forEach((u, i) => {
        body[`${m.referenceImages!.field}${i + 1}`] = u;
      });
    } else {
      body[m.referenceImages.field] = urls;
    }
    // Some reference endpoints also take a start frame (Wan 3.0 r2v does not;
    // a spec that wants it names `imageUrl` and we pass it when present).
    if (m.imageUrl && req.startImageUrl) body[m.imageUrl] = req.startImageUrl;
  }

  return body;
}

/** Structural check used where Zod is not available (the worker, tests). */
export function isFalSpec(value: unknown): value is FalSpec {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const e = v.endpoints as Record<string, unknown> | undefined;
  if (!e || typeof e !== 'object') return false;
  const anyEndpoint = ['text', 'image', 'reference'].some((k) => typeof e[k] === 'string' && e[k]);
  return anyEndpoint && typeof v.input === 'object' && v.input !== null;
}
