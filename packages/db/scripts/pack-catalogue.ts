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
 * One credit sells for $0.10 everywhere — every plan, every pack — and
 * every model is priced at 1.5x what the provider charges us. That single
 * rate is the whole pricing system as of 2026-09-17.
 *
 * So packs carry NO bonus credits and no bulk discount. They used to:
 * "5,000 + 500 free" reads as a gift where "$0.0091 per credit" reads as
 * arithmetic homework, and the ladder ran from $0.0100 down to $0.0083 to
 * stay just above the best subscription rate. That whole balancing act
 * existed because plans sold credits at four different prices. They no
 * longer do, so a pack cannot undercut a subscription however large it
 * is, and the bonus column has nothing left to protect.
 *
 *   pack     credits    price   $/credit
 *   ─────────────────────────────────────
 *   1k           100      $10      0.10
 *   2.5k         250      $25      0.10
 *   5k           500      $50      0.10
 *   10k        1,000     $100      0.10
 *   25k        2,500     $250      0.10
 *
 * The `key` values still read `topup_1k`, `topup_25k` and so on. They are
 * Apple and Google product ids as well as Stripe lookup keys, so renaming
 * them would orphan the mobile products for a purely cosmetic gain. They
 * are identifiers, not descriptions.
 *
 * Prices are round numbers on purpose: this is rendered as a slider, and
 * a slider that steps $10 -> $25 -> $50 -> $100 -> $250 is legible in a
 * way that $9.99 -> $24.99 is not.
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
  { key: 'topup_1k',   displayName: '100 credits',   credits: 100,   bonusCredits: 0, priceCents: 1_000,  displayOrder: 10, isFeatured: false },
  { key: 'topup_2_5k', displayName: '250 credits',   credits: 250,   bonusCredits: 0, priceCents: 2_500,  displayOrder: 20, isFeatured: false },
  { key: 'topup_5k',   displayName: '500 credits',   credits: 500,   bonusCredits: 0, priceCents: 5_000,  displayOrder: 30, isFeatured: true  },
  { key: 'topup_10k',  displayName: '1,000 credits', credits: 1_000, bonusCredits: 0, priceCents: 10_000, displayOrder: 40, isFeatured: false },
  { key: 'topup_25k',  displayName: '2,500 credits', credits: 2_500, bonusCredits: 0, priceCents: 25_000, displayOrder: 50, isFeatured: false },
];

/** What we pay for one credit: it sells for $0.10 at a 1.5x markup. */
export const COST_PER_CREDIT_USD = 0.1 / 1.5;

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
 *
 * Every plan now sells credits at the same $0.10, so this is a floor no
 * pack can currently breach — kept because it is the invariant that makes
 * a subscription worth having, and the day someone proposes a "20% off
 * bulk credits" promotion is the day it earns its keep again.
 */
export const BEST_SUBSCRIPTION_RATE_USD = 0.1; // every tier, $0.10/credit

export function violatesTierLadder(p: PackDefinition): boolean {
  return pricePerCredit(p) < BEST_SUBSCRIPTION_RATE_USD;
}
