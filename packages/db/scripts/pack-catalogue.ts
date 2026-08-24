/**
 * THE credit-pack ladder. One definition, imported by both the DB seed
 * and the Stripe sync.
 *
 * Deliberately NOT the shape `sync-stripe-prices.ts` uses for plans,
 * where the credit amounts live in the database and the prices live in
 * the script. That split means a repricing touches one file and a
 * re-credit touches another, and nothing checks they still agree. Packs
 * get one source instead, so the economics below can be read — and
 * argued with — in a single place.
 *
 * ── THE ECONOMICS ────────────────────────────────────────────────────
 * A credit costs us provider_USD / 300 = $0.00333.
 *
 * Top-ups must sit ABOVE the subscription rate, never below it. The plan
 * ladder already runs $0.0095/credit (Basic) down to $0.0079 (Ultimate),
 * and the whole point of a subscription is that it is the cheaper way to
 * buy credits. A top-up priced under Ultimate's rate would let a Basic
 * subscriber buy Ultimate economics without paying for Ultimate, and the
 * tier ladder would stop meaning anything.
 *
 * So: the smallest pack matches Basic's rate exactly, and the largest
 * stops just above Ultimate's. Bulk is rewarded through BONUS CREDITS
 * rather than a lower sticker price, because "5,000 + 500 free" reads as
 * a gift where "$0.0091 per credit" reads as arithmetic homework.
 *
 *   pack     credits   bonus    total    price   $/credit   margin
 *   ──────────────────────────────────────────────────────────────
 *   1k         1,000       0    1,000      $10    0.0100      67%
 *   2.5k       2,500     150    2,650      $25    0.0094      65%
 *   5k         5,000     500    5,500      $50    0.0091      63%
 *   10k       10,000   1,500   11,500     $100    0.0087      62%
 *   25k       25,000   5,000   30,000     $250    0.0083      60%
 *
 * Margin is the FLOOR (100% utilisation of the most expensive models),
 * not the expectation. The curve mirrors the plan ladder's 65% → 58%.
 *
 * Prices are round numbers on purpose: this is rendered as a slider, and
 * a slider that steps $10 → $25 → $50 → $100 → $250 is legible in a way
 * that $9.99 → $24.99 is not.
 *
 * ── CHANGING A PRICE ─────────────────────────────────────────────────
 * Edit here, then re-run BOTH scripts. `sync-stripe-packs.ts` will mint a
 * new Stripe price and deactivate the old one (Stripe prices are
 * immutable), never edit in place.
 */

export interface PackDefinition {
  /** Stable key. Used for Stripe lookup_keys and store product ids. */
  key: string;
  displayName: string;
  /** Credits bought. */
  credits: number;
  /** Extra credits granted free. The bulk incentive. */
  bonusCredits: number;
  /** Web price in whole US cents. */
  priceCents: number;
  displayOrder: number;
  /** The one pre-selected when the slider first renders. */
  isFeatured: boolean;
}

export const PACKS: PackDefinition[] = [
  { key: 'topup_1k',  displayName: '1,000 credits',  credits: 1_000,  bonusCredits: 0,     priceCents: 1_000,  displayOrder: 10, isFeatured: false },
  { key: 'topup_2_5k', displayName: '2,500 credits', credits: 2_500,  bonusCredits: 150,   priceCents: 2_500,  displayOrder: 20, isFeatured: false },
  { key: 'topup_5k',  displayName: '5,000 credits',  credits: 5_000,  bonusCredits: 500,   priceCents: 5_000,  displayOrder: 30, isFeatured: true  },
  { key: 'topup_10k', displayName: '10,000 credits', credits: 10_000, bonusCredits: 1_500, priceCents: 10_000, displayOrder: 40, isFeatured: false },
  { key: 'topup_25k', displayName: '25,000 credits', credits: 25_000, bonusCredits: 5_000, priceCents: 25_000, displayOrder: 50, isFeatured: false },
];

/** What we pay for one credit. `provider_USD / 300`. */
export const COST_PER_CREDIT_USD = 0.00333;

/** Total credits a pack actually delivers. */
export function totalCredits(p: PackDefinition): number {
  return p.credits + p.bonusCredits;
}

/** Effective price per delivered credit, in dollars. */
export function pricePerCredit(p: PackDefinition): number {
  return p.priceCents / 100 / totalCredits(p);
}

/** Gross margin at 100% utilisation — the floor, not the expectation. */
export function marginAtFullUse(p: PackDefinition): number {
  return 1 - COST_PER_CREDIT_USD / pricePerCredit(p);
}

/**
 * The guard rail this ladder exists to respect: no pack may beat the best
 * subscription rate. Both scripts call it before writing anything.
 */
export const BEST_SUBSCRIPTION_RATE_USD = 0.0079; // Ultimate, $99 / 12,500

export function violatesTierLadder(p: PackDefinition): boolean {
  return pricePerCredit(p) < BEST_SUBSCRIPTION_RATE_USD;
}
