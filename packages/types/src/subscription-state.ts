/**
 * Is this subscription ending, and when?
 *
 * Stripe has TWO ways of saying "cancel at the end of the paid period",
 * and which one is set depends on who asked:
 *
 *   - `cancel_at_period_end: true` — the older flag. What our own
 *     `/v1/billing/cancel` route sets.
 *   - `cancel_at: <period end>` — what the Customer Portal writes on the
 *     API version we pin (2026-07-29). Seen live on 2026-09-24: four
 *     subscriptions cancelled in the portal, every one with
 *     `cancel_at` set and `cancel_at_period_end` still false.
 *
 * Reading only the flag showed those four as "Renews on …" with a
 * working Cancel button, and Resume would not have cleared the date.
 * Every reader goes through this so both spellings mean the same thing.
 */

export interface SubscriptionCancelFields {
  /** Unix seconds. */
  cancelAt: number | null | undefined;
  cancelAtPeriodEnd: boolean | null | undefined;
  /** Unix seconds — the current period end, for the flag form. */
  periodEnd: number | null | undefined;
}

/** When access stops if nothing changes, or null when the plan continues. */
export function subscriptionEndsAt(f: SubscriptionCancelFields): Date | null {
  if (typeof f.cancelAt === 'number') return new Date(f.cancelAt * 1000);
  if (f.cancelAtPeriodEnd && typeof f.periodEnd === 'number') return new Date(f.periodEnd * 1000);
  return null;
}

export type CancellationTransition = 'scheduled' | 'undone' | null;

/**
 * What a `customer.subscription.updated` event means for the customer's
 * cancellation, from Stripe's `previous_attributes` (the OLD values of
 * whatever changed).
 *
 *   scheduled — neither field was set before, one is now: the customer
 *               just booked the end of their plan. Tell them.
 *   undone    — a field was set before and the plan now continues:
 *               they resumed. Tell them.
 *   null      — the event changed something else (card, metadata, a
 *               plan switch), or only moved the date. Say nothing.
 */
export function cancellationTransition(
  previousAttributes: Record<string, unknown> | null | undefined,
  endsAt: Date | null,
): CancellationTransition {
  const prev = previousAttributes ?? {};
  const touched = 'cancel_at' in prev || 'cancel_at_period_end' in prev;
  if (!touched) return null;

  const wasEnding =
    typeof prev.cancel_at === 'number' ||
    prev.cancel_at_period_end === true;

  if (endsAt && !wasEnding) return 'scheduled';
  if (!endsAt && wasEnding) return 'undone';
  return null;
}
