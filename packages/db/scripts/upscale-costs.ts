/**
 * What the upscaler is costing us, and what it earned.
 *
 * fal has no usage API — the key opens the queue and the price book,
 * not the invoice — so spend cannot be pulled. It can be COMPUTED
 * exactly, because fal bills one thing: seconds of source video, at a
 * rate set by the target resolution, the frame rate and the enhancement
 * tier. Every one of those is on the job row, so this script is the
 * invoice we would have fetched.
 *
 * Read it against fal's dashboard, not instead of it: a mismatch means
 * either the rate table below is wrong (6K and 8K are extrapolated — see
 * `seed-fal-upscaler.ts`) or a job billed differently than it declared.
 *
 * REFUNDS COUNT. A failed job is refunded to the user but fal may well
 * have run it, so a refunded row earns nothing and can still cost. They
 * are listed separately rather than dropped.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/upscale-costs.ts            # last 7 days
 *   DATABASE_URL=... pnpm tsx scripts/upscale-costs.ts --days 1
 *   DATABASE_URL=... pnpm tsx scripts/upscale-costs.ts --all
 */

import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const sql = neon(url);

const MODEL_KEY = 'bytedance-upscaler';
/** $/second of SOURCE video at 30fps on the standard tier. */
const USD_PER_SECOND: Record<string, number> = {
  '1080p': 0.0072,
  '2k': 0.0144,
  '4k': 0.0288,
  // Extrapolated — fal publishes no rate above 4K.
  '6k': 0.0576,
  '8k': 0.1152,
};
const ESTIMATED = new Set(['6k', '8k']);
const CREDIT_USD = 0.1;
const REFERENCE_SECONDS = 5;
const MARKUP = 1.5;

const argDays = process.argv.indexOf('--days');
const days = process.argv.includes('--all')
  ? 36500
  : argDays >= 0
    ? Number(process.argv[argDays + 1])
    : 7;

interface Row {
  id: string;
  status: string;
  started_at: string | null;
  cost_credits: number | null;
  options: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  created_at: string;
  completed_at: string | null;
  email: string | null;
  refunded: number;
}

function rateUsd(resolution: string, fps: number, tier: string): number {
  const rate = USD_PER_SECOND[resolution];
  if (rate === undefined) return NaN;
  return rate * (fps > 30 ? 2 : 1) * (tier === 'pro' ? 10 : 1);
}

function falCostUsd(resolution: string, fps: number, tier: string, seconds: number): number {
  return rateUsd(resolution, fps, tier) * seconds;
}

/**
 * The catalogue price of the reference length for a combination — the
 * same arithmetic `seed-fal-upscaler.ts` writes. Needed to work
 * BACKWARDS from a charge on rows that predate `sourceSeconds`: a
 * 7-credit job at 2K is a ~17-second clip, not a 35-second one, because
 * 2K costs two credits per five seconds and not one.
 */
function creditsPerReference(resolution: string, fps: number, tier: string): number {
  const rate = rateUsd(resolution, fps, tier);
  if (Number.isNaN(rate)) return 1;
  return Math.max(1, Math.ceil((rate * REFERENCE_SECONDS * MARKUP) / CREDIT_USD));
}

async function main() {
  const rows = (await sql`
    SELECT
      j.id, j.status, j.cost_credits, j.options, j.result,
      j.created_at, j.started_at, j.completed_at, u.email,
      -- Credits handed back. A refunded job earned nothing; fal may
      -- still have charged for it.
      COALESCE((
        SELECT sum(l.delta)::int FROM credit_ledger l
        WHERE l.job_id = j.id AND l.reason = 'refund'
      ), 0) AS refunded
    FROM jobs j
    LEFT JOIN users u ON u.id = j.user_id
    WHERE j.model_key = ${MODEL_KEY}
      AND j.created_at > now() - (${days} || ' days')::interval
    ORDER BY j.created_at`) as unknown as Row[];

  if (rows.length === 0) {
    console.log(`\nNo upscale jobs in the last ${days} day(s).\n`);
    return;
  }

  console.log(`\nVideo Upscaler — ${rows.length} job(s), last ${days} day(s)\n`);
  console.log(
    `  ${'when'.padEnd(17)}${'settings'.padEnd(22)}${'src'.padStart(5)}` +
      `${'credits'.padStart(9)}${'earned'.padStart(9)}${'fal cost'.padStart(10)}` +
      `${'margin'.padStart(9)}  status`,
  );

  let earnedTotal = 0;
  let costTotal = 0;
  let unknownCost = 0;

  for (const r of rows) {
    const opts = (r.options ?? {}) as {
      mode?: string;
      upscale?: { fps?: number; tier?: string };
      sourceSeconds?: number;
    };
    const resolution = opts.mode ?? '1080p';
    const fps = opts.upscale?.fps ?? 30;
    const tier = opts.upscale?.tier ?? 'standard';
    const charged = r.cost_credits ?? 0;

    /**
     * The clip length. Recorded on the job since 2026-09-21; before
     * that it has to be inferred from the charge, which only narrows it
     * to a 5-second band — those rows are marked `~`.
     */
    const recorded = typeof opts.sourceSeconds === 'number' ? opts.sourceSeconds : null;
    const seconds =
      recorded ??
      Math.round((charged * REFERENCE_SECONDS) / creditsPerReference(resolution, fps, tier));
    const approx = recorded === null;

    // A refunded job earned nothing, whatever it was charged.
    const earned = ((charged - r.refunded) * CREDIT_USD);
    const cost = falCostUsd(resolution, fps, tier, seconds);
    // fal charges for work it did. A job that never reached the provider
    // (a validation failure, an upload that never resolved) cost nothing.
    const reachedProvider = r.status === 'completed' || r.started_at !== null;
    const billable = Number.isNaN(cost) ? 0 : reachedProvider ? cost : 0;

    earnedTotal += earned;
    costTotal += billable;
    if (Number.isNaN(cost)) unknownCost++;

    const when = new Date(r.created_at).toISOString().slice(5, 16).replace('T', ' ');
    const settings = `${resolution}/${fps}fps/${tier}`;
    const margin = earned - billable;
    const took =
      r.completed_at && r.started_at
        ? `${Math.round((Date.parse(r.completed_at) - Date.parse(r.started_at)) / 60000)}m`
        : r.started_at
          ? `${Math.round((Date.now() - Date.parse(r.started_at)) / 60000)}m…`
          : '—';
    console.log(
      `  ${when.padEnd(17)}${settings.padEnd(22)}` +
        `${(approx ? '~' : '') + seconds + 's'}`.padStart(5) +
        `${took.padStart(8)}` +
        `${String(charged).padStart(9)}` +
        `${('$' + earned.toFixed(2)).padStart(9)}` +
        `${('$' + billable.toFixed(3)).padStart(10)}` +
        `${((margin >= 0 ? '+$' : '-$') + Math.abs(margin).toFixed(2)).padStart(9)}` +
        `  ${r.status}${r.refunded ? ` (refunded ${r.refunded})` : ''}` +
        `${ESTIMATED.has(resolution) ? '  ← rate is an estimate' : ''}`,
    );
  }

  const margin = earnedTotal - costTotal;
  console.log(`\n  earned    $${earnedTotal.toFixed(2)}  (credits spent x $${CREDIT_USD})`);
  console.log(`  fal cost  $${costTotal.toFixed(2)}  (computed, not invoiced — check the dashboard)`);
  console.log(
    `  margin    ${margin >= 0 ? '+' : '-'}$${Math.abs(margin).toFixed(2)}` +
      (costTotal > 0 ? `  (${((earnedTotal / costTotal) * 100 - 100).toFixed(0)}% over cost)` : ''),
  );
  if (unknownCost > 0) console.log(`  ${unknownCost} job(s) at an unpriced resolution — cost unknown`);
  const anyApprox = rows.some((r) => typeof (r.options as { sourceSeconds?: number })?.sourceSeconds !== 'number');
  if (anyApprox) {
    console.log(
      `\n  Rows marked ~ predate the job row recording its source length;\n` +
        `  their seconds are inferred from the charge and are a 5s band.`,
    );
  }
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
