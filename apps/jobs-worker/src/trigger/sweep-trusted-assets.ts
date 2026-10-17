/**
 * `sweep-trusted-assets` — keeps the BytePlus asset library from filling.
 *
 * The free tier holds 50 assets in total and never resets, so every slot
 * must be given back. Jobs release their own assets when they end; this
 * sweeper catches the rest every ten minutes: attachments verified in the
 * composer but never generated with, assets left by a crashed run, and
 * rows pointing at assets BytePlus no longer has.
 */

import { logger, schedules } from '@trigger.dev/sdk';

import { sweepTrustedAssets } from '../lib/trusted-assets';

export const sweepTrustedAssetsTask = schedules.task({
  id: 'sweep-trusted-assets',
  cron: '*/10 * * * *',
  maxDuration: 300,
  run: async () => {
    const result = await sweepTrustedAssets();
    logger.info('sweep-trusted-assets:done', result);
    return result;
  },
});
