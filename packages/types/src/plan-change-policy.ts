/**
 * Plan-change policy — what a Stripe invoice means for a subscriber's
 * credits, decided from OUR data rather than from Stripe's labels.
 *
 * ── THE RULES (founder, 2026-09-23) ──────────────────────────────────
 *
 *   Renewal   same tier again    → unspent plan credits are WIPED.
 *   Upgrade   higher tier        → pay the full new price today, KEEP
 *                                  every unspent credit, the renewal date
 *                                  becomes today.
 *   Downgrade lower tier, lands  → unspent credits WIPED, new allowance.
 *             at the period end
 *
 *   Yearly plans are not changed self-serve at all — "contact us".
 *
 * ── WHY NOT `billing_reason` ────────────────────────────────────────
 *
 * The obvious way to tell a renewal from an upgrade is Stripe's
 * `invoice.billing_reason`. It is the wrong way, and it was verified to
 * be the wrong way against a sandbox test clock on 2026-09-24:
 *
 *   - an anchor-reset upgrade arrives as `subscription_update`
 *   - a schedule-phase downgrade landing arrives as `subscription_cycle`
 *   - a plain renewal can arrive with a PRORATION line first, so even
 *     "renewal = one line" does not hold
 *
 * Any rule written on those labels would carry credits on a downgrade or
 * wipe them on an upgrade the first time Stripe shaped an invoice
 * differently. The tier LADDER is ours, cannot drift, and answers the
 * question directly: is the customer moving up, staying, or moving down?
 *
 * ── WHY NOT `invoice.lines[0]` ──────────────────────────────────────
 *
 * On a proration invoice Stripe lists the NEGATIVE "unused time on the
 * old plan" line first. Reading the plan from it granted a customer who
 * had just paid for Ultimate the Creator allowance, and set her tier back
 * to Creator one second after the subscription event had set it right.
 * The subscription's current price is the truth; a line is a fallback.
 */

import { tierRank, type UserEntitlement } from './user';

export type PlanInterval = 'month' | 'year';

/** What happens to the credits already in the subscription wallet. */
export type RolloverDecision = 'carry' | 'wipe';

/**
 * Carry the unspent balance forward only when the customer is moving UP
 * the ladder. Same tier is a renewal; a lower tier is a downgrade landing.
 * Both wipe.
 *
 * `previousTier` is the tier of the customer's most recent subscription
 * grant — read from our own ledger, never from `users.entitlement`, which
 * `customer.subscription.updated` may already have advanced by the time
 * the invoice is processed (the two events race, and Stripe promises no
 * order).
 */
export function decideRollover(
  previousTier: UserEntitlement | null,
  newTier: UserEntitlement,
): RolloverDecision {
  if (!previousTier) return 'wipe';
  return tierRank(newTier) > tierRank(previousTier) ? 'carry' : 'wipe';
}

/** The parts of an invoice line this policy reads. */
export interface InvoiceLineLike {
  amount: number;
  priceId: string | null;
  /** Unix seconds. */
  periodEnd: number | null;
}

/**
 * Which price an invoice was really for.
 *
 * The subscription's current price wins whenever we have it. Otherwise
 * the line with the LARGEST POSITIVE amount: on a proration invoice that
 * is the plan being moved to, and on every other invoice it is the only
 * line. The first line is never trusted on its own.
 */
export function resolveInvoicePriceId(
  lines: readonly InvoiceLineLike[],
  subscriptionPriceId: string | null,
): string | null {
  if (subscriptionPriceId) return subscriptionPriceId;
  let best: InvoiceLineLike | null = null;
  for (const line of lines) {
    if (!line.priceId || line.amount <= 0) continue;
    if (!best || line.amount > best.amount) best = line;
  }
  return best?.priceId ?? null;
}

/**
 * When the period being paid for ends.
 *
 * The LATEST period end among the lines that carry the resolved price. A
 * renewal can carry a short "remaining time" proration line ahead of the
 * real period line (seen in the sandbox after an anchor reset), and both
 * name the same price — the later end is the one Stripe will bill next.
 * A proration invoice's negative line belongs to the OLD price and is
 * never consulted. Falls back to the latest period on any line.
 */
export function resolvePeriodEnd(
  lines: readonly InvoiceLineLike[],
  priceId: string | null,
): number | null {
  const latest = (candidates: readonly InvoiceLineLike[]): number | null =>
    candidates.reduce<number | null>(
      (max, l) => (l.periodEnd && (max === null || l.periodEnd > max) ? l.periodEnd : max),
      null,
    );
  return latest(lines.filter((l) => l.priceId === priceId)) ?? latest(lines);
}

/** The allowance window on a yearly plan, in days. */
export const YEARLY_ALLOWANCE_DAYS = 30;

/**
 * When a subscription lot should expire.
 *
 * MONTHLY: at the real period end Stripe will bill next. A fixed 30 days
 * is wrong in every 31-day month — the expiry sweep zeroed the lot the
 * morning before the renewal landed, and the 30-day refresh task then
 * granted a lot the renewal wiped hours later.
 *
 * YEARLY: 30 days from now. The period end is a year away; the daily
 * refresh task closes this lot and opens the next one every 30 days.
 */
export function subscriptionLotExpiry(
  interval: PlanInterval,
  periodEnd: Date | null,
  now: Date = new Date(),
): Date {
  if (interval === 'month' && periodEnd && periodEnd.getTime() > now.getTime()) {
    return periodEnd;
  }
  return new Date(now.getTime() + YEARLY_ALLOWANCE_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Only monthly → monthly changes are self-serve. A yearly plan is twelve
 * prepaid allowances; changing it mid-year means either handing over the
 * undelivered ones at once or inventing a proration, and neither is a
 * rule we want the app applying on its own yet.
 */
export function isSelfServePlanChange(
  fromInterval: PlanInterval | null,
  toInterval: PlanInterval,
): boolean {
  return fromInterval === 'month' && toInterval === 'month';
}
