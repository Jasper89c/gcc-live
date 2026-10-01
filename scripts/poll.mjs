// The recorder: polls the real Galactic Conquest game's official read-only API and writes
// the JSON files the three pages read (Market Watch, Top Empires, Deep Space Radar).
//
//   GCC_API_KEY=... node scripts/poll.mjs <data-dir>
//
// Run on a schedule by .github/workflows/poll.yml. <data-dir> holds the previous run's
// files — they are both what the pages fetch and the recorder's own memory (price history,
// empire history, battle tallies), so each run reads them, adds one poll and writes them back.
//
// This is a port of the poller in the GCR backend (app/api/gcc_live.py); the retention
// windows and derived figures (power jumps, sparklines, attacker rankings) follow it.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Their docs say "/api/", but that path can't be resolved by their web server; the admin
// confirmed /api/index.cfm as the working address (2026-09-02). GCC_API_URL points the
// recorder at a stand-in server instead (see test/poll.test.mjs).
const UPSTREAM_URL = process.env.GCC_API_URL || "https://gcc.wrindustries.com/api/index.cfm";
const SERVERS = ["TB", "RT"];
const DAY = 24 * 60 * 60;

const HISTORY_RETENTION_DAYS = 7;
// How many empires deep to record per server. The page shows the top 50, but recording a
// bit deeper gives trend coverage for empires that only enter the top 50 by planets.
const RANKS_POLL_LIMIT = 100;
const RANKS_PAGE_LIMIT = 50;
const SPARKLINE_MAX_POINTS = 24;
const POWER_JUMPS_HOURS = 24;
const POWER_JUMPS_LIMIT = 200;
// dsr.battles returns the NEWEST `limit` battles (after the `after` cursor, when given) and
// has no cursor for paging further back. So every call asks for the maximum: on the first
// run that is the deepest history the API will ever give, and on later runs it means no
// battle is skipped unless more than this many happen between two polls.
const DSR_FETCH_LIMIT = 5000;
const DSR_FEED_SIZE = 25;
const DSR_RANKING_SIZE = 50;
const DSR_RECENT_DAYS = 30;

const dataDir = process.argv[2];
const apiKey = process.env.GCC_API_KEY;
if (!dataDir) throw new Error("Usage: node scripts/poll.mjs <data-dir>");
if (!apiKey) throw new Error("GCC_API_KEY is not set.");

async function call(action, params = {}) {
  const url = new URL(UPSTREAM_URL);
  url.searchParams.set("action", action);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const resp = await fetch(url, { headers: { "X-API-Key": apiKey }, signal: AbortSignal.timeout(60_000) });
  let body;
  try {
    body = await resp.json();
  } catch {
    throw new Error(`${action}: non-JSON response (HTTP ${resp.status})`);
  }
  if (!body.ok) throw new Error(`${action}: ${body.error || `HTTP ${resp.status}`}`);
  return body;
}

async function readJson(name, fallback) {
  try {
    return JSON.parse(await readFile(join(dataDir, name), "utf-8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;  // a corrupt file must stop the run, not silently restart the history
  }
}

const writeJson = (name, value) => writeFile(join(dataDir, name), JSON.stringify(value));

const nowSecs = Math.floor(Date.now() / 1000);
const nowIso = new Date(nowSecs * 1000).toISOString();

// ----------------------------------------------------------------- market watch
// market-<server>.json:
//   prices   latest market.prices rows, as the API returned them
//   history  { good: [[epoch, units, sellers, min, avg, max, book_value], ...] }, oldest first
async function recordMarket(server) {
  const body = await call("market.prices", { server });
  const rows = body.data ?? [];
  const file = `market-${server}.json`;
  const history = (await readJson(file, { history: {} })).history ?? {};
  const cutoff = nowSecs - HISTORY_RETENTION_DAYS * DAY;

  for (const row of rows) {
    const good = row.good || "";
    if (!good) continue;
    (history[good] ??= []).push([
      nowSecs, row.units || 0, row.sellers || 0,
      row.min_price ?? null, row.avg_price ?? null, row.max_price ?? null, row.book_value || 0,
    ]);
  }
  for (const good of Object.keys(history)) {
    history[good] = history[good].filter((p) => p[0] >= cutoff);
    if (history[good].length === 0) delete history[good];
  }

  await writeJson(file, {
    updated_at: nowIso, meta: body.meta ?? {}, retention_days: HISTORY_RETENTION_DAYS,
    prices: rows, history,
  });
}

// ----------------------------------------------------------------- top empires
function downsample(values, maxPoints) {
  if (values.length <= maxPoints) return values;
  const stride = values.length / maxPoints;
  return Array.from({ length: maxPoints }, (_, i) => values[Math.floor(i * stride)]);
}

// ranks-<server>.json          what the page loads: both rankings, sparklines, power jumps
// ranks-history-<server>.json  { empires: { id: { name, race, points: [[epoch, rank, power,
//                              planets, power_delta|null], ...] } } }, oldest first — loaded
//                              by the page only when a row is opened
async function recordRanks(server) {
  const byPower = await call("ranks.top50", { server, by: "power", limit: RANKS_POLL_LIMIT });
  const byPlanets = await call("ranks.top50", { server, by: "planets", limit: RANKS_PAGE_LIMIT });
  const historyFile = `ranks-history-${server}.json`;
  const empires = (await readJson(historyFile, { empires: {} })).empires ?? {};
  const cutoff = nowSecs - HISTORY_RETENTION_DAYS * DAY;

  // History is only ever recorded from the by-power listing, same as the backend.
  for (const row of byPower.data ?? []) {
    const id = row.id || 0;
    const power = row.power || 0;
    const empire = (empires[id] ??= { name: "", race: "", points: [] });
    empire.name = row.name || "";
    empire.race = row.race || "";
    const prev = empire.points.at(-1);
    // power_delta: change since this empire's previous recorded poll; null on its first.
    empire.points.push([nowSecs, row.rank || 0, power, row.planets || 0, prev ? power - prev[2] : null]);
  }
  for (const id of Object.keys(empires)) {
    empires[id].points = empires[id].points.filter((p) => p[0] >= cutoff);
    if (empires[id].points.length === 0) delete empires[id];
  }

  const sparklines = {};
  for (const [id, e] of Object.entries(empires)) {
    sparklines[id] = downsample(e.points.map((p) => p[2]), SPARKLINE_MAX_POINTS);
  }

  // Every recorded power movement (up or down) in the window, newest first. A null delta
  // (first row) or a zero delta (no change) is not a movement.
  const jumpsCutoff = nowSecs - POWER_JUMPS_HOURS * 60 * 60;
  const jumps = [];
  for (const [id, e] of Object.entries(empires)) {
    for (const [t, , power, , delta] of e.points) {
      if (t >= jumpsCutoff && delta) {
        jumps.push({ recorded_at: new Date(t * 1000).toISOString(), empire_id: Number(id), name: e.name, race: e.race, power, power_delta: delta });
      }
    }
  }
  jumps.sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : a.recorded_at > b.recorded_at ? -1 : 0));

  await writeJson(historyFile, { updated_at: nowIso, retention_days: HISTORY_RETENTION_DAYS, empires });
  await writeJson(`ranks-${server}.json`, {
    updated_at: nowIso, meta: byPower.meta ?? {},
    by_power: (byPower.data ?? []).slice(0, RANKS_PAGE_LIMIT), by_planets: byPlanets.data ?? [],
    sparklines, jumps: jumps.slice(0, POWER_JUMPS_LIMIT),
  });
}

// ----------------------------------------------------------------- deep space radar
function rankAttackers(tallies, names) {
  return Object.entries(tallies)
    .map(([id, [hits, wins, colonies]]) => ({
      empire_id: Number(id), name: names[id] ?? "", hits, wins,
      win_rate: hits ? wins / hits : 0, colonies_taken: colonies,
    }))
    .sort((a, b) => b.hits - a.hits || b.wins - a.wins || a.empire_id - b.empire_id)
    .slice(0, DSR_RANKING_SIZE);
}

// dsr-state-<server>.json  the recorder's memory:
//   last_event_id   highest event id seen (the forward-polling cursor)
//   first_fought    epoch of the earliest battle ever counted — how far "all time" reaches
//   names           { attacker id: latest name seen }
//   all_time        { attacker id: [hits, wins, colonies_taken] }, every battle ever counted
//   recent          [[epoch, attacker id, won 0/1, colonies_taken], ...] for the last 30 days
//   feed            the latest battles, as the API returned them, newest first
// dsr-<server>.json        what the page loads: the feed and the three ranking tables
async function recordDsr(server) {
  const stateFile = `dsr-state-${server}.json`;
  const state = await readJson(stateFile, {
    last_event_id: null, first_fought: null, names: {}, all_time: {}, recent: [], feed: [],
  });

  const params = { server, limit: DSR_FETCH_LIMIT };
  if (state.last_event_id !== null) params.after = state.last_event_id;
  const body = await call("dsr.battles", params);
  const fresh = (body.data ?? [])
    .filter((r) => r.event_id != null && r.fought_at_epoch != null)
    .filter((r) => state.last_event_id === null || r.event_id > state.last_event_id);

  // Oldest first, so the latest name seen for an attacker wins.
  for (const row of [...fresh].sort((a, b) => a.fought_at_epoch - b.fought_at_epoch)) {
    const id = row.attacker?.id || 0;
    const won = row.attacker_won ? 1 : 0;
    const colonies = row.colonies_taken || 0;
    state.names[id] = row.attacker?.name || "";
    const tally = (state.all_time[id] ??= [0, 0, 0]);
    tally[0] += 1;
    tally[1] += won;
    tally[2] += colonies;
    state.recent.push([row.fought_at_epoch, id, won, colonies]);
    if (state.first_fought === null || row.fought_at_epoch < state.first_fought) state.first_fought = row.fought_at_epoch;
    if (state.last_event_id === null || row.event_id > state.last_event_id) state.last_event_id = row.event_id;
  }
  state.recent = state.recent.filter((b) => b[0] >= nowSecs - DSR_RECENT_DAYS * DAY);
  state.feed = [...fresh, ...state.feed]
    .sort((a, b) => b.fought_at_epoch - a.fought_at_epoch || b.event_id - a.event_id)
    .slice(0, DSR_FEED_SIZE);

  const window = (days) => {
    const tallies = {};
    for (const [t, id, won, colonies] of state.recent) {
      if (t < nowSecs - days * DAY) continue;
      const tally = (tallies[id] ??= [0, 0, 0]);
      tally[0] += 1;
      tally[1] += won;
      tally[2] += colonies;
    }
    return rankAttackers(tallies, state.names);
  };

  await writeJson(stateFile, state);
  await writeJson(`dsr-${server}.json`, {
    updated_at: nowIso, meta: body.meta ?? {},
    battles: state.feed,
    seven_day: window(7), thirty_day: window(30), all_time: rankAttackers(state.all_time, state.names),
    all_time_since: state.first_fought === null ? null : new Date(state.first_fought * 1000).toISOString(),
  });
  return fresh.length;
}

// ----------------------------------------------------------------- run
await mkdir(dataDir, { recursive: true });
const errors = [];
let succeeded = 0;
for (const server of SERVERS) {
  for (const [label, record] of [["market", recordMarket], ["ranks", recordRanks], ["dsr", recordDsr]]) {
    try {
      const added = await record(server);
      succeeded += 1;
      console.log(`${label} ${server}: ok${added === undefined ? "" : ` (${added} new battles)`}`);
    } catch (e) {
      // One failed section keeps its previous files; the others still update.
      errors.push(`${label} ${server}: ${e.message}`);
      console.error(`${label} ${server}: FAILED — ${e.message}`);
    }
  }
}
await writeJson("status.json", { updated_at: nowIso, errors });
if (succeeded === 0) {
  console.error("Every section failed; leaving the published data untouched.");
  process.exit(1);
}
