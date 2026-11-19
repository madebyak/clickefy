import { afterEach, describe, expect, it, vi } from 'vitest';

import { FAL_START_TIMEOUT_SECONDS, cancelFal, executeFal, pollFal, type FalEnv } from './fal';

const ENV: FalEnv = { apiKey: 'test-key', baseUrl: 'https://queue.test' };
const ENDPOINT = 'fal-ai/bytedance-upscaler/upscale/video';

function mockFetch(...responses: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift() ?? { body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('executeFal', () => {
  it('asks fal to give the request up if no runner starts it in time', async () => {
    const calls = mockFetch({ body: { request_id: 'req-1', status_url: 'https://queue.test/fal-ai/bytedance-upscaler/requests/req-1/status' } });
    const result = await executeFal({ provider: 'fal', endpoint: ENDPOINT, input: { video_url: 'https://x/y.mp4' } }, ENV);

    expect(result).toEqual({ status: 'pending', taskId: 'req-1', provider: 'fal', endpoint: 'fal-ai/bytedance-upscaler' });
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers['X-Fal-Request-Start-Timeout']).toBe(String(FAL_START_TIMEOUT_SECONDS));
    expect(headers.Authorization).toBe('Key test-key');
    expect(calls[0]!.url).toBe(`https://queue.test/${ENDPOINT}`);
  });

  it('honours a caller-set limit and sends none for zero', async () => {
    let calls = mockFetch({ body: { request_id: 'a' } });
    await executeFal({ provider: 'fal', endpoint: ENDPOINT, input: {} }, { ...ENV, startTimeoutSeconds: 90 });
    expect((calls[0]!.init!.headers as Record<string, string>)['X-Fal-Request-Start-Timeout']).toBe('90');

    calls = mockFetch({ body: { request_id: 'b' } });
    await executeFal({ provider: 'fal', endpoint: ENDPOINT, input: {} }, { ...ENV, startTimeoutSeconds: 0 });
    expect((calls[0]!.init!.headers as Record<string, string>)['X-Fal-Request-Start-Timeout']).toBeUndefined();
  });
});

describe('pollFal', () => {
  it('tells waiting in the queue apart from running', async () => {
    mockFetch({ body: { status: 'IN_QUEUE', queue_position: 3 } });
    await expect(pollFal('req-1', ENDPOINT, ENV)).resolves.toEqual({ status: 'pending', phase: 'queued', queuePosition: 3 });

    mockFetch({ body: { status: 'IN_PROGRESS' } });
    await expect(pollFal('req-1', ENDPOINT, ENV)).resolves.toEqual({ status: 'pending', phase: 'running' });
  });

  it('collects the video when fal reports completion', async () => {
    mockFetch({ body: { status: 'COMPLETED' } }, { body: { video: { url: 'https://cdn/out.mp4', content_type: 'video/mp4' }, duration: 12.5 } });
    const result = await pollFal('req-1', ENDPOINT, ENV);
    expect(result).toEqual({ status: 'completed', outputs: [{ type: 'video', url: 'https://cdn/out.mp4' }] });
  });

  it('treats a failed result fetch as terminal, keeping the status code for the error mapper', async () => {
    // What fal returns when the start limit expires, and for a partner outage.
    mockFetch({ body: { status: 'COMPLETED' } }, { status: 504, body: { detail: 'Request timed out before it started' } });
    const result = await pollFal('01a1ef05-bda0-79f3-8d80-5ec12c384374', ENDPOINT, ENV);
    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.error).toMatch(/fal 504 /);
  });
});

describe('cancelFal', () => {
  it('PUTs the cancel path and reports whether fal accepted it', async () => {
    const calls = mockFetch({ body: { status: 'CANCELLATION_REQUESTED' } });
    await expect(cancelFal('req-1', ENDPOINT, ENV)).resolves.toBe(true);
    expect(calls[0]!.url).toBe('https://queue.test/fal-ai/bytedance-upscaler/requests/req-1/cancel');
    expect(calls[0]!.init!.method).toBe('PUT');

    mockFetch({ status: 400, body: { detail: 'Request is already completed' } });
    await expect(cancelFal('req-1', ENDPOINT, ENV)).resolves.toBe(false);
  });
});
