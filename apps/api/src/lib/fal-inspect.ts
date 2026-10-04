/**
 * Read a fal endpoint's published schema and price, and propose a draft
 * model row from them.
 *
 * Two public fal sources:
 *   - `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id>`
 *     (no auth) — OpenAPI 3 with `components.schemas.<X>Input/Output`
 *     carrying enums, defaults and descriptions.
 *   - `GET https://api.fal.ai/v1/models/pricing?endpoint_id=<id>`
 *     (needs the key) — one `unit_price` + `unit` per endpoint. Tiered
 *     models (per-resolution video) report a single number, so the
 *     admin still sets tier prices by hand; this only seeds the default.
 *
 * The draft is a STARTING POINT. Field names are guessed from the
 * conventions fal's catalogue follows (`prompt`, `image_url`,
 * `image_urls`, `aspect_ratio`, `resolution`, `duration`, `num_frames`);
 * the admin confirms them against the schema summary returned alongside.
 */

type JsonSchema = {
  type?: string | string[];
  enum?: unknown[];
  default?: unknown;
  description?: string;
  title?: string;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  $ref?: string;
  minimum?: number;
  maximum?: number;
};

export interface FalFieldSummary {
  name: string;
  type: string;
  required: boolean;
  enum?: unknown[];
  default?: unknown;
  description?: string;
  minimum?: number;
  maximum?: number;
}

export interface FalInspectResult {
  endpointId: string;
  title: string | null;
  description: string | null;
  kind: 'image' | 'video';
  unitPrice: { price: number; unit: string; currency: string } | null;
  inputFields: FalFieldSummary[];
  outputFields: string[];
  /** A proposed `capabilities` blob (without provider/modelKey/displayName/status, which the form owns). */
  draft: Record<string, unknown>;
  suggestedModelKey: string;
  /** Credits at the default settings by the house rule, when a price is known. */
  suggestedCredits: number | null;
}

const OPENAPI_URL = 'https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=';
const PRICING_URL = 'https://api.fal.ai/v1/models/pricing?endpoint_id=';

function deref(schema: JsonSchema | undefined, all: Record<string, JsonSchema>): JsonSchema | undefined {
  if (!schema) return undefined;
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop() ?? '';
    return deref(all[name], all);
  }
  if (schema.anyOf) {
    // `anyOf: [{type:'string', enum}, {type:'null'}]` — take the non-null arm.
    const arm = schema.anyOf.find((a) => a.type !== 'null');
    return arm ? { ...deref(arm, all), description: schema.description ?? arm.description, default: schema.default ?? arm.default } : schema;
  }
  return schema;
}

function typeOf(s: JsonSchema | undefined): string {
  if (!s) return 'unknown';
  if (Array.isArray(s.type)) return s.type.filter((t) => t !== 'null').join('|') || 'unknown';
  return s.type ?? (s.enum ? 'enum' : s.properties ? 'object' : 'unknown');
}

export async function inspectFalEndpoint(endpointId: string, falKey?: string): Promise<FalInspectResult> {
  const res = await fetch(OPENAPI_URL + encodeURIComponent(endpointId));
  if (!res.ok) throw new Error(`fal returned ${res.status} for the OpenAPI schema of ${endpointId}`);
  const doc = (await res.json()) as {
    info?: { title?: string; description?: string };
    components?: { schemas?: Record<string, JsonSchema> };
  };
  const all = doc.components?.schemas ?? {};
  const inputName = Object.keys(all).find((k) => /Input$/.test(k) && !/Output/.test(k));
  const outputName = Object.keys(all).find((k) => /Output$/.test(k));
  const input = inputName ? all[inputName] : undefined;
  const output = outputName ? all[outputName] : undefined;
  if (!input?.properties) throw new Error(`No input schema found for ${endpointId}`);

  const required = new Set(input.required ?? []);
  const inputFields: FalFieldSummary[] = Object.entries(input.properties).map(([name, raw]) => {
    const s = deref(raw, all) ?? raw;
    return {
      name,
      type: typeOf(s) === 'array' ? `array<${typeOf(deref(s.items, all))}>` : typeOf(s),
      required: required.has(name),
      ...(s.enum ? { enum: s.enum } : {}),
      ...(s.default !== undefined ? { default: s.default } : {}),
      ...(s.description ? { description: s.description.slice(0, 200) } : {}),
      ...(typeof s.minimum === 'number' ? { minimum: s.minimum } : {}),
      ...(typeof s.maximum === 'number' ? { maximum: s.maximum } : {}),
    };
  });
  const outputFields = Object.keys(output?.properties ?? {});
  const kind: 'image' | 'video' =
    outputFields.includes('video') || /video/i.test(endpointId) ? 'video' : 'image';

  // ── Price ──────────────────────────────────────────────────────────
  let unitPrice: FalInspectResult['unitPrice'] = null;
  if (falKey) {
    try {
      const pr = await fetch(PRICING_URL + encodeURIComponent(endpointId), {
        headers: { Authorization: `Key ${falKey}` },
      });
      if (pr.ok) {
        const body = (await pr.json()) as { prices?: Array<{ endpoint_id: string; unit_price: number; unit: string; currency: string }> };
        const hit = body.prices?.find((p) => p.endpoint_id === endpointId) ?? body.prices?.[0];
        if (hit) unitPrice = { price: hit.unit_price, unit: hit.unit, currency: hit.currency };
      }
    } catch {
      // Price is a convenience; the schema is the deliverable.
    }
  }

  // ── Draft ──────────────────────────────────────────────────────────
  const field = (n: string) => inputFields.find((f) => f.name === n);
  const enumStrings = (n: string) => (field(n)?.enum ?? []).filter((v): v is string => typeof v === 'string');

  const aspectRatios = enumStrings('aspect_ratio').filter((v) => /^\d+:\d+$/.test(v));
  const resolutionField = field('resolution') ? 'resolution' : field('quality') ? 'quality' : null;
  const modes = resolutionField ? enumStrings(resolutionField) : [];
  const defaultMode = (resolutionField && (field(resolutionField)?.default as string | undefined)) || modes[0];
  const durationField = field('duration');
  const durationEnum = durationField?.enum ?? [];
  let durations = durationEnum
    .map((v) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (durations.length === 0 && durationField && (durationField.minimum !== undefined || durationField.maximum !== undefined)) {
    // A numeric range (Wan 3.0: 2–30): offer the usual steps that fit.
    const lo = durationField.minimum ?? 1;
    const hi = durationField.maximum ?? 30;
    durations = [4, 5, 8, 10, 15, 20, 30].filter((n) => n >= lo && n <= hi);
  }
  const durationIsString = durationEnum.some((v) => typeof v === 'string');
  const defaultDurationRaw = durationField?.default;
  const defaultDuration = Number(defaultDurationRaw);

  const startField = field('image_url') ? 'image_url' : field('start_image_url') ? 'start_image_url' : null;
  const endField = field('end_image_url') ? 'end_image_url' : field('tail_image_url') ? 'tail_image_url' : null;
  const refsField = field('image_urls') ? 'image_urls' : field('reference_image_urls') ? 'reference_image_urls' : null;
  // The endpoint id says what the endpoint is for; the fields confirm it.
  const task: 'text' | 'image' | 'reference' = /\/reference-to-|\/edit/i.test(endpointId)
    ? 'reference'
    : /\/image-to-|\/first-last-frame/i.test(endpointId)
      ? 'image'
      : /\/text-to-/i.test(endpointId)
        ? 'text'
        : refsField
          ? 'reference'
          : startField
            ? 'image'
            : 'text';

  const spec: Record<string, unknown> = {
    endpoints: { [task]: endpointId },
    input: {
      ...(field('prompt') ? { prompt: 'prompt' } : {}),
      ...(field('negative_prompt') ? { negativePrompt: 'negative_prompt' } : {}),
      ...(aspectRatios.length ? { aspectRatio: { field: 'aspect_ratio' } } : {}),
      ...(resolutionField && modes.length ? { mode: { field: resolutionField } } : {}),
      ...(field('duration')
        ? { duration: { field: 'duration', as: durationIsString ? 'string' : 'number' } }
        : field('num_frames')
          ? { duration: { field: 'num_frames', as: 'frames', fps: Number(field('frames_per_second')?.default ?? 16), plusOne: true } }
          : {}),
      ...(startField ? { imageUrl: startField } : {}),
      ...(endField ? { endImageUrl: endField } : {}),
      ...(refsField ? { referenceImages: { field: refsField, max: 10 } } : {}),
      ...(field('num_images') ? { numOutputs: 'num_images' } : {}),
      ...(field('seed') ? { seed: 'seed' } : {}),
    },
  };

  const draft: Record<string, unknown> = {
    kind,
    sizing: { mode: 'aspect', values: aspectRatios.length ? aspectRatios : ['16:9', '9:16', '1:1'] },
    outputs: { min: 1, max: 1, default: 1 },
    ...(kind === 'video'
      ? {
          duration: {
            values: durations.length ? durations : [5],
            default: Number.isFinite(defaultDuration) && durations.includes(defaultDuration) ? defaultDuration : (durations[0] ?? 5),
          },
        }
      : {}),
    ...(modes.length ? { modes: { values: modes, default: defaultMode } } : {}),
    refAddressing: 'ordinal',
    maxReferences: refsField ? 10 : 0,
    maxSubjects: refsField ? 10 : startField ? (endField ? 2 : 1) : 0,
    maxImagesTotal: refsField ? 10 : startField ? (endField ? 2 : 1) : 0,
    acceptsStartEndImage: !!endField,
    negativePrompt: !!field('negative_prompt'),
    maxPromptChars: 2500,
    fal: spec,
  };

  // Credits at the default: unit price × default duration for per-second
  // units, else the unit price; then the house rule ceil(usd × 1.5 / 0.10).
  let suggestedCredits: number | null = null;
  if (unitPrice) {
    const perSecond = /second/i.test(unitPrice.unit);
    const usd = perSecond ? unitPrice.price * (draft.duration ? (draft.duration as { default: number }).default : 1) : unitPrice.price;
    suggestedCredits = Math.max(1, Math.ceil((usd * 1.5) / 0.1));
  }

  const suggestedModelKey = endpointId
    .toLowerCase()
    .replace(/^fal-ai\//, '')
    .replace(/\/(text|image|reference)-to-(video|image)$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return {
    endpointId,
    title: doc.info?.title ?? null,
    description: doc.info?.description?.slice(0, 300) ?? null,
    kind,
    unitPrice,
    inputFields,
    outputFields,
    draft,
    suggestedModelKey,
    suggestedCredits,
  };
}
