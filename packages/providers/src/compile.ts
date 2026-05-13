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
 *   │ Kling Omni   │ Native `<<<image_N>>>` notation. Subjects and   │
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
 *   - `angle`    → `<<<image_N>>>` (Kling Omni).
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
  style: 'ordinal' | 'angle' | 'none';
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
          } else if (style === 'angle') {
            const idx = partIndexBySubjectField.get(token.key);
            replacement = idx ? `<<<image_${idx}>>>` : '';
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
        } else if (style === 'angle') {
          const idx = partIndexByRefKey.get(token.key);
          replacement = idx ? `<<<image_${idx}>>>` : '';
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
        } else if (style === 'angle') {
          const idx = partIndexByStage.get(stageIndex);
          replacement = idx ? `<<<image_${idx}>>>` : '';
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
  throw new Error(`No compiler implementation for provider "${capabilities.provider}".`);
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
      model: stage.model,
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
    model: stage.model,
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
    style: isOmni ? 'angle' : 'ordinal',
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
    ? (stage.config.mode as 'standard' | 'pro' | 'std')
    : undefined;
  const negativePrompt =
    typeof stage.config.negativePrompt === 'string' && stage.config.negativePrompt.length > 0
      ? stage.config.negativePrompt
      : undefined;

  const request: KlingCompiledRequest = {
    provider: 'kling',
    variant: isOmni ? 'omni' : 'image2video',
    model: stage.model,
    prompt,
    negativePrompt,
    aspectRatio: aspectFromConfig,
    duration,
    mode,
    cfgScale,
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
  const imageSize = typeof cfg.imageSize === 'string' ? cfg.imageSize : undefined;
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
  StageOutputRef,
} from './compile-types';
