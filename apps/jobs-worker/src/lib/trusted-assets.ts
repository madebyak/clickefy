/**
 * Trusted assets — getting attachments that show a person past Seedance.
 *
 * Seedance 2.0 / 2.5 reject any reference image or clip with a human
 * face. BytePlus's private asset library accepts AI-generated people once
 * a file is registered there, and the generation then names
 * `asset://<id>` instead of the file's URL. This module owns that
 * registration end to end:
 *
 *   1. a Gemini vision model decides whether the file shows a person
 *      (cached per file and per content hash, so nothing is asked twice);
 *   2. files with a person are registered (`CreateAsset`) and polled until
 *      BytePlus marks them `Active`;
 *   3. slots are given back: the free tier holds 50 assets in TOTAL and
 *      takes 3 uploads a minute, so an asset is released the moment its
 *      job ends, anything idle for half an hour is swept, and a near-full
 *      library evicts its oldest idle asset before registering a new one.
 *
 * The row in `trusted_assets` is the record; BytePlus is a cache of it.
 * A released row keeps the person verdict and is re-registered on demand.
 */

import { logger } from '@trigger.dev/sdk';
import { and, asc, eq, inArray, isNotNull, lt, ne, or, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';

import { trustedAssets, type TrustedAsset, type TrustedAssetStatus } from '@clickfy/db';
import {
  ArkApiError,
  arkAssetTypeFor,
  arkAssetUri,
  arkAssets,
  detectHuman,
  isArkRateLimited,
  type ArkAssetsEnv,
  type RuntimeInputValue,
} from '@clickfy/providers';

import { env } from '../env';
import { getDb } from './db';
import { readUploadObject } from './r2';

/** One group holds every asset; groups are capped at 50 too, so per-user groups would not scale. */
const GROUP_NAME = 'clickefy-trusted';
/** The free Entry tier's library size. */
export const LIBRARY_CAPACITY = 50;
/** Start evicting idle assets before the hard ceiling so a burst never fails on capacity. */
const SOFT_CAPACITY = 45;
/** An asset nobody used for this long is given back by the sweeper. Longer than any job can run. */
export const IDLE_RELEASE_MINUTES = 30;
/** Assets touched this recently belong to a job in flight and are never evicted. */
const IN_FLIGHT_GRACE_MINUTES = 10;
/** 3 uploads a minute on the free tier: wait this long when BytePlus says no. */
const RATE_LIMIT_WAIT_MS = 21_000;
const RATE_LIMIT_ATTEMPTS = 6;
/** How long to wait for BytePlus's review; images answer in seconds, clips in minutes. */
const REVIEW_BUDGET_MS: Record<'image' | 'video' | 'audio', number> = {
  image: 2 * 60_000,
  video: 8 * 60_000,
  audio: 3 * 60_000,
};

const ALIVE: TrustedAssetStatus[] = ['verifying', 'verified'];

export function arkEnv(): ArkAssetsEnv | null {
  if (!env.BYTEPLUS_ACCESS_KEY || !env.BYTEPLUS_SECRET_KEY) return null;
  return {
    accessKey: env.BYTEPLUS_ACCESS_KEY,
    secretKey: env.BYTEPLUS_SECRET_KEY,
    projectName: env.BYTEPLUS_PROJECT_NAME ?? 'default',
  };
}

/** Both keys present: the person check needs Gemini, the registration needs BytePlus. */
export function trustedAssetsEnabled(): boolean {
  return arkEnv() !== null && !!env.GEMINI_API_KEY;
}

function publicUrlForR2(r2Key: string): string {
  return `${env.WORKER_API_URL.replace(/\/$/, '')}/v1/uploads/${r2Key}`;
}

let cachedGroupId: string | null = null;

/** The one asset group we register into; created on first use. */
async function ensureGroup(ark: ArkAssetsEnv): Promise<string> {
  if (cachedGroupId) return cachedGroupId;
  const list = await arkAssets.listAssetGroups(ark, { groupType: 'AIGC', name: GROUP_NAME });
  const found = (list.Items ?? []).find((g) => g.Name === GROUP_NAME);
  if (found) {
    cachedGroupId = found.Id;
    return found.Id;
  }
  const created = await arkAssets.createAssetGroup(ark, {
    name: GROUP_NAME,
    description: 'Clickefy attachments verified for Seedance. Managed automatically; assets are short-lived.',
  });
  cachedGroupId = created.Id;
  logger.info('trusted-assets:group-created', { groupId: created.Id });
  return created.Id;
}

async function setRow(id: string, patch: Partial<typeof trustedAssets.$inferInsert>): Promise<TrustedAsset> {
  const [row] = await getDb()
    .update(trustedAssets)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(trustedAssets.id, id))
    .returning();
  if (!row) throw new Error(`trusted asset ${id} vanished`);
  return row;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Register on BytePlus with the free tier's rate limit in mind: a refusal
 * waits out the minute window and tries again, up to a bounded number of
 * times, instead of failing the attachment.
 */
async function createAssetWithBackoff(
  ark: ArkAssetsEnv,
  args: { groupId: string; url: string; assetType: 'Image' | 'Video' | 'Audio'; name: string },
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= RATE_LIMIT_ATTEMPTS; attempt++) {
    try {
      const created = await arkAssets.createAsset(ark, args);
      return created.Id;
    } catch (err) {
      lastErr = err;
      if (!isArkRateLimited(err) || attempt === RATE_LIMIT_ATTEMPTS) throw err;
      logger.warn('trusted-assets:rate-limited', { attempt, waitMs: RATE_LIMIT_WAIT_MS });
      await new Promise((r) => setTimeout(r, RATE_LIMIT_WAIT_MS));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Rows holding a BytePlus slot right now. */
async function aliveRows(): Promise<TrustedAsset[]> {
  return getDb().query.trustedAssets.findMany({
    where: and(isNotNull(trustedAssets.byteplusAssetId), inArray(trustedAssets.status, ALIVE)),
    orderBy: [asc(trustedAssets.lastUsedAt), asc(trustedAssets.createdAt)],
  });
}

/**
 * Make room before a registration. The library has no monthly reset, so
 * the only way to stay under 50 is to give slots back: evict the oldest
 * assets that no job has touched in the last few minutes until the count
 * is below the soft ceiling. Assets in flight are never evicted; when the
 * library is genuinely full of running jobs the registration fails and
 * the caller falls back to the plain URL.
 */
export async function ensureCapacity(ark: ArkAssetsEnv): Promise<void> {
  const alive = await aliveRows();
  if (alive.length < SOFT_CAPACITY) return;
  const grace = Date.now() - IN_FLIGHT_GRACE_MINUTES * 60_000;
  const idle = alive.filter((r) => (r.lastUsedAt ?? r.createdAt).getTime() < grace);
  const toFree = alive.length - SOFT_CAPACITY + 1;
  for (const row of idle.slice(0, toFree)) {
    await releaseTrustedAsset(ark, row, 'capacity');
  }
  if (idle.length < toFree) {
    logger.warn('trusted-assets:library-full', { alive: alive.length, idle: idle.length });
  }
}

/** Delete the BytePlus asset and keep the row, so the person verdict survives. */
export async function releaseTrustedAsset(ark: ArkAssetsEnv, row: TrustedAsset, why: string): Promise<void> {
  if (row.byteplusAssetId) {
    try {
      await arkAssets.deleteAsset(ark, row.byteplusAssetId);
    } catch (err) {
      // Already gone is the outcome we wanted; anything else is logged and
      // the sweeper's reconciliation catches a stray.
      if (!(err instanceof ArkApiError && /NotFound/i.test(err.code))) {
        logger.warn('trusted-assets:delete-failed', { id: row.id, assetId: row.byteplusAssetId, err: String(err) });
        return;
      }
    }
  }
  await setRow(row.id, { status: 'released', byteplusAssetId: null, releasedAt: new Date() });
  logger.info('trusted-assets:released', { id: row.id, why });
}

/**
 * The whole pipeline for one row: person check (cached), registration,
 * review. Returns the row in its final state; never throws for a verdict
 * (`failed` is a state), only for our own misconfiguration.
 */
export async function verifyTrustedAsset(id: string): Promise<TrustedAsset> {
  const db = getDb();
  let row = await db.query.trustedAssets.findFirst({ where: eq(trustedAssets.id, id) });
  if (!row) throw new Error(`trusted asset ${id} not found`);
  const ark = arkEnv();
  if (!ark || !env.GEMINI_API_KEY) {
    return setRow(id, { status: 'failed', error: 'Verification is not configured on this worker.' });
  }
  if (row.status === 'verified' && row.byteplusAssetId) return row;
  if (row.status === 'no_human') return row;

  // ── 1. Bytes and the person verdict ──────────────────────────────
  let bytes: Uint8Array;
  let mimeType: string;
  try {
    const obj = await readUploadObject(row.r2Key);
    bytes = obj.bytes;
    mimeType = obj.mimeType || row.mimeType || 'application/octet-stream';
  } catch (err) {
    return setRow(id, { status: 'failed', error: 'The upload could not be read.' , checkReason: String(err).slice(0, 200) });
  }
  const sha = sha256(bytes);
  if (row.human === null) {
    const twin = await db.query.trustedAssets.findFirst({
      where: and(eq(trustedAssets.contentSha256, sha), isNotNull(trustedAssets.human), ne(trustedAssets.id, id)),
    });
    if (twin) {
      row = await setRow(id, { contentSha256: sha, mimeType, human: twin.human, checkModel: twin.checkModel, checkReason: twin.checkReason });
    } else {
      try {
        const verdict = await detectHuman({ apiKey: env.GEMINI_API_KEY, bytes, mimeType });
        row = await setRow(id, { contentSha256: sha, mimeType, human: verdict.human, checkModel: verdict.model, checkReason: verdict.reason });
      } catch (err) {
        logger.warn('trusted-assets:check-failed', { id, err: String(err) });
        return setRow(id, { contentSha256: sha, mimeType, status: 'failed', error: 'Could not inspect the file. Try again.' });
      }
    }
  }
  if (row.human === false) {
    return setRow(id, { status: 'no_human', error: null });
  }

  // ── 2. Registration ──────────────────────────────────────────────
  if (!row.byteplusAssetId) {
    try {
      const groupId = await ensureGroup(ark);
      await ensureCapacity(ark);
      const assetId = await createAssetWithBackoff(ark, {
        groupId,
        url: publicUrlForR2(row.r2Key),
        assetType: arkAssetTypeFor(row.kind),
        name: row.id,
      });
      row = await setRow(id, { status: 'verifying', byteplusGroupId: groupId, byteplusAssetId: assetId, error: null, lastUsedAt: new Date() });
    } catch (err) {
      logger.warn('trusted-assets:register-failed', { id, err: String(err) });
      const message = err instanceof ArkApiError ? `BytePlus refused the file (${err.code}).` : 'Could not register the file. Try again.';
      return setRow(id, { status: 'failed', error: message });
    }
  }

  // ── 3. Review ────────────────────────────────────────────────────
  const assetId = row.byteplusAssetId!;
  const deadline = Date.now() + REVIEW_BUDGET_MS[row.kind];
  let delay = 1_500;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 10_000);
    let asset;
    try {
      asset = await arkAssets.getAsset(ark, assetId);
    } catch (err) {
      logger.warn('trusted-assets:poll-error', { id, err: String(err) });
      continue;
    }
    if (asset.Status === 'Active') {
      return setRow(id, { status: 'verified', verifiedAt: new Date(), lastUsedAt: new Date(), error: null });
    }
    if (asset.Status === 'Failed') {
      const why = asset.FailReason ?? asset.Message ?? 'BytePlus did not accept this file.';
      // A failed asset still occupies a slot; give it back right away.
      try {
        await arkAssets.deleteAsset(ark, assetId);
      } catch {
        /* reconciled by the sweeper */
      }
      return setRow(id, { status: 'failed', byteplusAssetId: null, error: why.slice(0, 300) });
    }
  }
  try {
    await arkAssets.deleteAsset(ark, assetId);
  } catch {
    /* reconciled by the sweeper */
  }
  return setRow(id, { status: 'failed', byteplusAssetId: null, error: 'BytePlus took too long to review the file. Try again.' });
}

/**
 * Before a Seedance job compiles: swap every attachment that shows a
 * person for its `asset://` reference, verifying on the spot whatever the
 * upload step did not already settle (mobile uploads, released slots, a
 * model switched after attaching). Returns the ids of the rows the job
 * now holds, to be released when it ends.
 *
 * Never fails the job: an attachment that cannot be verified keeps its
 * URL, and Seedance's own moderation decides, exactly as before.
 */
export async function applyTrustedAssets(args: {
  userId: string;
  inputs: Record<string, RuntimeInputValue>;
}): Promise<string[]> {
  if (!trustedAssetsEnabled()) return [];
  const db = getDb();
  const held: string[] = [];
  for (const [key, value] of Object.entries(args.inputs)) {
    if (value.kind !== 'image' && value.kind !== 'video') continue;
    let row = await db.query.trustedAssets.findFirst({ where: eq(trustedAssets.r2Key, value.r2Key) });
    if (!row) {
      const [inserted] = await db
        .insert(trustedAssets)
        .values({ userId: args.userId, r2Key: value.r2Key, kind: value.kind, mimeType: value.mimeType, status: 'checking' })
        .onConflictDoNothing()
        .returning();
      row = inserted ?? (await db.query.trustedAssets.findFirst({ where: eq(trustedAssets.r2Key, value.r2Key) }));
      if (!row) continue;
    }
    if (row.status === 'no_human') continue;
    if (!(row.status === 'verified' && row.byteplusAssetId)) {
      // Covers checking, verifying (another run is on it — poll by re-running,
      // the function is idempotent), failed (retry once) and released.
      try {
        row = await verifyTrustedAsset(row.id);
      } catch (err) {
        logger.warn('trusted-assets:inline-verify-failed', { key, err: String(err) });
        continue;
      }
    }
    if (row.status === 'verified' && row.byteplusAssetId) {
      args.inputs[key] = { ...value, url: arkAssetUri(row.byteplusAssetId) };
      held.push(row.id);
      await setRow(row.id, { lastUsedAt: new Date() });
    }
  }
  return held;
}

/** The job is over: give the slots back immediately. */
export async function releaseTrustedAssetsAfterJob(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const ark = arkEnv();
  if (!ark) return;
  const rows = await getDb().query.trustedAssets.findMany({ where: inArray(trustedAssets.id, ids) });
  for (const row of rows) {
    if (!row.byteplusAssetId) continue;
    try {
      await releaseTrustedAsset(ark, row, 'job-finished');
    } catch (err) {
      logger.warn('trusted-assets:release-failed', { id: row.id, err: String(err) });
    }
  }
}

/**
 * Scheduled upkeep: release idle slots, and reconcile both ways with what
 * BytePlus actually holds (a crashed run can leave an asset without a
 * live row, or a row pointing at a deleted asset).
 */
export async function sweepTrustedAssets(): Promise<{ released: number; orphansDeleted: number; staleRows: number }> {
  const ark = arkEnv();
  if (!ark) return { released: 0, orphansDeleted: 0, staleRows: 0 };
  const db = getDb();
  const idleBefore = new Date(Date.now() - IDLE_RELEASE_MINUTES * 60_000);
  const idle = await db.query.trustedAssets.findMany({
    where: and(
      isNotNull(trustedAssets.byteplusAssetId),
      inArray(trustedAssets.status, ALIVE),
      or(lt(trustedAssets.lastUsedAt, idleBefore), and(sql`${trustedAssets.lastUsedAt} IS NULL`, lt(trustedAssets.createdAt, idleBefore))),
    ),
  });
  let released = 0;
  for (const row of idle) {
    await releaseTrustedAsset(ark, row, 'idle');
    released += 1;
  }

  // What BytePlus holds in our group versus what our rows claim.
  let orphansDeleted = 0;
  let staleRows = 0;
  try {
    const groupId = await ensureGroup(ark);
    const remote = new Set<string>();
    let nextToken: string | undefined;
    do {
      const page = await arkAssets.listAssets(ark, { groupIds: [groupId], nextToken });
      for (const item of page.Items ?? []) remote.add(item.Id);
      nextToken = page.NextToken;
    } while (nextToken);
    const alive = await aliveRows();
    const claimed = new Set(alive.map((r) => r.byteplusAssetId!));
    const grace = Date.now() - IN_FLIGHT_GRACE_MINUTES * 60_000;
    for (const assetId of remote) {
      if (claimed.has(assetId)) continue;
      // A registration in progress has a row in `verifying` with the id
      // set, so anything unclaimed here is a leftover — unless it was
      // created moments ago by a run that has not written its row yet.
      const row = await db.query.trustedAssets.findFirst({ where: eq(trustedAssets.byteplusAssetId, assetId) });
      if (row && row.updatedAt.getTime() > grace) continue;
      try {
        await arkAssets.deleteAsset(ark, assetId);
        orphansDeleted += 1;
      } catch (err) {
        logger.warn('trusted-assets:orphan-delete-failed', { assetId, err: String(err) });
      }
    }
    for (const row of alive) {
      if (remote.has(row.byteplusAssetId!)) continue;
      if (row.updatedAt.getTime() > grace) continue;
      await setRow(row.id, { status: 'released', byteplusAssetId: null, releasedAt: new Date() });
      staleRows += 1;
    }
  } catch (err) {
    logger.warn('trusted-assets:reconcile-failed', { err: String(err) });
  }
  return { released, orphansDeleted, staleRows };
}
