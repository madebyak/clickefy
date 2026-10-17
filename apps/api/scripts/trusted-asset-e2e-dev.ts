/**
 * Trusted assets, end to end on the DEV branch:
 *
 *   1. generate a synthetic portrait with fal and seed it into the local
 *      uploads bucket through the internal write route;
 *   2. insert its `trusted_assets` row and fire `verify-trusted-asset` on
 *      the local worker, then watch the row go checking → verifying →
 *      verified (the composer's badge path);
 *   3. create a Seedance job that references the upload, dispatch it, and
 *      watch it complete — the worker swaps the URL for `asset://` and
 *      releases the slot when the job ends;
 *   4. print the row's final state and BytePlus's view of the library.
 *
 * Needs the local API (port 8787), a public tunnel to it (BytePlus fetches
 * the file), and the local worker started with WORKER_API_URL set to that
 * tunnel. Refuses prod.
 *
 *   DATABASE_URL=<dev> TRIGGER_SECRET_KEY=tr_dev_… INTERNAL_API_SECRET=… FAL_KEY=… \
 *     pnpm tsx scripts/trusted-asset-e2e-dev.ts [--skip-job] [--product]
 */
import { eq } from 'drizzle-orm';
import { createDb, jobs, providerModels, trustedAssets } from '@clickfy/db';
import { arkAssets, findCapabilities } from '@clickfy/providers';
import { resolveCreditCost } from '@clickfy/types';
import { createUserJobAtomically } from '../src/lib/job-create';
import { dispatchJob, triggerTask } from '../src/lib/dispatch-job';

const url = process.env.DATABASE_URL!;
const triggerKey = process.env.TRIGGER_SECRET_KEY!;
const internalSecret = process.env.INTERNAL_API_SECRET!;
const falKey = process.env.FAL_KEY!;
if (!url?.includes('ep-polished-heart')) { console.error('REFUSING: not the dev branch'); process.exit(1); }
if (!triggerKey?.startsWith('tr_dev_')) { console.error('REFUSING: not a Trigger DEV key'); process.exit(1); }
const USER_ID = '6703dee1-e723-4bdd-8e9e-42ea9969bcde';
const API = 'http://localhost:8787';
const MODEL = 'dreamina-seedance-2-5-260628';
const skipJob = process.argv.includes('--skip-job');
/** `--product`: a product shot instead of a person, to see the check say no_human. */
const productShot = process.argv.includes('--product');
const db = createDb({ connectionString: url, runtime: 'http' });
const ark = process.env.BYTEPLUS_ACCESS_KEY && process.env.BYTEPLUS_SECRET_KEY
  ? { accessKey: process.env.BYTEPLUS_ACCESS_KEY, secretKey: process.env.BYTEPLUS_SECRET_KEY, projectName: process.env.BYTEPLUS_PROJECT_NAME ?? 'default' }
  : null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function portrait(): Promise<{ bytes: ArrayBuffer; mimeType: string }> {
  const gen = await fetch('https://fal.run/fal-ai/flux/schnell', {
    method: 'POST',
    headers: { authorization: `Key ${falKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: productShot ? 'studio product photo of a glass perfume bottle on a marble surface, soft light, no people' : 'photorealistic studio portrait of a young man with short dark hair, neutral expression, front-facing, soft light, plain background', image_size: 'portrait_4_3', num_images: 1 }),
  });
  const json = (await gen.json()) as { images?: Array<{ url: string; content_type?: string }> };
  const img = json.images?.[0];
  if (!img) throw new Error(`fal: ${JSON.stringify(json).slice(0, 200)}`);
  const res = await fetch(img.url);
  return { bytes: await res.arrayBuffer(), mimeType: img.content_type ?? 'image/jpeg' };
}

async function main() {
  const t0 = Date.now();
  const { bytes, mimeType } = await portrait();
  // The internal write route only takes a few prefixes; `templates/` is
  // one, and the worker reads any key. The API's own ownership check is
  // not exercised here — this is the worker path.
  const r2Key = `templates/e2e/trusted-${Date.now()}.jpg`;
  const put = await fetch(`${API}/v1/uploads/internal/${r2Key}`, {
    method: 'PUT', headers: { 'x-internal-secret': internalSecret, 'content-type': mimeType }, body: bytes,
  });
  if (!put.ok) throw new Error(`seed upload ${put.status}: ${await put.text()}`);
  console.log(`seeded ${r2Key} (${bytes.byteLength} bytes) in ${Date.now() - t0} ms`);

  // ── composer path: row + task ────────────────────────────────────
  const [row] = await db.insert(trustedAssets).values({ userId: USER_ID, r2Key, kind: 'image', mimeType, status: 'checking' }).returning();
  const fired = await triggerTask('verify-trusted-asset', { id: row!.id }, { triggerSecretKey: triggerKey });
  if (!fired.ok) throw new Error(`trigger: ${fired.message}`);
  console.log(`verify-trusted-asset run ${fired.runId}`);
  const t1 = Date.now();
  let last = '';
  for (;;) {
    await sleep(2_000);
    const r = (await db.select().from(trustedAssets).where(eq(trustedAssets.id, row!.id)))[0]!;
    if (r.status !== last) { console.log(`  +${Math.round((Date.now() - t1) / 1000)}s ${r.status}${r.byteplusAssetId ? ' ' + r.byteplusAssetId : ''}${r.error ? ' · ' + r.error : ''}`); last = r.status; }
    if (r.status === 'verified' || r.status === 'failed' || r.status === 'no_human') {
      console.log(`  human=${r.human} model=${r.checkModel} reason="${r.checkReason}"`);
      if (r.status !== 'verified') { console.log('stopping: not verified'); return; }
      break;
    }
    if (Date.now() - t1 > 5 * 60_000) throw new Error('verification timeout');
  }
  if (skipJob) return;

  // ── generation path ──────────────────────────────────────────────
  const caps = findCapabilities(MODEL)!;
  const priced = (await db.select().from(providerModels).where(eq(providerModels.modelKey, MODEL)))[0]!;
  const cost = resolveCreditCost({ baseCredits: priced.costCredits, tierPricing: priced.tierPricing ?? null, mode: '480p', sound: false, duration: 4, defaultDuration: caps.duration?.default });
  const created = await createUserJobAtomically(db, {
    userId: USER_ID,
    cost,
    modelKey: MODEL,
    inputs: {
      prompt: { kind: 'text', value: 'The man in Image 1 smiles and nods at the camera, soft studio light.' },
      ref_0: { kind: 'image', r2Key, mimeType, sizeBytes: bytes.byteLength },
    },
    options: { aspectRatio: '9:16', duration: 4, sound: false, mode: '480p' },
    idempotencyKey: null,
    origin: 'create',
  });
  if (!created) throw new Error('job create returned null (balance?)');
  const dispatch = await dispatchJob({ jobId: created.jobId, triggerSecretKey: triggerKey });
  console.log(`\njob ${created.jobId} cost ${cost} ${dispatch.ok ? 'dispatched ' + dispatch.runId : 'DISPATCH FAILED ' + dispatch.message}`);
  if (!dispatch.ok) return;
  await db.update(jobs).set({ triggerRunId: dispatch.runId }).where(eq(jobs.id, created.jobId));
  const t2 = Date.now();
  for (;;) {
    await sleep(10_000);
    const j = (await db.select().from(jobs).where(eq(jobs.id, created.jobId)))[0]!;
    if (j.status === 'completed' || j.status === 'failed') {
      const r = j.result as { videos?: Array<{ streamId: string; durationSec: number }> } | null;
      console.log(`\n${j.status} in ${Math.round((Date.now() - t2) / 1000)} s · cost $${j.providerCostUsd} (${j.costBasis})`);
      if (j.status === 'completed') console.log(`video ${r?.videos?.[0]?.streamId} ${r?.videos?.[0]?.durationSec}s`);
      else console.log(JSON.stringify(j.error));
      break;
    }
    if (Date.now() - t2 > 20 * 60_000) { console.log('timeout'); return; }
  }
  await sleep(3_000);
  const final = (await db.select().from(trustedAssets).where(eq(trustedAssets.id, row!.id)))[0]!;
  console.log(`\nrow after job: status=${final.status} assetId=${final.byteplusAssetId} releasedAt=${final.releasedAt?.toISOString()}`);
  if (ark) {
    const list = await arkAssets.listAssets(ark, { groupType: 'AIGC' });
    console.log(`BytePlus library now holds ${(list.Items ?? []).length} asset(s)`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
