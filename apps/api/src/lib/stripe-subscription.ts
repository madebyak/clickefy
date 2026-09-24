/**
 * Reading and changing a Stripe subscription.
 *
 * All of this could live in the route file. It does not, because the rules
 * below are the ones a customer feels — whether an upgrade charges today,
 * whether a downgrade takes their credits away early, whether cancelling
 * ends access now or at the end of the month — and they deserve to be
 * stated once, in one place, rather than inferred from four call sites.
 *
 * ─── THE TWO DIRECTIONS ARE NOT SYMMETRICAL ─────────────────────────
 *
 * An UPGRADE happens immediately, at FULL PRICE, and restarts the billing
 * cycle today. No proration: the customer bought credits, keeps every one
 * of them, and buys the new plan's credits on top — a rule the founder
 * set on 2026-09-23 so that nobody is ever charged for a credit they do
 * not receive, and so Stripe never decides our credit arithmetic. The
 * unused days of the old plan are simply over; the next charge is one
 * full period from today, and the old renewal date is gone.
 *
 * Stripe does this with `billing_cycle_anchor: 'now'` and
 * `proration_behavior: 'none'`. Verified against a sandbox test clock
 * (2026-09-24): one invoice, one line, the full new price, a fresh period
 * starting at the moment of the upgrade, and a clean single-line renewal
 * a period later.
 *
 * A DOWNGRADE waits for the period end. They have already paid for this
 * month at the higher tier, so taking the tier away immediately would be
 * charging for something and then withdrawing it. Stripe models this with
 * a SUBSCRIPTION SCHEDULE: the current phase runs to the period end, and
 * a second phase starts there on the cheaper price. Nothing is charged or
 * refunded in between, and the ordinary renewal invoice at the boundary
 * grants the smaller allowance through the same path as any other
 * renewal.
 *
 * ─── A SCHEDULE MUST BE RELEASED BEFORE ANYTHING ELSE ────────────────
 *
 * While a schedule is attached, Stripe REFUSES `cancel_at_period_end` on
 * the subscription — and, worse, ACCEPTS a direct price/anchor update and
 * then applies the schedule's phases on top of it, which in the sandbox
 * produced an un-invoiced free period followed by a renewal with a
 * proration line. Both seen on 2026-09-24. So every mutation here starts
 * by releasing any schedule. Releasing leaves the subscription exactly as
 * it is today; the booked change is simply forgotten, which is the rule
 * for "upgrade while a downgrade is pending" anyway.
 *
 * The schedule also stays attached for the whole phase AFTER a downgrade
 * lands (Stripe releases it only when the last phase ends), so "no
 * pending change" does not mean "no schedule".
 *
 * Direction comes from the TIER LADDER, never from the amount. A yearly
 * Basic costs more than a monthly Ultimate, so comparing prices would
 * call that an upgrade and charge for it on the spot.
 */

import type Stripe from 'stripe';

import { planDirection, type UserEntitlement } from '@clickfy/types';

/**
 * Statuses that mean "this person has a subscription".
 *
 * `past_due` and `unpaid` are included deliberately: the customer still
 * has a subscription, it is simply in trouble, and dunning owns what
 * happens to it. Treating them as unsubscribed here would let someone
 * with a failing card buy a SECOND one.
 */
export const LIVE_SUBSCRIPTION_STATUSES: Stripe.Subscription.Status[] = [
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'incomplete',
];

/** The customer's current subscription, or null. */
export async function findLiveSubscription(
  stripe: Stripe,
  customerId: string,
): Promise<Stripe.Subscription | null> {
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 20,
  });
  return subs.data.find((s) => LIVE_SUBSCRIPTION_STATUSES.includes(s.status)) ?? null;
}

/** The price a subscription is currently billing. */
export function currentPriceId(sub: Stripe.Subscription): string | null {
  return sub.items?.data?.[0]?.price?.id ?? null;
}

/**
 * When the current period ends.
 *
 * On the item, not the subscription: Stripe moved it there, and the
 * subscription-level field is gone in the API version we pin.
 */
export function currentPeriodEnd(sub: Stripe.Subscription): Date | null {
  const end = sub.items?.data?.[0]?.current_period_end;
  return typeof end === 'number' ? new Date(end * 1000) : null;
}

/**
 * A change already booked for the period end, if any.
 *
 * Read from the subscription's SCHEDULE rather than remembered by us.
 * Stripe is the one that will act on it, so Stripe is the one worth
 * asking — a copy in our database would be a second truth to keep in
 * step, and it would be wrong exactly when someone changed their mind in
 * the Stripe portal instead of our UI.
 */
export async function pendingPriceChange(
  stripe: Stripe,
  sub: Stripe.Subscription,
): Promise<{ priceId: string; effectiveAt: Date | null } | null> {
  const scheduleId = typeof sub.schedule === 'string' ? sub.schedule : sub.schedule?.id;
  if (!scheduleId) return null;

  const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
  if (schedule.status !== 'active' && schedule.status !== 'not_started') return null;

  const now = Math.floor(Date.now() / 1000);
  const future = schedule.phases.find((p) => p.start_date > now);
  if (!future) return null;

  const item = future.items?.[0];
  const priceId = typeof item?.price === 'string' ? item.price : (item?.price as { id?: string })?.id;
  if (!priceId) return null;
  return { priceId, effectiveAt: new Date(future.start_date * 1000) };
}

export interface PlanChangeResult {
  direction: 'upgrade' | 'downgrade';
  /** Null for a downgrade — nothing happens until the period ends. */
  chargedNow: boolean;
  effectiveAt: Date | null;
}

/**
 * Move a live subscription onto a different price.
 *
 * Returns what the customer should be told, not a Stripe object: the
 * caller's job is to render "you have been charged and your credits are
 * ready" or "you will move to Basic on 17 October", and both of those are
 * decided here.
 */
export async function changePlan(
  stripe: Stripe,
  sub: Stripe.Subscription,
  input: {
    newPriceId: string;
    fromTier: UserEntitlement;
    toTier: UserEntitlement;
    /** For the audit trail on Stripe's side. */
    userId: string;
  },
): Promise<PlanChangeResult> {
  const direction = planDirection(input.fromTier, input.toTier);
  if (direction === 'current') {
    throw new Error('changePlan called for the tier the customer is already on');
  }
  const item = sub.items.data[0];
  if (!item) throw new Error(`subscription ${sub.id} has no items`);

  if (direction === 'upgrade') {
    // Anything booked for the period end is superseded by moving up now.
    // It must also go first: see the header for what Stripe does to a
    // direct update while a schedule is attached.
    await cancelPendingChange(stripe, sub);

    // Full price, today, new cycle from today. `error_if_incomplete`
    // means a declined card leaves the subscription exactly as it was
    // rather than half-moved and unpaid.
    await stripe.subscriptions.update(sub.id, {
      items: [{ id: item.id, price: input.newPriceId }],
      proration_behavior: 'none',
      billing_cycle_anchor: 'now',
      payment_behavior: 'error_if_incomplete',
      metadata: { clickefy_user_id: input.userId, clickefy_tier: input.toTier },
    });
    return { direction, chargedNow: true, effectiveAt: new Date() };
  }

  // ── Downgrade: book it for the period end ─────────────────────────
  const periodEnd = currentPeriodEnd(sub);
  const scheduleId = typeof sub.schedule === 'string' ? sub.schedule : sub.schedule?.id;
  const schedule = scheduleId
    ? await stripe.subscriptionSchedules.retrieve(scheduleId)
    : await stripe.subscriptionSchedules.create({ from_subscription: sub.id });

  // Keep the phase that is running, and replace whatever came after it.
  // `from_subscription` gives us a single phase mirroring today, so the
  // second phase is the change.
  const live = schedule.phases.find((p) => p.end_date === null || p.end_date > Math.floor(Date.now() / 1000))
    ?? schedule.phases[schedule.phases.length - 1];
  const liveItem = live?.items?.[0];
  const livePrice =
    typeof liveItem?.price === 'string' ? liveItem.price : (liveItem?.price as { id?: string })?.id;

  await stripe.subscriptionSchedules.update(schedule.id, {
    end_behavior: 'release',
    phases: [
      {
        items: [{ price: livePrice ?? item.price.id, quantity: 1 }],
        start_date: live?.start_date ?? 'now',
        end_date: live?.end_date ?? undefined,
      },
      {
        items: [{ price: input.newPriceId, quantity: 1 }],
        metadata: { clickefy_user_id: input.userId, clickefy_tier: input.toTier },
      },
    ],
    // No money moves at the boundary beyond the ordinary renewal.
    proration_behavior: 'none',
  });

  return { direction, chargedNow: false, effectiveAt: periodEnd };
}

/**
 * Release any attached schedule, leaving the subscription as it is today.
 *
 * Undoes a booked downgrade — and is the mandatory first step of every
 * other mutation (upgrade, cancel), because Stripe will not cancel a
 * scheduled subscription and will mis-apply a direct update to one.
 */
export async function cancelPendingChange(stripe: Stripe, sub: Stripe.Subscription): Promise<boolean> {
  const scheduleId = typeof sub.schedule === 'string' ? sub.schedule : sub.schedule?.id;
  if (!scheduleId) return false;
  // Releasing detaches the schedule and leaves the subscription running
  // exactly as it is — as opposed to cancelling it, which would end it.
  await stripe.subscriptionSchedules.release(scheduleId);
  return true;
}
