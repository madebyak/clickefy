/**
 * Rebuild `credit_lots` so they reconcile with the bucket columns.
 *
 * WHY THIS EXISTS
 *   Between migration 0029 landing and the lot-aware code being deployed,
 *   production runs the OLD bucket-only paths: a spend decrements
 *   `users.promo_credits` and friends without touching any lot, so the two
 *   drift apart. Migration 0029's backfill will not heal that — it only
 *   inserts when no lot of that class exists at all.
 *
 *   MUST BE RUN IMMEDIATELY BEFORE DEPLOYING the lot-aware code. If it
 *   isn't, the first spend after deploy allocates against stale lots and
 *   trips the lot CHECK.
 *
 * WHICH SIDE IS TRUTH
 *   The BUCKET COLUMNS. They are what the currently-deployed code
 *   maintains, they are what users see, and they are what the
 *   `users_balance_matches_buckets` CHECK protects. Lots are rebuilt to
 *   agree with them, never the other way round.
 *
 * PER CLASS, per user:
 *   lots short of the bucket → add one `kind='migrated'` lot for the gap
 *   lots over the bucket     → drain lots by the excess, soonest expiry
 *                              first (the same order a spend uses, so the
 *                              result matches what the old code would have
 *                              done had it known about lots)
 *
 * SAFETY
 *   - `--apply` required; dry run by default.
 *   - Never touches `users` — the buckets and balances it reconciles
 *     towards are read-only here. Nothing this script does can change what
 *     a user sees or is owed.
 *   - No DELETE: an over-counted lot is drained to a lower
 *     `amount_remaining`, never removed, so the grant history survives.
 *   - Re-reads and re-checks every user afterwards.
 *   - Idempotent: a second run finds nothing to do.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/resync-credit-lots.ts
 *   DATABASE_URL=... pnpm tsx scripts/resync-credit-lots.ts --apply
 */

import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const apply = process.argv.includes('--apply');
const sql = neon(url);
const q = <T = Record<string, unknown>>(s: string) =>
  sql(Object.assign([s], { raw: [s] }) as unknown as TemplateStringsArray) as unknown as Promise<T[]>;

const CLASSES = ['promo', 'subscription', 'topup'] as const;
type Cls = (typeof CLASSES)[number];
const COLUMN: Record<Cls, string> = {
  promo: 'promo_credits',
  subscription: 'subscription_credits',
  topup: 'topup_credits',
};

async function main() {
  const host = new URL(url!.replace('postgresql://', 'https://')).hostname;
  console.log(`Target: ${host}`);
  console.log(apply ? 'Mode:   APPLY\n' : 'Mode:   DRY RUN (pass --apply to write)\n');

  const drifted = await q<{
    id: string;
    email: string;
    subscription_expires_at: string | null;
    promo_credits: number;
    subscription_credits: number;
    topup_credits: number;
    lot_promo: number;
    lot_sub: number;
    lot_topup: number;
  }>(`
    SELECT u.id, u.email, u.subscription_expires_at,
           u.promo_credits, u.subscription_credits, u.topup_credits,
           COALESCE(l.p, 0) AS lot_promo,
           COALESCE(l.s, 0) AS lot_sub,
           COALESCE(l.t, 0) AS lot_topup
    FROM users u
    LEFT JOIN (
      SELECT user_id,
        COALESCE(SUM(amount_remaining) FILTER (WHERE class='promo'), 0)        AS p,
        COALESCE(SUM(amount_remaining) FILTER (WHERE class='subscription'), 0) AS s,
        COALESCE(SUM(amount_remaining) FILTER (WHERE class='topup'), 0)        AS t
      FROM credit_lots GROUP BY user_id
    ) l ON l.user_id = u.id
    WHERE u.promo_credits        <> COALESCE(l.p, 0)
       OR u.subscription_credits <> COALESCE(l.s, 0)
       OR u.topup_credits        <> COALESCE(l.t, 0)
    ORDER BY u.email`);

  if (drifted.length === 0) {
    console.log('Nothing to do — every user\'s lots already match their buckets.');
    return;
  }

  console.log(`${drifted.length} user(s) drifted:\n`);
  let added = 0;
  let drained = 0;

  for (const u of drifted) {
    const gaps: Array<{ cls: Cls; bucket: number; lots: number; diff: number }> = [];
    for (const cls of CLASSES) {
      // Postgres SUM() over an integer column is bigint, which the driver
      // hands back as a STRING. Without coercing, `0 !== '0'` is true and
      // every class looks drifted.
      const bucket = Number(
        cls === 'promo' ? u.promo_credits : cls === 'subscription' ? u.subscription_credits : u.topup_credits,
      );
      const lots = Number(
        cls === 'promo' ? u.lot_promo : cls === 'subscription' ? u.lot_sub : u.lot_topup,
      );
      if (bucket !== lots) gaps.push({ cls, bucket, lots, diff: bucket - lots });
    }
    if (gaps.length === 0) continue;

    console.log(`  ${String(u.email).slice(0, 40).padEnd(42)}`);
    for (const g of gaps) {
      console.log(
        `      ${g.cls.padEnd(13)} bucket=${String(g.bucket).padStart(6)} lots=${String(g.lots).padStart(6)}  →  ${g.diff > 0 ? `add a ${g.diff}cr lot` : `drain ${-g.diff}cr from existing lots`}`,
      );
      if (!apply) continue;

      if (g.diff > 0) {
        // Subscription credits expire with the period; everything else is
        // grandfathered with no expiry (see migration 0029's reasoning —
        // we do not apply a new clock to credits issued under old terms).
        const expires =
          g.cls === 'subscription' && u.subscription_expires_at
            ? `'${u.subscription_expires_at}'::timestamptz`
            : 'NULL';
        await q(`
          INSERT INTO credit_lots
            (user_id, class, kind, amount_granted, amount_remaining, expires_at, source_platform)
          VALUES ('${u.id}'::uuid, '${g.cls}', 'migrated', ${g.diff}, ${g.diff}, ${expires}, 'system')`);
        added += 1;
      } else {
        // Drain in spend order so the surviving lots are the ones a real
        // spend would have left behind.
        await q(`
          WITH ranked AS (
            SELECT id, amount_remaining,
              SUM(amount_remaining) OVER (
                ORDER BY expires_at ASC NULLS LAST, created_at ASC, id ASC
                ROWS UNBOUNDED PRECEDING
              ) AS running
            FROM credit_lots
            WHERE user_id = '${u.id}'::uuid AND class = '${g.cls}' AND amount_remaining > 0
          ),
          alloc AS (
            SELECT id, LEAST(amount_remaining, ${-g.diff} - (running - amount_remaining)) AS take
            FROM ranked WHERE running - amount_remaining < ${-g.diff}
          )
          UPDATE credit_lots cl SET amount_remaining = cl.amount_remaining - a.take
          FROM alloc a WHERE cl.id = a.id`);
        drained += 1;
      }
    }
  }

  if (!apply) {
    console.log(`\nWould reconcile ${drifted.length} user(s). Re-run with --apply to write.`);
    return;
  }

  // Re-read and prove it worked, rather than trusting the writes.
  const left = await q<{ n: number }>(`
    SELECT COUNT(*)::int n FROM users u
    LEFT JOIN (
      SELECT user_id,
        COALESCE(SUM(amount_remaining) FILTER (WHERE class='promo'), 0)        AS p,
        COALESCE(SUM(amount_remaining) FILTER (WHERE class='subscription'), 0) AS s,
        COALESCE(SUM(amount_remaining) FILTER (WHERE class='topup'), 0)        AS t
      FROM credit_lots GROUP BY user_id
    ) l ON l.user_id = u.id
    WHERE u.promo_credits        <> COALESCE(l.p, 0)
       OR u.subscription_credits <> COALESCE(l.s, 0)
       OR u.topup_credits        <> COALESCE(l.t, 0)`);

  console.log(`\nApplied: ${added} lot(s) added, ${drained} class(es) drained.`);
  if (left[0]!.n === 0) {
    console.log('✔ every user\'s lots now match their buckets');
  } else {
    console.log(`✗ ${left[0]!.n} user(s) STILL drifted — do not deploy; investigate first`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\nFailed:', err);
  process.exit(1);
});
