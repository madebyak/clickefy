/**
 * Wire-format tests for the Seedance adapter's Draft mode.
 *
 * ModelArk validates the body strictly, so an extra field is a 4xx on a
 * job that has already been charged — these assert the exact JSON.
 *
 * `fetch` is stubbed; nothing here touches the network.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { executeSeedance } from './seedance';
import type { SeedanceCompiledRequest } from '../compile-types';

const ENV = { apiKey: 'test-key' };

type Captured = { url: string; body: Record<string, unknown> };

/** Stub fetch and capture what the adapter sent. */
function stubFetch(): { calls: Captured[] } {
  const calls: Captured[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({
        url,
        body: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {},
      });
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ id: 'cgt-new' }),
      } as unknown as Response;
    }),
  );
  return { calls };
}

afterEach(() => vi.unstubAllGlobals());

const MODEL = 'dreamina-seedance-2-5-260628';

describe('Seedance adapter — Draft mode', () => {
  it('a draft is a normal body plus draft: true', async () => {
    const { calls } = stubFetch();
    const request: SeedanceCompiledRequest = {
      provider: 'seedance',
      model: MODEL,
      prompt: 'a paper boat on a pond',
      ratio: '16:9',
      duration: 4,
      resolution: '480p',
      draft: true,
      generateAudio: false,
    };
    await executeSeedance(request, ENV);
    expect(calls[0]!.body).toEqual({
      model: MODEL,
      content: [{ type: 'text', text: 'a paper boat on a pond' }],
      ratio: '16:9',
      duration: 4,
      resolution: '480p',
      draft: true,
      generate_audio: false,
    });
  });

  it('a final sends the draft task id and the tier, and nothing it would reuse', async () => {
    const { calls } = stubFetch();
    const request: SeedanceCompiledRequest = {
      provider: 'seedance',
      model: MODEL,
      prompt: '',
      draftTaskId: 'cgt-draft-1',
      resolution: '1080p',
      // Present on the request by mistake — must still stay off the wire.
      ratio: '16:9',
      duration: 5,
      generateAudio: false,
    };
    const result = await executeSeedance(request, ENV);
    expect(result).toEqual({ status: 'pending', taskId: 'cgt-new', provider: 'seedance' });
    expect(calls[0]!.body).toEqual({
      model: MODEL,
      content: [{ type: 'draft_task', draft_task: { id: 'cgt-draft-1' } }],
      resolution: '1080p',
    });
  });

  it('a normal generation never sends the draft field', async () => {
    const { calls } = stubFetch();
    await executeSeedance(
      { provider: 'seedance', model: MODEL, prompt: 'x', resolution: '720p', generateAudio: false },
      ENV,
    );
    expect(calls[0]!.body).not.toHaveProperty('draft');
  });
});
