/**
 * Ending a subscription's access, in ONE place.
 *
 * Two things can decide a subscription is over — Stripe's
 * `customer.subscription.deleted` webhook, and the reconcile sweep that
 * exists for when that webhook never arrives — and they must do exactly
 * the same thing. Two code paths emptying the same wallet is how a bug in
 * either becomes invisible: the other one covers for it until the day it
 * does not.
 */

import { eq } from 'drizzle-orm';

import { users } from '@clickfy/db';

import { closeSubscriptionLots, pauseTopupClocks } from './credit-grants';
import type { AppEnv } from '../types';

/**
 * Entitlement back to free, the period's allowance forfeited, the top-up
 * clock frozen.
 *
 * Top-ups SURVIVE but become unspendable (the allocator refuses the
 * `topup` class without a subscription), so their clock stops rather than
 * burning months the customer was never allowed to use.
 */
export async function endSubscriptionAccess(
  db: AppEnv['Variables']['db'],
  userId: string,
  note: string,
): Promise<string> {
  await db
    .update(users)
    .set({
      entitlement: 'free',
      subscriptionPlatform: null,
      subscriptionProductId: null,
      subscriptionRenewsAt: null,
      subscriptionExpiresAt: null,
      subscriptionCancelsAt: null,
    })
    .where(eq(users.id, userId));

  const forfeited = await closeSubscriptionLots(db, userId, note);
  const paused = await pauseTopupClocks(db, userId);

  const notes: string[] = ['subscription ended'];
  if (forfeited > 0) notes.push(`forfeited ${forfeited}`);
  if (paused > 0) notes.push(`paused ${paused} topup clock(s)`);
  return notes.join('; ');
}
