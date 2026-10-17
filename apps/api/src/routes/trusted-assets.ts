/**
 * `/v1/trusted-assets` — verifying attachments that show a person, so
 * Seedance accepts them.
 *
 *   POST /            start (or resume) verification of one upload
 *   GET  /?keys=a,b   current state of several uploads, for the badges
 *   POST /:id/retry   run it again after a failure
 *
 * The work itself happens on the jobs worker (`verify-trusted-asset`):
 * a vision model looks for a person, and files with one are registered
 * in BytePlus's private asset library. This route only owns the row and
 * fires the task. States: checking → no_human | verifying → verified |
 * failed; released once the BytePlus slot was given back (re-verifiable).
 */

import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { trustedAssets, type TrustedAsset } from '@clickfy/db';

import { triggerTask } from '../lib/dispatch-job';
import { withAuth, withCurrentUser } from '../middleware/with-auth';
import { byClerkUserId, withRateLimit } from '../middleware/with-rate-limit';
import type { AppEnv } from '../types';

export const trustedAssetsRoute = new Hono<AppEnv>();

const checkSchema = z.object({
  r2Key: z.string().min(1).max(512),
  kind: z.enum(['image', 'video']),
  mimeType: z.string().max(120).optional(),
});

const MAX_KEYS = 40;

function publicState(row: TrustedAsset) {
  return {
    id: row.id,
    r2Key: row.r2Key,
    status: row.status,
    error: row.status === 'failed' ? row.error : null,
  };
}

async function fire(c: Context<AppEnv>, id: string) {
  const key = c.env.TRIGGER_SECRET_KEY;
  if (!key) return { ok: false as const, status: 0, message: 'TRIGGER_SECRET_KEY unset' };
  return triggerTask('verify-trusted-asset', { id }, { triggerSecretKey: key });
}

trustedAssetsRoute.post(
  '/',
  withAuth({ required: true }),
  withCurrentUser(),
  withRateLimit((env) => env.RL_USER_WRITE, byClerkUserId),
  zValidator('json', checkSchema),
  async (c) => {
    const user = c.var.user!;
    const body = c.req.valid('json');
    if (!body.r2Key.startsWith(`user-uploads/${user.id}/`)) {
      return c.json({ error: { code: 'forbidden_r2_key', message: 'That upload does not belong to you.' } }, 403);
    }
    const db = c.var.db;
    let row = await db.query.trustedAssets.findFirst({ where: eq(trustedAssets.r2Key, body.r2Key) });
    let start = false;
    if (!row) {
      const [inserted] = await db
        .insert(trustedAssets)
        .values({ userId: user.id, r2Key: body.r2Key, kind: body.kind, mimeType: body.mimeType ?? null, status: 'checking' })
        .onConflictDoNothing()
        .returning();
      row = inserted ?? (await db.query.trustedAssets.findFirst({ where: eq(trustedAssets.r2Key, body.r2Key) }));
      start = !!inserted;
    } else if (row.status === 'released' || row.status === 'failed') {
      // The verdict is cached on the row; the worker skips straight to
      // registration when a person was already found.
      [row] = await db
        .update(trustedAssets)
        .set({ status: 'checking', error: null, updatedAt: new Date() })
        .where(eq(trustedAssets.id, row.id))
        .returning();
      start = true;
    }
    if (!row) {
      return c.json({ error: { code: 'internal', message: 'Could not record the attachment.' } }, 500);
    }
    if (start) {
      const fired = await fire(c, row.id);
      if (!fired.ok) {
        console.error('[trusted-assets] trigger failed:', fired.message);
        [row] = await db
          .update(trustedAssets)
          .set({ status: 'failed', error: 'Verification could not start. Try again.', updatedAt: new Date() })
          .where(eq(trustedAssets.id, row.id))
          .returning();
      }
    }
    return c.json({ data: publicState(row!) });
  },
);

trustedAssetsRoute.get(
  '/',
  withAuth({ required: true }),
  withCurrentUser(),
  withRateLimit((env) => env.RL_USER_READ, byClerkUserId),
  async (c) => {
    const user = c.var.user!;
    const keys = (c.req.query('keys') ?? '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
      .slice(0, MAX_KEYS);
    if (keys.length === 0) return c.json({ data: { assets: [] } });
    const rows = await c.var.db.query.trustedAssets.findMany({
      where: and(eq(trustedAssets.userId, user.id), inArray(trustedAssets.r2Key, keys)),
    });
    c.header('Cache-Control', 'no-store');
    return c.json({ data: { assets: rows.map(publicState) } });
  },
);

trustedAssetsRoute.post(
  '/:id/retry',
  withAuth({ required: true }),
  withCurrentUser(),
  withRateLimit((env) => env.RL_USER_WRITE, byClerkUserId),
  async (c) => {
    const user = c.var.user!;
    const id = c.req.param('id');
    const db = c.var.db;
    const existing = await db.query.trustedAssets.findFirst({
      where: and(eq(trustedAssets.id, id), eq(trustedAssets.userId, user.id)),
    });
    if (!existing) return c.json({ error: { code: 'not_found', message: 'Attachment not found.' } }, 404);
    if (existing.status === 'checking' || existing.status === 'verifying') {
      return c.json({ data: publicState(existing) });
    }
    let [row] = await db
      .update(trustedAssets)
      .set({ status: 'checking', error: null, updatedAt: new Date() })
      .where(eq(trustedAssets.id, id))
      .returning();
    const fired = await fire(c, id);
    if (!fired.ok) {
      console.error('[trusted-assets] trigger failed:', fired.message);
      [row] = await db
        .update(trustedAssets)
        .set({ status: 'failed', error: 'Verification could not start. Try again.', updatedAt: new Date() })
        .where(eq(trustedAssets.id, id))
        .returning();
    }
    return c.json({ data: publicState(row!) });
  },
);
