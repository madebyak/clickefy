/**
 * Redenominate the credit system — September 2026.
 *
 * ONE credit becomes $0.10 (it was worth about $0.0095), and every model
 * is repriced at 1.5x its provider cost. Both halves have to land in the
 * same pass: new prices under the old denomination would be a 90% price
 * cut, and a new denomination under the old prices a 10x rise.
 *
 * WHAT CHANGES
 *
 *   provider_models   cost_credits + tier_pricing, from the price book.
 *                       DEPRECATED models too: 285 published templates
 *                       still name `gemini-3-pro-image-preview`, and a
 *                       template snapshot pins the model key forever. Leave
 *                       them in old credits and a recomputed template adds
 *                       old-denomination and new-denomination numbers
 *                       together — which is exactly what the first dry run
 *                       did (134 -> 49, where 40 of the 49 were old money).
 *   plans             credits_per_period: 2000/4500/9000/12500
 *                       becomes 190/390/750/990 (price x 10)
 *   credit_packs      credits = price x 10, bonus removed (no volume
 *                       discount anywhere in the new system)
 *   grant_policies    every policy amount; the welcome grant lands on 6
 *   subscription_plans the LEGACY mobile catalogue. Not the same table as
 *                       `plans`: `/v1/store` serves it to the shipped app
 *                       and the RevenueCat webhook GRANTS from it. Leaving
 *                       it alone would hand a mobile subscriber 2,000 new
 *                       credits — $200 of value for a $22 purchase. Its
 *                       rows are simply redenominated, preserving today's
 *                       behaviour; the real mobile catalogue is Phase 3.
 *   credit_lots       every live lot divided by 10, rounded UP
 *   users             the three bucket columns rebuilt FROM the lots
 *   credit_ledger     one compensating row per user, carrying the new
 *                       balance in `balance_after` so point-in-time
 *                       reconstruction still works across the change
 *
 * WHY THE LEDGER ROW IS NOT OPTIONAL
 *
 * `verify-credit-integrity` asserts SUM(credit_ledger.delta) = credits_balance
 * for every user. Historical rows stay in the OLD denomination — rewriting
 * a year of history to make the arithmetic work would destroy the audit
 * trail this system exists to keep. So each user gets one `admin_adjust`
 * row carrying the difference, which both preserves the invariant and
 * leaves the redenomination visible as a single, explicable event.
 *
 * WHY ROUNDING IS UP
 *
 * 2,657 credits instead of 1,993 across the whole user base — about $65
 * of provider cost. A migration that silently reduces what somebody has
 * already paid for is not worth arguing about for that money.
 *
 * TEMPLATES ARE NOT TOUCHED HERE
 *
 * The 339 published templates carry prices frozen at publish time. Scaling
 * them by any constant would bake in the OLD markup, so they are recomputed
 * from their own pipelines against the new catalogue afterwards:
 *
 *     pnpm tsx scripts/recompute-template-costs.ts --apply
 *
 * Run it AFTER this script, or it will recompute against prices that are
 * about to change.
 *
 * SAFETY
 *   - `--apply` required; dry run by default, and the dry run prints every
 *     row it would touch.
 *   - UPDATE and INSERT only. No DELETE, no TRUNCATE, no DDL.
 *   - Refuses to start if the credit system is ALREADY inconsistent: a
 *     migration is the worst possible moment to discover a pre-existing
 *     imbalance.
 *   - Refuses to start while a job is queued or processing. A refund reads
 *     back what the ledger says the job CHARGED, so a job charged before
 *     the change and refunded after would return old-denomination credits
 *     into a new-denomination balance — ten times what it took. Waiting
 *     for the queue to drain costs a few minutes and closes that window
 *     entirely.
 *   - The BALANCE phase refuses to run twice — dividing by ten a second
 *     time would quietly take 90% of everyone's balance, so the marker in
 *     each user's ledger row is checked first. The catalogue phase stays
 *     re-runnable on purpose: it writes absolute values from the price
 *     book, so correcting a price and re-running is safe and is how a
 *     mistake gets fixed without hand-editing rows.
 *   - Each user's lots, buckets and ledger row move in ONE statement, so
 *     a failure halfway through leaves that user untouched rather than
 *     half-converted (the neon-http driver has no interactive
 *     transactions; a data-modifying CTE is the atomic unit available).
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/redenominate-credits-2026-09.ts
 *   DATABASE_URL=... pnpm tsx scripts/redenominate-credits-2026-09.ts --apply
 *
 * Take a snapshot first, every time:
 *   DATABASE_URL=... pnpm tsx scripts/backup-money-tables.ts
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** Old credits per new credit. The denominator of the whole migration. */
const DIVISOR = 10;

/** The price book's two numbers, needed here only for deprecated models. */
const MARKUP = 1.5;
const CREDIT_USD = 0.1;

/** Written on every ledger row this script creates, and checked before it runs. */
const MARKER = 'redenominate-2026-09';

const here = dirname(fileURLToPath(import.meta.url));
const catalogue = JSON.parse(
  readFileSync(join(here, '..', 'pricing', 'catalogue-2026-09.json'), 'utf8'),
) as {
  models: Record<string, { costCredits: number; tierPricing: Record<string, number> | null }>;
  plans: Array<{ tier: string; monthlyUsd: number; yearlyUsd: number; creditsPerPeriod: number }>;
};

/** Top-up packs: credits = price x 10, and no bonus. */
const PACKS: Record<string, number> = {
  topup_1k: 100,
  topup_2_5k: 250,
  topup_5k: 500,
  topup_10k: 1000,
  topup_25k: 2500,
};

/** The welcome grant, in new credits. 60 old credits bought ~6 images. */
const WELCOME_CREDITS = 6;

const problems: string[] = [];

/** True once the balance phase has run: it must never run a second time. */
let balancesAlreadyDone = false;
const say = (s = '') => console.log(s);

// ─── Preconditions ──────────────────────────────────────────────────

async function assertHealthy() {
  const [bal] = await q<{ n: string }>(`
    SELECT COUNT(*) AS n FROM users
    WHERE credits_balance <> promo_credits + subscription_credits + topup_credits`);
  if (Number(bal.n) > 0) problems.push(`${bal.n} user(s) whose balance does not equal their buckets`);

  const [proj] = await q<{ n: string }>(`
    SELECT COUNT(*) AS n FROM (
      SELECT u.id
      FROM users u
      LEFT JOIN credit_lots cl ON cl.user_id = u.id AND cl.amount_remaining > 0
      GROUP BY u.id, u.promo_credits, u.subscription_credits, u.topup_credits
      HAVING u.promo_credits <> COALESCE(SUM(cl.amount_remaining) FILTER (WHERE cl.class='promo'), 0)
          OR u.subscription_credits <> COALESCE(SUM(cl.amount_remaining) FILTER (WHERE cl.class='subscription'), 0)
          OR u.topup_credits <> COALESCE(SUM(cl.amount_remaining) FILTER (WHERE cl.class='topup'), 0)
    ) x`);
  if (Number(proj.n) > 0) problems.push(`${proj.n} user(s) whose bucket columns disagree with their lots`);

  const [inflight] = await q<{ n: string }>(`
    SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued', 'processing')`);
  if (Number(inflight.n) > 0) {
    problems.push(
      `${inflight.n} job(s) are queued or processing — their refunds would be paid in old credits. Wait for the queue to drain.`,
    );
  }

  const [already] = await q<{ n: string }>(`
    SELECT COUNT(*) AS n FROM credit_ledger WHERE metadata->>'migration' = '${MARKER}'`);
  balancesAlreadyDone = Number(already.n) > 0;
}

// ─── The plan ───────────────────────────────────────────────────────

interface ModelChange {
  modelKey: string;
  displayName: string;
  fromCredits: number;
  toCredits: number;
  fromTiers: Record<string, number> | null;
  toTiers: Record<string, number> | null;
}

/**
 * A deprecated model's price, from its recorded provider cost.
 *
 * These are not in the price book — nobody can choose one — but published
 * templates still reference two of them, so they need to be in the SAME
 * money as everything else. Deriving from `cost_per_call_usd` rather than
 * dividing the old credits by ten means a template using the legacy
 * Nano Banana Pro key costs exactly what one using the current key costs.
 *
 * A model sitting at 0 credits is deliberately unpriced — the job route
 * refuses it — so it stays at 0 rather than being quietly resurrected.
 */
function priceDeprecated(costCredits: number, usdPerCall: number | null): number | null {
  if (costCredits === 0) return null;
  if (!usdPerCall || usdPerCall <= 0) return Math.max(1, Math.ceil(costCredits / DIVISOR));
  return Math.max(1, Math.ceil((usdPerCall * MARKUP) / CREDIT_USD));
}

async function planModels(): Promise<ModelChange[]> {
  const rows = await q<{
    model_key: string;
    display_name: string;
    cost_credits: number;
    cost_per_call_usd: string | null;
    tier_pricing: Record<string, number> | null;
    status: string;
  }>(`SELECT model_key, display_name, cost_credits, cost_per_call_usd, tier_pricing, status
      FROM provider_models`);

  const changes: ModelChange[] = [];
  for (const r of rows) {
    if (r.status === 'deprecated') {
      const to = priceDeprecated(Number(r.cost_credits), r.cost_per_call_usd ? Number(r.cost_per_call_usd) : null);
      if (to === null) continue;
      const toTiers = r.tier_pricing
        ? Object.fromEntries(
            // Keep the tiers' proportions; only the denomination changes.
            Object.entries(r.tier_pricing).map(([t, v]) => [
              t,
              Math.max(1, Math.round((Number(v) * to) / Number(r.cost_credits))),
            ]),
          )
        : null;
      changes.push({
        modelKey: r.model_key,
        displayName: `${r.display_name} (deprecated)`,
        fromCredits: Number(r.cost_credits),
        toCredits: to,
        fromTiers: r.tier_pricing,
        toTiers,
      });
      continue;
    }
    const next = catalogue.models[r.model_key];
    if (!next) {
      // A model that is sellable but absent from the price book would keep
      // its OLD price under the NEW denomination — a tenfold rise. Refuse.
      problems.push(`${r.model_key} is ${r.status} but has no entry in the price book`);
      continue;
    }
    if (next.costCredits < 1) {
      problems.push(`${r.model_key} would be priced at ${next.costCredits} credits`);
      continue;
    }
    changes.push({
      modelKey: r.model_key,
      displayName: r.display_name,
      fromCredits: Number(r.cost_credits),
      toCredits: next.costCredits,
      fromTiers: r.tier_pricing,
      toTiers: next.tierPricing,
    });
  }

  const unknown = Object.keys(catalogue.models).filter(
    (k) => !rows.some((r) => r.model_key === k && r.status !== 'deprecated'),
  );
  if (unknown.length > 0) {
    problems.push(`price book names models that are not active/preview: ${unknown.join(', ')}`);
  }
  return changes;
}

interface UserChange {
  id: string;
  email: string;
  fromBalance: number;
  toBalance: number;
  lots: number;
}

async function planUsers(): Promise<UserChange[]> {
  // The projected new balance, computed the same way the UPDATE will:
  // per lot, rounded up, then summed. Doing the arithmetic in SQL rather
  // than in JS means the dry run cannot disagree with the write.
  return q<UserChange & { fromBalance: string; toBalance: string; lots: string }>(`
    SELECT u.id,
           u.email,
           u.credits_balance AS "fromBalance",
           COALESCE(SUM(CEIL(cl.amount_remaining::numeric / ${DIVISOR}))::int, 0) AS "toBalance",
           COUNT(cl.id) AS lots
      FROM users u
      LEFT JOIN credit_lots cl ON cl.user_id = u.id AND cl.amount_remaining > 0
     WHERE u.is_deleted = false
     GROUP BY u.id, u.email, u.credits_balance
     HAVING u.credits_balance > 0 OR COUNT(cl.id) > 0
     ORDER BY u.credits_balance DESC`) as unknown as Promise<UserChange[]>;
}

// ─── Writes ─────────────────────────────────────────────────────────

async function writeModels(changes: ModelChange[]) {
  for (const c of changes) {
    if (c.toTiers) {
      await sql`
        UPDATE provider_models
           SET cost_credits = ${c.toCredits},
               tier_pricing = ${JSON.stringify(c.toTiers)}::jsonb,
               updated_at = now()
         WHERE model_key = ${c.modelKey}`;
    } else {
      await sql`
        UPDATE provider_models
           SET cost_credits = ${c.toCredits},
               tier_pricing = NULL,
               updated_at = now()
         WHERE model_key = ${c.modelKey}`;
    }
  }
}

async function writeCatalogue() {
  for (const p of catalogue.plans) {
    // Both intervals carry the same allowance: credits are per 30 days on
    // every plan, and `refresh-subscription-credits` supplies the eleven
    // top-ups a yearly subscriber's single invoice never announces.
    await sql`
      UPDATE plans SET credits_per_period = ${p.creditsPerPeriod}, updated_at = now()
       WHERE tier = ${p.tier}`;
  }
  for (const [storeProductId, credits] of Object.entries(PACKS)) {
    await sql`
      UPDATE credit_packs
         SET credits = ${credits}, bonus_credits = 0, updated_at = now()
       WHERE store_product_id = ${storeProductId}`;
  }
  await sql`
    UPDATE grant_policies SET amount = ${WELCOME_CREDITS}, updated_at = now()
     WHERE kind = 'welcome'`;
  // Every other policy keeps its current behaviour, in new money.
  await sql`
    UPDATE grant_policies
       SET amount = GREATEST(1, CEIL(amount::numeric / ${DIVISOR}))::int, updated_at = now()
     WHERE kind <> 'welcome' AND amount > 0`;
  // The legacy mobile catalogue. Redenominated, not repriced: what these
  // rows SHOULD grant under the four-tier catalogue is a Phase 3 question,
  // and answering it here would change mobile behaviour in a migration
  // that is supposed to change only the unit.
  await sql`
    UPDATE subscription_plans
       SET credits_per_period = GREATEST(1, CEIL(credits_per_period::numeric / ${DIVISOR}))::int,
           updated_at = now()
     WHERE credits_per_period > 0`;
}

/**
 * One user's lots, buckets and ledger row, in a single statement.
 *
 * `before` is read inside the same snapshot as the write, so the ledger
 * delta cannot be computed against a balance that changed underneath it.
 * Both SET expressions read the OLD row, which is why `amount_remaining`
 * can be clamped to the new `amount_granted` without reading it back.
 */
async function writeUser(userId: string) {
  await sql`
    WITH before AS (
      SELECT credits_balance AS old FROM users WHERE id = ${userId}::uuid
    ),
    rescaled AS (
      UPDATE credit_lots
         SET amount_granted = GREATEST(1, CEIL(amount_granted::numeric / ${DIVISOR}))::int,
             amount_remaining = LEAST(
               GREATEST(1, CEIL(amount_granted::numeric / ${DIVISOR}))::int,
               CEIL(amount_remaining::numeric / ${DIVISOR})::int
             )
       WHERE user_id = ${userId}::uuid
       RETURNING class, amount_remaining
    ),
    sums AS (
      SELECT
        COALESCE(SUM(amount_remaining) FILTER (WHERE class = 'promo'), 0)::int        AS promo,
        COALESCE(SUM(amount_remaining) FILTER (WHERE class = 'subscription'), 0)::int AS sub,
        COALESCE(SUM(amount_remaining) FILTER (WHERE class = 'topup'), 0)::int        AS topup
      FROM rescaled
    ),
    updated AS (
      UPDATE users u
         SET promo_credits = s.promo,
             subscription_credits = s.sub,
             topup_credits = s.topup,
             credits_balance = s.promo + s.sub + s.topup
        FROM sums s
       WHERE u.id = ${userId}::uuid
       RETURNING u.credits_balance AS new_balance
    )
    INSERT INTO credit_ledger (user_id, delta, balance_after, reason, note, metadata)
    SELECT ${userId}::uuid,
           updated.new_balance - before.old,
           updated.new_balance,
           'admin_adjust'::credit_reason,
           'Credit redenomination: 1 new credit = 10 old credits, and every model repriced. Balance unchanged in value.',
           ${JSON.stringify({ migration: MARKER, divisor: DIVISOR, rounding: 'up' })}::jsonb
      FROM updated, before`;
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  const host = new URL(url!).host;
  say(`\n${apply ? 'APPLYING' : 'DRY RUN'} — credit redenomination, September 2026`);
  say(`database: ${host}`);
  say(`1 new credit = ${DIVISOR} old credits = $0.10 · every model repriced at 1.5x provider cost\n`);

  await assertHealthy();
  const models = await planModels();
  const users = balancesAlreadyDone ? [] : await planUsers();

  if (problems.length > 0) {
    console.error('Refusing to run:\n  ' + problems.join('\n  '));
    process.exit(1);
  }

  say('MODELS');
  say('─'.repeat(78));
  for (const m of models) {
    const tiers = m.toTiers
      ? Object.entries(m.toTiers)
          .map(([t, v]) => `${t} ${m.fromTiers?.[t] ?? '—'}→${v}`)
          .join('  ')
      : '—';
    say(` ${m.displayName.padEnd(24)} ${String(m.fromCredits).padStart(5)} → ${String(m.toCredits).padStart(4)}   ${tiers}`);
  }

  say('\nPLANS');
  say('─'.repeat(78));
  for (const p of catalogue.plans) {
    say(` ${p.tier.padEnd(12)} $${String(p.monthlyUsd).padEnd(4)} → ${p.creditsPerPeriod} credits/30d   (yearly $${p.yearlyUsd})`);
  }

  say('\nPACKS');
  say('─'.repeat(78));
  for (const [id, credits] of Object.entries(PACKS)) say(` ${id.padEnd(14)} → ${credits} credits, no bonus`);

  say('\nGRANT POLICIES');
  say('─'.repeat(78));
  const policies = await q<{ kind: string; amount: number; is_active: boolean }>(
    `SELECT kind, amount, is_active FROM grant_policies ORDER BY kind`,
  );
  for (const p of policies) {
    const to = p.kind === 'welcome' ? WELCOME_CREDITS : Math.max(1, Math.ceil(Number(p.amount) / DIVISOR));
    say(` ${p.kind.padEnd(24)} ${String(p.amount).padStart(5)} → ${String(to).padStart(4)}${p.is_active ? '' : '   (inactive)'}`);
  }

  say('\nLEGACY MOBILE CATALOGUE (subscription_plans — what /v1/store serves)');
  say('─'.repeat(78));
  const legacy = await q<{ store_product_id: string; entitlement: string; credits_per_period: number }>(
    `SELECT store_product_id, entitlement, credits_per_period FROM subscription_plans ORDER BY display_order`,
  );
  for (const l of legacy) {
    say(
      ` ${l.store_product_id.padEnd(14)} ${l.entitlement.padEnd(10)} ${String(l.credits_per_period).padStart(6)} → ` +
        `${String(Math.max(1, Math.ceil(Number(l.credits_per_period) / DIVISOR))).padStart(5)}`,
    );
  }

  say('\nBALANCES');
  say('─'.repeat(78));
  if (balancesAlreadyDone) {
    say(' already redenominated — skipped (the catalogue above is still re-applied)');
  }
  let fromTotal = 0;
  let toTotal = 0;
  for (const u of users) {
    fromTotal += Number(u.fromBalance);
    toTotal += Number(u.toBalance);
    say(` ${u.email.padEnd(34)} ${String(u.fromBalance).padStart(6)} → ${String(u.toBalance).padStart(5)}   (${u.lots} lot${Number(u.lots) === 1 ? '' : 's'})`);
  }
  say(` ${'TOTAL'.padEnd(34)} ${String(fromTotal).padStart(6)} → ${String(toTotal).padStart(5)}`);
  if (users.length > 0) {
    say(
      `\n Rounding up gives users ${toTotal - Math.floor(fromTotal / DIVISOR)} credits more than exact division` +
        ` (~$${(((toTotal - Math.floor(fromTotal / DIVISOR)) * CREDIT_USD) / MARKUP).toFixed(2)} of provider cost).`,
    );
  }

  if (!apply) {
    say('\nDry run — nothing written. Re-run with --apply.');
    say('Take a snapshot first: pnpm tsx scripts/backup-money-tables.ts');
    process.exit(0);
  }

  await writeModels(models);
  await writeCatalogue();
  if (!balancesAlreadyDone) for (const u of users) await writeUser(u.id);

  say('\nWritten. Now, in this order:');
  say('  1. pnpm tsx scripts/verify-credit-integrity.ts     (all 7 checks must pass)');
  say('  2. pnpm tsx scripts/recompute-template-costs.ts --apply');
  say('  3. deploy jobs-worker, then the API');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
