// Runs the recorder (scripts/poll.mjs) against a stand-in for the game's API and checks what
// it writes: history accumulating across runs, old readings dropped, power changes, and
// battle tallies that never count a battle twice.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const POLL = fileURLToPath(new URL("../scripts/poll.mjs", import.meta.url));
const DAY = 24 * 60 * 60;
const now = () => Math.floor(Date.now() / 1000);

/** A fake game API. `world` is mutated between polls to play the game forward. */
async function fakeApi(world) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const q = Object.fromEntries(url.searchParams);
    world.calls.push(q);
    const send = (body) => res.end(JSON.stringify(body));
    res.setHeader("Content-Type", "application/json");
    if (req.headers["x-api-key"] !== "test-key") return send({ ok: false, error: "bad key" });
    if (world.down?.includes(q.action)) return send({ ok: false, error: "upstream is down" });
    if (q.action === "market.prices") return send({ ok: true, meta: { server: q.server }, data: world.market[q.server] });
    if (q.action === "ranks.top50") {
      const rows = [...world.ranks[q.server]].sort((a, b) => b[q.by] - a[q.by]).map((r, i) => ({ ...r, rank: i + 1 }));
      return send({ ok: true, meta: { server: q.server, by: q.by }, data: rows.slice(0, Number(q.limit)) });
    }
    if (q.action === "dsr.battles") {
      // Like the real endpoint: the newest `limit` battles after the cursor, newest first.
      const rows = world.battles[q.server]
        .filter((b) => q.after === undefined || b.event_id > Number(q.after))
        .sort((a, b) => b.event_id - a.event_id)
        .slice(0, Number(q.limit));
      return send({ ok: true, meta: { server: q.server }, data: rows });
    }
    send({ ok: false, error: `unknown action ${q.action}` });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() };
}

const battle = (event_id, secsAgo, attacker, won, colonies = 0) => ({
  event_id, fought_at_epoch: now() - secsAgo, fought_at: "2026-01-01 00:00:00",
  attacker: { id: attacker.id, name: attacker.name, power: 1000 },
  defender: { id: 99, name: "Target", power: 900 },
  attacker_won: won, colonies_taken: colonies,
});

function freshWorld() {
  const empire = (id, name, power, planets) => ({ id, name, race: "Terran", power, planets, protected: false, fed: null });
  const good = (name, avg) => ({ good: name, good_id: 1, units: 100, sellers: 2, min_price: avg - 1, avg_price: avg, max_price: avg + 1, book_value: 500 });
  const ann = { id: 1, name: "Ann" }, bob = { id: 2, name: "Bob" };
  return {
    calls: [],
    market: { TB: [good("Food", 10)], RT: [good("Food", 12), good("Ore", 30)] },
    ranks: { TB: [empire(1, "Ann", 500, 9)], RT: [empire(1, "Ann", 500, 9), empire(2, "Bob", 400, 20)] },
    battles: {
      TB: [],
      RT: [
        battle(10, 60, ann, true, 2),              // a minute ago
        battle(11, 3 * DAY, ann, false),           // 3 days ago
        battle(12, 20 * DAY, bob, true, 1),        // 20 days ago: outside 7d, inside 30d
        battle(13, 90 * DAY, bob, true),           // 90 days ago: all-time only
      ],
    },
  };
}

async function setup() {
  const world = freshWorld();
  const api = await fakeApi(world);
  const dir = await mkdtemp(join(tmpdir(), "gcc-live-"));
  const poll = (key = "test-key") => run(process.execPath, [POLL, dir], { env: { ...process.env, GCC_API_KEY: key, GCC_API_URL: api.url } });
  const read = async (name) => JSON.parse(await readFile(join(dir, name), "utf-8"));
  return { world, api, dir, poll, read };
}

test("market history accumulates one reading per poll and drops readings older than 7 days", async () => {
  const { world, api, dir, poll, read } = await setup();
  try {
    // A reading from 8 days ago and one from 2 days ago are already on file.
    const old = [now() - 8 * DAY, 1, 1, 5, 6, 7, 1], recent = [now() - 2 * DAY, 1, 1, 8, 9, 10, 1];
    await writeFile(join(dir, "market-RT.json"), JSON.stringify({ history: { Food: [old, recent], Gone: [old] } }));
    await poll();
    world.market.RT[0].avg_price = 15;
    await poll();
    const market = await read("market-RT.json");
    assert.deepEqual(market.prices.map((r) => r.good), ["Food", "Ore"]);
    assert.deepEqual(market.history.Food.map((p) => p[4]), [9, 12, 15]);   // 8-day-old reading gone
    assert.equal(market.history.Ore.length, 2);
    assert.equal("Gone" in market.history, false);                        // nothing left of it
  } finally { api.close(); }
});

test("empire history records rank, power and planets, and reports power changes", async () => {
  const { world, api, poll, read } = await setup();
  try {
    await poll();
    let ranks = await read("ranks-RT.json");
    assert.deepEqual(ranks.jumps, []);                       // a first reading is not a change
    assert.deepEqual(ranks.by_power.map((r) => r.name), ["Ann", "Bob"]);
    assert.deepEqual(ranks.by_planets.map((r) => r.name), ["Bob", "Ann"]);

    world.ranks.RT[1].power = 650;                           // Bob overtakes Ann
    await poll();
    ranks = await read("ranks-RT.json");
    assert.deepEqual(ranks.jumps.map((j) => [j.name, j.power, j.power_delta]), [["Bob", 650, 250]]);
    assert.deepEqual(ranks.sparklines["2"], [400, 650]);
    const history = await read("ranks-history-RT.json");
    assert.deepEqual(history.empires["2"].points.map(([, rank, power, planets, delta]) => [rank, power, planets, delta]),
      [[2, 400, 20, null], [1, 650, 20, 250]]);
    assert.deepEqual(history.empires["1"].points.map((p) => p[4]), [null, 0]);   // unchanged: delta 0, no jump
  } finally { api.close(); }
});

test("battles are tallied once, windowed by age, and polled forward from the last one seen", async () => {
  const { world, api, poll, read } = await setup();
  try {
    await poll();
    let dsr = await read("dsr-RT.json");
    const brief = (rows) => rows.map((r) => [r.name, r.hits, r.wins, r.colonies_taken]);
    assert.deepEqual(brief(dsr.seven_day), [["Ann", 2, 1, 2]]);
    assert.deepEqual(brief(dsr.thirty_day), [["Ann", 2, 1, 2], ["Bob", 1, 1, 1]]);
    assert.deepEqual(brief(dsr.all_time), [["Bob", 2, 2, 1], ["Ann", 2, 1, 2]]);   // tie on hits: more wins first
    assert.equal(dsr.seven_day[0].win_rate, 0.5);
    assert.deepEqual(dsr.battles.map((b) => b.event_id), [10, 11, 12, 13]);        // newest first
    assert.ok(Math.abs(new Date(dsr.all_time_since) / 1000 - (now() - 90 * DAY)) < 60);

    // Bob attacks again under a new name; the second poll must ask only for what is new.
    world.battles.RT.push(battle(14, 5, { id: 2, name: "Bob the Bold" }, true, 3));
    await poll();
    dsr = await read("dsr-RT.json");
    assert.equal(world.calls.filter((c) => c.action === "dsr.battles" && c.server === "RT").at(-1).after, "13");
    assert.deepEqual(brief(dsr.all_time), [["Bob the Bold", 3, 3, 4], ["Ann", 2, 1, 2]]);
    assert.deepEqual(brief(dsr.seven_day), [["Ann", 2, 1, 2], ["Bob the Bold", 1, 1, 3]]);
    assert.deepEqual(dsr.battles.map((b) => b.event_id), [14, 10, 11, 12, 13]);

    await poll();                                            // nothing new: tallies unchanged
    assert.deepEqual(brief((await read("dsr-RT.json")).all_time), [["Bob the Bold", 3, 3, 4], ["Ann", 2, 1, 2]]);
  } finally { api.close(); }
});

test("a failing section keeps its previous data; a wrong key fails the run", async () => {
  const { world, api, poll, read } = await setup();
  try {
    await poll();
    const before = await read("market-RT.json");
    world.down = ["market.prices"];
    await poll();                                            // partial failure still succeeds
    assert.deepEqual(await read("market-RT.json"), before);
    assert.deepEqual((await read("status.json")).errors.sort(),
      ["market RT: market.prices: upstream is down", "market TB: market.prices: upstream is down"]);

    const ranksBefore = await read("ranks-RT.json");
    await assert.rejects(poll("wrong-key"));                 // exit code 1: the workflow stops before publishing
    assert.deepEqual(await read("ranks-RT.json"), ranksBefore);
  } finally { api.close(); }
});
