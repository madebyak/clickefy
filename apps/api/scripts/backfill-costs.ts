/**
 * Back-fill provider cost onto historic jobs, and payments from Stripe events.
 *
 * JOBS — every row whose `provider_cost_usd` is NULL gets the four cost
 * columns from today's rate card (`@clickfy/types/provider-cost`) and the
 * facts the row kept: model, tier, duration, source-clip length, sound,
 * references, the produced clip's length, and for failures whether the
 * provider was reached. Basis is always `estimated`: the September
 * repricing means pre-17-Sept jobs ran on older rates we no longer hold
 * (founder's decision 2026-10-04: one price book, flagged).
 *
 *   create / tool jobs: one stage, from `jobs.options`
 *   template jobs:      one stage per snapshot stage, from `stage.config`
 *
 * PAYMENTS — one row per `invoice.paid` (amount_paid) and per payment-mode
 * `checkout.session.completed` (amount_total) in `stripe_events`, keyed by
 * the Stripe object id so a re-run inserts nothing twice. Refunds already
 * on the charge are applied where the event's payment intent matches.
 *
 * Dry run by default; `--apply` writes. Works on dev and prod.
 *
 * Usage (from apps/api):
 *   DATABASE_URL=… pnpm tsx scripts/backfill-costs.ts [--apply] [--jobs|--payments]
 */

import { and, eq, isNull, sql } from 'drizzle-orm';

import { createDb, jobs, payments, providerModels, stripeEvents, templateVersions } from '@clickfy/db';
import { findCapabilities, failedStageCost, stageCost, summariseJobCost, registerDynamicCapabilities, type StageCost } from '@clickfy/providers';

import { falModelCapabilitiesSchema, toModelCapabilities } from '../src/lib/fal-model-schema';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }
const apply = process.argv.includes('--apply');
const onlyJobs = process.argv.includes('--jobs');
const onlyPayments = process.argv.includes('--payments');
const db = createDb({ connectionString: url, runtime: 'http' });

type Opts = {
  mode?: string; duration?: number; sound?: boolean; inputVideoSeconds?: number; sourceSeconds?: number;
  aspectRatio?: string; task?: string; upscale?: { fps?: number; tier?: string };
};

async function backfillJobs() {
  // Dynamic fal models must be registered for their capabilities.
  const rows = await db.select().from(providerModels);
  registerDynamicCapabilities(
    rows
      .filter((r) => r.provider === 'fal' && r.capabilities && 'fal' in r.capabilities)
      .map((r) => falModelCapabilitiesSchema.safeParse({ ...r.capabilities, modelKey: r.modelKey, displayName: r.displayName, status: r.status }))
      .filter((p) => p.success)
      .map((p) => toModelCapabilities(p.data)),
  );
  const fallbackUsd = new Map(rows.map((r) => [r.modelKey, Number(r.costPerCallUsd)]));
  const providerOf = new Map(rows.map((r) => [r.modelKey, r.provider as string]));

  const pending = await db
    .select({
      id: jobs.id, source: jobs.source, modelKey: jobs.modelKey, status: jobs.status, options: jobs.options,
      inputs: jobs.inputs, result: jobs.result, error: jobs.error, templateVersionId: jobs.templateVersionId,
    })
    .from(jobs)
    .where(and(isNull(jobs.providerCostUsd), sql`${jobs.status} IN ('completed','failed')`));
  console.log(`jobs to back-fill: ${pending.length}`);

  const snapshots = new Map<string, Array<{ provider: string; model: string; config?: Record<string, unknown> }>>();
  let written = 0, unpriced = 0, totalUsd = 0;
  const byModel = new Map<string, { n: number; usd: number }>();

  for (const j of pending) {
    const inputs = (j.inputs ?? {}) as Record<string, { kind?: string }>;
    const references = Object.values(inputs).filter((v) => v && v.kind !== 'text').length;
    const result = (j.result ?? null) as { images?: unknown[]; videos?: Array<{ durationSec?: number }> } | null;
    const error = (j.error ?? null) as { code?: string; reason?: string; stage?: number } | null;
    const failed = j.status === 'failed';
    const outputs = (result?.images?.length ?? 0) + (result?.videos?.length ?? 0);
    const outputDurationSec = result?.videos?.[0]?.durationSec ?? null;

    // Stages: one from options, or the template snapshot's list.
    let stages: Array<{ modelKey: string; provider: string; config: Opts }> = [];
    if (j.source === 'user' && j.modelKey) {
      const o = (j.options ?? {}) as Opts;
      stages = [{ modelKey: j.modelKey, provider: providerOf.get(j.modelKey) ?? findCapabilities(j.modelKey)?.provider ?? 'unknown', config: o }];
    } else if (j.templateVersionId) {
      let snap = snapshots.get(j.templateVersionId);
      if (!snap) {
        const v = await db.query.templateVersions.findFirst({ where: eq(templateVersions.id, j.templateVersionId) });
        const s = (v?.snapshot ?? {}) as { generation?: { stages?: Array<{ provider: string; model: string; config?: Record<string, unknown> }> } };
        snap = s.generation?.stages ?? [];
        snapshots.set(j.templateVersionId, snap);
      }
      stages = snap.map((s) => ({
        modelKey: s.model, provider: s.provider,
        config: { mode: (s.config?.mode ?? s.config?.resolution) as string | undefined, duration: s.config?.duration as number | undefined, sound: s.config?.sound === true || s.config?.sound === 'on' },
      }));
    }
    if (stages.length === 0) { unpriced++; continue; }

    const costs: StageCost[] = [];
    stages.forEach((s, i) => {
      const caps = findCapabilities(s.modelKey);
      const facts = {
        modelKey: s.modelKey, provider: s.provider,
        mode: s.config.mode ?? null,
        durationSeconds: s.config.duration ?? null,
        inputVideoSeconds: s.config.inputVideoSeconds ?? s.config.sourceSeconds ?? null,
        sound: s.config.sound === true,
        aspectRatio: s.config.aspectRatio ?? null,
        upscale: s.config.upscale ?? null,
        references,
        outputs: stages.length === 1 ? Math.max(1, outputs) : 1,
        outputDurationSec: stages.length === 1 ? outputDurationSec : null,
        fallbackUsdPerCall: fallbackUsd.get(s.modelKey) ?? null,
      };
      const failingStage = failed && (error?.stage ?? stages.length) === i + 1;
      const c = failed && (failingStage || i + 1 > (error?.stage ?? 0))
        ? failedStageCost(i + 1, facts, caps, {
            // A provider_error / provider_timeout means the adapter ran; anything else never reached it.
            reachedProvider: failingStage && (error?.code === 'provider_error' || error?.code === 'provider_timeout'),
            reason: error?.reason ?? null,
            errorCode: error?.code ?? null,
          })
        : stageCost(i + 1, facts, caps);
      if (c) costs.push(c);
    });
    if (costs.length === 0) { unpriced++; continue; }

    const summary = summariseJobCost(costs, 'estimated');
    totalUsd += summary.usd;
    const key = stages[0]!.modelKey;
    const agg = byModel.get(key) ?? { n: 0, usd: 0 };
    agg.n++; agg.usd += summary.usd; byModel.set(key, agg);

    if (apply) {
      const requestIds = (result as { providerTaskId?: string } | null)?.providerTaskId ? [(result as { providerTaskId: string }).providerTaskId] : null;
      await db.update(jobs).set({
        provider: stages[0]!.provider,
        providerCostUsd: summary.usd.toFixed(5),
        providerBilledUnits: summary.units,
        providerRequestIds: requestIds,
        costBasis: 'estimated',
      }).where(and(eq(jobs.id, j.id), isNull(jobs.providerCostUsd)));
      written++;
    }
  }
  console.log(`priced: ${pending.length - unpriced}, unpriced: ${unpriced}, total estimated cost $${totalUsd.toFixed(2)}${apply ? `, written ${written}` : ' (dry run)'}`);
  for (const [k, v] of [...byModel.entries()].sort((a, b) => b[1].usd - a[1].usd).slice(0, 12)) {
    console.log(`  ${k.padEnd(36)} ${String(v.n).padStart(5)} jobs  $${v.usd.toFixed(2)}`);
  }
}

async function backfillPayments() {
  const events = await db
    .select({ eventType: stripeEvents.eventType, userId: stripeEvents.userId, payload: stripeEvents.payload, created: stripeEvents.eventCreatedAt })
    .from(stripeEvents)
    .where(sql`${stripeEvents.eventType} IN ('invoice.paid','checkout.session.completed','charge.refunded')`);
  let inserted = 0, skipped = 0, refunds = 0;
  for (const e of events) {
    const obj = ((e.payload as { data?: { object?: Record<string, unknown> } })?.data?.object ?? {}) as Record<string, unknown>;
    if (e.eventType === 'invoice.paid') {
      const amount = typeof obj.amount_paid === 'number' ? obj.amount_paid : 0;
      const lines = (obj.lines as { data?: Array<{ pricing?: { price_details?: { price?: string } }; price?: { id?: string } }> } | undefined)?.data ?? [];
      const priceId = lines[0]?.pricing?.price_details?.price ?? lines[0]?.price?.id ?? null;
      const paidAt = (obj.status_transitions as { paid_at?: number } | undefined)?.paid_at ?? (obj.created as number | undefined);
      if (!apply) { inserted++; continue; }
      const r = await db.insert(payments).values({
        userId: e.userId, platform: 'stripe', kind: 'subscription', externalId: String(obj.id), paymentIntentId: null,
        amountCents: amount, currency: String(obj.currency ?? 'usd'), creditsGranted: null, productRef: priceId,
        occurredAt: new Date((paidAt ?? Math.floor(e.created.getTime() / 1000)) * 1000),
      }).onConflictDoNothing({ target: [payments.platform, payments.externalId] }).returning({ id: payments.id });
      r.length ? inserted++ : skipped++;
    } else if (e.eventType === 'checkout.session.completed') {
      if (obj.mode !== 'payment') continue;
      const amount = typeof obj.amount_total === 'number' ? obj.amount_total : 0;
      const meta = (obj.metadata ?? {}) as Record<string, string>;
      if (!apply) { inserted++; continue; }
      const r = await db.insert(payments).values({
        userId: e.userId, platform: 'stripe', kind: 'pack', externalId: String(obj.id),
        paymentIntentId: typeof obj.payment_intent === 'string' ? obj.payment_intent : null,
        amountCents: amount, currency: String(obj.currency ?? 'usd'), creditsGranted: null, productRef: meta.clickefy_pack_id ?? null,
        occurredAt: e.created,
      }).onConflictDoNothing({ target: [payments.platform, payments.externalId] }).returning({ id: payments.id });
      r.length ? inserted++ : skipped++;
    } else if (e.eventType === 'charge.refunded') {
      const pi = typeof obj.payment_intent === 'string' ? obj.payment_intent : null;
      const refunded = typeof obj.amount_refunded === 'number' ? obj.amount_refunded : 0;
      if (pi && refunded > 0 && apply) {
        await db.update(payments).set({ amountRefundedCents: refunded }).where(eq(payments.paymentIntentId, pi));
      }
      refunds++;
    }
  }
  console.log(`payments: ${inserted} ${apply ? 'inserted' : 'would insert'}, ${skipped} already present, ${refunds} refund event(s) seen`);
}

async function main() {
  console.log(`\n${apply ? 'APPLYING' : 'DRY RUN'} — ${new URL(url!).host}\n`);
  if (!onlyPayments) await backfillJobs();
  if (!onlyJobs) await backfillPayments();
}
main().catch((e) => { console.error(e); process.exit(1); });
