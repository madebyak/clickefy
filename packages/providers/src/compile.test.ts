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

import { getCapabilities } from './capabilities';
import { compile } from './compile';
import type {
  CompileContext,
  GeminiCompiledRequest,
  KlingCompiledRequest,
  RuntimeInputValue,
  StageOutputRef,
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

// ─── Kling Omni: angle bracket addressing ───────────────────────────

describe('compile() — Kling 3 Omni', () => {
  it('produces <<<image_N>>> in the prompt and a referenceImages list', () => {
    const product = imageField('product', 'Product');
    const stage = makeStage({
      provider: 'kling',
      model: 'kling-v3-omni',
      prompt:
        'Animate <<<image_1>>> walking through a forest matching the mood of {{ref:mood}}.',
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
    expect(kling.prompt).toContain('<<<image_2>>>');
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
    expect(kling.prompt).toContain('<<<image_1>>>');
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
