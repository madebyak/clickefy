/**
 * The generic fal compiler, against specs shaped like the models the
 * client approved on 2026-10-05. Field names and enum spellings come
 * from each endpoint's fal page / OpenAPI, so a passing test here means
 * the body is what fal accepts — the smoke test in admin is the second
 * check, against the real queue.
 */

import { describe, expect, it } from 'vitest';

import type { GenerationStage } from '@clickfy/types';

import { registerDynamicCapabilities, type ModelCapabilities } from './capabilities';
import { compile } from './compile';
import type { CompileContext } from './compile-types';
import { buildCreateStage } from './create-stage';
import { buildFalInput, isFalSpec, pickFalEndpoint, type FalSpec } from './fal-spec';
import { ownerPathFromStatusUrl } from './adapters/fal';

const WAN3_SPEC: FalSpec = {
  endpoints: {
    text: 'alibaba/wan-3.0/text-to-video',
    image: 'alibaba/wan-3.0/image-to-video',
    reference: 'alibaba/wan-3.0/reference-to-video',
  },
  input: {
    prompt: 'prompt',
    negativePrompt: 'negative_prompt',
    aspectRatio: { field: 'aspect_ratio' },
    mode: { field: 'resolution' },
    duration: { field: 'duration', as: 'number' },
    imageUrl: 'image_url',
    endImageUrl: 'end_image_url',
    referenceImages: { field: 'image_urls', max: 10 },
    seed: 'seed',
    extra: { audio: true },
  },
};

const WAN3: ModelCapabilities = {
  provider: 'fal',
  modelKey: 'wan-3-0',
  displayName: 'Wan 3.0',
  status: 'active',
  kind: 'video',
  sizing: { mode: 'aspect', values: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
  outputs: { min: 1, max: 1, default: 1 },
  duration: { values: [5, 10, 15], default: 5 },
  modes: { values: ['480p', '720p', '1080p'], default: '720p' },
  refAddressing: 'ordinal',
  maxReferences: 10,
  maxSubjects: 10,
  maxImagesTotal: 10,
  acceptsStartEndImage: true,
  fal: WAN3_SPEC,
};

const FLUX3_SPEC: FalSpec = {
  endpoints: {
    text: 'blackforestlabs/flux-3/text-to-image',
    reference: 'blackforestlabs/flux-3/edit-image',
  },
  input: {
    aspectRatio: { field: 'aspect_ratio' },
    mode: { field: 'resolution' },
    referenceImages: { field: 'image_urls', max: 10 },
    extra: { output_format: 'jpeg' },
  },
};

const FLUX3: ModelCapabilities = {
  provider: 'fal',
  modelKey: 'flux-3-image',
  displayName: 'FLUX 3',
  status: 'active',
  kind: 'image',
  sizing: { mode: 'aspect', values: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'] },
  outputs: { min: 1, max: 1, default: 1 },
  modes: { values: ['1k', '2k', '4k'], default: '1k' },
  refAddressing: 'ordinal',
  maxReferences: 10,
  maxSubjects: 10,
  maxImagesTotal: 10,
  fal: FLUX3_SPEC,
};

const WAN25_SPEC: FalSpec = {
  endpoints: { text: 'fal-ai/wan-25-preview/text-to-video' },
  input: { duration: { field: 'duration', as: 'string' }, mode: { field: 'resolution' } },
};

const WAN22_SPEC: FalSpec = {
  endpoints: { image: 'fal-ai/wan/v2.2-a14b/image-to-video' },
  input: { duration: { field: 'num_frames', as: 'frames', fps: 16, plusOne: true }, imageUrl: 'image_url' },
};

function stage(model: string, config: Record<string, unknown>, prompt = 'a marble on a track'): GenerationStage {
  return { id: 'create', order: 0, provider: 'fal', model, prompt, references: [], config, retry: { enabled: false, maxAttempts: 1 } };
}

function ctx(caps: ModelCapabilities, s: GenerationStage, inputs: Record<string, { url: string }> = {}): CompileContext {
  return {
    stage: s,
    templateInputs: Object.keys(inputs).map((fieldKey, i) => ({
      id: fieldKey, fieldKey, label: fieldKey, required: false, order: i, type: 'image' as const,
    })),
    inputValues: Object.fromEntries(
      Object.entries(inputs).map(([k, v]) => [k, { kind: 'image' as const, r2Key: `k/${k}`, mimeType: 'image/png', url: v.url }]),
    ),
    previousOutputs: [],
    capabilities: caps,
  };
}

describe('pickFalEndpoint', () => {
  it('routes by what is attached', () => {
    expect(pickFalEndpoint(WAN3_SPEC, { referenceImageUrls: [] })?.task).toBe('text');
    expect(pickFalEndpoint(WAN3_SPEC, { startImageUrl: 'u', referenceImageUrls: [] })?.task).toBe('image');
    expect(pickFalEndpoint(WAN3_SPEC, { referenceImageUrls: ['a'] })?.task).toBe('reference');
  });
  it('promotes the first reference on an image-only model', () => {
    const r = pickFalEndpoint(WAN22_SPEC, { referenceImageUrls: ['a', 'b'] });
    expect(r).toEqual({ task: 'image', endpoint: 'fal-ai/wan/v2.2-a14b/image-to-video', promoteFirstReference: true });
  });
  it('refuses a prompt-only request on an image-only model', () => {
    expect(pickFalEndpoint(WAN22_SPEC, { referenceImageUrls: [] })).toBeUndefined();
  });
});

describe('buildFalInput', () => {
  it('spells durations three ways', () => {
    expect(buildFalInput(WAN3_SPEC, 'text', { prompt: 'p', referenceImageUrls: [], durationSeconds: 10 })).toMatchObject({ duration: 10 });
    expect(buildFalInput(WAN25_SPEC, 'text', { prompt: 'p', referenceImageUrls: [], durationSeconds: 5 })).toMatchObject({ duration: '5' });
    expect(buildFalInput(WAN22_SPEC, 'image', { prompt: 'p', referenceImageUrls: [], durationSeconds: 5, startImageUrl: 'u' })).toMatchObject({ num_frames: 81, image_url: 'u' });
  });
  it('writes only the fields the spec names', () => {
    const body = buildFalInput(FLUX3_SPEC, 'text', { prompt: 'p', referenceImageUrls: [], negativePrompt: 'ugly', durationSeconds: 5, aspectRatio: '1:1', mode: '2k' });
    expect(body).toEqual({ prompt: 'p', aspect_ratio: '1:1', resolution: '2k', output_format: 'jpeg' });
  });
  it('maps enum spellings when a map is given', () => {
    const spec: FalSpec = { endpoints: { text: 'x' }, input: { mode: { field: 'quality', values: { high: 'hd' } }, aspectRatio: { field: 'ratio', values: { '16:9': 'landscape' } } } };
    expect(buildFalInput(spec, 'text', { prompt: 'p', referenceImageUrls: [], mode: 'high', aspectRatio: '16:9' })).toEqual({ prompt: 'p', quality: 'hd', ratio: 'landscape' });
  });
  it('supports indexed reference fields', () => {
    const spec: FalSpec = { endpoints: { reference: 'x' }, input: { referenceImages: { field: 'image_url_', max: 3, style: 'indexed' } } };
    expect(buildFalInput(spec, 'reference', { prompt: 'p', referenceImageUrls: ['a', 'b', 'c', 'd'] })).toEqual({ prompt: 'p', image_url_1: 'a', image_url_2: 'b', image_url_3: 'c' });
  });
});

describe('compile() with a fal spec', () => {
  it('compiles a text-to-video request with clamped settings', () => {
    const r = compile(ctx(WAN3, stage('wan-3-0', { aspectRatio: '16:9', mode: '1080p', duration: 10 })));
    expect(r.request).toEqual({
      provider: 'fal',
      endpoint: 'alibaba/wan-3.0/text-to-video',
      input: { audio: true, prompt: 'a marble on a track', aspect_ratio: '16:9', resolution: '1080p', duration: 10 },
    });
    expect(r.warnings).toEqual([]);
  });
  it('clamps an unknown tier and duration, loudly', () => {
    const r = compile(ctx(WAN3, stage('wan-3-0', { mode: '4k', duration: 7 })));
    expect(r.request).toMatchObject({ input: { resolution: '720p', duration: 5 } });
    expect(r.warnings.map((w) => w.code)).toEqual(['config_clamped', 'config_clamped']);
  });
  it('binds a start frame to the image endpoint', () => {
    const s = stage('wan-3-0', { frameSlots: { firstFrame: { kind: 'user_input', fieldKey: 'start' } }, duration: 5 });
    const r = compile(ctx(WAN3, s, { start: { url: 'https://r2/start.png' } }));
    expect(r.request).toMatchObject({ endpoint: 'alibaba/wan-3.0/image-to-video', input: { image_url: 'https://r2/start.png', duration: 5 } });
  });
  it('binds references to the reference endpoint and drops a video reference', () => {
    const s = stage('wan-3-0', {
      referenceSlots: [
        { id: 'r0', assetKind: 'image', source: { kind: 'user_input', fieldKey: 'r0' } },
        { id: 'r1', assetKind: 'video', source: { kind: 'user_input', fieldKey: 'r1' } },
      ],
    });
    const r = compile(ctx(WAN3, s, { r0: { url: 'https://r2/a.png' }, r1: { url: 'https://r2/b.mp4' } }));
    expect(r.request).toMatchObject({ endpoint: 'alibaba/wan-3.0/reference-to-video', input: { image_urls: ['https://r2/a.png'] } });
    expect(r.warnings[0]?.code).toBe('reference_dropped');
  });
  it('an image model with references compiles to its edit endpoint', () => {
    const s = stage('flux-3-image', {
      aspectRatio: '1:1', mode: '1k', numberOfOutputs: 1,
      referenceSlots: [{ id: 'r0', assetKind: 'image', source: { kind: 'user_input', fieldKey: 'r0' } }],
    });
    const r = compile(ctx(FLUX3, s, { r0: { url: 'https://r2/a.png' } }));
    expect(r.request).toEqual({
      provider: 'fal',
      endpoint: 'blackforestlabs/flux-3/edit-image',
      input: { output_format: 'jpeg', prompt: 'a marble on a track', aspect_ratio: '1:1', resolution: '1k', image_urls: ['https://r2/a.png'] },
    });
  });
});

describe('buildCreateStage() for a dynamic fal model', () => {
  it('writes frame and reference slots the generic compiler reads', () => {
    registerDynamicCapabilities([WAN3]);
    const built = buildCreateStage({
      modelKey: 'wan-3-0', prompt: 'hello @Image1', aspectRatio: '9:16', mode: '720p', duration: 10,
      hasStartFrame: true, hasEndFrame: false, referenceCount: 0,
    });
    expect(built.provider).toBe('fal');
    expect(built.stage.config).toMatchObject({ aspectRatio: '9:16', mode: '720p', duration: 10, frameSlots: { firstFrame: { kind: 'user_input' } } });
    registerDynamicCapabilities([]);
  });
});

describe('fal helpers', () => {
  it('derives the owner path from a status url', () => {
    expect(ownerPathFromStatusUrl('https://queue.fal.run/alibaba/wan-3.0/requests/abc/status')).toBe('alibaba/wan-3.0');
    expect(ownerPathFromStatusUrl('https://queue.fal.run/fal-ai/bytedance-upscaler/requests/abc/status')).toBe('fal-ai/bytedance-upscaler');
    expect(ownerPathFromStatusUrl('not a url')).toBeUndefined();
  });
  it('recognises a spec', () => {
    expect(isFalSpec(WAN3_SPEC)).toBe(true);
    expect(isFalSpec({ endpoints: {}, input: {} })).toBe(false);
    expect(isFalSpec(null)).toBe(false);
  });
});
