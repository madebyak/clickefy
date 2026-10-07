/**
 * One-Click Ad, end to end on the DEV branch: fetch an already-uploaded
 * product image through the local API, write the Seedance prompt with
 * the real writer, create the job the way the route does, dispatch it to
 * the local worker, and print the result. Refuses prod.
 *
 * Needs the local API (port 8787) and the local worker running.
 *   DATABASE_URL=<dev> TRIGGER_SECRET_KEY=tr_dev_… GEMINI_API_KEY=… \
 *     pnpm tsx scripts/ad-e2e-dev.ts <uploads r2Key> [notes]
 */
import { eq } from 'drizzle-orm';
import { createDb, jobs, providerModels } from '@clickfy/db';
import { AD_ASPECT_RATIO, AD_DURATION_SECONDS, AD_SCRIPT_CREDITS, TOOL_MODELS, findCapabilities } from '@clickfy/providers';
import { resolveCreditCost } from '@clickfy/types';
import { createUserJobAtomically } from '../src/lib/job-create';
import { dispatchJob } from '../src/lib/dispatch-job';
import { writeAdPrompt } from '../src/lib/ad-writer';

const url = process.env.DATABASE_URL!;
const triggerKey = process.env.TRIGGER_SECRET_KEY!;
const gemini = process.env.GEMINI_API_KEY!;
if (!url?.includes('ep-polished-heart')) { console.error('REFUSING: not the dev branch'); process.exit(1); }
if (!triggerKey?.startsWith('tr_dev_')) { console.error('REFUSING: not a Trigger DEV key'); process.exit(1); }
const USER_ID = '6703dee1-e723-4bdd-8e9e-42ea9969bcde';
const r2Key = process.argv[2]!;
const notes = process.argv[3];
if (!r2Key) { console.error('usage: <r2Key> [notes]'); process.exit(1); }
const db = createDb({ connectionString: url, runtime: 'http' });

async function main() {
  const res = await fetch(`http://localhost:8787/v1/uploads/${r2Key}`);
  if (!res.ok) throw new Error(`image fetch ${res.status}`);
  const bytes = await res.arrayBuffer();
  const mimeType = res.headers.get('content-type') ?? 'image/jpeg';
  console.log(`image ${r2Key} ${mimeType} ${bytes.byteLength} bytes`);

  const t0 = Date.now();
  const { prompt, writer } = await writeAdPrompt({ apiKey: gemini, images: [{ bytes, mimeType }], notes });
  console.log(`\nwriter ${writer} in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${prompt.length} chars, ${prompt.split(/\s+/).length} words\n`);
  console.log(prompt);

  const { modelKey, quality } = TOOL_MODELS.ad;
  const caps = findCapabilities(modelKey)!;
  const row = (await db.select().from(providerModels).where(eq(providerModels.modelKey, modelKey)))[0]!;
  const video = resolveCreditCost({ baseCredits: row.costCredits, tierPricing: row.tierPricing ?? null, mode: quality, sound: true, duration: AD_DURATION_SECONDS, defaultDuration: caps.duration?.default });
  const cost = video + AD_SCRIPT_CREDITS;
  const result = await createUserJobAtomically(db, {
    userId: USER_ID,
    cost,
    modelKey,
    inputs: { prompt: { kind: 'text', value: prompt }, ref_0: { kind: 'image', r2Key, mimeType, sizeBytes: bytes.byteLength } },
    options: { aspectRatio: AD_ASPECT_RATIO.reels, duration: AD_DURATION_SECONDS, sound: true, mode: quality, tool: { kind: 'ad', orientation: 'reels', notes, writer } },
    idempotencyKey: null,
    origin: 'tool',
  });
  if (!result) throw new Error('job create returned null (balance?)');
  const dispatch = await dispatchJob({ jobId: result.jobId, triggerSecretKey: triggerKey });
  console.log(`\njob ${result.jobId} cost ${cost} (video ${video} + script ${AD_SCRIPT_CREDITS}) ${dispatch.ok ? 'dispatched ' + dispatch.runId : 'DISPATCH FAILED ' + dispatch.message}`);
  if (!dispatch.ok) return;
  await db.update(jobs).set({ triggerRunId: dispatch.runId }).where(eq(jobs.id, result.jobId));
  const started = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 10_000));
    const j = (await db.select().from(jobs).where(eq(jobs.id, result.jobId)))[0]!;
    if (j.status === 'completed' || j.status === 'failed') {
      const r = j.result as { videos?: Array<{ streamId: string; durationSec: number }> } | null;
      console.log(`\n${j.status} in ${Math.round((Date.now() - started) / 1000)} s · cost $${j.providerCostUsd} (${j.costBasis}) units ${JSON.stringify(j.providerBilledUnits)}`);
      if (j.status === 'completed') console.log(`video ${r?.videos?.[0]?.streamId} ${r?.videos?.[0]?.durationSec}s`);
      else console.log(JSON.stringify(j.error));
      return;
    }
    if (Date.now() - started > 20 * 60_000) { console.log('timeout'); return; }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
