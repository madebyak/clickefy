# Price book — September 2026

`cost-basis-2026-09.json` is the rate card: every provider rate we sell
against, with its source and the date it was read. `catalogue-2026-09.json`
is what that rate card turns into — the `cost_credits` and `tier_pricing`
each model should carry — and is what `scripts/redenominate-credits-2026-09.ts`
applies.

Both are generated artefacts of the working folder in `docs/pricing-new/`
(gitignored), which also holds the cost book, the price book, the formulas
behind each provider's billing, and the findings. They are copied here
because a script must not depend on a file that is not in the repository.

## The decisions these encode

| | |
|---|---|
| One credit | **$0.10**, on every plan and every top-up pack |
| Markup | **1.5x** on the provider's standard cost |
| Plans | $19 / $39 / $75 / $99 → 190 / 390 / 750 / 990 credits |
| Yearly | 12x monthly, no discount for now |
| Top-ups | flat $0.10, no volume bonus |
| Promotions | never in the catalogue price — a separate, dated discount |

`credits = ceil(provider_cost x markup / 0.10)`

Because nothing is discounted anywhere, $0.10 is both the list price and
the floor, so that one line is the whole pricing system.

## Regenerating

    node docs/pricing-new/build.mjs
    cp docs/pricing-new/05-catalogue.json packages/db/pricing/catalogue-2026-09.json
