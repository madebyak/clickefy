/**
 * THE refund policy, in one place.
 *
 * Written down as code rather than prose because three different things
 * need to agree on it: the person issuing a refund in the Stripe
 * dashboard, the webhook that reacts when one happens, and whatever
 * support tooling gets built later. A policy that lives only in someone's
 * head gets applied differently every time.
 *
 * ── THE RULES ────────────────────────────────────────────────────────
 *
 * 1. TOP-UPS ARE NON-REFUNDABLE. Full stop. The credits are delivered
 *    instantly and are immediately spendable, so there is no "unused"
 *    state to return to — by the time someone asks, we may already have
 *    paid the provider bill. This is standard for consumable digital
 *    goods (Apple, Google, Steam wallet and every credit-based AI tool
 *    treat consumables the same way).
 *
 * 2. A SUBSCRIPTION IS REFUNDABLE ONLY IF BOTH HOLD:
 *      a. NOT ONE credit from that period has been spent, and
 *      b. it is within 7 days of the period being granted.
 *
 *    (a) is the real protection. Without it someone can subscribe to
 *    Ultimate, spend 12,500 credits on video — which costs us real money
 *    the moment the provider runs the job — and then ask for the $99
 *    back. There is no way to un-render a video, so a used period simply
 *    cannot be refunded.
 *
 *    (b) keeps it a change-of-mind window rather than an open-ended
 *    option. Seven days matches the cooling-off period most digital
 *    services offer and is comfortably inside Stripe's dispute window.
 *
 * 3. A SUBSCRIPTION REFUND TOUCHES ONLY SUBSCRIPTION CREDITS. Never
 *    top-ups, never the free welcome grant. Those were paid for
 *    separately, or given, and have nothing to do with this month's plan.
 *
 * ── WHAT THIS MODULE CAN AND CANNOT DO ───────────────────────────────
 *
 * It CANNOT stop a refund. Refunds are issued in Stripe, by a human or
 * by a card network resolving a dispute, and our code hears about it
 * afterwards. So this module does two jobs:
 *
 *   - BEFORE: `evaluateSubscriptionRefund` answers "should I issue this?"
 *     so nobody has to reason it out at the moment they are looking at an
 *     unhappy customer. `scripts/check-refund-eligibility.ts` prints it.
 *
 *   - AFTER: the webhook uses the same function to record whether what
 *     happened was in policy. A refund that violates rule 2 is not
 *     rejected — the money has already moved — but it is labelled in the
 *     ledger, so "we refunded a fully-spent Ultimate month" is findable
 *     rather than invisible.
 *
 * Lives in `@clickfy/types` for the same reason `pricing.ts` does: it is
 * the only package every app and script already depends on, and it has no
 * dependencies of its own. The API webhook, the founder's pre-refund
 * check and any future admin screen all read the SAME rules — which is
 * the entire point of writing them down once.
 */

/** Change-of-mind window for a subscription period, in days. */
export const SUBSCRIPTION_REFUND_WINDOW_DAYS = 7;

/**
 * Top-ups are never refundable. Exported as a named constant rather than
 * left implicit so that a future "just this once" has to change a line
 * that says exactly what it is doing.
 */
export const TOPUPS_ARE_REFUNDABLE = false;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The parts of a credit lot the policy actually reads. */
export interface RefundableLot {
  amountGranted: number;
  amountRemaining: number;
  createdAt: Date;
}

export interface RefundVerdict {
  eligible: boolean;
  /** Machine-readable reasons the refund is refused. Empty when eligible. */
  reasons: RefundRefusal[];
  /** One line fit for a dashboard, a log, or a support reply. */
  summary: string;
  creditsGranted: number;
  creditsUsed: number;
  daysSinceGrant: number;
}

export type RefundRefusal = 'credits_used' | 'outside_window' | 'no_subscription_period';

/**
 * Should this subscription period be refunded?
 *
 * `lot` is the credit lot for the period in question — normally the most
 * recent subscription lot, since the 7-day window makes any older one
 * ineligible on its own terms.
 */
export function evaluateSubscriptionRefund(
  lot: RefundableLot | null,
  now: Date = new Date(),
): RefundVerdict {
  if (!lot) {
    return {
      eligible: false,
      reasons: ['no_subscription_period'],
      summary: 'No subscription period found to refund.',
      creditsGranted: 0,
      creditsUsed: 0,
      daysSinceGrant: 0,
    };
  }

  const creditsUsed = Math.max(0, lot.amountGranted - lot.amountRemaining);
  const daysSinceGrant = Math.floor((now.getTime() - lot.createdAt.getTime()) / DAY_MS);

  const reasons: RefundRefusal[] = [];
  if (creditsUsed > 0) reasons.push('credits_used');
  if (daysSinceGrant > SUBSCRIPTION_REFUND_WINDOW_DAYS) reasons.push('outside_window');

  const eligible = reasons.length === 0;

  const summary = eligible
    ? `Refundable: ${lot.amountGranted.toLocaleString()} credits untouched, ` +
      `${daysSinceGrant} day(s) since purchase (within ${SUBSCRIPTION_REFUND_WINDOW_DAYS}).`
    : `NOT refundable: ${[
        creditsUsed > 0 ? `${creditsUsed.toLocaleString()} credit(s) already spent` : null,
        daysSinceGrant > SUBSCRIPTION_REFUND_WINDOW_DAYS
          ? `${daysSinceGrant} days since purchase (limit ${SUBSCRIPTION_REFUND_WINDOW_DAYS})`
          : null,
      ]
        .filter(Boolean)
        .join('; ')}.`;

  return {
    eligible,
    reasons,
    summary,
    creditsGranted: lot.amountGranted,
    creditsUsed,
    daysSinceGrant,
  };
}
