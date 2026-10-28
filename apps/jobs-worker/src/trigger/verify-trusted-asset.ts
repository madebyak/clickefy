/**
 * The badge path for one attachment, as two tasks on two queues.
 *
 *   verify-trusted-asset   — the person check. Many at once: Gemini has
 *                            no rate cap that matters here, and most
 *                            attachments end right here with "no person"
 *                            in a few seconds. Bounded so a burst of
 *                            attachments never starves generation runs
 *                            of environment concurrency.
 *   register-trusted-asset — the BytePlus registration, only for files
 *                            with a person. One at a time: the Entry tier
 *                            takes three uploads a minute.
 *
 * Until 2026-10-28 both halves ran as one task on the serial queue, so
 * twenty-four product shots from one user queued behind each other for
 * minutes with the Generate button held. The composer fires the first
 * task (`POST /v1/trusted-assets`); the first hands over to the second.
 */
import { logger, queue, task } from '@trigger.dev/sdk';

import { checkPerson, markVerificationFailed, registerTrustedAsset } from '../lib/trusted-assets';

export const personCheckQueue = queue({ name: 'person-check', concurrencyLimit: 5 });
export const trustedAssetQueue = queue({ name: 'byteplus-assets', concurrencyLimit: 1 });

export const registerTrustedAssetTask = task({
  id: 'register-trusted-asset',
  queue: trustedAssetQueue,
  // A clip's review can take minutes, and the rate-limit backoff adds up to two more.
  maxDuration: 900,
  retry: { maxAttempts: 2 },
  run: async (payload: { id: string }) => {
    const row = await registerTrustedAsset(payload.id);
    logger.info('register-trusted-asset:done', { id: row.id, status: row.status, assetId: row.byteplusAssetId });
    return { status: row.status, assetId: row.byteplusAssetId };
  },
  onFailure: async ({ payload, error }) => {
    await markVerificationFailed(payload.id, 'Could not register the file. Try again.', error);
  },
});

export const verifyTrustedAssetTask = task({
  id: 'verify-trusted-asset',
  queue: personCheckQueue,
  // Reading a file of up to 15 MB and one Gemini answer; the 45 s call timeout times three attempts fits.
  maxDuration: 180,
  retry: { maxAttempts: 3, minTimeoutInMs: 3_000, maxTimeoutInMs: 30_000, factor: 2, randomize: true },
  run: async (payload: { id: string }) => {
    const row = await checkPerson(payload.id);
    const needsRegistration = row.human === true && !(row.status === 'verified' && row.byteplusAssetId);
    logger.info('verify-trusted-asset:checked', { id: row.id, status: row.status, human: row.human, needsRegistration });
    if (needsRegistration) {
      await registerTrustedAssetTask.trigger({ id: row.id });
    }
    return { status: row.status, human: row.human, handedOff: needsRegistration };
  },
  onFailure: async ({ payload, error }) => {
    await markVerificationFailed(payload.id, 'Could not inspect the file. Try again.', error);
  },
});
