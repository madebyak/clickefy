/**
 * `compile()` — the prompt compiler.
 *
 * Takes a `GenerationStage` plus runtime context and produces a
 * provider-shaped `CompiledRequest`. Pure: no SDK calls, no I/O.
 *
 * The compiler is the single place that knows how the
 * provider-agnostic admin syntax (`{{input:x}}`, `{{ref:y}}`,
 * `{{stage_N_output}}` / `{{previous}}`) is translated to each
 * provider's native conventions:
 *
 *   ┌──────────────┬─────────────────────────────────────────────────┐
 *   │ Provider     │ How references are addressed                    │
 *   ├──────────────┼─────────────────────────────────────────────────┤
 *   │ Gemini       │ Ordinal — images sit in `contents[]` after a    │
 *   │ (multimodal) │ labelled text part. The prompt's {{ref:k}} /    │
 *   │              │ {{input:k}} tokens become "the Nth image".      │
 *   │ Imagen       │ No images. Image tokens are stripped with a     │
 *   │              │ warning so the prompt still reads naturally.    │
 *   │ Kling v2     │ Single subject image only. {{ref:k}} is         │
 *   │              │ unsupported — surfaced as a warning.            │
 *   │ Kling Omni   │ Native `@image_N` notation. Subjects and        │
 *   │              │ references occupy distinct slots                │
 *   │              │ (`start_image` + `reference_images[]`).         │
 *   └──────────────┴─────────────────────────────────────────────────┘
 *
 * Anything ambiguous or unsupported emits a `CompileWarning`. The
 * caller decides whether to upgrade warnings to errors (the admin
 * editor probably wants to; the runtime executor probably doesn't).
 */

import type {
  GenerationReference,
  GenerationStage,
  TemplateInputField,
} from '@clickfy/types';

import type { ModelCapabilities } from './capabilities';
import type {
  CompileContext,
  CompileResult,
  CompileWarning,
  GeminiCompiledRequest,
  GeminiContentPart,
  GptImageCompiledRequest,
  ImagePart,
  KlingCompiledRequest,
  RuntimeInputValue,
  SeedanceCompiledRequest,
  SeedreamCompiledRequest,
  StageOutputRef,
} from './compile-types';

// ─── Token parsing ──────────────────────────────────────────────────

/**
 * Variable tokens the compiler understands. Order of arms matters —
 * the more specific patterns are listed first so the regex won't
 * silently match a less specific one.
 */
type ParsedToken =
  | { kind: 'input'; key: string; raw: string }
  | { kind: 'ref'; key: string; raw: string }
  | { kind: 'stage-output'; stageIndex: number; raw: string }
  | { kind: 'previous'; raw: string }
  /**
   * Legacy `{{key}}` without `input:` / `ref:` prefix. Resolved at
   * substitution time: prefer input → reference → unknown. Emits a
   * `deprecated_syntax` warning so admins migrate over time.
   */
  | { kind: 'bare'; key: string; raw: string };

/**
 * Accepts both the new namespaced form and the legacy bare form. The
 * bare branch sits last so the more specific alternatives win first.
 */
const TOKEN_REGEX =
  /\{\{\s*(input:[a-z][a-z0-9_]*|ref:[a-z][a-z0-9_]*|stage_(\d+)_output|previous|[a-z][a-z0-9_]*)\s*\}\}/gi;

/**
 * Scan a prompt string and return every variable token in document
 * order. Used both for substitution and for the "unknown variable"
 * detection pass.
 */
function parseTokens(prompt: string): ParsedToken[] {
  const tokens: ParsedToken[] = [];
  for (const match of prompt.matchAll(TOKEN_REGEX)) {
    const raw = match[0];
    const body = (match[1] ?? '').trim();
    const lower = body.toLowerCase();
    if (lower === 'previous') {
      tokens.push({ kind: 'previous', raw });
      continue;
    }
    if (lower.startsWith('input:')) {
      tokens.push({ kind: 'input', key: body.slice('input:'.length), raw });
      continue;
    }
    if (lower.startsWith('ref:')) {
      tokens.push({ kind: 'ref', key: body.slice('ref:'.length), raw });
      continue;
    }
    const stageMatch = /^stage_(\d+)_output$/i.exec(body);
    if (stageMatch && stageMatch[1]) {
      tokens.push({ kind: 'stage-output', stageIndex: Number(stageMatch[1]), raw });
      continue;
    }
    // Anything else that matched our identifier pattern is a legacy
    // bare token (e.g. `{{product_image}}`).
    if (/^[a-z][a-z0-9_]*$/i.test(body)) {
      tokens.push({ kind: 'bare', key: body, raw });
    }
  }
  return tokens;
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Turn an ordinal index into the natural-language phrase Google's docs
 * use ("the first image", "the second image", …). Past nine we fall
 * back to a numeric form because spelt-out ordinals get awkward fast.
 */
function ordinalPhrase(index1: number): string {
  const ordinals = [
    'the first image',
    'the second image',
    'the third image',
    'the fourth image',
    'the fifth image',
    'the sixth image',
    'the seventh image',
    'the eighth image',
    'the ninth image',
  ];
  return ordinals[index1 - 1] ?? `image ${index1}`;
}

/**
 * Preamble we emit before a Gemini image so the model knows whether
 * the image is a reference (use as inspiration) or a subject (must
 * appear in the result). The role tag is uppercased and always sits
 * adjacent to the word "REFERENCE" / "INPUT" / "CONTINUATION" so the
 * model can pattern-match on it reliably; the admin's freeform
 * `displayLabel` is appended after a dash so it remains visible but
 * doesn't interfere with the keyword.
 */
function geminiPreamble(part: ImagePart): string {
  const ordinal = ordinalPhrase(part.index);
  const trailer = part.displayLabel ? ` (${part.displayLabel})` : '';
  if (part.role === 'reference') {
    return `[${part.roleTag} REFERENCE${trailer} — ${ordinal}. Use this ONLY as inspiration; do NOT reproduce or copy it]:`;
  }
  if (part.role === 'stage-output') {
    return `[CONTINUATION FROM PREVIOUS STAGE${trailer} — ${ordinal}. Preserve this content as the basis for the new generation]:`;
  }
  return `[USER INPUT${trailer} — ${ordinal}. This is the primary subject that MUST appear in the result]:`;
}

function buildImagePartsForGemini(
  ctx: CompileContext,
  warnings: CompileWarning[],
): ImagePart[] {
  // Ordering rule: stage outputs → user inputs → admin references.
  // Stage outputs go first so the model treats them as the dominant
  // subject (mirrors the "continuation" semantics). User inputs sit
  // next (the user's primary subject), and admin-uploaded references
  // come last (style / lighting cues the model is told to use only as
  // inspiration). This same ordering is reflected when emitting
  // `contents[]`.
  const parts: ImagePart[] = [];
  let index = 0;

  for (const so of ctx.previousOutputs) {
    if (so.kind !== 'image') continue;
    if (parts.length >= ctx.capabilities.maxImagesTotal) {
      warnings.push({
        code: 'config_clamped',
        message: `Dropped stage_${so.stageIndex}_output — model accepts at most ${ctx.capabilities.maxImagesTotal} images.`,
      });
      break;
    }
    index += 1;
    parts.push({
      index,
      role: 'stage-output',
      roleTag: 'STAGE_OUTPUT',
      displayLabel: `Stage ${so.stageIndex} output`,
      mimeType: so.mimeType,
      bytes: so.bytes,
      r2Key: so.r2Key,
      url: so.url,
    });
  }

  for (const field of ctx.templateInputs) {
    const value = ctx.inputValues[field.fieldKey];
    if (!value) continue;
    if (value.kind !== 'image' && value.kind !== 'video') continue;
    if (value.kind === 'video') continue; // Gemini image models can't take video.
    if (parts.length >= ctx.capabilities.maxImagesTotal) {
      warnings.push({
        code: 'config_clamped',
        message: `Dropped user input "${field.fieldKey}" — model accepts at most ${ctx.capabilities.maxImagesTotal} images.`,
      });
      break;
    }
    index += 1;
    parts.push({
      index,
      role: 'subject',
      roleTag: 'USER_INPUT',
      displayLabel: field.label || field.fieldKey,
      mimeType: value.mimeType,
      bytes: value.bytes,
      r2Key: value.r2Key,
      url: value.url,
    });
  }

  for (const ref of ctx.stage.references) {
    if (parts.length >= ctx.capabilities.maxImagesTotal) {
      warnings.push({
        code: 'config_clamped',
        message: `Dropped reference "${ref.key}" — model accepts at most ${ctx.capabilities.maxImagesTotal} images.`,
      });
      break;
    }
    if (!ref.r2Key && !ref.base64) {
      warnings.push({
        code: 'reference_dropped',
        message: `Reference "${ref.key}" has no r2Key or working base64; skipped.`,
      });
      continue;
    }
    index += 1;
    parts.push({
      index,
      role: 'reference',
      roleTag: ref.role.toUpperCase(),
      displayLabel: ref.label ?? '',
      mimeType: ref.mimeType ?? 'image/png',
      bytes: ref.base64 ? base64ToBytes(ref.base64) : undefined,
      r2Key: ref.r2Key,
    });
  }

  return parts;
}

function base64ToBytes(b64: string): Uint8Array {
  // We're agnostic to the runtime here — Workers ship `atob`, Node 18+
  // does too, and Trigger.dev's Node runtime obviously does. We avoid
  // `Buffer` so the package stays Web-Standards-only.
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

// ─── Token substitution ─────────────────────────────────────────────

/**
 * Substitute every `{{…}}` token in the prompt. The substitution
 * differs per provider style:
 *
 *   - `ordinal`  → "the first image" / "the second image" (Gemini).
 *   - `at`       → `@image_N` (Kling Omni / O1).
 *   - `none`     → image tokens are stripped entirely; only text input
 *                  tokens are substituted (Imagen).
 *
 * Text-input tokens (`{{input:foo}}` where `foo` is a `text`/`textarea`
 * field) are always inlined as plain text regardless of provider.
 *
 * Returns the rewritten prompt plus any warnings the caller should
 * propagate (e.g. unknown tokens or refs that don't exist).
 */
function substituteTokens(args: {
  prompt: string;
  tokens: ParsedToken[];
  templateInputs: TemplateInputField[];
  inputValues: Record<string, RuntimeInputValue>;
  references: GenerationReference[];
  previousOutputs: StageOutputRef[];
  imageParts: ImagePart[];
  style: 'ordinal' | 'at' | 'none';
  warnings: CompileWarning[];
}): string {
  const {
    tokens,
    templateInputs,
    inputValues,
    references,
    previousOutputs,
    imageParts,
    style,
    warnings,
  } = args;

  const refByKey = new Map(references.map((r) => [r.key, r] as const));
  // Map every kind of image token → its index in `imageParts`. We
  // match on stable identity (fieldKey for inputs, ref key for refs,
  // stageIndex for stage outputs) rather than on display strings, so
  // admins can rename labels without breaking prompt substitution.
  const partIndexBySubjectField = new Map<string, number>();
  for (const f of templateInputs) {
    const expectedLabel = f.label || f.fieldKey;
    const part = imageParts.find(
      (p) => p.role === 'subject' && p.displayLabel === expectedLabel,
    );
    if (part) partIndexBySubjectField.set(f.fieldKey, part.index);
  }
  const partIndexByRefKey = new Map<string, number>();
  // Reference parts are pushed in the order `stage.references` is
  // iterated, so we can pair them up by position rather than by label.
  const refParts = imageParts.filter((p) => p.role === 'reference');
  references.forEach((ref, i) => {
    const part = refParts[i];
    if (part) partIndexByRefKey.set(ref.key, part.index);
  });
  const partIndexByStage = new Map<number, number>();
  for (const so of previousOutputs) {
    const part = imageParts.find(
      (p) => p.role === 'stage-output' && p.displayLabel === `Stage ${so.stageIndex} output`,
    );
    if (part) partIndexByStage.set(so.stageIndex, part.index);
  }

  let prompt = args.prompt;

  // Helper: rewrite a `bare` token to its concrete kind by probing
  // template inputs and references in order. Anything still unresolved
  // becomes a noisy unknown_variable warning so admins notice.
  const tokenInputKeys = new Set(templateInputs.map((f) => f.fieldKey));
  const tokenRefKeys = new Set(references.map((r) => r.key));
  const resolveBare = (key: string, raw: string): ParsedToken => {
    if (tokenInputKeys.has(key)) {
      warnings.push({
        code: 'deprecated_syntax',
        message: `\`${raw}\` uses the legacy bare-key syntax. Prefer \`{{input:${key}}}\` for clarity.`,
        token: raw,
      });
      return { kind: 'input', key, raw };
    }
    if (tokenRefKeys.has(key)) {
      warnings.push({
        code: 'deprecated_syntax',
        message: `\`${raw}\` uses the legacy bare-key syntax. Prefer \`{{ref:${key}}}\` for clarity.`,
        token: raw,
      });
      return { kind: 'ref', key, raw };
    }
    return { kind: 'bare', key, raw };
  };

  for (const rawToken of tokens) {
    const token: ParsedToken = rawToken.kind === 'bare'
      ? resolveBare(rawToken.key, rawToken.raw)
      : rawToken;
    let replacement: string | null = null;

    switch (token.kind) {
      case 'bare': {
        warnings.push({
          code: 'unknown_variable',
          message: `Prompt references unknown variable "${token.key}".`,
          token: token.raw,
        });
        replacement = '';
        break;
      }
      case 'input': {
        const value = inputValues[token.key];
        const field = templateInputs.find((f) => f.fieldKey === token.key);
        if (!field) {
          warnings.push({
            code: 'unknown_variable',
            message: `Prompt references unknown input "${token.key}".`,
            token: token.raw,
          });
          replacement = '';
          break;
        }
        if (value?.kind === 'text') {
          replacement = value.value;
        } else if (value?.kind === 'image' || value?.kind === 'video') {
          // Image-typed input: substitute according to the provider style.
          if (style === 'none') {
            warnings.push({
              code: 'subject_dropped',
              message: `Model "${args.style}" does not accept images; dropped "{{input:${token.key}}}".`,
              token: token.raw,
            });
            replacement = '';
          } else if (style === 'at') {
            const idx = partIndexBySubjectField.get(token.key);
            replacement = idx ? `@image_${idx}` : '';
          } else {
            const idx = partIndexBySubjectField.get(token.key);
            replacement = idx ? ordinalPhrase(idx) : '';
          }
        } else {
          // Field exists but the user didn't submit a value — leave a
          // blank rather than the raw token so prompts stay coherent.
          replacement = '';
        }
        break;
      }
      case 'ref': {
        const ref = refByKey.get(token.key);
        if (!ref) {
          warnings.push({
            code: 'unknown_variable',
            message: `Prompt references unknown reference "${token.key}".`,
            token: token.raw,
          });
          replacement = '';
          break;
        }
        if (style === 'none') {
          warnings.push({
            code: 'reference_dropped',
            message: `Model does not accept reference images; dropped "{{ref:${token.key}}}".`,
            token: token.raw,
          });
          replacement = '';
        } else if (style === 'at') {
          const idx = partIndexByRefKey.get(token.key);
          replacement = idx ? `@image_${idx}` : '';
        } else {
          const idx = partIndexByRefKey.get(token.key);
          replacement = idx ? ordinalPhrase(idx) : '';
        }
        break;
      }
      case 'stage-output':
      case 'previous': {
        const stageIndex =
          token.kind === 'previous'
            ? previousOutputs[previousOutputs.length - 1]?.stageIndex
            : token.stageIndex;
        if (!stageIndex) {
          warnings.push({
            code: 'stage_output_missing',
            message:
              token.kind === 'previous'
                ? 'Prompt uses {{previous}} but there is no previous stage.'
                : `Prompt references stage_${token.kind === 'stage-output' ? token.stageIndex : '?'}_output but that stage has not run.`,
            token: token.raw,
          });
          replacement = '';
          break;
        }
        if (style === 'none') {
          warnings.push({
            code: 'subject_dropped',
            message: `Model does not accept images; dropped stage output reference.`,
            token: token.raw,
          });
          replacement = '';
        } else if (style === 'at') {
          const idx = partIndexByStage.get(stageIndex);
          replacement = idx ? `@image_${idx}` : '';
        } else {
          const idx = partIndexByStage.get(stageIndex);
          replacement = idx ? ordinalPhrase(idx) : '';
        }
        break;
      }
    }

    if (replacement !== null) {
      prompt = prompt.replace(token.raw, replacement);
    }
  }

  return prompt;
}

// ─── Top-level compiler ─────────────────────────────────────────────

function isImagen(model: string): boolean {
  return model.toLowerCase().startsWith('imagen');
}

function isKlingOmni(model: string): boolean {
  return model.toLowerCase().includes('omni');
}

/**
 * Compile a single stage into a provider-shaped request. The caller
 * is responsible for actually performing the HTTP call — typically via
 * `packages/providers/src/adapters/*` once those land.
 */
export function compile(ctx: CompileContext): CompileResult {
  const { stage, capabilities } = ctx;
  const warnings: CompileWarning[] = [];
  const tokens = parseTokens(stage.prompt);

  if (capabilities.provider === 'gemini') {
    return compileGemini(ctx, tokens, warnings);
  }
  if (capabilities.provider === 'kling') {
    return compileKling(ctx, tokens, warnings);
  }
  if (capabilities.provider === 'openai') {
    return compileOpenAI(ctx, tokens, warnings);
  }
  if (capabilities.provider === 'seedance') {
    // One vendor, two product lines: Seedream (image) is a synchronous
    // `/images/generations` call, Seedance (video) is a submit-and-poll
    // task. They share nothing but the host and key, so they get separate
    // compilers rather than a forest of conditionals in one.
    return capabilities.kind === 'image'
      ? compileSeedream(ctx, tokens, warnings)
      : compileSeedance(ctx, tokens, warnings);
  }
  throw new Error(`No compiler implementation for provider "${capabilities.provider}".`);
}

/**
 * The model id to put on the wire.
 *
 * `stage.model` is our internal key, frozen into template snapshots and
 * job rows; it is deliberately never renamed. When the provider's own id
 * for that model changes (a preview alias reaching GA, say), the registry
 * carries `apiModelId` and we send that instead. Falls back to the stage's
 * own value, which is the case for every model whose upstream id matches.
 */
function apiModelFor(stage: GenerationStage, capabilities: ModelCapabilities): string {
  return capabilities.apiModelId ?? stage.model;
}

// ─── Gemini compiler ────────────────────────────────────────────────

function compileGemini(
  ctx: CompileContext,
  tokens: ParsedToken[],
  warnings: CompileWarning[],
): CompileResult {
  const { stage, capabilities } = ctx;

  // Imagen variant: pure text-to-image. Strip image tokens entirely.
  if (isImagen(stage.model) || capabilities.refAddressing === 'none') {
    const prompt = substituteTokens({
      prompt: stage.prompt,
      tokens,
      templateInputs: ctx.templateInputs,
      inputValues: ctx.inputValues,
      references: stage.references,
      previousOutputs: ctx.previousOutputs,
      imageParts: [],
      style: 'none',
      warnings,
    });

    // Surface any refs we dropped wholesale.
    if (stage.references.length > 0) {
      warnings.push({
        code: 'reference_dropped',
        message: `Model "${stage.model}" ignores reference images; ${stage.references.length} dropped.`,
      });
    }

    const request: GeminiCompiledRequest = {
      provider: 'gemini',
      variant: 'generateImages',
      model: apiModelFor(stage, capabilities),
      prompt,
      contents: [],
      imageConfig: extractAspect(stage, capabilities),
      numberOfOutputs: extractNumberOfOutputs(stage, capabilities),
      responseModalities: ['IMAGE'],
      imageParts: [],
    };
    return { request, warnings };
  }

  // Multimodal Gemini (Nano Banana family).
  const imageParts = buildImagePartsForGemini(ctx, warnings);
  const prompt = substituteTokens({
    prompt: stage.prompt,
    tokens,
    templateInputs: ctx.templateInputs,
    inputValues: ctx.inputValues,
    references: stage.references,
    previousOutputs: ctx.previousOutputs,
    imageParts,
    style: 'ordinal',
    warnings,
  });

  const contents: GeminiContentPart[] = [];
  for (const part of imageParts) {
    contents.push({ text: geminiPreamble(part) });
    // Inline data is only emitted if the executor has the bytes; the
    // adapter is responsible for fetching from R2 when only `r2Key` is
    // present and then patching `inlineData.data` into the part.
    if (part.bytes) {
      contents.push({
        inlineData: { mimeType: part.mimeType, data: bytesToBase64(part.bytes) },
      });
    } else {
      contents.push({
        inlineData: { mimeType: part.mimeType, data: '' },
      });
    }
  }
  contents.push({ text: prompt });

  // Warn about refs / inputs that were never referenced. The check is
  // intentionally lenient: an admin might include a reference purely
  // for style transfer without naming it in the prompt — that's valid.
  // We only warn when there's clearly no way the image could matter
  // (i.e. the prompt contains no image tokens at all).
  const tokenKinds = new Set(tokens.map((t) => t.kind));
  if (!tokenKinds.has('ref') && !tokenKinds.has('input') && !tokenKinds.has('stage-output') && !tokenKinds.has('previous') && imageParts.length > 0) {
    warnings.push({
      code: 'unused_reference',
      message: `Prompt does not address any of the ${imageParts.length} attached images.`,
    });
  }

  const request: GeminiCompiledRequest = {
    provider: 'gemini',
    variant: 'generateContent',
    model: apiModelFor(stage, capabilities),
    prompt,
    contents,
    imageConfig: extractAspect(stage, capabilities),
    numberOfOutputs: extractNumberOfOutputs(stage, capabilities),
    responseModalities: ['IMAGE'],
    imageParts,
  };
  return { request, warnings };
}

// ─── Kling compiler ─────────────────────────────────────────────────

function compileKling(
  ctx: CompileContext,
  tokens: ParsedToken[],
  warnings: CompileWarning[],
): CompileResult {
  const { stage, capabilities } = ctx;
  const isOmni = isKlingOmni(stage.model);

  // Collect subjects (stage outputs first, then user image inputs).
  // Kling v2 keeps only the first subject; Omni accepts up to 2 (start
  // + end frame) and surfaces all refs in a separate slot.
  const subjects: ImagePart[] = [];
  let subjectIndex = 0;

  for (const so of ctx.previousOutputs) {
    if (so.kind !== 'image') continue;
    if (subjects.length >= capabilities.maxSubjects) break;
    subjectIndex += 1;
    subjects.push({
      index: subjectIndex,
      role: 'stage-output',
      roleTag: 'STAGE_OUTPUT',
      displayLabel: `Stage ${so.stageIndex} output`,
      mimeType: so.mimeType,
      bytes: so.bytes,
      r2Key: so.r2Key,
      url: so.url,
    });
  }
  for (const field of ctx.templateInputs) {
    const v = ctx.inputValues[field.fieldKey];
    if (!v || v.kind !== 'image') continue;
    if (subjects.length >= capabilities.maxSubjects) {
      warnings.push({
        code: 'config_clamped',
        message: `Kling ${stage.model} accepts ${capabilities.maxSubjects} subject image(s); "${field.fieldKey}" dropped.`,
      });
      break;
    }
    subjectIndex += 1;
    subjects.push({
      index: subjectIndex,
      role: 'subject',
      roleTag: 'USER_INPUT',
      displayLabel: field.label || field.fieldKey,
      mimeType: v.mimeType,
      bytes: v.bytes,
      r2Key: v.r2Key,
      url: v.url,
    });
  }

  // References. Empty array for v2 (which doesn't accept them) plus a
  // warning if the admin attached any.
  const refs: ImagePart[] = [];
  if (!isOmni && stage.references.length > 0) {
    warnings.push({
      code: 'reference_dropped',
      message: `Kling ${stage.model} does not accept reference images; ${stage.references.length} dropped. Use Kling Omni for multi-reference flows.`,
    });
  }
  if (isOmni) {
    let refIndex = subjects.length;
    for (const ref of stage.references) {
      if (refs.length >= capabilities.maxReferences) {
        warnings.push({
          code: 'config_clamped',
          message: `Kling Omni accepts at most ${capabilities.maxReferences} references; "${ref.key}" dropped.`,
        });
        break;
      }
      if (!ref.r2Key && !ref.base64) {
        warnings.push({
          code: 'reference_dropped',
          message: `Reference "${ref.key}" has no r2Key or base64; skipped.`,
        });
        continue;
      }
      refIndex += 1;
      refs.push({
        index: refIndex,
        role: 'reference',
        roleTag: ref.role.toUpperCase(),
        displayLabel: ref.label ?? '',
        mimeType: ref.mimeType ?? 'image/png',
        bytes: ref.base64 ? base64ToBytes(ref.base64) : undefined,
        r2Key: ref.r2Key,
      });
    }
  }

  const imageParts: ImagePart[] = [...subjects, ...refs];

  const prompt = substituteTokens({
    prompt: stage.prompt,
    tokens,
    templateInputs: ctx.templateInputs,
    inputValues: ctx.inputValues,
    references: stage.references,
    previousOutputs: ctx.previousOutputs,
    imageParts,
    style: isOmni ? 'at' : 'ordinal',
    warnings,
  });

  // Only emit `aspectRatio` when the model actually honors it. A
  // single-value capability list (e.g. v2-master locked to its input
  // aspect) means "don't send the field at all"; if the admin somehow
  // configured a different one, surface a warning so they know it
  // would have been ignored.
  const cfgAspect =
    typeof stage.config.aspectRatio === 'string' ? stage.config.aspectRatio : undefined;
  // Narrow on the sizing mode before reading `.values` — the pixels
  // arm carries `presets` instead. Today every Kling capability is
  // aspect-mode, but the type-guard keeps us honest when GPT Image 2
  // (pixels mode) lands.
  const aspectSizing = capabilities.sizing.mode === 'aspect' ? capabilities.sizing : undefined;
  const supportsAspect = aspectSizing !== undefined && aspectSizing.values.length > 1;
  let aspectFromConfig: string | undefined;
  if (supportsAspect && aspectSizing) {
    if (cfgAspect && !aspectSizing.values.includes(cfgAspect)) {
      warnings.push({
        code: 'config_clamped',
        message: `Aspect ratio "${cfgAspect}" is not supported by ${stage.model}; falling back to the model default. Allowed: ${aspectSizing.values.join(', ')}.`,
      });
      aspectFromConfig = undefined;
    } else {
      aspectFromConfig = cfgAspect;
    }
  } else if (cfgAspect) {
    warnings.push({
      code: 'config_clamped',
      message: `${stage.model} does not honor aspect_ratio; the field will be omitted from the request.`,
    });
  }
  const duration =
    typeof stage.config.duration === 'number'
      ? stage.config.duration
      : capabilities.duration?.default;
  const cfgScale =
    typeof stage.config.cfgScale === 'number' ? stage.config.cfgScale : undefined;
  const mode = typeof stage.config.mode === 'string'
    ? (stage.config.mode as 'standard' | 'pro' | 'std' | '4k')
    : undefined;
  const negativePrompt =
    typeof stage.config.negativePrompt === 'string' && stage.config.negativePrompt.length > 0
      ? stage.config.negativePrompt
      : undefined;
  // Native audio (`sound: on|off` on the omni endpoint). Only emitted
  // for sound-capable models; a truthy config on a non-capable model
  // gets a soft warning instead of a silently-ignored wire field.
  const cfgSound = stage.config.sound === true || stage.config.sound === 'on';
  let soundEnabled: boolean | undefined;
  if (capabilities.supportsSound) {
    soundEnabled = cfgSound ? true : undefined;
  } else if (cfgSound) {
    warnings.push({
      code: 'config_clamped',
      message: `${stage.model} does not support native audio; \`sound\` will be omitted from the request.`,
    });
  }

  // Endpoint variant: Omni has its own route; on the classic endpoints a
  // prompt-only run goes to text2video — but ONLY for models that can do
  // t2v (the v3 family, discriminated by having quality `modes`). The
  // i2v-only v2 family keeps image2video so a missing subject still
  // surfaces the adapter's clear "requires a subject image" error
  // instead of a confusing provider 4xx.
  const supportsTextToVideo = !isOmni && capabilities.modes !== undefined;

  // Native audio is gated behind a minimum tier on some models (Kling
  // 2.6: 1080p only). The tier is what the user was BILLED for, so it is
  // not ours to upgrade — quietly serving 1080p when they paid for 720p
  // loses the difference on every job. Drop the audio and say why.
  let audioEnabled = soundEnabled;
  const audioTier = capabilities.nativeAudioRequiresTier;
  if (audioEnabled && audioTier && mode && mode !== audioTier) {
    const label = capabilities.modes?.labels?.[audioTier] ?? audioTier;
    warnings.push({
      code: 'config_clamped',
      message: `${stage.model} only generates native audio at the ${label} tier; this stage is billed at "${mode}", so audio was turned off. Select ${label} to keep the sound.`,
    });
    audioEnabled = undefined;
  }

  const request: KlingCompiledRequest = {
    provider: 'kling',
    variant: isOmni
      ? 'omni'
      : !subjects[0] && supportsTextToVideo
        ? 'text2video'
        : 'image2video',
    api2: capabilities.klingApi2,
    model: apiModelFor(stage, capabilities),
    prompt,
    negativePrompt,
    aspectRatio: aspectFromConfig,
    duration,
    mode,
    cfgScale,
    soundEnabled: audioEnabled,
    startImage: subjects[0],
    endImage: capabilities.acceptsStartEndImage ? subjects[1] : undefined,
    referenceImages: refs.length > 0 ? refs : undefined,
  };
  return { request, warnings };
}

// ─── Helpers ────────────────────────────────────────────────────────

function extractAspect(
  stage: GenerationStage,
  capabilities: ModelCapabilities,
): GeminiCompiledRequest['imageConfig'] {
  if (capabilities.sizing.mode !== 'aspect') return undefined;
  const cfg = stage.config;
  const aspect = typeof cfg.aspectRatio === 'string' ? cfg.aspectRatio : undefined;
  // For Gemini the priced tier IS the resolution, so `mode` wins over a
  // stage-authored `imageSize`: the user was billed for that exact tier
  // and must be served it.
  const tier =
    capabilities.modes && typeof cfg.mode === 'string' && capabilities.modes.values.includes(cfg.mode)
      ? cfg.mode
      : undefined;
  const imageSize = tier ?? (typeof cfg.imageSize === 'string' ? cfg.imageSize : undefined);
  if (!aspect && !imageSize) return undefined;
  return { aspectRatio: aspect, imageSize };
}

function extractNumberOfOutputs(
  stage: GenerationStage,
  capabilities: ModelCapabilities,
): number {
  const raw = stage.config.numberOfOutputs;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(capabilities.outputs.min, Math.min(capabilities.outputs.max, Math.trunc(raw)));
  }
  return capabilities.outputs.default;
}

// ─── OpenAI compiler (GPT Image 2) ──────────────────────────────────

/**
 * Resolve a pixel-mode `size` string.
 *
 * Every other provider in the roster is aspect-ratio based, so nothing
 * existed for this arm — `extractAspect()` returns undefined for pixels
 * mode, which is why an unresolved size would previously have sailed
 * past validation unchallenged.
 *
 * Accepts, in order of preference:
 *   1. an explicit `WIDTHxHEIGHT` that satisfies every documented
 *      constraint (each edge divisible by 16, total pixels in range,
 *      aspect between 1:3 and 3:1, longest edge ≤ maxEdge);
 *   2. an aspect-ratio string mapped onto the closest preset, so a
 *      template authored against ratio-based models still works;
 *   3. the model's first preset.
 */
/**
 * Largest valid `WIDTHxHEIGHT` for a target ratio, or null when the
 * ratio cannot be expressed at all.
 *
 * Both edges must land on the provider's multiple, stay inside the edge
 * cap, and keep total pixels within range. We walk candidate heights and
 * keep the one with the smallest ratio error, breaking ties toward a
 * target area chosen to match the model's own presets — so output size
 * stays consistent whichever shape is picked.
 */
function solvePixelSize(
  ratio: number,
  sizing: Extract<ModelCapabilities['sizing'], { mode: 'pixels' }>,
): string | null {
  // OpenAI rejects anything beyond 1:3–3:1 regardless of pixel count.
  if (ratio > 3 || ratio < 1 / 3) return null;
  const { divisibleBy: step, maxEdge, minPixels, maxPixels } = sizing;
  const TARGET_PIXELS = 1_600_000;

  let best: { size: string; err: number; areaGap: number } | null = null;
  for (let h = step; h <= maxEdge; h += step) {
    const w = Math.round((ratio * h) / step) * step;
    if (w < step || w > maxEdge) continue;
    const pixels = w * h;
    if (pixels < minPixels || pixels > maxPixels) continue;
    const err = Math.abs(w / h - ratio) / ratio;
    const areaGap = Math.abs(pixels - TARGET_PIXELS);
    if (!best || err < best.err - 1e-9 || (Math.abs(err - best.err) < 1e-9 && areaGap < best.areaGap)) {
      best = { size: `${w}x${h}`, err, areaGap };
    }
  }
  return best?.size ?? null;
}

function resolvePixelSize(
  stage: GenerationStage,
  capabilities: ModelCapabilities,
  warnings: CompileWarning[],
): string {
  const sizing = capabilities.sizing;
  if (sizing.mode !== 'pixels') return '1024x1024';
  const fallback = sizing.presets[0] ?? '1024x1024';
  const cfg = stage.config;

  const raw = typeof cfg.imageSize === 'string' ? cfg.imageSize : undefined;
  if (raw) {
    const m = /^(\d+)x(\d+)$/i.exec(raw.trim());
    if (m) {
      const w = Number(m[1]);
      const h = Number(m[2]);
      const pixels = w * h;
      const ratio = w / h;
      const ok =
        w % sizing.divisibleBy === 0 &&
        h % sizing.divisibleBy === 0 &&
        Math.max(w, h) <= sizing.maxEdge &&
        pixels >= sizing.minPixels &&
        pixels <= sizing.maxPixels &&
        ratio <= 3 &&
        ratio >= 1 / 3;
      if (ok) return `${w}x${h}`;
      warnings.push({
        code: 'config_clamped',
        message: `Size "${raw}" violates the model's pixel constraints; using "${fallback}".`,
      });
      return fallback;
    }
    // Not WxH — fall through and try to read it as an aspect ratio.
  }

  const aspect = typeof cfg.aspectRatio === 'string' ? cfg.aspectRatio : raw;
  if (aspect && aspect !== 'Auto' && aspect !== 'adaptive') {
    const parts = aspect.split(':').map(Number);
    const [aw, ah] = parts;
    if (aw && ah) {
      // Solve the ratio into exact dimensions rather than snapping to the
      // nearest preset. With only three presets (1:1, 3:2, 2:3), a 16:9
      // request used to come back as 3:2 — visibly the wrong shape, with
      // nothing to tell the user it had been substituted.
      const solved = solvePixelSize(aw / ah, sizing);
      if (solved) return solved;
      warnings.push({
        code: 'config_clamped',
        message: `Aspect ratio "${aspect}" cannot be expressed within ${stage.model}'s pixel limits; using "${fallback}".`,
      });
      return fallback;
    }
  }

  return fallback;
}

function compileOpenAI(
  ctx: CompileContext,
  tokens: ParsedToken[],
  warnings: CompileWarning[],
): CompileResult {
  const { stage, capabilities } = ctx;
  const cfg = stage.config;

  const imageParts = buildImagePartsForGemini(ctx, warnings);

  const prompt = substituteTokens({
    prompt: stage.prompt,
    tokens,
    templateInputs: ctx.templateInputs,
    inputValues: ctx.inputValues,
    references: stage.references,
    previousOutputs: ctx.previousOutputs,
    imageParts,
    style: 'ordinal',
    warnings,
  });

  // Validate the quality tier against what the model actually offers
  // rather than trusting the stage config — an unknown value is a 400.
  const allowed = capabilities.quality?.values ?? ['low', 'medium', 'high'];
  const fallbackQuality = (capabilities.quality?.default ?? 'medium') as 'low' | 'medium' | 'high';
  // `mode` is the billed tier and takes precedence over a stage-authored
  // `quality` for the same reason as Gemini's resolution above.
  const requested =
    (typeof cfg.mode === 'string' ? cfg.mode : undefined) ??
    (typeof cfg.quality === 'string' ? cfg.quality : undefined);
  let quality = fallbackQuality;
  if (requested) {
    if (allowed.includes(requested)) {
      quality = requested as 'low' | 'medium' | 'high';
    } else {
      warnings.push({
        code: 'config_clamped',
        message: `Quality "${requested}" is not supported; using "${fallbackQuality}".`,
      });
    }
  }

  const request: GptImageCompiledRequest = {
    provider: 'openai',
    // Reference images switch the call from /images/generations to
    // /images/edits, which is multipart rather than JSON.
    variant: imageParts.length > 0 ? 'image-edit' : 'image-generate',
    model: apiModelFor(stage, capabilities),
    prompt,
    size: resolvePixelSize(stage, capabilities, warnings),
    quality,
    numberOfOutputs: extractNumberOfOutputs(stage, capabilities),
    imageParts,
  };

  return { request, warnings };
}

// ─── Seedream compiler (BytePlus ModelArk, image line) ──────────────

/**
 * Compile a Seedream image request.
 *
 * Two things make this unlike every other image compiler we have:
 *
 * 1. **There is no aspect-ratio parameter.** Seedream infers shape from
 *    the prompt text and reports what it actually made in `data[].size`
 *    (asking for `1K` returned 1152x864 in testing). So a chosen ratio has
 *    to be *written into the prompt* — that is the only lever available.
 *
 * 2. **There is no `n`.** Multi-image comes from
 *    `sequential_image_generation: 'auto'` plus a `max_images` cap, and the
 *    model decides how many the prompt implies. Inputs + outputs ≤ 15.
 */
function compileSeedream(
  ctx: CompileContext,
  tokens: ParsedToken[],
  warnings: CompileWarning[],
): CompileResult {
  const { stage, capabilities } = ctx;
  const cfg = stage.config;

  // Same ordering rule as Gemini (stage outputs → user inputs → admin
  // refs); the helper is provider-agnostic despite its name.
  const images = buildImagePartsForGemini(ctx, warnings);

  let prompt = substituteTokens({
    prompt: stage.prompt,
    tokens,
    templateInputs: ctx.templateInputs,
    inputValues: ctx.inputValues,
    references: stage.references,
    previousOutputs: ctx.previousOutputs,
    imageParts: images,
    style: 'ordinal',
    warnings,
  });

  // Fold the aspect ratio into the prompt, since the API has no field for
  // it. Skipped for 'adaptive' (means "match the input").
  const ratio = typeof cfg.aspectRatio === 'string' ? cfg.aspectRatio : undefined;
  if (ratio && ratio !== 'adaptive') {
    prompt = `${prompt}\n\nAspect ratio: ${ratio}.`;
  }

  // Resolution keyword. Never pass raw WxH: 4.5 and 5.0-lite reject
  // anything under ~3.69 MP, so a plausible-looking 1024x1024 is a hard
  // error there. Keywords are per-model and always valid.
  const resolutions = capabilities.sizing.mode === 'aspect' ? capabilities.sizing.resolutions : undefined;
  const requested = typeof cfg.imageSize === 'string' ? cfg.imageSize : undefined;
  let size = requested;
  if (size && resolutions && !resolutions.includes(size)) {
    warnings.push({
      code: 'config_clamped',
      message: `Model "${stage.model}" does not support resolution "${size}"; using "${resolutions[0]}".`,
    });
    size = resolutions[0];
  }
  if (!size && resolutions?.length) size = resolutions[0];

  // Deliberately ONE image per call.
  //
  // Seedream has no `n`. Its only batching lever is
  // `sequential_image_generation: 'auto'`, where the MODEL decides how
  // many images the prompt implies — asking for 2 returned 1 in testing
  // because the prompt described a single subject. We debit credits
  // up-front per requested image, so a user paying for N and receiving
  // fewer would be a billing defect. Multiple outputs are produced the
  // same way as every other provider: N independent jobs, each debited
  // and each returning exactly one image.
  const wanted = extractNumberOfOutputs(stage, capabilities);
  if (wanted > 1) {
    warnings.push({
      code: 'config_clamped',
      message: `Seedream cannot guarantee a fixed output count; generating 1 image (requested ${wanted}). Submit ${wanted} jobs instead.`,
    });
  }

  const request: SeedreamCompiledRequest = {
    provider: 'seedance',
    variant: 'image',
    model: apiModelFor(stage, capabilities),
    prompt,
    size,
    // Omitted entirely unless the model accepts the field — 4.x errors on
    // its mere presence, even set to that model's own default.
    ...(capabilities.supportsOutputFormat
      ? { outputFormat: cfg.outputFormat === 'png' ? ('png' as const) : ('jpeg' as const) }
      : {}),
    // API defaults this to true and burns a visible mark into the output.
    watermark: false,
    sequentialImageGeneration: 'disabled',
    ...(images.length > 0 ? { images } : {}),
  };

  return { request, warnings };
}

// ─── Seedance compiler ──────────────────────────────────────────────

/**
 * Compile a Seedance 2.0 stage.
 *
 * BytePlus Seedance 2.0 exposes four mutually-exclusive generation
 * modes; the wire shape (`content[]` array roles) is the contract:
 *
 *   • text-only         — no media parts
 *   • first-frame I2V   — one `image_url` with role `first_frame`
 *   • first+last frame  — two `image_url`s, roles `first_frame` +
 *                         `last_frame`
 *   • multimodal ref    — N `image_url`s with role `reference_image`,
 *                         + reference_video + reference_audio
 *
 * BytePlus's own docs explicitly forbid mixing modes in one task. We
 * disambiguate via `stage.config.seedanceMode` (admin-picked), with
 * `inferLegacyMode()` as the fallback for templates written before the
 * mode picker landed. Each branch resolves its own slot bindings and
 * deliberately ignores data belonging to the other mode (with a warning).
 *
 * Text-only is reachable from either mode by leaving every slot empty —
 * we don't need (and don't expose) a third 'text' option.
 */

/**
 * Resolve a single `SeedanceSlotBinding` to the `ImagePart` shape the
 * adapter understands. Returns `undefined` (with a warning) when the
 * binding cannot be satisfied at compile time — e.g. the bound user
 * input wasn't supplied for this run, or the referenced stage hasn't
 * produced an output yet. The caller decides whether a missing slot
 * is fatal (typically: no, drop it and continue).
 */
function resolveSeedanceSlot(
  binding: import('@clickfy/types').SeedanceSlotBinding,
  ctx: CompileContext,
  index: number,
  assetKind: 'image' | 'video' | 'audio',
  warnings: CompileWarning[],
): ImagePart | undefined {
  if (binding.kind === 'user_input') {
    const field = ctx.templateInputs.find((f) => f.fieldKey === binding.fieldKey);
    const value = ctx.inputValues[binding.fieldKey];
    if (!value || (value.kind !== 'image' && value.kind !== 'video')) {
      warnings.push({
        code: 'unknown_variable',
        message: `Seedance slot bound to user input "${binding.fieldKey}" — no usable value provided.`,
        token: binding.fieldKey,
      });
      return undefined;
    }
    return {
      index,
      role: 'subject',
      roleTag: 'USER_INPUT',
      displayLabel: field?.label || binding.fieldKey,
      mimeType: value.mimeType,
      bytes: value.bytes,
      r2Key: value.r2Key,
      url: value.url,
    };
  }
  if (binding.kind === 'stage_output') {
    const so = ctx.previousOutputs.find((o) => o.stageIndex === binding.stageIndex);
    if (!so) {
      warnings.push({
        code: 'stage_output_missing',
        message: `Seedance slot bound to stage ${binding.stageIndex} output — that stage has not produced an output yet.`,
      });
      return undefined;
    }
    return {
      index,
      role: 'stage-output',
      roleTag: 'STAGE_OUTPUT',
      displayLabel: `Stage ${so.stageIndex} output`,
      mimeType: so.mimeType,
      bytes: so.bytes,
      r2Key: so.r2Key,
      url: so.url,
    };
  }
  // admin_asset — only path for audio refs in v1
  const mimeFallback =
    assetKind === 'video'
      ? 'video/mp4'
      : assetKind === 'audio'
        ? 'audio/mpeg'
        : 'image/png';
  return {
    index,
    role: 'reference',
    roleTag: 'ADMIN_ASSET',
    displayLabel: '',
    mimeType: mimeFallback,
    r2Key: binding.r2Key,
  };
}

/**
 * Pick the right mode for templates that pre-date the explicit
 * `seedanceMode` config key:
 *
 *   • admin references present, no usable user-image subjects → reference
 *   • admin references present AND user-image subjects present → reference
 *     (mixed mode is the historical latent-bug case; reference wins
 *     because that's what most pre-PR templates were trying to do)
 *   • otherwise → first_last_frame
 *
 * Returns the inferred mode plus an optional deprecation warning when
 * the legacy state was ambiguous, so the admin sees a hint to migrate.
 */
function inferLegacySeedanceMode(
  stage: GenerationStage,
  ctx: CompileContext,
): { mode: 'first_last_frame' | 'reference'; warning?: CompileWarning } {
  const hasAdminRefs = stage.references.length > 0;
  const hasSubjectInputs =
    ctx.templateInputs.some((f) => f.type === 'image' || f.type === 'video') ||
    ctx.previousOutputs.some((o) => o.kind === 'image' || o.kind === 'video');

  if (hasAdminRefs && hasSubjectInputs) {
    return {
      mode: 'reference',
      warning: {
        code: 'deprecated_syntax',
        message:
          'Seedance stage has both admin references and image/video inputs; defaulting to "reference" mode. Pick an explicit mode in the editor to silence this.',
      },
    };
  }
  if (hasAdminRefs) return { mode: 'reference' };
  return { mode: 'first_last_frame' };
}

function compileSeedance(
  ctx: CompileContext,
  tokens: ParsedToken[],
  warnings: CompileWarning[],
): CompileResult {
  const { stage, capabilities } = ctx;
  const cfg = stage.config as import('@clickfy/types').SeedanceStageConfig;

  // ── Pick generation mode ─────────────────────────────────────────
  let mode: 'first_last_frame' | 'reference';
  if (cfg.seedanceMode === 'first_last_frame' || cfg.seedanceMode === 'reference') {
    mode = cfg.seedanceMode;
  } else {
    const inferred = inferLegacySeedanceMode(stage, ctx);
    mode = inferred.mode;
    if (inferred.warning) warnings.push(inferred.warning);
  }

  // ── Resolve slots per mode ───────────────────────────────────────
  let startImage: ImagePart | undefined;
  let endImage: ImagePart | undefined;
  const refs: ImagePart[] = [];

  if (mode === 'first_last_frame') {
    // Mode-conflict guard: warn (but don't crash) if legacy admin refs
    // are present in a first/last stage — they'd violate BytePlus's
    // mode-exclusivity rule. We drop them on the wire and ask the
    // admin to migrate (either move to reference mode, or remove the
    // refs).
    if (stage.references.length > 0) {
      warnings.push({
        code: 'reference_dropped',
        message: `Seedance stage is in First & Last Frame mode; ${stage.references.length} admin reference(s) ignored to keep the request valid.`,
      });
    }

    const explicitSlots = cfg.frameSlots;
    if (explicitSlots) {
      let idx = 0;
      if (explicitSlots.firstFrame) {
        idx += 1;
        startImage = resolveSeedanceSlot(explicitSlots.firstFrame, ctx, idx, 'image', warnings);
      }
      if (explicitSlots.lastFrame) {
        if (!capabilities.acceptsStartEndImage) {
          warnings.push({
            code: 'config_clamped',
            message: `${stage.model} does not accept a last frame; lastFrame slot dropped.`,
          });
        } else {
          idx += 1;
          endImage = resolveSeedanceSlot(explicitSlots.lastFrame, ctx, idx, 'image', warnings);
        }
      }
    } else {
      // Legacy auto-bind: when the admin hasn't picked a mode yet
      // (no `seedanceMode` config), preserve the pre-PR behavior of
      // auto-populating firstFrame (and optional lastFrame) from the
      // first available subjects — stage outputs win over user inputs,
      // matching the orchestrator's input-resolver ordering.
      const subjects: ImagePart[] = [];
      let idx = 0;
      for (const so of ctx.previousOutputs) {
        if (so.kind !== 'image' && so.kind !== 'video') continue;
        if (subjects.length >= capabilities.maxSubjects) break;
        idx += 1;
        subjects.push({
          index: idx,
          role: 'stage-output',
          roleTag: 'STAGE_OUTPUT',
          displayLabel: `Stage ${so.stageIndex} output`,
          mimeType: so.mimeType,
          bytes: so.bytes,
          r2Key: so.r2Key,
          url: so.url,
        });
      }
      for (const field of ctx.templateInputs) {
        const v = ctx.inputValues[field.fieldKey];
        if (!v || (v.kind !== 'image' && v.kind !== 'video')) continue;
        if (subjects.length >= capabilities.maxSubjects) break;
        idx += 1;
        subjects.push({
          index: idx,
          role: 'subject',
          roleTag: 'USER_INPUT',
          displayLabel: field.label || field.fieldKey,
          mimeType: v.mimeType,
          bytes: v.bytes,
          r2Key: v.r2Key,
          url: v.url,
        });
      }
      startImage = subjects[0];
      endImage = capabilities.acceptsStartEndImage ? subjects[1] : undefined;
    }
  } else {
    // reference mode — also guard against legacy mixed shape
    if (cfg.frameSlots?.firstFrame || cfg.frameSlots?.lastFrame) {
      warnings.push({
        code: 'reference_dropped',
        message:
          'Seedance stage is in Reference mode; frame slots ignored to keep the request valid.',
      });
    }

    const slots = cfg.referenceSlots ?? [];

    // Per-asset-kind limits enforced by BytePlus.
    const limits: Record<'image' | 'video' | 'audio', number> = {
      image: capabilities.maxReferences ?? 9,
      video: 3,
      audio: 3,
    };
    const counts: Record<'image' | 'video' | 'audio', number> = {
      image: 0,
      video: 0,
      audio: 0,
    };

    let idx = 0;
    for (const slot of slots) {
      if (counts[slot.assetKind] >= limits[slot.assetKind]) {
        warnings.push({
          code: 'config_clamped',
          message: `Seedance accepts at most ${limits[slot.assetKind]} ${slot.assetKind} reference(s); "${slot.id}" dropped.`,
        });
        continue;
      }
      idx += 1;
      const part = resolveSeedanceSlot(slot.source, ctx, idx, slot.assetKind, warnings);
      if (!part) continue; // resolver already pushed a warning
      // Stamp the assetKind onto the mimeType when missing/wrong so the
      // adapter routes correctly. admin_asset bindings carry only an
      // r2Key — we infer mime from assetKind here.
      if (slot.source.kind === 'admin_asset') {
        part.mimeType =
          slot.assetKind === 'video'
            ? part.mimeType.startsWith('video/')
              ? part.mimeType
              : 'video/mp4'
            : slot.assetKind === 'audio'
              ? part.mimeType.startsWith('audio/')
                ? part.mimeType
                : 'audio/mpeg'
              : part.mimeType.startsWith('image/')
                ? part.mimeType
                : 'image/png';
      }
      refs.push(part);
      counts[slot.assetKind] += 1;
    }

    // Legacy admin references (stage.references[]) — when the admin
    // hasn't migrated to referenceSlots yet, treat each as an image
    // reference. Same per-kind limits apply.
    if (slots.length === 0) {
      let legacyIdx = idx;
      for (const ref of stage.references) {
        if (!ref.r2Key && !ref.base64) {
          warnings.push({
            code: 'reference_dropped',
            message: `Reference "${ref.key}" has no r2Key or base64; skipped.`,
          });
          continue;
        }
        const assetKind = (ref.assetKind ?? 'image') as 'image' | 'video' | 'audio';
        if (counts[assetKind] >= limits[assetKind]) {
          warnings.push({
            code: 'config_clamped',
            message: `Seedance accepts at most ${limits[assetKind]} ${assetKind} reference(s); "${ref.key}" dropped.`,
          });
          continue;
        }
        legacyIdx += 1;
        refs.push({
          index: legacyIdx,
          role: 'reference',
          roleTag: ref.role.toUpperCase(),
          displayLabel: ref.label ?? '',
          mimeType: ref.mimeType ?? (assetKind === 'video' ? 'video/mp4' : assetKind === 'audio' ? 'audio/mpeg' : 'image/png'),
          bytes: ref.base64 ? base64ToBytes(ref.base64) : undefined,
          r2Key: ref.r2Key,
        });
        counts[assetKind] += 1;
      }
    }
  }

  // Token substitution — prompts are addressed ordinally for Seedance
  // regardless of mode (role tags on the wire carry structural meaning).
  const imageParts: ImagePart[] = [
    ...(startImage ? [startImage] : []),
    ...(endImage ? [endImage] : []),
    ...refs,
  ];

  const prompt = substituteTokens({
    prompt: stage.prompt,
    tokens,
    templateInputs: ctx.templateInputs,
    inputValues: ctx.inputValues,
    references: stage.references,
    previousOutputs: ctx.previousOutputs,
    imageParts,
    style: 'ordinal',
    warnings,
  });

  // Aspect / resolution / duration extraction with capability clamps.
  const aspectSizing =
    capabilities.sizing.mode === 'aspect' ? capabilities.sizing : undefined;
  const cfgRatio =
    typeof stage.config.aspectRatio === 'string' ? stage.config.aspectRatio : undefined;
  let ratio: string | undefined;
  if (cfgRatio && aspectSizing && !aspectSizing.values.includes(cfgRatio)) {
    warnings.push({
      code: 'config_clamped',
      message: `Aspect ratio "${cfgRatio}" is not supported by ${stage.model}; falling back to model default. Allowed: ${aspectSizing.values.join(', ')}.`,
    });
  } else {
    ratio = cfgRatio;
  }

  // The billed tier wins over a stage-authored `resolution`: the user was
  // charged for that exact tier and must be served it. Mirrors how Gemini
  // resolves imageSize.
  const billedTier =
    capabilities.modes && typeof stage.config.mode === 'string'
      && capabilities.modes.values.includes(stage.config.mode)
      ? stage.config.mode
      : undefined;
  const cfgResolution =
    billedTier ??
    (typeof stage.config.resolution === 'string' ? stage.config.resolution : undefined);
  const allowedResolutions = aspectSizing?.resolutions ?? [];
  let resolution: SeedanceCompiledRequest['resolution'];
  if (
    cfgResolution &&
    allowedResolutions.length > 0 &&
    !allowedResolutions.includes(cfgResolution)
  ) {
    warnings.push({
      code: 'config_clamped',
      message: `Resolution "${cfgResolution}" is not supported by ${stage.model}; falling back to default. Allowed: ${allowedResolutions.join(', ')}.`,
    });
  } else if (cfgResolution) {
    resolution = cfgResolution as SeedanceCompiledRequest['resolution'];
  }

  let duration: number | undefined;
  if (typeof stage.config.duration === 'number') {
    duration = stage.config.duration;
  } else {
    duration = capabilities.duration?.default;
  }

  // `generate_audio` defaults to TRUE on ModelArk, and audio output is
  // billed. Leaving it unset therefore buys audio on every generation
  // whether or not the product offers a sound toggle, so we always send
  // an explicit boolean and default it OFF. A model that cannot do audio
  // at all never gets the field.
  const generateAudio = capabilities.supportsSound
    ? typeof stage.config.generateAudio === 'boolean'
      ? stage.config.generateAudio
      : false
    : undefined;
  const returnLastFrame =
    typeof stage.config.returnLastFrame === 'boolean'
      ? stage.config.returnLastFrame
      : undefined;
  const cameraFixed =
    typeof stage.config.cameraFixed === 'boolean' ? stage.config.cameraFixed : undefined;
  const seed = typeof stage.config.seed === 'number' ? stage.config.seed : undefined;
  const negativePrompt =
    typeof stage.config.negativePrompt === 'string' && stage.config.negativePrompt.length > 0
      ? stage.config.negativePrompt
      : undefined;

  const request: SeedanceCompiledRequest = {
    provider: 'seedance',
    model: apiModelFor(stage, capabilities),
    prompt,
    ratio,
    duration,
    resolution,
    generateAudio,
    returnLastFrame,
    cameraFixed,
    seed,
    negativePrompt,
    startImage,
    endImage,
    referenceImages: refs.length > 0 ? refs : undefined,
  };
  return { request, warnings };
}

// Re-export for ergonomic single-import callers.
export type {
  CompiledRequest,
  CompileContext,
  CompileResult,
  CompileWarning,
  GeminiCompiledRequest,
  GptImageCompiledRequest,
  KlingCompiledRequest,
  RuntimeInputValue,
  SeedanceCompiledRequest,
  StageOutputRef,
} from './compile-types';
