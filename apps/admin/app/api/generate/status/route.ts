/**
 * GET /api/generate/status?taskId=…&provider=kling
 *
 * Poll an async generation task. Currently only Kling produces async
 * jobs; Gemini / Imagen complete inline in `/api/generate`. The route
 * thinly wraps `pollAsyncTask()` from `@clickfy/providers` so the same
 * Kling JWT + endpoint code is used for playground polls and any
 * future Trigger.dev worker.
 */

import { NextResponse } from 'next/server';

import { pollAsyncTask } from '@clickfy/providers';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const taskId = url.searchParams.get('taskId');
  const provider = url.searchParams.get('provider');
  // `variant` distinguishes Kling's two async endpoints. The submit
  // response carries it forward; the playground echoes it back here.
  const rawVariant = url.searchParams.get('variant') ?? 'image2video';
  const variant: 'image2video' | 'omni' =
    rawVariant === 'omni' ? 'omni' : 'image2video';

  if (!taskId || !provider) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: '`taskId` and `provider` are required.' } },
      { status: 400 },
    );
  }
  if (provider !== 'kling') {
    return NextResponse.json(
      { error: { code: 'unsupported_provider', message: `Polling is not supported for "${provider}".` } },
      { status: 400 },
    );
  }

  if (!process.env.KLING_ACCESS_KEY || !process.env.KLING_SECRET_KEY) {
    return NextResponse.json(
      {
        error: {
          code: 'missing_credentials',
          message: 'KLING_ACCESS_KEY / KLING_SECRET_KEY are not set in the admin environment.',
        },
      },
      { status: 500 },
    );
  }

  try {
    const result = await pollAsyncTask(taskId, 'kling', variant, {
      kling: {
        accessKey: process.env.KLING_ACCESS_KEY,
        secretKey: process.env.KLING_SECRET_KEY,
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Status check failed.';
    console.error('Status poll error:', err);
    return NextResponse.json(
      { error: { code: 'poll_failed', message } },
      { status: 500 },
    );
  }
}
