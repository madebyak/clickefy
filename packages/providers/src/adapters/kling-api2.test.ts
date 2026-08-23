/**
 * Wire-format tests for the Kling API 2.0 adapter.
 *
 * These assert the exact JSON we put on the network, because the whole
 * point of this adapter is that the shape changed between API
 * generations — a regression here is invisible in a type-check and
 * shows up as a provider 4xx with the credits already spent.
 *
 * `fetch` is stubbed; nothing here touches the network.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { executeKlingApi2, pollKlingApi2 } from './kling-api2';
import type { KlingCompiledRequest } from '../compile-types';

const ENV = { apiKey: 'test-key' };

type Captured = { url: string; init: RequestInit; body: Record<string, unknown> };

/** Stub fetch and capture what the adapter sent. */
function stubFetch(response: unknown, status = 200): { calls: Captured[] } {
  const calls: Captured[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({
        url,
        init,
        body: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {},
      });
      return {
        ok: status < 400,
        status,
        statusText: 'OK',
        text: async () => JSON.stringify(response),
      } as unknown as Response;
    }),
  );
  return { calls };
}

afterEach(() => vi.unstubAllGlobals());

function req(overrides: Partial<KlingCompiledRequest> = {}): KlingCompiledRequest {
  return {
    provider: 'kling',
    variant: 'image2video',
    api2: true,
    model: 'kling-2.6',
    prompt: 'A slow push-in.',
    ...overrides,
  };
}

const OK_CREATE = { code: 0, message: 'SUCCEED', data: { id: 'task-1' } };

describe('executeKlingApi2 — request shape', () => {
  it('puts the model in the URL path, not the body', async () => {
    const { calls } = stubFetch(OK_CREATE);
    await executeKlingApi2(req(), ENV);
    expect(calls[0]!.url).toBe('https://api-singapore.klingai.com/image-to-video/kling-2.6');
    expect(calls[0]!.body).not.toHaveProperty('model_name');
    expect(calls[0]!.body).not.toHaveProperty('model');
  });

  it('routes each variant to its own endpoint family', async () => {
    for (const [variant, path] of [
      ['text2video', 'text-to-video'],
      ['image2video', 'image-to-video'],
      ['omni', 'omni-video'],
    ] as const) {
      const { calls } = stubFetch(OK_CREATE);
      await executeKlingApi2(req({ variant, model: 'kling-3.0-omni' }), ENV);
      expect(calls[0]!.url).toContain(`/${path}/kling-3.0-omni`);
      vi.unstubAllGlobals();
    }
  });

  it('sends a bare prompt for text-to-video and contents[] otherwise', async () => {
    const t2v = stubFetch(OK_CREATE);
    await executeKlingApi2(req({ variant: 'text2video' }), ENV);
    expect(t2v.calls[0]!.body.prompt).toBe('A slow push-in.');
    expect(t2v.calls[0]!.body).not.toHaveProperty('contents');
    vi.unstubAllGlobals();

    const i2v = stubFetch(OK_CREATE);
    await executeKlingApi2(req({ variant: 'image2video' }), ENV);
    expect(i2v.calls[0]!.body).not.toHaveProperty('prompt');
    expect(i2v.calls[0]!.body.contents).toEqual([
      { type: 'prompt', text: 'A slow push-in.' },
    ]);
  });

  it('translates the billed tier to a resolution', async () => {
    for (const [mode, resolution] of [
      ['std', '720p'],
      ['pro', '1080p'],
      ['4k', '4k'],
    ] as const) {
      const { calls } = stubFetch(OK_CREATE);
      await executeKlingApi2(req({ mode }), ENV);
      expect((calls[0]!.body.settings as Record<string, unknown>).resolution).toBe(resolution);
      vi.unstubAllGlobals();
    }
  });

  it('always sends an explicit audio setting so the server default cannot apply', async () => {
    const off = stubFetch(OK_CREATE);
    await executeKlingApi2(req(), ENV);
    expect((off.calls[0]!.body.settings as Record<string, unknown>).audio).toBe('off');
    vi.unstubAllGlobals();

    const on = stubFetch(OK_CREATE);
    await executeKlingApi2(req({ soundEnabled: true }), ENV);
    expect((on.calls[0]!.body.settings as Record<string, unknown>).audio).toBe('native');
  });

  it("uses O1's `original` audio value when the model asks for it", async () => {
    // O1's enum is `original | off`; it rejects `native`. The compiler
    // copies the right value onto the request from the capability.
    const { calls } = stubFetch(OK_CREATE);
    await executeKlingApi2(req({ soundEnabled: true, soundOnValue: 'original' }), ENV);
    expect((calls[0]!.body.settings as Record<string, unknown>).audio).toBe('original');
  });

  it('always pins multi_shot off', async () => {
    // Upstream defaults it to TRUE on the 3.0 family, so a prompt that
    // merely contains semicolons can come back as several cuts.
    const { calls } = stubFetch(OK_CREATE);
    await executeKlingApi2(req({}), ENV);
    expect((calls[0]!.body.settings as Record<string, unknown>).multi_shot).toBe(false);
  });

  it('maps frames and references onto typed content parts', async () => {
    const { calls } = stubFetch(OK_CREATE);
    await executeKlingApi2(
      req({
        variant: 'omni',
        startImage: {
          index: 1, role: 'subject', roleTag: 'USER_INPUT', displayLabel: '',
          mimeType: 'image/png', url: 'https://cdn/a.png',
        },
        endImage: {
          index: 2, role: 'subject', roleTag: 'USER_INPUT', displayLabel: '',
          mimeType: 'image/png', url: 'https://cdn/b.png',
        },
        referenceImages: [
          {
            index: 3, role: 'reference', roleTag: 'STYLE', displayLabel: '',
            mimeType: 'image/png', url: 'https://cdn/c.png',
          },
        ],
      }),
      ENV,
    );
    expect(calls[0]!.body.contents).toEqual([
      { type: 'prompt', text: 'A slow push-in.' },
      { type: 'first_frame', url: 'https://cdn/a.png' },
      { type: 'last_frame', url: 'https://cdn/b.png' },
      // `id` is what an `@image_3` token in the prompt binds to.
      { type: 'refer_image', url: 'https://cdn/c.png', id: 'image_3' },
    ]);
  });

  it('omits aspect_ratio when a first frame already implies the frame size', async () => {
    const withFrame = stubFetch(OK_CREATE);
    await executeKlingApi2(
      req({
        aspectRatio: '9:16',
        startImage: {
          index: 1, role: 'subject', roleTag: 'USER_INPUT', displayLabel: '',
          mimeType: 'image/png', url: 'https://cdn/a.png',
        },
      }),
      ENV,
    );
    expect(withFrame.calls[0]!.body.settings).not.toHaveProperty('aspect_ratio');
    vi.unstubAllGlobals();

    const noFrame = stubFetch(OK_CREATE);
    await executeKlingApi2(req({ variant: 'text2video', aspectRatio: '9:16' }), ENV);
    expect((noFrame.calls[0]!.body.settings as Record<string, unknown>).aspect_ratio).toBe('9:16');
  });

  it('returns a pending result flagged for the API 2.0 poller', async () => {
    stubFetch(OK_CREATE);
    const result = await executeKlingApi2(req(), ENV);
    expect(result).toMatchObject({
      status: 'pending', taskId: 'task-1', provider: 'kling', api2: true,
    });
  });

  it('names the AK/SK mistake explicitly on code 1002', async () => {
    stubFetch({ code: 1002, message: 'Authentication error.' }, 401);
    await expect(executeKlingApi2(req(), ENV)).rejects.toThrow(/console-issued API key/);
  });
});

describe('pollKlingApi2', () => {
  it('polls the unified endpoint by system task id', async () => {
    const { calls } = stubFetch({ code: 0, data: [] });
    await pollKlingApi2('task-1', ENV);
    expect(calls[0]!.url).toBe('https://api-singapore.klingai.com/tasks?task_ids=task-1');
  });

  // An id the service has not indexed yet comes back as an empty array.
  // Treating that as failure would refund a job that is still running.
  it('treats an unknown id as still pending', async () => {
    stubFetch({ code: 0, data: [] });
    await expect(pollKlingApi2('task-1', ENV)).resolves.toMatchObject({ status: 'pending' });
  });

  it('stays pending while the task is queued or running', async () => {
    for (const status of ['submitted', 'processing'] as const) {
      stubFetch({ code: 0, data: [{ id: 't', status }] });
      await expect(pollKlingApi2('t', ENV)).resolves.toMatchObject({ status: 'pending' });
      vi.unstubAllGlobals();
    }
  });

  it('returns the video output on success', async () => {
    stubFetch({
      code: 0,
      data: [
        {
          id: 't',
          status: 'succeeded',
          outputs: [{ type: 'video', url: 'https://cdn/out.mp4', duration: '10' }],
        },
      ],
    });
    await expect(pollKlingApi2('t', ENV)).resolves.toEqual({
      status: 'completed',
      outputs: [{ type: 'video', url: 'https://cdn/out.mp4', durationSec: 10 }],
    });
  });

  it('surfaces the provider reason when a task fails', async () => {
    stubFetch({ code: 0, data: [{ id: 't', status: 'failed', message: 'risk control' }] });
    await expect(pollKlingApi2('t', ENV)).rejects.toThrow(/risk control/);
  });
});
