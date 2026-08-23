/**
 * Tests for the prompt compiler.
 *
 * Coverage strategy: every meaningful row of the compiler decision
 * matrix gets at least one assertion. We deliberately avoid mocking
 * the SDKs — the compiler is pure, so the assertions are on the shape
 * of `CompiledRequest` and on the warning list.
 */

import { describe, expect, it } from 'vitest';

import type {
  GenerationStage,
  TemplateInputField,
} from '@clickfy/types';

import { aspectRatiosFor, getCapabilities } from './capabilities';
import { compile } from './compile';
import type {
  CompileContext,
  GeminiCompiledRequest,
  KlingCompiledRequest,
  RuntimeInputValue,
  SeedanceCompiledRequest,
  StageOutputRef,
  GptImageCompiledRequest,
} from './compile-types';

// ─── Tiny builders ──────────────────────────────────────────────────

function textField(fieldKey: string, label = fieldKey): TemplateInputField {
  return {
    id: `f-${fieldKey}`,
    fieldKey,
    label,
    required: false,
    order: 0,
    type: 'text',
  };
}

function imageField(fieldKey: string, label = fieldKey): TemplateInputField {
  return {
    id: `f-${fieldKey}`,
    fieldKey,
    label,
    required: false,
    order: 0,
    type: 'image',
  };
}

function imageValue(key = 'fake-key'): RuntimeInputValue {
  return {
    kind: 'image',
    r2Key: key,
    mimeType: 'image/png',
    bytes: new Uint8Array([1, 2, 3, 4]),
  };
}

function makeStage(partial: Partial<GenerationStage>): GenerationStage {
  return {
    id: 's-1',
    order: 1,
    provider: 'gemini',
    model: 'gemini-3-pro-image-preview',
    prompt: '',
    references: [],
    config: {},
    retry: { enabled: true, maxAttempts: 2 },
    ...partial,
  };
}

function makeCtx(partial: Partial<CompileContext> & { stage: GenerationStage }): CompileContext {
  return {
    stage: partial.stage,
    templateInputs: partial.templateInputs ?? [],
    inputValues: partial.inputValues ?? {},
    previousOutputs: partial.previousOutputs ?? [],
    capabilities: partial.capabilities ?? getCapabilities(partial.stage.model),
  };
}

// ─── Gemini: ordinal labelling ──────────────────────────────────────

describe('compile() — Gemini multimodal', () => {
  it('substitutes {{input:text}} inline and assembles ordinal preambles for images', () => {
    const product = imageField('product', 'Product');
    const background = textField('background', 'Background color');

    const stage = makeStage({
      prompt:
        'Studio shot of {{input:product}} with a {{input:background}} background. Match the lighting of {{ref:studio_light}}.',
      references: [
        {
          id: 'r-1',
          key: 'studio_light',
          role: 'lighting',
          label: 'Soft three-point',
          r2Key: 'refs/studio.png',
          mimeType: 'image/png',
        },
      ],
    });

    const ctx = makeCtx({
      stage,
      templateInputs: [product, background],
      inputValues: {
        product: imageValue('uploads/product.png'),
        background: { kind: 'text', value: 'warm cream' },
      },
    });

    const { request, warnings } = compile(ctx);
    expect(request.provider).toBe('gemini');
    const gemini = request as GeminiCompiledRequest;
    expect(gemini.variant).toBe('generateContent');

    // The image ordering should be: user inputs (subject) first, then
    // references. So `{{input:product}}` is "the first image" and
    // `{{ref:studio_light}}` is "the second image".
    expect(gemini.prompt).toBe(
      'Studio shot of the first image with a warm cream background. Match the lighting of the second image.',
    );

    // contents[] has: [subject-preamble, subject-bytes, ref-preamble, ref-bytes, prompt]
    expect(gemini.contents).toHaveLength(5);
    expect((gemini.contents[0] as { text: string }).text).toContain('USER INPUT');
    expect((gemini.contents[0] as { text: string }).text).toContain('the first image');
    expect((gemini.contents[2] as { text: string }).text).toContain('LIGHTING REFERENCE');
    expect((gemini.contents[2] as { text: string }).text).toContain('(Soft three-point)');
    expect((gemini.contents[2] as { text: string }).text).toContain('the second image');
    expect((gemini.contents[4] as { text: string }).text).toBe(gemini.prompt);

    expect(gemini.imageParts).toHaveLength(2);
    expect(gemini.imageParts[0]!.role).toBe('subject');
    expect(gemini.imageParts[1]!.role).toBe('reference');
    expect(warnings).toEqual([]);
  });

  it('surfaces an unknown_variable warning when {{ref:missing}} has no matching reference', () => {
    const stage = makeStage({
      prompt: 'Use the style of {{ref:missing}}.',
      references: [],
    });
    const { warnings, request } = compile(makeCtx({ stage }));
    expect(warnings.some((w) => w.code === 'unknown_variable')).toBe(true);
    // The stray token should be substituted to an empty string so the
    // prompt still reads naturally rather than leaking `{{ref:missing}}`.
    expect((request as GeminiCompiledRequest).prompt).toBe('Use the style of .');
  });

  it('clamps numberOfOutputs to the capability range', () => {
    const stage = makeStage({
      prompt: 'hi',
      config: { numberOfOutputs: 99 },
    });
    const { request } = compile(makeCtx({ stage }));
    const gemini = request as GeminiCompiledRequest;
    // gemini-3-pro-image-preview maxes at 4.
    expect(gemini.numberOfOutputs).toBe(4);
  });
});

// ─── Imagen: no images allowed ──────────────────────────────────────

describe('compile() — Imagen text-to-image', () => {
  it('routes to generateImages and drops every image token with a warning', () => {
    const stage = makeStage({
      model: 'imagen-4.0-generate-001',
      prompt: 'Generate {{input:scene}} in the style of {{ref:noir}}.',
      references: [
        { id: 'r', key: 'noir', role: 'style', r2Key: 'refs/n.png', mimeType: 'image/png' },
      ],
    });

    const { request, warnings } = compile(
      makeCtx({
        stage,
        templateInputs: [textField('scene')],
        inputValues: { scene: { kind: 'text', value: 'a moody alleyway' } },
      }),
    );

    const gemini = request as GeminiCompiledRequest;
    expect(gemini.variant).toBe('generateImages');
    expect(gemini.contents).toEqual([]);
    expect(gemini.imageParts).toEqual([]);
    expect(gemini.prompt).toBe('Generate a moody alleyway in the style of .');
    expect(warnings.find((w) => w.code === 'reference_dropped')).toBeDefined();
  });
});

// ─── Kling Omni: @image_N addressing ────────────────────────────────

describe('compile() — Kling 3 Omni', () => {
  it('produces @image_N in the prompt and a referenceImages list', () => {
    const product = imageField('product', 'Product');
    const stage = makeStage({
      provider: 'kling',
      model: 'kling-v3-omni',
      prompt:
        'Animate @image_1 walking through a forest matching the mood of {{ref:mood}}.',
      references: [
        { id: 'r', key: 'mood', role: 'lighting', r2Key: 'refs/m.png', mimeType: 'image/png' },
      ],
      config: { aspectRatio: '9:16', duration: 8, mode: 'pro' },
    });

    const { request, warnings } = compile(
      makeCtx({
        stage,
        templateInputs: [product],
        inputValues: { product: imageValue() },
      }),
    );

    expect(request.provider).toBe('kling');
    const kling = request as KlingCompiledRequest;
    expect(kling.variant).toBe('omni');
    // {{ref:mood}} sits at slot 2 (subject is slot 1).
    expect(kling.prompt).toContain('@image_2');
    expect(kling.prompt).not.toContain('{{ref:mood}}');
    expect(kling.aspectRatio).toBe('9:16');
    expect(kling.duration).toBe(8);
    expect(kling.mode).toBe('pro');
    expect(kling.startImage?.role).toBe('subject');
    expect(kling.referenceImages).toHaveLength(1);
    expect(kling.referenceImages?.[0]!.roleTag).toBe('LIGHTING');
    expect(kling.referenceImages?.[0]!.displayLabel).toBe('');
    expect(warnings).toEqual([]);
  });
});

// ─── Kling v2: single subject, no refs ──────────────────────────────

describe('compile() — Kling v2 family', () => {
  it('emits a reference_dropped warning when refs are attached', () => {
    const stage = makeStage({
      provider: 'kling',
      model: 'kling-v2-6',
      prompt: 'Camera tracks in slowly on the subject.',
      references: [
        { id: 'r', key: 's', role: 'style', r2Key: 'refs/s.png', mimeType: 'image/png' },
      ],
    });
    const { request, warnings } = compile(
      makeCtx({
        stage,
        templateInputs: [imageField('subj')],
        inputValues: { subj: imageValue() },
      }),
    );
    const kling = request as KlingCompiledRequest;
    expect(kling.variant).toBe('image2video');
    expect(kling.referenceImages).toBeUndefined();
    expect(warnings.find((w) => w.code === 'reference_dropped')).toBeDefined();
    expect(kling.startImage).toBeDefined();
  });
});

// ─── Multi-stage continuation ───────────────────────────────────────

describe('compile() — stage chaining', () => {
  it('treats {{previous}} as the latest stage output and slots it as a subject', () => {
    const product = imageField('product');
    const stage1Output: StageOutputRef = {
      stageIndex: 1,
      kind: 'image',
      mimeType: 'image/png',
      bytes: new Uint8Array([9, 9, 9]),
    };

    const stage2 = makeStage({
      id: 's-2',
      order: 2,
      provider: 'kling',
      model: 'kling-v3-omni',
      prompt: 'Animate {{previous}} with a slow track-in.',
    });

    const { request } = compile(
      makeCtx({
        stage: stage2,
        templateInputs: [product],
        previousOutputs: [stage1Output],
      }),
    );

    const kling = request as KlingCompiledRequest;
    expect(kling.prompt).toContain('@image_1');
    expect(kling.startImage?.role).toBe('stage-output');
  });

  it('warns when {{previous}} is used in stage 1', () => {
    const stage1 = makeStage({
      prompt: 'Continue from {{previous}}.',
    });
    const { warnings } = compile(makeCtx({ stage: stage1 }));
    expect(warnings.some((w) => w.code === 'stage_output_missing')).toBe(true);
  });

  it('binds {{stage_2_output}} explicitly to the named prior stage', () => {
    const ctx = makeCtx({
      stage: makeStage({
        prompt: 'Refine {{stage_2_output}}.',
      }),
      previousOutputs: [
        {
          stageIndex: 1,
          kind: 'image',
          mimeType: 'image/png',
          bytes: new Uint8Array([1]),
        },
        {
          stageIndex: 2,
          kind: 'image',
          mimeType: 'image/png',
          bytes: new Uint8Array([2]),
        },
      ],
    });
    const { request, warnings } = compile(ctx);
    expect(warnings.find((w) => w.code === 'stage_output_missing')).toBeUndefined();
    // Stage outputs are pushed in iteration order — stage 1 then stage 2 —
    // so stage_2_output ends up at ordinal index 2.
    expect((request as GeminiCompiledRequest).prompt).toBe('Refine the second image.');
  });
});

// ─── Legacy bare-key syntax ─────────────────────────────────────────

describe('compile() — legacy bare-key syntax', () => {
  it('resolves bare {{key}} to a matching input field with a deprecated_syntax warning', () => {
    const product = imageField('product_image', 'Product');
    const stage = makeStage({
      prompt: 'Generate a photo of {{product_image}} on marble.',
    });
    const { request, warnings } = compile(
      makeCtx({
        stage,
        templateInputs: [product],
        inputValues: { product_image: imageValue() },
      }),
    );
    const gemini = request as GeminiCompiledRequest;
    expect(gemini.prompt).toBe('Generate a photo of the first image on marble.');
    expect(warnings.find((w) => w.code === 'deprecated_syntax')).toBeDefined();
  });

  it('resolves bare {{key}} to a matching reference when no input claims it', () => {
    const stage = makeStage({
      prompt: 'Match the lighting of {{moody}}.',
      references: [
        { id: 'r', key: 'moody', role: 'lighting', r2Key: 'm.png', mimeType: 'image/png' },
      ],
    });
    const { request, warnings } = compile(makeCtx({ stage }));
    expect((request as GeminiCompiledRequest).prompt).toBe('Match the lighting of the first image.');
    expect(warnings.some((w) => w.code === 'deprecated_syntax')).toBe(true);
  });

  it('warns unknown_variable for a bare {{key}} that matches nothing', () => {
    const stage = makeStage({ prompt: 'Use {{ghost}} somehow.' });
    const { warnings } = compile(makeCtx({ stage }));
    expect(warnings.some((w) => w.code === 'unknown_variable')).toBe(true);
  });
});

// ─── Seedance 2.0: BytePlus multimodal video ────────────────────────

describe('compile() — GPT Image aspect ratios', () => {
  const SIZING = getCapabilities('gpt-image-2').sizing as Extract<
    ReturnType<typeof getCapabilities>['sizing'],
    { mode: 'pixels' }
  >;

  it('offers ratios even though the model is pixel-sized', () => {
    // Without this the picker renders no ratio control at all, because
    // the roster only ever read `sizing.values` from aspect-mode models.
    expect(aspectRatiosFor(getCapabilities('gpt-image-2')).length).toBeGreaterThan(10);
  });

  it('resolves every offered ratio to a size the API will accept', () => {
    for (const ratio of aspectRatiosFor(getCapabilities('gpt-image-2'))) {
      const stage = makeStage({
        provider: 'openai',
        model: 'gpt-image-2',
        prompt: 'A parrot.',
        config: { aspectRatio: ratio },
      });
      const { request, warnings } = compile(makeCtx({ stage }));
      const size = (request as GptImageCompiledRequest).size;
      const m = /^(\d+)x(\d+)$/.exec(size!);
      expect(m, `${ratio} produced "${size}"`).toBeTruthy();
      const w = Number(m![1]);
      const h = Number(m![2]);
      const [aw, ah] = ratio.split(':').map(Number);

      // Every OpenAI constraint, asserted per ratio.
      expect(w % SIZING.divisibleBy, `${ratio} width`).toBe(0);
      expect(h % SIZING.divisibleBy, `${ratio} height`).toBe(0);
      expect(Math.max(w, h)).toBeLessThanOrEqual(SIZING.maxEdge);
      expect(w * h).toBeGreaterThanOrEqual(SIZING.minPixels);
      expect(w * h).toBeLessThanOrEqual(SIZING.maxPixels);
      expect(w / h).toBeLessThanOrEqual(3.0001);
      expect(w / h).toBeGreaterThanOrEqual(1 / 3 - 0.0001);

      // And it is actually the requested SHAPE, not a nearby preset.
      expect(Math.abs(w / h - aw! / ah!) / (aw! / ah!)).toBeLessThan(0.01);
      expect(warnings.filter((x) => x.code === 'config_clamped')).toHaveLength(0);
    }
  });

  it('gives 16:9 a true widescreen size, not the 3:2 preset', () => {
    const stage = makeStage({
      provider: 'openai',
      model: 'gpt-image-2',
      prompt: 'A parrot.',
      config: { aspectRatio: '16:9' },
    });
    const size = (compile(makeCtx({ stage })).request as GptImageCompiledRequest).size;
    // The old closest-preset logic returned 1536x1024 (3:2) here.
    expect(size).not.toBe('1536x1024');
    const [w, h] = size!.split('x').map(Number) as [number, number];
    expect(w! / h!).toBeCloseTo(16 / 9, 2);
  });

  it('still rejects a ratio outside the 1:3–3:1 window', () => {
    const stage = makeStage({
      provider: 'openai',
      model: 'gpt-image-2',
      prompt: 'A parrot.',
      config: { aspectRatio: '8:1' },
    });
    const { request, warnings } = compile(makeCtx({ stage }));
    expect((request as GptImageCompiledRequest).size).toBe('1024x1024');
    expect(warnings.some((w) => w.code === 'config_clamped')).toBe(true);
  });
});

describe('compile() — Seedance priced resolution tiers', () => {
  // Resolution is what the user is BILLED on, so the tier has to reach
  // the provider: serving 720p on a 4K charge is a silent overcharge.
  it('sends the billed tier as the resolution', () => {
    const stage = makeStage({
      provider: 'seedance',
      model: 'dreamina-seedance-2-0-260128',
      prompt: 'A drone shot over dunes.',
      config: { aspectRatio: '16:9', duration: 5, mode: '4k' },
    });
    const sd = compile(makeCtx({ stage })).request as SeedanceCompiledRequest;
    expect(sd.resolution).toBe('4k');
  });

  it('lets the billed tier override a stage-authored resolution', () => {
    const stage = makeStage({
      provider: 'seedance',
      model: 'dreamina-seedance-2-0-260128',
      prompt: 'A drone shot over dunes.',
      config: { aspectRatio: '16:9', duration: 5, resolution: '480p', mode: '1080p' },
    });
    const sd = compile(makeCtx({ stage })).request as SeedanceCompiledRequest;
    expect(sd.resolution).toBe('1080p');
  });

  it('exposes only the tiers each model actually supports', () => {
    expect(getCapabilities('dreamina-seedance-2-0-260128').modes?.values).toEqual([
      '480p', '720p', '1080p', '4k',
    ]);
    // 2.5 gained 1080p on 2026-08-14 (10-bit H.265), separately priced.
    expect(getCapabilities('dreamina-seedance-2-5-260628').modes?.values).toEqual([
      '480p', '720p', '1080p',
    ]);
    // Fast and Mini genuinely cap at 720p.
    for (const key of [
      'dreamina-seedance-2-0-fast-260128',
      'dreamina-seedance-2-0-mini-260615',
    ]) {
      expect(getCapabilities(key).modes?.values).toEqual(['480p', '720p']);
    }
    for (const key of [
      'dreamina-seedance-2-0-fast-260128',
      'dreamina-seedance-2-0-mini-260615',
      'dreamina-seedance-2-5-260628',
    ]) {
      expect(getCapabilities(key).modes?.default).toBe('720p');
    }
  });
});

describe('compile() — Seedance audio + exclusivity guards', () => {
  // `generate_audio` defaults to TRUE upstream and audio output is
  // billed, so an omitted field silently buys audio on every job.
  it('sends generate_audio explicitly false when the stage does not ask for sound', () => {
    const stage = makeStage({
      provider: 'seedance',
      model: 'dreamina-seedance-2-0-260128',
      prompt: 'A silent drift across a frozen lake.',
      config: { aspectRatio: '16:9', duration: 5 },
    });
    const { request } = compile(makeCtx({ stage }));
    const sd = request as SeedanceCompiledRequest;
    expect(sd.generateAudio).toBe(false);
  });

  it('still honours an explicit request for sound', () => {
    const stage = makeStage({
      provider: 'seedance',
      model: 'dreamina-seedance-2-0-260128',
      prompt: 'Waves crashing, with sound.',
      config: { aspectRatio: '16:9', duration: 5, generateAudio: true },
    });
    const sd = compile(makeCtx({ stage })).request as SeedanceCompiledRequest;
    expect(sd.generateAudio).toBe(true);
  });

  // Start frames and references are mutually exclusive upstream, but
  // that is already enforced by the explicit `seedanceMode` selector
  // rather than by a capability flag: in first_last_frame mode the admin
  // references are dropped, and in reference mode the frame slots are.
  it('drops admin references when the stage is in first_last_frame mode', () => {
    const product = imageField('product', 'Product');
    const stage = makeStage({
      provider: 'seedance',
      model: 'dreamina-seedance-2-0-260128',
      prompt: 'Animate {{input:product}} in the style of {{ref:mood}}.',
      references: [
        { id: 'r', key: 'mood', role: 'lighting', r2Key: 'refs/m.png', mimeType: 'image/png' },
      ],
      config: { aspectRatio: '16:9', duration: 5, seedanceMode: 'first_last_frame' },
    });
    const { request, warnings } = compile(
      makeCtx({
        stage,
        templateInputs: [product],
        inputValues: { product: imageValue('uploads/p.png') },
      }),
    );
    const sd = request as SeedanceCompiledRequest;
    expect(sd.startImage).toBeDefined();
    expect(sd.referenceImages ?? []).toHaveLength(0);
    expect(warnings.some((w) => w.code === 'reference_dropped')).toBe(true);
  });

  // Fast tops out at 720p; 1080p used to be offered and rejected upstream.
  it('clamps an unsupported resolution on the Fast tier instead of sending it', () => {
    const stage = makeStage({
      provider: 'seedance',
      model: 'dreamina-seedance-2-0-fast-260128',
      prompt: 'A quick pan across a market.',
      config: { aspectRatio: '16:9', resolution: '1080p', duration: 5 },
    });
    const { request, warnings } = compile(makeCtx({ stage }));
    const sd = request as SeedanceCompiledRequest;
    expect(sd.resolution).toBeUndefined();
    expect(warnings.some((w) => w.code === 'config_clamped')).toBe(true);
  });

  it('exposes the corrected duration and resolution ranges', () => {
    expect(getCapabilities('dreamina-seedance-2-0-260128').duration?.values).toContain(15);
    expect(getCapabilities('dreamina-seedance-2-0-fast-260128').sizing).toMatchObject({
      resolutions: ['480p', '720p'],
    });
    // Kling 3.0 accepts every whole second in 3..15, not just 5 and 10.
    expect(getCapabilities('kling-v3').duration?.values).toContain(7);
    expect(getCapabilities('kling-v3-omni').duration?.values).toContain(12);
    // 2.6 gained native audio.
    expect(getCapabilities('kling-v2-6').supportsSound).toBe(true);
  });
});

describe('compile() — Seedance 2.0', () => {
  it('compiles a T2V stage with prompt + config flow-through', () => {
    const stage = makeStage({
      provider: 'seedance',
      model: 'dreamina-seedance-2-0-fast-260128',
      prompt: 'Cinematic dolly shot of a koi pond at sunset.',
      config: {
        aspectRatio: '16:9',
        resolution: '720p',
        duration: 5,
        generateAudio: true,
        cameraFixed: false,
      },
    });
    const { request, warnings } = compile(makeCtx({ stage }));
    expect(request.provider).toBe('seedance');
    const sd = request as SeedanceCompiledRequest;
    expect(sd.prompt).toBe('Cinematic dolly shot of a koi pond at sunset.');
    expect(sd.ratio).toBe('16:9');
    expect(sd.resolution).toBe('720p');
    expect(sd.duration).toBe(5);
    expect(sd.generateAudio).toBe(true);
    // `camera_fixed` is documented for the Seedance 1.x line only, so it
    // is dropped rather than sent to a 2.x model that would reject it.
    expect(sd.cameraFixed).toBeUndefined();
    expect(sd.startImage).toBeUndefined();
    expect(sd.endImage).toBeUndefined();
    expect(sd.referenceImages).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it('compiles an I2V stage with a user image input as first_frame', () => {
    const product = imageField('product', 'Product');
    const stage = makeStage({
      provider: 'seedance',
      model: 'dreamina-seedance-2-0-260128',
      prompt: 'Animate {{input:product}} with a slow zoom in.',
      config: { aspectRatio: 'adaptive', resolution: '1080p', duration: 5 },
    });
    const { request } = compile(
      makeCtx({
        stage,
        templateInputs: [product],
        inputValues: { product: imageValue('uploads/p.png') },
      }),
    );
    const sd = request as SeedanceCompiledRequest;
    expect(sd.startImage).toBeDefined();
    expect(sd.startImage?.role).toBe('subject');
    expect(sd.startImage?.r2Key).toBe('uploads/p.png');
    expect(sd.endImage).toBeUndefined();
    expect(sd.ratio).toBe('adaptive');
    expect(sd.resolution).toBe('1080p');
    // Ordinal substitution: {{input:product}} → "the first image".
    expect(sd.prompt).toBe('Animate the first image with a slow zoom in.');
  });

  it('places two subject images as first_frame + last_frame (bookend control)', () => {
    const start = imageField('start', 'Start');
    const end = imageField('end', 'End');
    const stage = makeStage({
      provider: 'seedance',
      model: 'dreamina-seedance-2-0-260128',
      prompt: 'Morph between the two reference frames smoothly.',
    });
    const { request } = compile(
      makeCtx({
        stage,
        templateInputs: [start, end],
        inputValues: {
          start: imageValue('uploads/start.png'),
          end: imageValue('uploads/end.png'),
        },
      }),
    );
    const sd = request as SeedanceCompiledRequest;
    expect(sd.startImage?.r2Key).toBe('uploads/start.png');
    expect(sd.endImage?.r2Key).toBe('uploads/end.png');
  });

  it('routes admin references to referenceImages[] (legacy mixed shape → reference mode wins)', () => {
    // Pre-mode-picker template: both user image input AND admin refs.
    // BytePlus forbids mixing first/last-frame and reference modes in
    // one task, so the legacy inferrer picks `reference` and drops the
    // user image with a deprecation warning telling the admin to pick
    // an explicit mode.
    const product = imageField('product');
    const stage = makeStage({
      provider: 'seedance',
      model: 'dreamina-seedance-2-0-260128',
      prompt: 'Match the look of {{ref:mood}}.',
      references: [
        { id: 'r1', key: 'mood', role: 'lighting', r2Key: 'refs/m.png', mimeType: 'image/png' },
        { id: 'r2', key: 'style', role: 'style', r2Key: 'refs/s.png', mimeType: 'image/png' },
      ],
    });
    const { request, warnings } = compile(
      makeCtx({
        stage,
        templateInputs: [product],
        inputValues: { product: imageValue() },
      }),
    );
    const sd = request as SeedanceCompiledRequest;
    expect(sd.startImage).toBeUndefined();
    expect(sd.endImage).toBeUndefined();
    expect(sd.referenceImages).toHaveLength(2);
    expect(sd.referenceImages?.[0]!.role).toBe('reference');
    expect(sd.referenceImages?.[0]!.roleTag).toBe('LIGHTING');
    // {{ref:mood}} resolves to the first image (no subject occupying
    // index 1 anymore in reference mode).
    expect(sd.prompt).toBe('Match the look of the first image.');
    expect(warnings.some((w) => w.code === 'deprecated_syntax')).toBe(true);
  });

  it('clamps aspect ratio and resolution to capability allowlists with a warning', () => {
    const stage = makeStage({
      provider: 'seedance',
      model: 'dreamina-seedance-2-0-fast-260128',
      prompt: 'A test scene.',
      config: { aspectRatio: '7:3', resolution: '8K' },
    });
    const { request, warnings } = compile(makeCtx({ stage }));
    const sd = request as SeedanceCompiledRequest;
    expect(sd.ratio).toBeUndefined();
    expect(sd.resolution).toBeUndefined();
    expect(warnings.filter((w) => w.code === 'config_clamped').length).toBeGreaterThanOrEqual(2);
  });

  // ── Explicit mode dispatch (PR1 of the generation-modes work) ────

  it('explicit first_last_frame mode binds firstFrame from a user input', () => {
    const product = imageField('product', 'Product');
    const stage = makeStage({
      provider: 'seedance',
      model: 'dreamina-seedance-2-0-260128',
      prompt: 'Pan slowly across {{input:product}}.',
      config: {
        seedanceMode: 'first_last_frame',
        frameSlots: {
          firstFrame: { kind: 'user_input', fieldKey: 'product' },
        },
      },
    });
    const { request, warnings } = compile(
      makeCtx({
        stage,
        templateInputs: [product],
        inputValues: { product: imageValue('uploads/p.png') },
      }),
    );
    const sd = request as SeedanceCompiledRequest;
    expect(sd.startImage?.r2Key).toBe('uploads/p.png');
    expect(sd.endImage).toBeUndefined();
    expect(sd.referenceImages).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it('explicit first_last_frame mode binds both frames and ignores admin refs with a warning', () => {
    const start = imageField('start');
    const end = imageField('end');
    const stage = makeStage({
      provider: 'seedance',
      model: 'dreamina-seedance-2-0-260128',
      prompt: 'Bookend animation.',
      // Admin left a stray ref on the stage before switching modes.
      references: [{ id: 'r1', key: 'mood', role: 'lighting', r2Key: 'refs/m.png' }],
      config: {
        seedanceMode: 'first_last_frame',
        frameSlots: {
          firstFrame: { kind: 'user_input', fieldKey: 'start' },
          lastFrame: { kind: 'user_input', fieldKey: 'end' },
        },
      },
    });
    const { request, warnings } = compile(
      makeCtx({
        stage,
        templateInputs: [start, end],
        inputValues: {
          start: imageValue('uploads/s.png'),
          end: imageValue('uploads/e.png'),
        },
      }),
    );
    const sd = request as SeedanceCompiledRequest;
    expect(sd.startImage?.r2Key).toBe('uploads/s.png');
    expect(sd.endImage?.r2Key).toBe('uploads/e.png');
    expect(sd.referenceImages).toBeUndefined();
    expect(warnings.some((w) => w.code === 'reference_dropped')).toBe(true);
  });

  it('first_last_frame mode can chain off a previous stage output', () => {
    const stage = makeStage({
      provider: 'seedance',
      model: 'dreamina-seedance-2-0-260128',
      prompt: 'Animate the upstream still.',
      config: {
        seedanceMode: 'first_last_frame',
        frameSlots: {
          firstFrame: { kind: 'stage_output', stageIndex: 1 },
        },
      },
    });
    const previousOutputs: StageOutputRef[] = [
      { stageIndex: 1, kind: 'image', r2Key: 'jobs/abc/s1.png', mimeType: 'image/png' },
    ];
    const { request } = compile(makeCtx({ stage, previousOutputs }));
    const sd = request as SeedanceCompiledRequest;
    expect(sd.startImage?.r2Key).toBe('jobs/abc/s1.png');
    expect(sd.startImage?.role).toBe('stage-output');
  });

  it('first_last_frame mode warns when a bound user input is missing at runtime', () => {
    const product = imageField('product');
    const stage = makeStage({
      provider: 'seedance',
      model: 'dreamina-seedance-2-0-260128',
      prompt: 'Animate.',
      config: {
        seedanceMode: 'first_last_frame',
        frameSlots: {
          firstFrame: { kind: 'user_input', fieldKey: 'product' },
        },
      },
    });
    const { request, warnings } = compile(
      makeCtx({ stage, templateInputs: [product], inputValues: {} }),
    );
    const sd = request as SeedanceCompiledRequest;
    expect(sd.startImage).toBeUndefined();
    expect(warnings.some((w) => w.code === 'unknown_variable')).toBe(true);
  });

  it('explicit reference mode binds heterogeneous referenceSlots and ignores frame slots with a warning', () => {
    const product = imageField('product');
    const stage = makeStage({
      provider: 'seedance',
      model: 'dreamina-seedance-2-0-260128',
      prompt: 'Stylize the product.',
      config: {
        seedanceMode: 'reference',
        // Stray frameSlots left over from a mode switch.
        frameSlots: { firstFrame: { kind: 'user_input', fieldKey: 'product' } },
        referenceSlots: [
          {
            id: 'slot-a',
            assetKind: 'image',
            source: { kind: 'user_input', fieldKey: 'product' },
          },
          {
            id: 'slot-b',
            assetKind: 'image',
            source: { kind: 'admin_asset', r2Key: 'refs/style.png' },
          },
        ],
      },
    });
    const { request, warnings } = compile(
      makeCtx({
        stage,
        templateInputs: [product],
        inputValues: { product: imageValue('uploads/p.png') },
      }),
    );
    const sd = request as SeedanceCompiledRequest;
    expect(sd.startImage).toBeUndefined();
    expect(sd.referenceImages).toHaveLength(2);
    expect(sd.referenceImages?.[0]!.r2Key).toBe('uploads/p.png');
    expect(sd.referenceImages?.[1]!.r2Key).toBe('refs/style.png');
    expect(warnings.some((w) => w.code === 'reference_dropped')).toBe(true);
  });

  it('reference mode enforces BytePlus per-asset-kind limits (video ≤ 3)', () => {
    const stage = makeStage({
      provider: 'seedance',
      model: 'dreamina-seedance-2-0-260128',
      prompt: 'Multi-video reference.',
      config: {
        seedanceMode: 'reference',
        referenceSlots: Array.from({ length: 4 }, (_, i) => ({
          id: `v${i}`,
          assetKind: 'video' as const,
          source: { kind: 'admin_asset' as const, r2Key: `refs/v${i}.mp4` },
        })),
      },
    });
    const { request, warnings } = compile(makeCtx({ stage }));
    const sd = request as SeedanceCompiledRequest;
    expect(sd.referenceImages).toHaveLength(3);
    expect(sd.referenceImages?.every((r) => r.mimeType.startsWith('video/'))).toBe(true);
    expect(warnings.some((w) => w.code === 'config_clamped')).toBe(true);
  });

  it('legacy template (no seedanceMode) with only refs infers reference mode without warning', () => {
    const stage = makeStage({
      provider: 'seedance',
      model: 'dreamina-seedance-2-0-260128',
      prompt: 'Animate.',
      references: [{ id: 'r1', key: 'mood', role: 'lighting', r2Key: 'refs/m.png' }],
    });
    const { request, warnings } = compile(makeCtx({ stage }));
    const sd = request as SeedanceCompiledRequest;
    expect(sd.referenceImages).toHaveLength(1);
    expect(sd.startImage).toBeUndefined();
    expect(warnings.some((w) => w.code === 'deprecated_syntax')).toBe(false);
  });
});

// ─── Capabilities clamping ──────────────────────────────────────────

describe('compile() — capability limits', () => {
  it('drops trailing images when more are attached than the model accepts', () => {
    const stage = makeStage({
      model: 'gemini-2.5-flash-image', // maxImagesTotal = 3
      prompt: 'Use {{ref:a}} and {{ref:b}} and {{ref:c}} and {{ref:d}}.',
      references: [
        { id: 'a', key: 'a', role: 'style', r2Key: 'a.png', mimeType: 'image/png' },
        { id: 'b', key: 'b', role: 'style', r2Key: 'b.png', mimeType: 'image/png' },
        { id: 'c', key: 'c', role: 'style', r2Key: 'c.png', mimeType: 'image/png' },
        { id: 'd', key: 'd', role: 'style', r2Key: 'd.png', mimeType: 'image/png' },
      ],
    });
    const { request, warnings } = compile(makeCtx({ stage }));
    const gemini = request as GeminiCompiledRequest;
    expect(gemini.imageParts).toHaveLength(3);
    expect(warnings.some((w) => w.code === 'config_clamped')).toBe(true);
  });
});

// ─── apiModelId indirection ─────────────────────────────────────────
//
// `stage.model` is our internal key and is frozen into template
// snapshots; `apiModelId` is what the vendor is actually called today.
// These assert the two can diverge, so re-pointing a model at a new
// upstream id never requires rewriting stored snapshots.

describe('compile() — apiModelId indirection', () => {
  it('sends the capability apiModelId, not the snapshot key, when they differ', () => {
    const stage = makeStage({ model: 'gemini-3-pro-image-preview', prompt: 'A banana.' });
    const { request } = compile(makeCtx({ stage }));

    // The stage (and every stored snapshot) keeps the preview key…
    expect(stage.model).toBe('gemini-3-pro-image-preview');
    // …but the wire request targets the GA id.
    expect(request.model).toBe('gemini-3-pro-image');
  });

  it('maps the Nano Banana 2 preview key to its GA id too', () => {
    const stage = makeStage({ model: 'gemini-3.1-flash-image-preview', prompt: 'A banana.' });
    const { request } = compile(makeCtx({ stage }));
    expect(request.model).toBe('gemini-3.1-flash-image');
  });

  it('falls back to stage.model for models whose upstream id already matches', () => {
    // Gemini GA keys are their own upstream ids. (Kling no longer suits
    // this case: every ported model carries a path-segment apiModelId.)
    const stage = makeStage({ model: 'gemini-3-pro-image', prompt: 'A banana.' });
    const { request } = compile(makeCtx({ stage }));
    expect(request.model).toBe('gemini-3-pro-image');
  });

  it('maps ported Kling keys to their API 2.0 path segment and flags the route', () => {
    const stage = makeStage({
      provider: 'kling',
      model: 'kling-v2-6',
      prompt: 'A banana rotating.',
      config: { aspectRatio: '16:9' },
    });
    const { request } = compile(makeCtx({ stage }));
    const kling = request as KlingCompiledRequest;
    // The stored modelKey never changes; only the id on the wire does.
    expect(kling.model).toBe('kling-2.6');
    expect(kling.api2).toBe(true);
  });

  it('leaves un-ported Kling models on the legacy client', () => {
    const stage = makeStage({
      provider: 'kling',
      model: 'kling-v2-master',
      prompt: 'A banana rotating.',
      config: { aspectRatio: '16:9' },
    });
    const kling = compile(makeCtx({ stage })).request as KlingCompiledRequest;
    expect(kling.model).toBe('kling-v2-master');
    expect(kling.api2).toBeUndefined();
  });

  it('drops native audio rather than upgrading a billed tier (Kling 2.6)', () => {
    const stage = makeStage({
      provider: 'kling',
      model: 'kling-v2-6',
      prompt: 'A banana rotating, with sound.',
      config: { aspectRatio: '16:9', sound: true, mode: 'std' },
    });
    const { request, warnings } = compile(makeCtx({ stage }));
    const kling = request as KlingCompiledRequest;
    expect(kling.soundEnabled).toBeUndefined();
    expect(warnings.some((w) => w.message.includes('native audio'))).toBe(true);
  });
});

// ─── Seedream (ModelArk image line) ─────────────────────────────────
//
// Each of these encodes a vendor behaviour discovered by calling the real
// API — the docs either omitted or contradicted all three.

describe('compile() — Seedream', () => {
  const seedreamStage = (model: string, config: Record<string, unknown> = {}) =>
    makeStage({
      provider: 'seedance',
      model,
      prompt: 'A ripe banana on white',
      config: { aspectRatio: '16:9', ...config },
    });

  it('omits output_format on 4.x, which rejects the field outright', () => {
    const { request } = compile(makeCtx({ stage: seedreamStage('seedream-4-0-250828') }));
    expect(request).not.toHaveProperty('outputFormat');
  });

  it('sends output_format on 5.x, which accepts it', () => {
    const { request } = compile(makeCtx({ stage: seedreamStage('seedream-5-0-260128') }));
    expect(request).toHaveProperty('outputFormat');
  });

  it('clamps a sub-minimum resolution keyword rather than letting the API 400', () => {
    // 5.0-lite rejects anything under ~3.69 MP, so 1K is not merely
    // suboptimal — it is an error. 'adaptive' keeps us on the keyword
    // path, where the clamp is the only protection.
    const { request, warnings } = compile(
      makeCtx({
        stage: seedreamStage('seedream-5-0-260128', {
          imageSize: '1K',
          aspectRatio: 'adaptive',
        }),
      }),
    );
    expect((request as { size?: string }).size).toBe('2K');
    expect(warnings.some((w) => w.code === 'config_clamped')).toBe(true);
  });

  it('pins the chosen aspect ratio as exact pixels, not as prose', () => {
    // `size` is the only lever that actually controls shape — there is no
    // `aspect_ratio` field, and a ratio described in the prompt is a
    // suggestion the model routinely ignores.
    const { request } = compile(makeCtx({ stage: seedreamStage('seedream-4-0-250828') }));
    const size = (request as { size?: string }).size!;
    const [w, h] = size.split('x').map(Number) as [number, number];
    expect(w / h).toBeCloseTo(16 / 9, 2);
    // Inside 4.0's documented pixel window.
    expect(w * h).toBeGreaterThanOrEqual(921_600);
    expect(w * h).toBeLessThanOrEqual(16_777_216);
  });

  it('respects each model\u2019s own pixel floor when solving a ratio', () => {
    // The same 16:9 request must land above ~3.69 MP on 5.0-lite, where a
    // perfectly reasonable-looking 1024x1024 is a hard error.
    const { request } = compile(makeCtx({ stage: seedreamStage('seedream-5-0-260128') }));
    const [w, h] = (request as { size?: string }).size!.split('x').map(Number) as [number, number];
    expect(w / h).toBeCloseTo(16 / 9, 2);
    expect(w * h).toBeGreaterThanOrEqual(3_686_400);
  });

  it('always disables sequential generation so the output count is predictable', () => {
    const { request, warnings } = compile(
      makeCtx({ stage: seedreamStage('seedream-4-0-250828', { numberOfOutputs: 3 }) }),
    );
    expect((request as { sequentialImageGeneration?: string }).sequentialImageGeneration).toBe(
      'disabled',
    );
    // Credits are debited up-front, so silently returning fewer images
    // than requested would be a billing defect — warn instead.
    expect(warnings.some((w) => w.code === 'config_clamped')).toBe(true);
  });

  it('does not also fold the ratio into the prompt once pixels carry it', () => {
    // Belt-and-braces prose was the old mechanism; with exact dimensions
    // it is redundant text competing with the user's own prompt.
    const { request } = compile(makeCtx({ stage: seedreamStage('seedream-4-0-250828') }));
    expect((request as { prompt: string }).prompt).toBe('A ripe banana on white');
  });

  it('never sends watermark:true — the API default stamps the output', () => {
    const { request } = compile(makeCtx({ stage: seedreamStage('seedream-4-0-250828') }));
    expect((request as { watermark: boolean }).watermark).toBe(false);
  });
});

// ─── OpenAI (GPT Image 2) ───────────────────────────────────────────

describe('compile() — OpenAI GPT Image 2', () => {
  const openaiStage = (config: Record<string, unknown> = {}) =>
    makeStage({ provider: 'openai', model: 'gpt-image-2', prompt: 'A yellow circle', config });

  it('pins the dated snapshot on the wire, not the floating alias', () => {
    const { request } = compile(makeCtx({ stage: openaiStage() }));
    expect(request.model).toBe('gpt-image-2-2026-04-21');
  });

  it('uses the generate variant with no references and edit with them', () => {
    const plain = compile(makeCtx({ stage: openaiStage() }));
    expect((plain.request as { variant: string }).variant).toBe('image-generate');

    const field = imageField('src', 'Source');
    const withRef = compile(
      makeCtx({
        stage: openaiStage(),
        templateInputs: [field],
        inputValues: {
          src: {
            kind: 'image',
            r2Key: 'user-uploads/u/src.png',
            bytes: new Uint8Array([1, 2, 3]),
            mimeType: 'image/png',
          },
        },
      }),
    );
    expect((withRef.request as { variant: string }).variant).toBe('image-edit');
  });

  it('accepts a valid WxH and rejects one that breaks the pixel constraints', () => {
    const ok = compile(makeCtx({ stage: openaiStage({ imageSize: '1536x1024' }) }));
    expect((ok.request as { size: string }).size).toBe('1536x1024');

    // 100x100: below minPixels and not divisible by 16.
    const bad = compile(makeCtx({ stage: openaiStage({ imageSize: '100x100' }) }));
    expect((bad.request as { size: string }).size).toBe('1024x1024');
    expect(bad.warnings.some((w) => w.code === 'config_clamped')).toBe(true);
  });

  it('maps an aspect ratio onto the closest pixel preset', () => {
    // Templates authored against ratio-based models still need to work.
    const { request } = compile(makeCtx({ stage: openaiStage({ aspectRatio: '3:2' }) }));
    expect((request as { size: string }).size).toBe('1536x1024');
  });

  it('falls back to the default quality when an unsupported tier is asked for', () => {
    const { request, warnings } = compile(makeCtx({ stage: openaiStage({ quality: 'ultra' }) }));
    expect((request as { quality: string }).quality).toBe('medium');
    expect(warnings.some((w) => w.code === 'config_clamped')).toBe(true);
  });
});

// ─── Priced tiers → provider parameters ─────────────────────────────
//
// The tier the user is BILLED for must be the tier they are SERVED.
// Each provider spends it on a different parameter, so these guard the
// translation: a mistake here charges for 4K and delivers 1K.

describe('compile() — priced tier translation', () => {
  it('Gemini: the tier becomes imageSize', () => {
    const stage = makeStage({ model: 'gemini-3-pro-image', prompt: 'x', config: { mode: '4K' } });
    const { request } = compile(makeCtx({ stage }));
    expect((request as { imageConfig?: { imageSize?: string } }).imageConfig?.imageSize).toBe('4K');
  });

  it('Gemini: a billed tier overrides a stage-authored imageSize', () => {
    // The user paid for 4K; a template default must not downgrade them.
    const stage = makeStage({
      model: 'gemini-3-pro-image',
      prompt: 'x',
      config: { mode: '4K', imageSize: '1K' },
    });
    const { request } = compile(makeCtx({ stage }));
    expect((request as { imageConfig?: { imageSize?: string } }).imageConfig?.imageSize).toBe('4K');
  });

  it('Gemini: an unknown tier is ignored rather than sent upstream', () => {
    const stage = makeStage({ model: 'gemini-3-pro-image', prompt: 'x', config: { mode: '8K' } });
    const { request } = compile(makeCtx({ stage }));
    expect((request as { imageConfig?: { imageSize?: string } }).imageConfig?.imageSize).toBeUndefined();
  });

  it('OpenAI: the tier becomes quality', () => {
    const stage = makeStage({
      provider: 'openai',
      model: 'gpt-image-2',
      prompt: 'x',
      config: { mode: 'high' },
    });
    const { request } = compile(makeCtx({ stage }));
    expect((request as { quality: string }).quality).toBe('high');
  });

  it('Nano Banana 2 Lite has no tiers — it is 1K only, so nothing to price', () => {
    expect(getCapabilities('gemini-3.1-flash-lite-image').modes).toBeUndefined();
  });
});
