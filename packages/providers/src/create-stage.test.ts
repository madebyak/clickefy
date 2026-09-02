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

  // Regression guard for the family-wide bug: `maxSubjects: 1` capped the
  // subject list at one, so `endImage` (read as `subjects[1]`) was always
  // undefined and no Kling model could ever send a last frame — even
  // though every endpoint except 3.0 Turbo documents one.
  it.each([
    ['kling-v3', 'pro'],
    ['kling-v2-6', 'pro'],
    ['kling-v2-5-turbo', 'pro'],
  ])('%s: end frame reaches endImage', (modelKey, mode) => {
    const built = buildCreateStage({
      modelKey,
      prompt: 'morph between the frames',
      aspectRatio: '16:9',
      hasStartFrame: true,
      hasEndFrame: true,
      mode,
    });
    const { request } = run(built, {
      [CREATE_START_FRAME_KEY]: img('start'),
      [CREATE_END_FRAME_KEY]: img('end'),
    });
    const k = request as KlingCompiledRequest;
    expect(k.startImage?.r2Key).toBe('start');
    expect(k.endImage?.r2Key).toBe('end');
  });

  it('2.6: end frame is dropped below the 1080p tier it requires', () => {
    const built = buildCreateStage({
      modelKey: 'kling-v2-6',
      prompt: 'morph between the frames',
      aspectRatio: '16:9',
      hasStartFrame: true,
      hasEndFrame: true,
      mode: 'std',
    });
    const { request, warnings } = run(built, {
      [CREATE_START_FRAME_KEY]: img('start'),
      [CREATE_END_FRAME_KEY]: img('end'),
    });
    const k = request as KlingCompiledRequest;
    expect(k.startImage?.r2Key).toBe('start');
    // Dropped rather than silently upgrading the billed tier.
    expect(k.endImage).toBeUndefined();
    expect(warnings.some((w) => /first\+last frame pair/.test(w.message))).toBe(true);
  });

  it('3.0 Turbo: documents no last_frame, so none is sent', () => {
    const built = buildCreateStage({
      modelKey: 'kling-v3-turbo',
      prompt: 'push in slowly',
      aspectRatio: '16:9',
      hasStartFrame: true,
      hasEndFrame: true,
    });
    const { request } = run(built, {
      [CREATE_START_FRAME_KEY]: img('start'),
      [CREATE_END_FRAME_KEY]: img('end'),
    });
    const k = request as KlingCompiledRequest;
    expect(k.startImage?.r2Key).toBe('start');
    expect(k.endImage).toBeUndefined();
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

  it('mixed reference kinds route each clip by its own assetKind', () => {
    const built = buildCreateStage({
      modelKey: 'dreamina-seedance-2-5-260628',
      prompt: 'a launch film in the style of these',
      referenceCount: 3,
      referenceKinds: ['image', 'video', 'audio'],
    });
    const slots = (built.stage.config as { referenceSlots?: Array<{ assetKind: string }> })
      .referenceSlots;
    expect(slots?.map((sl) => sl.assetKind)).toEqual(['image', 'video', 'audio']);

    const { request, warnings } = run(built, {
      [createReferenceKey(0)]: img('r0'),
      [createReferenceKey(1)]: {
        kind: 'video',
        r2Key: 'clip',
        mimeType: 'video/mp4',
        bytes: new Uint8Array([4]),
      },
      [createReferenceKey(2)]: {
        kind: 'audio',
        r2Key: 'voice',
        mimeType: 'audio/mpeg',
        bytes: new Uint8Array([5]),
      },
    });
    const s = request as SeedanceCompiledRequest;
    const mimes = (s.referenceImages ?? []).map((p) => p.mimeType);
    expect(mimes).toContain('video/mp4');
    expect(mimes).toContain('audio/mpeg');
    // Nothing was clamped or dropped — the budgets allow this mix.
    expect(warnings.filter((w) => w.code === 'config_clamped')).toHaveLength(0);
  });

  it('honours per-model clip budgets from the registry (2.5 takes >3 videos)', () => {
    // The compiler used to hardcode 3 videos/3 audio for every model,
    // which silently under-served Seedance 2.5's documented 10/10.
    const built = buildCreateStage({
      modelKey: 'dreamina-seedance-2-5-260628',
      prompt: 'stitch these takes',
      referenceCount: 5,
      referenceKinds: ['video', 'video', 'video', 'video', 'video'],
    });
    const inputs = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [
        createReferenceKey(i),
        {
          kind: 'video' as const,
          r2Key: `clip-${i}`,
          mimeType: 'video/mp4',
          bytes: new Uint8Array([1]),
        },
      ]),
    );
    const { request, warnings } = run(built, inputs);
    const s = request as SeedanceCompiledRequest;
    expect((s.referenceImages ?? []).length).toBe(5);
    expect(warnings.filter((w) => w.code === 'config_clamped')).toHaveLength(0);
  });

  it('still clamps the 2.0 family at its own 3-video budget', () => {
    const built = buildCreateStage({
      modelKey: 'dreamina-seedance-2-0-260128',
      prompt: 'stitch these takes',
      referenceCount: 4,
      referenceKinds: ['video', 'video', 'video', 'video'],
    });
    const inputs = Object.fromEntries(
      Array.from({ length: 4 }, (_, i) => [
        createReferenceKey(i),
        {
          kind: 'video' as const,
          r2Key: `clip-${i}`,
          mimeType: 'video/mp4',
          bytes: new Uint8Array([1]),
        },
      ]),
    );
    const { request, warnings } = run(built, inputs);
    const s = request as SeedanceCompiledRequest;
    expect((s.referenceImages ?? []).length).toBe(3);
    expect(warnings.some((w) => w.code === 'config_clamped')).toBe(true);
  });

  it('edit task pins the documented constraints onto the wire', () => {
    const built = buildCreateStage({
      modelKey: 'dreamina-seedance-2-5-260628',
      prompt: 'Video edit: remove everyone except the protagonist.',
      // A client-sent ratio/duration must not survive an edit request.
      aspectRatio: '16:9',
      duration: 10,
      referenceCount: 1,
      referenceKinds: ['video'],
      task: 'edit',
    });
    expect(built.stage.config.omniReferenceTaskType).toBe('edit');
    expect(built.stage.config.aspectRatio).toBe('adaptive');
    expect(built.stage.config.duration).toBe(-1);

    const { request } = run(built, {
      [createReferenceKey(0)]: {
        kind: 'video',
        r2Key: 'source',
        mimeType: 'video/mp4',
        bytes: new Uint8Array([1]),
      },
    });
    const s = request as SeedanceCompiledRequest;
    expect(s.omniReferenceTaskType).toBe('edit');
    expect(s.ratio).toBe('adaptive');
    expect(s.duration).toBe(-1);
  });

  it('extend task keeps the chosen output duration', () => {
    const built = buildCreateStage({
      modelKey: 'dreamina-seedance-2-5-260628',
      prompt: 'Extend @Video1: keep moving through the gallery.',
      duration: 12,
      referenceCount: 2,
      referenceKinds: ['video', 'video'],
      task: 'extend',
    });
    expect(built.stage.config.omniReferenceTaskType).toBe('extend');
    expect(built.stage.config.aspectRatio).toBe('adaptive');
    expect(built.stage.config.duration).toBe(12);
  });

  it('ignores a task on models without supportsOmniTaskType', () => {
    // The 2.0 family auto-detects tasks from the prompt; declaring the
    // param there would be an invalid field on the wire.
    const built = buildCreateStage({
      modelKey: 'dreamina-seedance-2-0-260128',
      prompt: 'Video edit: swap the cat for a lion.',
      referenceCount: 1,
      referenceKinds: ['video'],
      task: 'edit',
    });
    expect(built.stage.config.omniReferenceTaskType).toBeUndefined();
  });

  it('defaults missing kinds to image, byte-identical to the old shape', () => {
    const built = buildCreateStage({
      modelKey: 'dreamina-seedance-2-0-260128',
      prompt: 'combine these looks',
      referenceCount: 2,
    });
    const slots = (built.stage.config as { referenceSlots?: Array<{ assetKind: string }> })
      .referenceSlots;
    expect(slots?.map((sl) => sl.assetKind)).toEqual(['image', 'image']);
  });
});

describe('buildCreateStage — studio tools (hidden prompts)', () => {
  it('camera angle: composes the whole prompt from the two degrees', () => {
    const built = buildCreateStage({
      modelKey: 'gpt-image-2',
      prompt: '', // the user typed nothing — the prompt is entirely ours
      aspectRatio: '3:4',
      referenceCount: 1,
      tool: { kind: 'camera_angle', h: 120, v: -35 },
    });
    expect(built.stage.prompt).toContain('side profile view from the right');
    expect(built.stage.prompt).toContain('120°');
    expect(built.stage.prompt).toContain('at a low angle');
    expect(built.stage.prompt).toContain('frozen in time');
    expect(built.stage.prompt).toContain('Do not change');
  });

  it('camera angle: extreme elevation reads as an overhead shot', () => {
    const built = buildCreateStage({
      modelKey: 'gpt-image-2',
      prompt: '',
      aspectRatio: '1:1',
      referenceCount: 1,
      tool: { kind: 'camera_angle', h: 0, v: 70 },
    });
    expect(built.stage.prompt).toContain("bird's-eye view");
    expect(built.stage.prompt).toContain('original front-facing position');
  });

  it('storyboard: embeds the script inside the engineered sheet prompt', () => {
    const script = 'A chef races through rain to open her restaurant.';
    const built = buildCreateStage({
      modelKey: 'gpt-image-2',
      prompt: script,
      tool: { kind: 'storyboard', style: 'hand_drawn', cols: 3, rows: 3 },
    });
    expect(built.stage.prompt).toContain('exactly 9 key shots');
    expect(built.stage.prompt).toContain('3x3 grid');
    expect(built.stage.prompt).toContain('hand-drawn');
    expect(built.stage.prompt).toContain(script);
    expect(built.stage.prompt).toContain('clean frames only');
  });

  it('no tool: the user prompt passes through untouched', () => {
    const built = buildCreateStage({
      modelKey: 'gpt-image-2',
      prompt: 'a red bicycle',
    });
    expect(built.stage.prompt).toBe('a red bicycle');
  });
});

// ─── The billed tier must reach the provider ────────────────────────
//
// Regression guard for a live money bug: `mode` (and the sound toggle)
// were written only in the Gemini/Kling branch, so a Seedance job was
// charged at the tier the user picked and then submitted with no
// `resolution` at all. BytePlus fell back to its own default, and every
// cheap-tier sale ran at a loss while every premium sale was
// under-served. These tests assert the value survives the whole
// buildCreateStage → compile path, per provider.

describe('buildCreateStage — the billed quality tier reaches the request', () => {
  it('Seedance: the picked resolution tier is sent, not silently defaulted', () => {
    const built = buildCreateStage({
      modelKey: 'dreamina-seedance-2-5-260628',
      prompt: 'a paper boat drifting down a rain gutter',
      aspectRatio: '16:9',
      duration: 5,
      mode: '480p',
    });
    expect(built.stage.config.mode).toBe('480p');

    const { request } = run(built, {});
    expect((request as SeedanceCompiledRequest).resolution).toBe('480p');
  });

  it('Seedance: 1080p is a reachable tier on 2.5', () => {
    const built = buildCreateStage({
      modelKey: 'dreamina-seedance-2-5-260628',
      prompt: 'macro shot of dew on a spiderweb',
      mode: '1080p',
    });
    const { request, warnings } = run(built, {});
    expect((request as SeedanceCompiledRequest).resolution).toBe('1080p');
    expect(warnings.filter((w) => w.code === 'config_clamped')).toEqual([]);
  });

  it('Kling: the tier still reaches the request (unchanged path)', () => {
    const built = buildCreateStage({
      modelKey: 'kling-v3-omni',
      prompt: 'a hummingbird hovering at a feeder',
      mode: 'pro',
    });
    expect(built.stage.config.mode).toBe('pro');
    const { request } = run(built, {});
    expect((request as KlingCompiledRequest).mode).toBe('pro');
  });
});

describe('buildCreateStage — Seedance native audio', () => {
  it('sound: on reaches the request as generateAudio', () => {
    const built = buildCreateStage({
      modelKey: 'dreamina-seedance-2-5-260628',
      prompt: 'waves breaking on shingle',
      sound: true,
    });
    const { request } = run(built, {});
    expect((request as SeedanceCompiledRequest).generateAudio).toBe(true);
  });

  it('sound: off is sent EXPLICITLY — the ModelArk default is true and audio is billed', () => {
    const built = buildCreateStage({
      modelKey: 'dreamina-seedance-2-5-260628',
      prompt: 'waves breaking on shingle',
      sound: false,
    });
    const { request } = run(built, {});
    expect((request as SeedanceCompiledRequest).generateAudio).toBe(false);
  });
});

describe('buildCreateStage — Seedance 2.5 frame/ratio constraint', () => {
  it('a start frame forces ratio=adaptive, because 2.5 preserves the frame shape', () => {
    const built = buildCreateStage({
      modelKey: 'dreamina-seedance-2-5-260628',
      prompt: 'push in slowly',
      aspectRatio: '16:9',
      hasStartFrame: true,
    });
    const { request, warnings } = run(built, {
      [CREATE_START_FRAME_KEY]: img('uploads/start.png'),
    });
    const sd = request as SeedanceCompiledRequest;
    expect(sd.startImage).toBeDefined();
    expect(sd.ratio).toBe('adaptive');
    expect(warnings.some((w) => w.code === 'config_clamped')).toBe(true);
  });

  it('without a frame the chosen ratio is honoured as-is', () => {
    const built = buildCreateStage({
      modelKey: 'dreamina-seedance-2-5-260628',
      prompt: 'push in slowly',
      aspectRatio: '16:9',
    });
    const { request } = run(built, {});
    expect((request as SeedanceCompiledRequest).ratio).toBe('16:9');
  });
});

describe('buildCreateStage — Seedream is an image model on the seedance tag', () => {
  it('gets image config, not a video stage', () => {
    const built = buildCreateStage({
      modelKey: 'seedream-4-0-250828',
      prompt: 'a ripe banana on white',
      aspectRatio: '16:9',
      duration: 5,
    });
    expect(built.stage.config.numberOfOutputs).toBe(1);
    // None of the video-shaped keys belong on an image stage.
    expect(built.stage.config.duration).toBeUndefined();
    expect(built.stage.config.seedanceMode).toBeUndefined();
    expect(built.stage.config.frameSlots).toBeUndefined();
  });

  it('the chosen ratio becomes exact pixels', () => {
    const built = buildCreateStage({
      modelKey: 'seedream-4-0-250828',
      prompt: 'a ripe banana on white',
      aspectRatio: '9:16',
    });
    const { request } = run(built, {});
    const [w, h] = (request as { size?: string }).size!.split('x').map(Number) as [number, number];
    expect(w / h).toBeCloseTo(9 / 16, 2);
  });
});
