/**
 * Dunning policy — how long a failing subscription may keep working.
 *
 * THE RULE
 *   24 hours and two payment attempts. After either is exhausted the
 *   subscription is cancelled: access ends, the period's credits are
 *   forfeited, the top-up clock stops.
 *
 *   Far shorter than Stripe's default (up to four retries across three
 *   weeks, access intact throughout). That default suits a business whose
 *   marginal cost of serving an unpaid customer is near zero. Ours is
 *   not: every generation bills a model provider in real money the moment
 *   it runs, so three weeks of "past due but still working" is three
 *   weeks of us paying BytePlus and Google for someone whose card has
 *   already declined.
 *
 * WHY THE DECISION LIVES HERE, AWAY FROM STRIPE
 *   The sweep that applies this talks to the Stripe API, which makes it
 *   awkward to test — Stripe deliberately hides test-clock subscriptions
 *   from list results, so an end-to-end test of the sweep cannot see its
 *   own fixture. The arithmetic is the part that can actually be wrong,
 *   so it is separated out, given no dependencies, and tested directly.
 *   The caller's remaining job is pagination and an API call.
 *
 *   Same reasoning, same home as `refund-policy.ts`.
 */

/** How long a subscription may keep working after payment starts failing. */
export const DUNNING_GRACE_HOURS = 24;

/** Payment attempts Stripe gets before we stop waiting for the deadline. */
export const MAX_PAYMENT_ATTEMPTS = 2;

const HOUR_MS = 60 * 60 * 1000;

/** The parts of a subscription the policy actually reads. */
export interface DunningSubscription {
  /**
   * When the current unpaid invoice was created. Invoices are created as
   * the period rolls and charged immediately, so this is effectively the
   * first failed attempt.
   */
  invoiceCreatedAt: Date | null;
  /** Fallback when there is no invoice to read. */
  startedAt: Date | null;
}

export interface DunningVerdict {
  cancel: boolean;
  /** Hours the subscription has been failing. Null when unknowable. */
  failingForHours: number | null;
  reason: 'past_deadline' | 'within_grace' | 'unknown_age';
}

/**
 * Should this failing subscription be cancelled now?
 *
 * When the age cannot be determined we WAIT rather than cancel. Getting
 * this backwards would cancel paying customers on missing data, which is
 * far worse than serving an unpaid one for an extra hour until the next
 * sweep — and the next sweep is an hour away, not a month.
 */
export function evaluateDunning(
  sub: DunningSubscription,
  now: Date = new Date(),
): DunningVerdict {
  const since = sub.invoiceCreatedAt ?? sub.startedAt;
  if (!since) {
    return { cancel: false, failingForHours: null, reason: 'unknown_age' };
  }

  const elapsedMs = now.getTime() - since.getTime();
  const failingForHours = Math.floor(elapsedMs / HOUR_MS);

  if (elapsedMs >= DUNNING_GRACE_HOURS * HOUR_MS) {
    return { cancel: true, failingForHours, reason: 'past_deadline' };
  }
  return { cancel: false, failingForHours, reason: 'within_grace' };
}

/**
 * Has Stripe exhausted its attempts?
 *
 * The webhook's fast path. `attempt_count` depends on a retry schedule
 * that lives in dashboard configuration and can drift, which is why the
 * time-based deadline above is the real guarantee and this is only an
 * accelerator.
 */
export function hasExhaustedAttempts(attemptCount: number): boolean {
  return attemptCount >= MAX_PAYMENT_ATTEMPTS;
}
