/**
 * Script-driven smoke tests — the admin button's twin, for the DEV branch.
 *
 * Creates one prompt-only job per model through the same atomic
 * job-create statement and Trigger dispatch the API route uses, waits
 * for each to finish, and prints the outcome. Refuses any database that
 * is not the dev branch, and tops the fixture user up with promo credits
 * so the tests never fail on balance.
 *
 * Needs a local worker running against the SAME dev database and a
 * Trigger DEV key (`.dev.vars`):
 *   apps/jobs-worker:  npx trigger.dev@4.4.6 dev --env-file .env.dev
 *
 * Usage (from apps/api):
 *   DATABASE_URL=<dev> TRIGGER_SECRET_KEY=tr_dev_… pnpm tsx scripts/smoke-test-models.ts [modelKey …]
 */

import { eq, sql } from 'drizzle-orm';

import { createDb, jobs, providerModels, users } from '@clickfy/db';
import { findCapabilities, aspectRatiosFor, registerDynamicCapabilities } from '@clickfy/providers';
import { resolveCreditCost } from '@clickfy/types';

import { createUserJobAtomically } from '../src/lib/job-create';
import { grantCredits } from '../src/lib/credit-grants';
import { dispatchJob } from '../src/lib/dispatch-job';
import { falModelCapabilitiesSchema, toModelCapabilities } from '../src/lib/fal-model-schema';

const url = process.env.DATABASE_URL!;
const triggerKey = process.env.TRIGGER_SECRET_KEY!;
if (!url?.includes('ep-polished-heart')) { console.error('REFUSING: not the dev branch'); process.exit(1); }
if (!triggerKey?.startsWith('tr_dev_')) { console.error('REFUSING: not a Trigger DEV key'); process.exit(1); }

const USER_ID = '6703dee1-e723-4bdd-8e9e-42ea9969bcde'; // webtest fixture (dev)
const PROMPT = 'A small red marble rolls slowly across a sunlit wooden table and stops beside a green apple. Soft daylight, shallow depth of field.';
const db = createDb({ connectionString: url, runtime: 'http' });

async function main() {
  const wanted = process.argv.slice(2);
  const rows = await db.select().from(providerModels);
  const dynamic = rows
    .filter((r) => r.provider === 'fal' && r.capabilities && 'fal' in r.capabilities)
    .map((r) => falModelCapabilitiesSchema.safeParse({ ...r.capabilities, modelKey: r.modelKey, displayName: r.displayName, status: r.status }))
    .filter((p) => p.success)
    .map((p) => toModelCapabilities(p.data));
  registerDynamicCapabilities(dynamic);

  const targets = (wanted.length ? wanted : ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'gemini-omni-1-1-flash', 'wan-3-0', 'flux-3-image', 'flux-3-video', 'h3-max']);

  // Enough credits for every test, on the fixture only — through the real
  // grant path, so a LOT backs the bucket (the allocator spends lots, and
  // a bucket bumped by hand with no lot behind it allocates nothing).
  // First put the fixture's buckets back in step with its lots (dev only).
  // One statement: the CHECK `balance = promo + sub + topup` holds per row write.
  await db.execute(sql`
    WITH lots AS (
      SELECT
        COALESCE(sum(amount_remaining) FILTER (WHERE class = 'promo'), 0)::int AS p,
        COALESCE(sum(amount_remaining) FILTER (WHERE class = 'subscription'), 0)::int AS s,
        COALESCE(sum(amount_remaining) FILTER (WHERE class = 'topup'), 0)::int AS t
      FROM credit_lots WHERE user_id = ${USER_ID}::uuid AND (expires_at IS NULL OR expires_at > now())
    )
    UPDATE users u SET promo_credits = lots.p, subscription_credits = lots.s, topup_credits = lots.t,
                       credits_balance = lots.p + lots.s + lots.t
    FROM lots WHERE u.id = ${USER_ID}::uuid`);
  await grantCredits(db, {
    userId: USER_ID,
    class: 'promo',
    kind: 'admin',
    amount: 500,
    reason: 'admin_adjust',
    sourcePlatform: 'admin',
    sourceRef: `smoke-test:${Date.now()}`,
    note: 'smoke-test top-up (dev)',
    metadata: { smokeTest: true },
  });

  const created: Array<{ modelKey: string; jobId: string }> = [];
  for (const modelKey of targets) {
    const caps = findCapabilities(modelKey);
    const row = rows.find((r) => r.modelKey === modelKey);
    if (!caps || !row) { console.log(`✗ ${modelKey}: not registered / no row`); continue; }
    const mode = caps.modes?.default;
    const cost = resolveCreditCost({
      baseCredits: row.costCredits,
      tierPricing: row.tierPricing ?? null,
      mode,
      duration: caps.kind === 'video' ? caps.duration?.default : undefined,
      defaultDuration: caps.kind === 'video' ? caps.duration?.default : undefined,
    });
    const options: Record<string, unknown> = {
      aspectRatio: aspectRatiosFor(caps)[0],
      ...(mode ? { mode } : {}),
      ...(caps.kind === 'video' && caps.duration ? { duration: caps.duration.default } : {}),
    };
    const result = await createUserJobAtomically(db, {
      userId: USER_ID,
      cost,
      modelKey,
      inputs: { prompt: { kind: 'text', value: PROMPT } },
      options,
      idempotencyKey: null,
      origin: 'create',
    });
    if (!result) { console.log(`✗ ${modelKey}: job create returned null (balance?)`); continue; }
    const dispatch = await dispatchJob({ jobId: result.jobId, triggerSecretKey: triggerKey });
    console.log(`→ ${modelKey.padEnd(24)} job ${result.jobId} cost ${cost} ${dispatch.ok ? 'dispatched ' + dispatch.runId : 'DISPATCH FAILED ' + dispatch.message}`);
    if (dispatch.ok) {
      await db.update(jobs).set({ triggerRunId: dispatch.runId }).where(eq(jobs.id, result.jobId));
      created.push({ modelKey, jobId: result.jobId });
    }
  }

  // Wait for all to reach a terminal state (up to 20 minutes).
  const deadline = Date.now() + 20 * 60 * 1000;
  const pending = new Set(created.map((c) => c.jobId));
  while (pending.size && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10_000));
    for (const { modelKey, jobId } of created) {
      if (!pending.has(jobId)) continue;
      const j = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
      if (!j) continue;
      if (j.status === 'completed' || j.status === 'failed') {
        pending.delete(jobId);
        const res = j.result as { images?: unknown[]; videos?: Array<{ durationSec?: number }> } | null;
        const err = j.error as { code?: string; message?: string } | null;
        const took = j.completedAt && j.startedAt ? Math.round((j.completedAt.getTime() - j.startedAt.getTime()) / 1000) : null;
        console.log(`${j.status === 'completed' ? '✓' : '✗'} ${modelKey.padEnd(24)} ${j.status}${took != null ? ` in ${took}s` : ''} ${j.status === 'completed' ? `images ${res?.images?.length ?? 0} videos ${res?.videos?.length ?? 0}${res?.videos?.[0]?.durationSec ? ` (${res.videos[0].durationSec}s)` : ''}` : `${err?.code}: ${err?.message?.slice(0, 160)}`}`);
      }
    }
  }
  if (pending.size) console.log(`timed out waiting for ${pending.size} job(s)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
