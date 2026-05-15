/**
 * `/v1/credits` — the signed-in user's view of their own credit account.
 *
 *   GET /me              { buckets, total, entitlement, history? }
 *   GET /me/history      paginated credit_ledger rows for the user
 *
 * The mobile "Credits & history" screen calls these. The buckets are
 * mirrored verbatim from the `users` row; the history is bucketed
 * `credit_ledger` rows joined with light context (job id, broadcast
 * id) so the user can see "you spent 60 credits on Snowy Cabin" not
 * just "-60".
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, lt } from 'drizzle-orm';
import { z } from 'zod';

import { creditLedger } from '@clickfy/db';

import { withAuth, withCurrentUser } from '../middleware/with-auth';
import { byClerkUserId, withRateLimit } from '../middleware/with-rate-limit';
import type { AppEnv } from '../types';

export const creditsRoute = new Hono<AppEnv>();

creditsRoute.use(
  '*',
  withAuth({ required: true }),
  withCurrentUser(),
  withRateLimit((env) => env.RL_USER_READ, byClerkUserId),
);

creditsRoute.get('/me', async (c) => {
  const user = c.var.user!;
  return c.json({
    data: {
      buckets: {
        promo: user.promoCredits,
        subscription: user.subscriptionCredits,
        topup: user.topupCredits,
      },
      total: user.creditsBalance,
      entitlement: user.entitlement,
      // The mobile UI uses this to decide whether to grey out the
      // topup balance ("locked — resubscribe to unlock"). We surface
      // it explicitly so the client doesn't have to derive the rule
      // (it stays in lockstep with the server even if we change it).
      topupSpendable: user.entitlement !== 'free',
      subscriptionExpiresAt: user.subscriptionExpiresAt?.toISOString() ?? null,
    },
  });
});

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** ISO timestamp of the oldest row already on screen — pulls older rows. */
  before: z.coerce.date().optional(),
});

creditsRoute.get(
  '/me/history',
  zValidator('query', historyQuerySchema),
  async (c) => {
    const user = c.var.user!;
    const { limit, before } = c.req.valid('query');

    const whereParts = [eq(creditLedger.userId, user.id)];
    if (before) whereParts.push(lt(creditLedger.createdAt, before));

    const rows = await c.var.db
      .select({
        id: creditLedger.id,
        delta: creditLedger.delta,
        reason: creditLedger.reason,
        bucket: creditLedger.bucket,
        balanceAfter: creditLedger.balanceAfter,
        jobId: creditLedger.jobId,
        note: creditLedger.note,
        metadata: creditLedger.metadata,
        createdAt: creditLedger.createdAt,
      })
      .from(creditLedger)
      .where(and(...whereParts))
      .orderBy(desc(creditLedger.createdAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const oldest = page[page.length - 1];
    const nextCursor =
      hasMore && oldest ? oldest.createdAt.toISOString() : null;

    return c.json({ data: page, nextCursor });
  },
);
