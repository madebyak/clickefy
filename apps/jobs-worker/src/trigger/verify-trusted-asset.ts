/**
 * `verify-trusted-asset` — triggered by the API the moment an attachment
 * that might show a person lands in the composer, so the badge on the
 * thumbnail is settled before the user presses Generate.
 *
 * One at a time: the free BytePlus tier takes three registrations a
 * minute, and a serial queue plus the backoff in the lib keeps a burst of
 * uploads from tripping it. The generation path verifies inline as well,
 * so a queue that is behind only delays the badge, never the job.
 */

import { logger, queue, task } from '@trigger.dev/sdk';

import { verifyTrustedAsset } from '../lib/trusted-assets';

export const trustedAssetQueue = queue({ name: 'byteplus-assets', concurrencyLimit: 1 });

export const verifyTrustedAssetTask = task({
  id: 'verify-trusted-asset',
  queue: trustedAssetQueue,
  // Image reviews answer in seconds; a clip can take minutes, and the
  // rate-limit backoff adds up to two more.
  maxDuration: 900,
  retry: { maxAttempts: 2 },
  run: async (payload: { id: string }) => {
    const row = await verifyTrustedAsset(payload.id);
    logger.info('verify-trusted-asset:done', { id: row.id, status: row.status, human: row.human, assetId: row.byteplusAssetId });
    return { status: row.status, human: row.human, assetId: row.byteplusAssetId };
  },
});
