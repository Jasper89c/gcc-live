// Loads the JSON files written by the recorder (scripts/poll.mjs), which sit next to the
// page under data/. The pages never talk to the game's API themselves — its key stays with
// the scheduled job — so everything shown is as of the recorder's last run.

export type Server = "TB" | "RT";

/** Raised when a data file can't be loaded; the message is shown to the reader. */
export class DataError extends Error {}

async function load<T>(name: string): Promise<T> {
  let resp: Response;
  try {
    // The timestamp sidesteps the CDN's and the browser's caches, so Refresh really refetches.
    resp = await fetch(`data/${name}?t=${Date.now()}`);
  } catch {
    throw new DataError("Couldn't reach the recorded data — check your connection and try again.");
  }
  if (resp.status === 404) throw new DataError("Nothing has been recorded for this server yet.");
  if (!resp.ok) throw new DataError(`Couldn't load the recorded data (HTTP ${resp.status}).`);
  return resp.json() as Promise<T>;
}

const iso = (epochSecs: number) => new Date(epochSecs * 1000).toISOString();

// ----------------------------------------------------------------- market watch
export interface GccMarketHistoryPoint {
  recorded_at: string; // ISO datetime, UTC
  good: string;
  units: number;
  sellers: number;
  min_price: number | null;
  avg_price: number | null;
  max_price: number | null;
  book_value: number;
}

type MarketHistoryRow = [number, number, number, number | null, number | null, number | null, number];

interface MarketFile {
  updated_at: string;
  prices: Record<string, unknown>[];
  history: Record<string, MarketHistoryRow[]>;
}

export interface MarketData {
  updatedAt: string;
  // market.prices rows as the game's API returned them: { good, good_id, units, sellers,
  // min_price, avg_price, max_price, book_value }. Typed loosely since it's someone else's API.
  prices: Record<string, unknown>[];
  historyByGood: Map<string, GccMarketHistoryPoint[]>;
}

export async function loadMarket(server: Server): Promise<MarketData> {
  const file = await load<MarketFile>(`market-${server}.json`);
  const historyByGood = new Map<string, GccMarketHistoryPoint[]>();
  for (const [good, rows] of Object.entries(file.history)) {
    historyByGood.set(good, rows.map(([t, units, sellers, min_price, avg_price, max_price, book_value]) => ({
      recorded_at: iso(t), good, units, sellers, min_price, avg_price, max_price, book_value,
    })));
  }
  return { updatedAt: file.updated_at, prices: file.prices, historyByGood };
}

// ----------------------------------------------------------------- top empires
export interface GccPowerJump {
  recorded_at: string;
  empire_id: number;
  name: string;
  race: string;
  power: number;
  power_delta: number;
}

export interface RanksData {
  updated_at: string;
  // ranks.top50 rows as the game's API returned them: { fed: {name, id} | null, race_id,
  // race, rank, protected, name, id, power (float), planets }.
  by_power: Record<string, unknown>[];
  by_planets: Record<string, unknown>[];
  sparklines: Record<string, number[]>;   // empire id -> up to 24 power readings over 7 days
  jumps: GccPowerJump[];                  // every power change in the last 24h, newest first
}

export const loadRanks = (server: Server) => load<RanksData>(`ranks-${server}.json`);

export interface GccEmpireHistoryPoint {
  recorded_at: string; // ISO datetime, UTC
  rank: number;
  power: number;
  planets: number;
}

interface RanksHistoryFile {
  empires: Record<string, { points: [number, number, number, number, number | null][] }>;
}

/** Every recorded empire's 7-day history, keyed by empire id. A bigger file than the rest,
 * so the page only asks for it when a row is opened. */
export async function loadRanksHistory(server: Server): Promise<Map<number, GccEmpireHistoryPoint[]>> {
  const file = await load<RanksHistoryFile>(`ranks-history-${server}.json`);
  return new Map(Object.entries(file.empires).map(([id, e]) => [
    Number(id),
    e.points.map(([t, rank, power, planets]) => ({ recorded_at: iso(t), rank, power, planets })),
  ]));
}

// ----------------------------------------------------------------- deep space radar
export interface GccDsrRankingRow {
  empire_id: number;
  name: string;
  hits: number;
  wins: number;
  win_rate: number;
  colonies_taken: number;
}

export interface DsrData {
  updated_at: string;
  // dsr.battles rows as the game's API returned them: { event_id, fought_at, fought_at_epoch,
  // fought_at_utc, attacker: {id, name, power}, defender: {id, name, power}, attacker_won,
  // colonies_taken }, newest first.
  battles: Record<string, unknown>[];
  seven_day: GccDsrRankingRow[];
  thirty_day: GccDsrRankingRow[];
  all_time: GccDsrRankingRow[];
  all_time_since: string | null;   // earliest battle counted in all_time
}

export const loadDsr = (server: Server) => load<DsrData>(`dsr-${server}.json`);
