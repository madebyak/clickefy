/**
 * Dunning — what happens when a renewal payment fails.
 *
 * THE POLICY
 *   Stripe gets 24 hours and two attempts. After that the subscription is
 *   cancelled outright: access ends, the period's credits are forfeited,
 *   and the top-up clock stops.
 *
 *   This is deliberately far shorter than Stripe's default (up to four
 *   retries over three weeks, access intact throughout). The default suits
 *   a business whose marginal cost of serving an unpaid customer is
 *   roughly zero. Ours is not: every generation bills a model provider in
 *   real money the moment it runs, so three weeks of "past due but still
 *   working" is three weeks of us paying BytePlus and Google on behalf of
 *   someone whose card has already declined.
 *
 * WHY TWO MECHANISMS
 *   Stripe's retry cadence is dashboard configuration, and configuration
 *   drifts — someone changes it, a new account has different defaults, a
 *   sandbox does not match production. Enforcing the deadline only through
 *   `attempt_count` would silently stop working the day that schedule
 *   changed. So:
 *
 *     1. The webhook cancels as soon as Stripe reports the SECOND failed
 *        attempt, which is the fast path when retries are configured
 *        tightly.
 *     2. `enforceDunningDeadline` sweeps hourly and cancels anything that
 *        has been failing for more than 24 hours, WHATEVER the attempt
 *        count says. This is the one that actually guarantees the policy.
 *
 *   Either can fire first; both converge on the same action.
 *
 * ONE PLACE REVOKES
 *   Neither path touches credits directly. Both cancel the subscription
 *   IN STRIPE, and Stripe's `customer.subscription.deleted` webhook does
 *   the teardown — entitlement to free, credits forfeited, top-up clock
 *   paused. Revoking here as well would mean two code paths racing to
 *   empty the same wallet, and a bug in either would be invisible.
 *
 *   It also fixes the failure this exists to prevent: marking someone free
 *   in OUR database while leaving an active subscription in Stripe means
 *   the next successful invoice silently re-grants a full month of credits
 *   to an account we believed was cancelled.
 */

import Stripe from 'stripe';

import { DUNNING_GRACE_HOURS, evaluateDunning } from '@clickfy/types';

import { makeStripe } from './stripe-client';
import type { Bindings } from '../types';

// The deadline arithmetic lives in `@clickfy/types` so it can be unit
// tested without a Stripe account — Stripe hides test-clock subscriptions
// from list results, which makes an end-to-end test of the sweep unable
// to see its own fixture. What remains here is pagination and the call.
export { DUNNING_GRACE_HOURS, MAX_PAYMENT_ATTEMPTS } from '@clickfy/types';

/**
 * Cancel a subscription, tolerating the cases where it is already gone.
 *
 * Returns true if we actually cancelled something. A subscription that
 * has already been cancelled is a SUCCESS, not an error — both the
 * webhook and the sweep can reach the same subscription, and whichever
 * arrives second must not turn that into a failed run.
 */
export async function cancelSubscription(
  stripe: Stripe,
  subscriptionId: string,
  reason: string,
): Promise<boolean> {
  try {
    await stripe.subscriptions.cancel(subscriptionId, {
      // Stripe records this on the subscription, so the reason survives
      // in their dashboard rather than only in our logs.
      cancellation_details: { comment: reason.slice(0, 500) },
    });
    return true;
  } catch (err) {
    const code = (err as { code?: string; statusCode?: number })?.code;
    const status = (err as { statusCode?: number })?.statusCode;
    // Already cancelled or already gone.
    if (code === 'resource_missing' || status === 404) return false;
    throw err;
  }
}

/**
 * Cancel every live subscription a customer has.
 *
 * Used by the refund path: a refunded month is not a month of service, so
 * the subscription ends with it. Lists rather than taking an id because
 * in Stripe v22 a Charge no longer carries its invoice, so there is no
 * direct link from the refunded charge back to the subscription.
 */
export async function cancelSubscriptionsForCustomer(
  stripe: Stripe,
  customerId: string,
  reason: string,
): Promise<number> {
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 20,
  });
  let cancelled = 0;
  for (const sub of subs.data) {
    if (sub.status === 'canceled' || sub.status === 'incomplete_expired') continue;
    if (await cancelSubscription(stripe, sub.id, reason)) cancelled += 1;
  }
  return cancelled;
}

/** Map a Stripe subscription onto the shape the policy reads. */
function toPolicyShape(sub: Stripe.Subscription) {
  const invoice = sub.latest_invoice;
  const invoiceCreated =
    invoice && typeof invoice !== 'string' && typeof invoice.created === 'number'
      ? new Date(invoice.created * 1000)
      : null;
  return {
    invoiceCreatedAt: invoiceCreated,
    startedAt: typeof sub.start_date === 'number' ? new Date(sub.start_date * 1000) : null,
  };
}

export interface DunningSweepResult {
  examined: number;
  cancelled: number;
  waiting: number;
  errors: number;
}

/**
 * Cancel every subscription that has been failing longer than the grace
 * window. Safe to run as often as you like; it only acts on subscriptions
 * already past the deadline.
 */
export async function enforceDunningDeadline(
  env: Bindings,
  now: number = Date.now(),
): Promise<DunningSweepResult> {
  const result: DunningSweepResult = { examined: 0, cancelled: 0, waiting: 0, errors: 0 };
  if (!env.STRIPE_SECRET_KEY) return result;

  const stripe = makeStripe(env.STRIPE_SECRET_KEY);

  // `past_due` — Stripe is still retrying.
  // `unpaid`   — Stripe has given up but left the subscription in place.
  // Both mean the customer is being served without having paid.
  for (const status of ['past_due', 'unpaid'] as const) {
    let startingAfter: string | undefined;

    for (;;) {
      const page = await stripe.subscriptions.list({
        status,
        limit: 100,
        expand: ['data.latest_invoice'],
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });

      for (const sub of page.data) {
        result.examined += 1;
        const verdict = evaluateDunning(toPolicyShape(sub), new Date(now));
        if (!verdict.cancel) {
          result.waiting += 1;
          continue;
        }
        try {
          const done = await cancelSubscription(
            stripe,
            sub.id,
            `Unpaid for ${verdict.failingForHours}h — exceeds the ${DUNNING_GRACE_HOURS}h grace window`,
          );
          if (done) result.cancelled += 1;
        } catch (err) {
          // One bad subscription must not abort the sweep for everyone
          // else; the next run will retry it.
          console.error('[dunning] failed to cancel', sub.id, err);
          result.errors += 1;
        }
      }

      if (!page.has_more || page.data.length === 0) break;
      startingAfter = page.data[page.data.length - 1]!.id;
    }
  }

  return result;
}
