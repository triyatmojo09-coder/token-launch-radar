# Token Launch Radar

![make.fun bounty](https://make.fun/badge/token-radar-01.svg)
![rank](https://make.fun/badge/token-radar-01/triyatmojo09-coder/token-launch-radar/rank.svg)
![reward](https://make.fun/badge/token-radar-01/triyatmojo09-coder/token-launch-radar/reward.svg)

A radar for token launches that have not happened yet. It reads the sealed DefiLlama snapshot shipped with the [make.fun token launch radar bounty](https://make.fun/bounty/token-radar-01) (758 protocols with at least $5M TVL, as of 14 November 2026) and ranks the protocols that record no token by the value a token launch might plausibly reach, each with a concrete plan for farming a possible allocation.

## The value model

Nothing is hardcoded per protocol; every number is derived from the snapshot itself:

- For each category, take the tokenised protocols in the snapshot (market cap recorded, TVL at least $5M) and compute the median market-cap/TVL multiple. The global median across 144 tokenised protocols is 0.1689.
- Shrink each category multiple toward the global median by sample size, `(n * median + 4 * global) / (n + 4)`, and clamp to [0.02, 3.0]. Thin categories lean on the global figure instead of one loud peer.
- Implied value = TVL x category multiple x growth multiplier (7-day TVL change clamped to [-60, 120] and halved) x maturity multiplier (0.6 plus up to 0.4 for three years without a token).

Eligibility keeps pre-token protocols and leaves off derivatives of existing tokens: wrapped, staked and restaked products, exchange house tokens, version-suffixed re-issues, and bridged assets whose whole name is a bare ticker (the asset is itself a token). All 40 watchlist protocols are always on the board. The board holds 216 protocols; a protocol here "records no token" in the snapshot, which is not a promise that none exists anywhere.

## The dashboard

A static, fully offline dashboard (no network calls): the ranked board with search, category and chain filters, a watchlist-only toggle and sortable columns; a detail view per protocol showing the model equation with that protocol's real numbers and its five-step farm plan (position sizing scaled to TVL, chain gas tiers, week-by-week duration, a points/announcement tracking step and a risk/exit step); and a methodology section with the full category-multiples table.

## Running it

```
node main.ts --input <snapshot.json>
```

writes `board.json`, the dashboard data, the dashboard and screenshots, and `dossier.json` into the output directory. `main.ts` and `vendor/makefun-board.ts` are the competition's stock plumbing; the model lives in `lib/model.ts` and the dashboard in `dashboard/`.
