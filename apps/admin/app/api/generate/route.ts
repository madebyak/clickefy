/**
 * POST /api/generate — admin Playground execution.
 *
 * This route is the admin-side companion to the mobile-job runner.
 * Both call the SAME `compile()` + `executeStage()` from
 * `@clickfy/providers`, so output from the playground matches what
 * a real user sees when they trigger the template from mobile.
 *
 * Request shape:
 * ```
 * {
 *   stage:          GenerationStage,
 *   templateInputs: TemplateInputField[],     // for variable lookup
 *   inputValues:    Record<fieldKey, RuntimeInputValue>,
 *   previousOutputs?: StageOutputRef[]        // multi-stage chains
 * }
 * ```
 *
 * Response: `ExecuteResult` plus a `warnings` array surfaced by the
 * compiler (deprecated syntax, dropped refs, etc.). The admin UI
 * shows warnings as inline hints; nothing here blocks execution.
 */

import { NextResponse } from 'next/server';

import {
  compile,
  executeStage,
  getCapabilities,
  type CompileContext,
  type RuntimeInputValue,
  type StageOutputRef,
} from '@clickfy/providers';
import type { GenerationStage, TemplateInputField } from '@clickfy/types';
export const maxDuration = 60;

interface GenerateRequestBody {
  stage: GenerationStage;
  templateInputs: TemplateInputField[];
  inputValues: Record<string, RuntimeInputValue>;
  previousOutputs?: StageOutputRef[];
}

/**
 * `RuntimeInputValue` over-the-wire: the playground serialises image
 * bytes as base64 strings because JSON doesn't carry binary natively.
 * This re-hydrates them into `Uint8Array` so the compiler / adapters
 * never have to think about the transport encoding.
 */
function hydrateInputs(
  inputValues: Record<string, unknown>,
): Record<string, RuntimeInputValue> {
  const out: Record<string, RuntimeInputValue> = {};
  for (const [key, raw] of Object.entries(inputValues ?? {})) {
    const v = raw as Record<string, unknown> | null;
    if (!v || typeof v !== 'object') continue;
    if (v.kind === 'text' && typeof v.value === 'string') {
      out[key] = { kind: 'text', value: v.value };
      continue;
    }
    if ((v.kind === 'image' || v.kind === 'video') && typeof v.mimeType === 'string') {
      const bytes =
        typeof v.base64 === 'string' ? base64ToBytes(v.base64) : undefined;
      out[key] = {
        kind: v.kind,
        r2Key: typeof v.r2Key === 'string' ? v.r2Key : 'playground-in-memory',
        mimeType: v.mimeType,
        bytes,
        url: typeof v.url === 'string' ? v.url : undefined,
      };
    }
  }
  return out;
}

function hydrateStageOutputs(raw: unknown): StageOutputRef[] {
  if (!Array.isArray(raw)) return [];
  const out: StageOutputRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const i = item as Record<string, unknown>;
    if (typeof i.stageIndex !== 'number') continue;
    if (i.kind !== 'image' && i.kind !== 'video') continue;
    out.push({
      stageIndex: i.stageIndex,
      kind: i.kind,
      mimeType: typeof i.mimeType === 'string' ? i.mimeType : 'image/png',
      bytes: typeof i.base64 === 'string' ? base64ToBytes(i.base64) : undefined,
      r2Key: typeof i.r2Key === 'string' ? i.r2Key : undefined,
      url: typeof i.url === 'string' ? i.url : undefined,
    });
  }
  return out;
}

/**
 * Fetch bytes for previous-stage outputs that arrived as URL-only refs.
 *
 * Multi-stage chains no longer round-trip stage outputs through the
 * browser as base64 — Vercel rejects any request body over 4.5MB
 * (FUNCTION_PAYLOAD_TOO_LARGE), which is exactly what a full-size
 * gpt-image output re-uploaded for stage 2 does. The client now sends
 * only the output's URL; the compiler and the image adapters need real
 * bytes ("hydrate before compile time"), so we fetch them back here,
 * server-side, where no payload cap applies. Video refs stay URL-only:
 * the video providers take URLs natively.
 */
async function fetchUrlOnlyOutputs(refs: StageOutputRef[]): Promise<StageOutputRef[]> {
  return Promise.all(
    refs.map(async (ref) => {
      if (ref.bytes || ref.kind !== 'image' || !ref.url) return ref;
      const res = await fetch(ref.url);
      if (!res.ok) {
        throw new Error(
          `Failed to fetch stage-${ref.stageIndex} output ${ref.url}: ${res.status} ${res.statusText}`,
        );
      }
      return {
        ...ref,
        bytes: new Uint8Array(await res.arrayBuffer()),
        mimeType: res.headers.get('content-type') ?? ref.mimeType,
      };
    }),
  );
}

function extensionForMime(mime: string): string {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'video/mp4':
      return 'mp4';
    default:
      return 'bin';
  }
}

/**
 * Persist inline (base64) outputs to R2 and hand the client URLs
 * instead — the other half of the payload-cap fix: a 4K-class output
 * inlined in the response JSON can breach Vercel's response cap too,
 * and inlined outputs are what forced the client to re-upload them for
 * the next stage. Writes go through the Worker's secret-gated
 * `PUT /v1/outputs/internal/<key>` (same channel the Trigger.dev
 * runner uses); reads are the public immutable `GET /v1/outputs/<key>`.
 *
 * Without `INTERNAL_API_SECRET` configured (or on a failed write) the
 * output stays inline — degraded but working, exactly today's behavior.
 */
async function persistOutputs(
  outputs: Array<{ type: string; base64?: string; mimeType?: string; url?: string }>,
): Promise<typeof outputs> {
  const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '');
  const secret = process.env.INTERNAL_API_SECRET;
  if (!apiBase || !secret) {
    if (!secret) console.warn('INTERNAL_API_SECRET unset — playground outputs stay inline.');
    return outputs;
  }
  const runId = crypto.randomUUID();
  return Promise.all(
    outputs.map(async (out, i) => {
      if (!out.base64 || out.url) return out;
      const mime = out.mimeType ?? 'image/png';
      const key = `admin-playground/${runId}/out-${i}.${extensionForMime(mime)}`;
      try {
        const res = await fetch(`${apiBase}/v1/outputs/internal/${key}`, {
          method: 'PUT',
          headers: { 'content-type': mime, 'x-internal-secret': secret },
          body: base64ToBytes(out.base64) as unknown as ArrayBuffer,
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return { ...out, base64: undefined, url: `${apiBase}/v1/outputs/${key}` };
      } catch (err) {
        console.warn(`Playground output persist failed (${key}), keeping inline:`, err);
        return out;
      }
    }),
  );
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/**
 * Hydrate reference images stored in R2 into inline `base64` so the
 * compiler / adapter can ship them to the provider. The admin form
 * eagerly uploads each ref to the Worker's `/v1/admin/uploads`
 * endpoint and persists only `r2Key`; here we fetch the bytes back
 * through the public proxy (`/v1/uploads/<key>`) and stamp them onto
 * the stage in-place before compilation.
 *
 * Skipped for refs that already carry a `base64` payload (newly
 * uploaded in the same session) or no `r2Key` (legacy drafts).
 */
async function hydrateStageReferences(
  stage: GenerationStage,
): Promise<GenerationStage> {
  const apiBase = process.env.NEXT_PUBLIC_API_URL;
  if (!apiBase) {
    throw new Error(
      'NEXT_PUBLIC_API_URL is not set; cannot fetch R2-stored references.',
    );
  }
  const hydratedRefs = await Promise.all(
    stage.references.map(async (ref) => {
      if (ref.base64) return ref;
      if (!ref.r2Key) return ref;
      const res = await fetch(`${apiBase}/v1/uploads/${ref.r2Key}`);
      if (!res.ok) {
        throw new Error(
          `Failed to fetch reference image ${ref.r2Key}: ${res.status} ${res.statusText}`,
        );
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      return {
        ...ref,
        base64: bytesToBase64(buf),
        mimeType: ref.mimeType ?? res.headers.get('content-type') ?? 'image/png',
      };
    }),
  );
  return { ...stage, references: hydratedRefs };
}

export async function POST(req: Request) {
  let body: GenerateRequestBody;
  try {
    body = (await req.json()) as GenerateRequestBody;
  } catch {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'Invalid JSON body.' } },
      { status: 400 },
    );
  }

  if (!body?.stage?.model) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: '`stage` with at least { model } is required.' } },
      { status: 400 },
    );
  }

  let capabilities;
  try {
    capabilities = getCapabilities(body.stage.model);
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: 'unknown_model',
          message: err instanceof Error ? err.message : String(err),
        },
      },
      { status: 400 },
    );
  }

  let hydratedStage: GenerationStage;
  try {
    hydratedStage = await hydrateStageReferences(body.stage);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to hydrate reference images.';
    return NextResponse.json(
      { error: { code: 'reference_hydration_failed', message } },
      { status: 502 },
    );
  }

  let previousOutputs: StageOutputRef[];
  try {
    previousOutputs = await fetchUrlOnlyOutputs(hydrateStageOutputs(body.previousOutputs));
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to fetch previous stage outputs.';
    return NextResponse.json(
      { error: { code: 'stage_output_hydration_failed', message } },
      { status: 502 },
    );
  }

  const ctx: CompileContext = {
    stage: hydratedStage,
    templateInputs: body.templateInputs ?? [],
    inputValues: hydrateInputs(body.inputValues as Record<string, unknown> ?? {}),
    previousOutputs,
    capabilities,
  };

  const { request, warnings } = compile(ctx);

  try {
    const result = await executeStage(request, {
      gemini: process.env.GEMINI_API_KEY
        ? { apiKey: process.env.GEMINI_API_KEY }
        : undefined,
      klingApi2: process.env.KLING_API_KEY
        ? { apiKey: process.env.KLING_API_KEY }
        : undefined,
      kling:
        process.env.KLING_ACCESS_KEY && process.env.KLING_SECRET_KEY
          ? {
              accessKey: process.env.KLING_ACCESS_KEY,
              secretKey: process.env.KLING_SECRET_KEY,
            }
          : undefined,
      seedance: process.env.SEEDANCE_API_KEY
        ? { apiKey: process.env.SEEDANCE_API_KEY }
        : undefined,
      openai: process.env.OPENAI_API_KEY
        ? { apiKey: process.env.OPENAI_API_KEY }
        : undefined,
    });

    if (result.status === 'completed') {
      return NextResponse.json({
        ...result,
        outputs: await persistOutputs(result.outputs),
        warnings,
      });
    }
    return NextResponse.json({ ...result, warnings });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Generation failed.';
    console.error('Playground generation error:', err);
    return NextResponse.json(
      { error: { code: 'generation_failed', message }, warnings },
      { status: 500 },
    );
  }
}
