// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and ranks every
// other pre-token protocol the snapshot carries that is not a wrapped, staked, bridged or exchange
// product of a protocol that already has a token. A protocol is pre-token when its record carries no
// token (no market cap, no CoinGecko id, no symbol). That is a statement about the record, not about
// the world: the snapshot can only say a protocol records no token, never that it has none.
//
// Implied value follows only from the snapshot's own figures. Protocols whose token already trades
// price the categories: for each category, the median market-cap-to-TVL ratio of its tokenised peers
// (TVL at least $5,000,000), shrunk toward the global median by the peer count, is what one dollar of
// a pre-token protocol's TVL is provisionally worth in that category:
//
//   multiple   = clamp((n x category median + 4 x global median) / (n + 4), 0.02, 3.0)
//   base       = tvl_usd x multiple(category)
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x 0.5
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   implied    = max(1, round(base x growthMult x maturity))
//
// No protocol name is ever special-cased: the same function scores every row, and the dashboard shows
// the multiples table the numbers came from.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  /** Pseudo-count of the global median in each category's shrinkage. */
  shrink_prior: number;
  multiple_floor: number;
  multiple_cap: number;
  /** A tokenised protocol prices its category only at or above this TVL. */
  peer_min_tvl: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  shrink_prior: 4,
  multiple_floor: 0.02,
  multiple_cap: 3.0,
  peer_min_tvl: 5_000_000,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the dashboard's context set carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's implied-value multiple and the peer sample behind it. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  n: number;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    category_sample_size: number;
    global_multiple: number;
    base_value_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row, farm plan and model breakdown included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  watchlist: boolean;
  category_multiple: number;
  category_sample_size: number;
  base_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the multiples table and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  universe_size: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  combined_implied_usd: number;
  global_multiple: number;
  multiples: CategoryMultiple[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * The category multiples, derived from the snapshot itself: every protocol whose token trades and
 * whose TVL clears the peer floor contributes its market-cap-to-TVL ratio to the global pool and to
 * its category's pool. A category's multiple is its median ratio shrunk toward the global median by
 * its sample size, so a category priced by three peers leans on the market as a whole, and one priced
 * by thirty stands mostly on its own.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { table: Map<string, CategoryMultiple>; globalMultiple: number } {
  const ratios: number[] = [];
  const byCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd < model.peer_min_tvl || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    ratios.push(ratio);
    if (p.category !== null) {
      const pool = byCategory.get(p.category) ?? [];
      pool.push(ratio);
      byCategory.set(p.category, pool);
    }
  }
  const clampMultiple = (x: number): number => Math.min(model.multiple_cap, Math.max(model.multiple_floor, x));
  const global = ratios.length > 0 ? clampMultiple(median(ratios)) : model.multiple_floor;
  const table = new Map<string, CategoryMultiple>();
  for (const [category, pool] of byCategory) {
    const shrunk = (pool.length * median(pool) + model.shrink_prior * global) / (pool.length + model.shrink_prior);
    table.set(category, { category, multiple: round4(clampMultiple(shrunk)), n: pool.length });
  }
  return { table, globalMultiple: round4(global) };
}

/** The multiple one protocol is scored with: its category's, or the global median when it has no priced peers. */
function multipleFor(p: SnapshotProtocol, table: Map<string, CategoryMultiple>, globalMultiple: number): CategoryMultiple {
  if (p.category !== null) {
    const entry = table.get(p.category);
    if (entry !== undefined) return entry;
    return { category: p.category, multiple: globalMultiple, n: 0 };
  }
  return { category: 'Uncategorised', multiple: globalMultiple, n: 0 };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word that marks a wrapped or staked product of an underlying asset. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A bare ticker for a name: the whole name is one exchange-style symbol and nothing else. */
const BARE_TICKER = /^[A-Z][A-Z0-9]{1,9}$/;

/** Categories that are wrapped, staked, bridged or exchange products by construction. */
const DERIVATIVE_CATEGORIES = new Set(['CEX', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'Canonical Bridge']);

/** Exchanges whose names prefix their own tokenised products. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a pre-token protocol is a derivative product of one whose token already trades. */
export function isDerivative(p: SnapshotProtocol): boolean {
  if (p.category !== null && DERIVATIVE_CATEGORIES.has(p.category)) return true;
  if (VERSIONED.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  // A bridged asset is itself a token, so it will not launch one: a Bridge entry whose whole name
  // is a bare ticker (WBTC, CCIP) is the wrapped or bridged form of an asset that already exists.
  if (p.category === 'Bridge' && BARE_TICKER.test(p.name.trim())) return true;
  const lower = p.name.toLowerCase();
  return EXCHANGE_PREFIXES.some((x) => lower.startsWith(x.toLowerCase()));
}

/** Whether a protocol is one the board may rank: pre-token and not a derivative product. */
export function isEligible(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isDerivative(p);
}

/** The multipliers, the base value and the implied value one protocol gets. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiple: number,
  model: ModelConstants,
): { implied: number; base: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, base, growthPct, growthMult, maturityMult, age };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const { table, globalMultiple } = categoryMultiples(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);
  // The watchlist is the floor: every slug on it is ranked, even if a filter below would leave it out.
  const chosen = snapshot.protocols.filter((p) => watchlist.has(p.slug) || isEligible(p));
  const scored = chosen.map((p) => {
    const cm = multipleFor(p, table, globalMultiple);
    const v = impliedValue(p, snapshot.as_of, cm.multiple, model);
    return { p, cm, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    watchlist: watchlist.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.cm.multiple,
      category_sample_size: s.cm.n,
      global_multiple: globalMultiple,
      base_value_usd: Math.round(s.base),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p),
  }));
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain, in the words a farmer budgets with. */
function gasText(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 'budget $5-25 per transaction in gas';
  if (c === 'solana') return 'gas runs under $0.05 per transaction';
  if (c === 'base' || c === 'arbitrum' || c === 'optimism' || c === 'linea' || c === 'scroll' || c.includes('zksync')) {
    return 'gas runs under $0.50 per transaction';
  }
  return 'budget $0.10-2 per transaction in gas';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function positionFor(p: SnapshotProtocol): string {
  if (p.tvl_usd >= 1_000_000_000) return '$1,000';
  if (p.tvl_usd >= 250_000_000) return '$500';
  if (p.tvl_usd >= 50_000_000) return '$250';
  if (p.tvl_usd >= 10_000_000) return '$100';
  return '$50';
}

/** The category's core farming action, in the words a farmer can follow. */
function coreAction(p: SnapshotProtocol, size: string, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend')) {
    return `Supply about ${size} of USDC or ETH to ${name}'s core lending market on ${chain}. If its borrow markets are open, borrow a modest amount against the deposit and re-supply it, so the wallet shows genuine two-sided use.`;
  }
  if (c.includes('dex')) {
    return `Provide about ${size} of liquidity across both sides of ${name}'s busiest pair on ${chain} (a stablecoin or ETH pair keeps impermanent loss low) and make a few small swaps through it, so the wallet shows both LP and trader activity.`;
  }
  if (c.includes('yield')) {
    return `Deposit about ${size} of USDC or ETH into ${name}'s flagship vault on ${chain} and leave the shares untouched. Enable auto-compound if ${name} offers it, so yield accrues without extra transactions.`;
  }
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('option') || c.includes('synthetic')) {
    return `Deposit about ${size} of margin collateral into ${name} on ${chain} and trade small, hedged positions, keeping total exposure near the deposit. Close and reopen one position each week so the wallet records real trading volume, not a single bet.`;
  }
  if (c.includes('bridge')) {
    return `Bridge about ${size} of USDC or ETH through ${name} onto ${chain}, use the funds in a destination app for a few days, then bridge a similar amount back. Repeat monthly: round trips in both directions are the activity a bridge can measure.`;
  }
  if (c.includes('rwa')) {
    return `Mint or buy about ${size} of ${name}'s tokenised real-world asset on ${chain} through its own app and hold it to accrue its yield. Check redemption terms first, since these assets often settle redemptions on a delay.`;
  }
  if (c.includes('cdp')) {
    return `Open a collateralised debt position on ${name}: deposit about ${size} of ETH or a liquid staking token on ${chain} and mint its stablecoin against at most a third of its value, so price swings cannot liquidate the position.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('liquidity manager')) {
    return `Deposit about ${size} of USDC or ETH into a ${name}-curated vault on ${chain} and keep the shares. Pick the vault with the longest track record rather than the highest advertised yield.`;
  }
  if (c.includes('basis') || c.includes('leveraged farm') || c.includes('farm')) {
    return `Deposit about ${size} of USDC or ETH into ${name}'s main strategy on ${chain} and leave it in place. Read the strategy description once (these carry leverage or hedging mechanics underneath) and check the position weekly for drawdowns.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake about ${size} of the underlying asset through ${name} on ${chain} and keep the receipt token in the same wallet. Note the unbonding period first: the position cannot exit faster than that window allows.`;
  }
  if (c.includes('launchpad')) {
    return `Register the wallet on ${name} and take part in one launch with a small ticket of about ${size} on ${chain}, completing any holding or staking requirement the launch sets. Completed participations count; abandoned registrations do not.`;
  }
  if (c.includes('prediction')) {
    return `Fund about ${size} on ${name} and take small positions in its most liquid markets on ${chain}, and settle at least one position to completion. Spread activity across several markets and weeks, not a single event.`;
  }
  if (c.includes('index')) {
    return `Buy about ${size} of ${name}'s index product on ${chain} and hold it in the farming wallet, untouched through at least two scheduled rebalances, so the holding period is unambiguous.`;
  }
  if (c.includes('chain')) {
    return `Bridge about ${size} onto ${name} itself, keep a working balance of its gas asset, and use two or three of its native applications each week. A chain rewards wallets that hold, transfer and transact on it over time, not a single bridge-in.`;
  }
  if (c.includes('insurance')) {
    return `Buy about ${size} of cover from ${name} on ${chain} for a position you actually hold, and keep the policy to expiry. Renew once if the first policy lapses during the farming window, so coverage is continuous.`;
  }
  if (c.includes('stable') || c.includes('algo')) {
    return `Mint or deposit about ${size} of ${name}'s stable asset on ${chain} and provide it as liquidity in the asset's main pool, so the wallet both mints and supports the stablecoin's market. Watch the peg weekly and be ready to exit if it strays.`;
  }
  if (c.includes('payment') || c.includes('card')) {
    return `Route about ${size} of genuine monthly spending or payments through ${name} on ${chain}, the way a normal user would. Product-usage programs measure retained, regular users, so steady real transactions beat a single large deposit.`;
  }
  if (c.includes('privacy')) {
    return `Make a small number of genuine private transfers of about ${size} in total through ${name} on ${chain}, spread across several weeks. Keep records of your own transactions privately, since privacy tools draw scrutiny and your own log is your proof of legitimate use.`;
  }
  return `Deposit about ${size} of USDC or ETH into ${name}'s core product on ${chain} and keep it open. Use the product the way its documentation describes a typical user; ordinary, measured activity is what any future program can reward.`;
}

/**
 * A protocol's farm plan: five steps, each one string with an action, what it costs and how long it
 * takes. The plan is derived from the protocol's own record (category, chains, TVL), never from a
 * hand-written list of names. Wording is careful throughout: the snapshot records no token for these
 * protocols, which is a fact about the record, and no step promises that a token or reward exists.
 */
export function farmSteps(p: SnapshotProtocol): string[] {
  const chain = chainOf(p);
  const gas = gasText(chain);
  const size = positionFor(p);
  const name = p.name;
  return [
    `Set up a fresh wallet dedicated to farming ${name} and fund it on ${chain} with about ${size} of working capital plus gas (${gas}). A dedicated wallet keeps the farm separate from your main funds if a contract or approval ever goes wrong. Cost: the ${size} itself plus a few dollars of gas. Time: about 20 minutes.`,
    `${coreAction(p, size, chain)} Cost: about ${size} of capital plus gas (${gas}). Time: 30 minutes to set up; held for the 8-12 week window below.`,
    `Repeat one small action every week for at least 8 weeks: a deposit top-up, a swap, a claim, a vote or a rebalance through ${name} on ${chain} (${gas}). Steady weekly activity across many snapshots counts for far more than one large deposit. Cost: gas only, a few dollars a week at most. Time: about 10 minutes a week for 8-12 weeks.`,
    `Check ${name}'s official announcements and points page weekly, and trust only links those channels publish. This snapshot records no token for ${name}, so nothing is promised; if a points program or token is ever announced, early and consistent users are usually the ones it describes. Cost: nothing. Time: about 10 minutes a week.`,
    `Cap the whole position at about ${size} and never borrow money to farm ${name}. Review it monthly: if its TVL falls sharply for several weeks running, or no program has been announced after about 6 months, withdraw in one transaction (${gas}) and move on to the next protocol on the board. Cost: one exit transaction. Time: about 15 minutes a month.`,
  ];
}

/** The live-token protocols, by market cap, carried as context beside the board. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    watchlist: row.watchlist,
    category_multiple: row.model.category_multiple,
    category_sample_size: row.model.category_sample_size,
    base_value_usd: row.model.base_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const { table, globalMultiple } = categoryMultiples(snapshot, model);
  // The dashboard's multiples table: every category the snapshot names, priced or not, largest sample first.
  const categories = new Set<string>();
  for (const p of snapshot.protocols) if (p.category !== null) categories.add(p.category);
  const multiples: CategoryMultiple[] = [...categories]
    .map((category) => table.get(category) ?? { category, multiple: globalMultiple, n: 0 })
    .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1));
  const early = board.filter((r) => !r.watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    universe_size: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    combined_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
    global_multiple: globalMultiple,
    multiples,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: size, coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows: a radar board needs at least 100`;
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
