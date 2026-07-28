/**
 * Tests for `buildCreateStage()` — the synthetic-stage builder for the
 * user "create from scratch" flow.
 *
 * Strategy: build a stage for each roster model, then feed it through the
 * real `compile()` with hydrated `inputValues` and assert the resulting
 * `CompiledRequest` shape. This proves the synthetic stage is compatible
 * with the same engine templates use — no mocking.
 */

import { describe, expect, it } from 'vitest';

import type { RuntimeInputValue } from './compile-types';
import type {
  GeminiCompiledRequest,
  KlingCompiledRequest,
  SeedanceCompiledRequest,
} from './compile-types';
import { getCapabilities } from './capabilities';
import { compile } from './compile';
import {
  buildCreateStage,
  CREATE_END_FRAME_KEY,
  CREATE_START_FRAME_KEY,
  createReferenceKey,
} from './create-stage';

function img(key: string): RuntimeInputValue {
  return { kind: 'image', r2Key: key, mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) };
}

function run(
  built: ReturnType<typeof buildCreateStage>,
  inputValues: Record<string, RuntimeInputValue>,
) {
  return compile({
    stage: built.stage,
    templateInputs: built.templateInputs,
    inputValues,
    previousOutputs: [],
    capabilities: getCapabilities(built.stage.model),
  });
}

describe('buildCreateStage — Gemini (image)', () => {
  it('text-only prompt compiles to a generateContent request with aspect + 1 output', () => {
    const built = buildCreateStage({
      modelKey: 'gemini-3-pro-image-preview',
      prompt: 'a serene mountain lake at golden hour',
      aspectRatio: '16:9',
    });
    expect(built.provider).toBe('gemini');
    expect(built.stage.references).toEqual([]);
    expect(built.templateInputs).toHaveLength(0);
    expect(built.stage.config.numberOfOutputs).toBe(1);

    const { request } = run(built, {});
    const g = request as GeminiCompiledRequest;
    expect(g.provider).toBe('gemini');
    expect(g.prompt).toContain('serene mountain lake');
    expect(g.imageConfig?.aspectRatio).toBe('16:9');
    expect(g.imageParts).toHaveLength(0);
  });

  it('reference images become subject image parts in order', () => {
    const built = buildCreateStage({
      modelKey: 'gemini-3.1-flash-image-preview',
      prompt: 'blend these into a poster',
      aspectRatio: '1:1',
      referenceCount: 2,
    });
    expect(built.templateInputs.map((f) => f.fieldKey)).toEqual([
      createReferenceKey(0),
      createReferenceKey(1),
    ]);

    const { request } = run(built, {
      [createReferenceKey(0)]: img('a'),
      [createReferenceKey(1)]: img('b'),
    });
    const g = request as GeminiCompiledRequest;
    expect(g.imageParts).toHaveLength(2);
    expect(g.imageParts.every((p) => p.role === 'subject')).toBe(true);
  });
});

describe('buildCreateStage — Kling', () => {
  it('Omni: start + end frames map to startImage / endImage', () => {
    const built = buildCreateStage({
      modelKey: 'kling-v3-omni',
      prompt: 'pan across the scene',
      aspectRatio: '16:9',
      duration: 10,
      hasStartFrame: true,
      hasEndFrame: true,
    });
    expect(built.templateInputs.map((f) => f.fieldKey)).toEqual([
      CREATE_START_FRAME_KEY,
      CREATE_END_FRAME_KEY,
    ]);
    expect(built.stage.config.duration).toBe(10);

    const { request } = run(built, {
      [CREATE_START_FRAME_KEY]: img('start'),
      [CREATE_END_FRAME_KEY]: img('end'),
    });
    const k = request as KlingCompiledRequest;
    expect(k.provider).toBe('kling');
    expect(k.variant).toBe('omni');
    expect(k.startImage?.r2Key).toBe('start');
    expect(k.endImage?.r2Key).toBe('end');
    expect(k.aspectRatio).toBe('16:9');
    expect(k.duration).toBe(10);
  });

  it('Omni: text-only produces no frames', () => {
    const built = buildCreateStage({
      modelKey: 'kling-v3-omni',
      prompt: 'a neon city at night',
      aspectRatio: '9:16',
    });
    const { request } = run(built, {});
    const k = request as KlingCompiledRequest;
    expect(k.startImage).toBeUndefined();
    expect(k.endImage).toBeUndefined();
  });

  it('v2.6: required start frame maps to startImage (image2video)', () => {
    const built = buildCreateStage({
      modelKey: 'kling-v2-6',
      prompt: 'make it move',
      aspectRatio: '9:16',
      hasStartFrame: true,
    });
    const { request } = run(built, { [CREATE_START_FRAME_KEY]: img('start') });
    const k = request as KlingCompiledRequest;
    expect(k.variant).toBe('image2video');
    expect(k.startImage?.r2Key).toBe('start');
  });
});

describe('buildCreateStage — Seedance (video)', () => {
  it('frames mode: binds first/last frame slots', () => {
    const built = buildCreateStage({
      modelKey: 'dreamina-seedance-2-0-260128',
      prompt: 'slow dolly in',
      aspectRatio: '16:9',
      duration: 5,
      hasStartFrame: true,
      hasEndFrame: true,
    });
    expect(built.stage.config.seedanceMode).toBe('first_last_frame');

    const { request } = run(built, {
      [CREATE_START_FRAME_KEY]: img('first'),
      [CREATE_END_FRAME_KEY]: img('last'),
    });
    const s = request as SeedanceCompiledRequest;
    expect(s.provider).toBe('seedance');
    expect(s.startImage?.r2Key).toBe('first');
    expect(s.endImage?.r2Key).toBe('last');
  });

  it('reference mode: binds N reference slots', () => {
    const built = buildCreateStage({
      modelKey: 'dreamina-seedance-2-0-260128',
      prompt: 'combine these looks',
      aspectRatio: '9:16',
      referenceCount: 2,
    });
    expect(built.stage.config.seedanceMode).toBe('reference');

    const { request } = run(built, {
      [createReferenceKey(0)]: img('r0'),
      [createReferenceKey(1)]: img('r1'),
    });
    const s = request as SeedanceCompiledRequest;
    expect((s.referenceImages ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('text-only: empty frame slots, no images', () => {
    const built = buildCreateStage({
      modelKey: 'dreamina-seedance-2-0-260128',
      prompt: 'a jellyfish drifting',
      aspectRatio: '1:1',
    });
    const { request } = run(built, {});
    const s = request as SeedanceCompiledRequest;
    expect(s.startImage).toBeUndefined();
    expect(s.endImage).toBeUndefined();
  });
});
