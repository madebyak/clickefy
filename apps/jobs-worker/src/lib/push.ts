/**
 * Thin client that proxies push-fan-out through the Worker.
 *
 * The Worker owns the `device_tokens` table + the Expo HTTP client; the
 * jobs-worker just POSTs a "ping user X with this title/body" envelope
 * and lets the Worker resolve tokens + handle DeviceNotRegistered.
 *
 * Auth: the same `INTERNAL_API_SECRET` we use for /v1/outputs/internal.
 * Fire-and-forget: failures are logged but do not block the calling
 * task from marking its job complete — a missed push is materially
 * less bad than a refund-loop on a job that's already done.
 */

import { logger } from '@trigger.dev/sdk';

import { env } from '../env';

export interface PushUserArgs {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export async function pushUser(args: PushUserArgs): Promise<void> {
  try {
    const res = await fetch(`${env.WORKER_API_URL}/v1/internal/push/user`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': env.INTERNAL_API_SECRET,
      },
      body: JSON.stringify(args),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn('push-user-failed', {
        userId: args.userId,
        status: res.status,
        body: text.slice(0, 200),
      });
      return;
    }
  } catch (err) {
    logger.warn('push-user-threw', {
      userId: args.userId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
