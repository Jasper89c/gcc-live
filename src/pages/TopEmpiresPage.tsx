import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DataError, loadRanks, loadRanksHistory,
  type GccEmpireHistoryPoint, type RanksData, type Server,
} from "../data.ts";
import { compact, decodeEntities, full } from "../format.ts";
import RecordedAt from "../components/RecordedAt";
import Sparkline from "../components/Sparkline";
import TrendChart from "../components/TrendChart";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function PowerJumpBadge({ delta }: { delta: number }) {
  const up = delta > 0;
  return (
    <span className={`power-jump ${up ? "power-jump--pos" : "power-jump--neg"}`}>
      {up ? "▲ +" : "▼ -"}{full(Math.abs(delta))}
    </span>
  );
}

type SortBy = "power" | "planets";

interface RankRow {
  id: number;
  name: string;
  race: string;
  rank: number;
  power: number;
  planets: number;
  protected: boolean;
  fedName: string | null;
}

function toRow(raw: Record<string, unknown>): RankRow | null {
  const id = raw.id;
  if (typeof id !== "number") return null;
  const fed = raw.fed as Record<string, unknown> | null | undefined;
  return {
    id,
    name: typeof raw.name === "string" ? decodeEntities(raw.name) : "",
    race: typeof raw.race === "string" ? raw.race : "",
    rank: typeof raw.rank === "number" ? raw.rank : 0,
    power: typeof raw.power === "number" ? raw.power : 0,
    planets: typeof raw.planets === "number" ? raw.planets : 0,
    protected: raw.protected === true,
    fedName: fed && typeof fed.name === "string" ? decodeEntities(fed.name) : null,
  };
}

export default function TopEmpiresPage() {
  const [server, setServer] = useState<Server>("RT");
  const [by, setBy] = useState<SortBy>("power");
  const [ranks, setRanks] = useState<RanksData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  // Every empire's 7-day history for the current server, fetched the first time a row is opened.
  const [history, setHistory] = useState<Map<number, GccEmpireHistoryPoint[]> | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyRequest = useRef(0);

  const load = useCallback((srv: Server) => {
    setLoading(true);
    setError(null);
    historyRequest.current += 1;   // drop any history still in flight for the old data
    setHistory(null);
    setHistoryError(null);
    setExpandedId(null);
    loadRanks(srv)
      .then(setRanks)
      .catch((e) => { setRanks(null); setError(e instanceof DataError ? e.message : "Failed to load rankings"); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(server); }, [server, load]);

  useEffect(() => { setExpandedId(null); }, [by]);

  function toggleRow(id: number) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (history) return;
    setHistoryError(null);
    const request = ++historyRequest.current;
    loadRanksHistory(server)
      .then((h) => { if (request === historyRequest.current) setHistory(h); })
      .catch((e) => {
        if (request === historyRequest.current) {
          setHistoryError(e instanceof DataError ? e.message : "Failed to load empire history");
        }
      });
  }

  const rows = useMemo(
    () => (ranks ? (by === "power" ? ranks.by_power : ranks.by_planets).map(toRow).filter((x): x is RankRow => x !== null) : null),
    [ranks, by],
  );
  const jumps = ranks?.jumps ?? null;

  const raceCounts = useMemo(() => {
    if (!rows) return [];
    const counts = new Map<string, number>();
    for (const row of rows) {
      const race = row.race || "Unknown";
      counts.set(race, (counts.get(race) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const detail = expandedId !== null && history ? history.get(expandedId) ?? [] : null;

  return (
    <main className="content content--wide">
      <div className="page-head">
        <h1>Top Empires</h1>
      </div>
      <p className="hint" style={{ textAlign: "center" }}>
        Rankings from the real Galactic Conquest, via the game's official API — recorded about every 15 minutes.
      </p>

      {raceCounts.length > 0 && (
        <div className="race-summary">
          {raceCounts.map(([race, count]) => (
            <div className="race-summary__card" key={race}>
              <div className="race-summary__label">{race}</div>
              <div className="race-summary__value">{count}</div>
            </div>
          ))}
        </div>
      )}

      <div className="market-watch-toolbar">
        {(["TB", "RT"] as const).map((s) => (
          <button
            key={s}
            className={`btn btn-sm ${server === s ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setServer(s)}
          >
            {s}
          </button>
        ))}
        <span className="hint" style={{ margin: "0 2px" }}>by</span>
        {(["power", "planets"] as const).map((b) => (
          <button
            key={b}
            className={`btn btn-sm ${by === b ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setBy(b)}
          >
            {b === "power" ? "Power" : "Planets"}
          </button>
        ))}
        <button className="btn btn-sm btn-ghost" onClick={() => load(server)} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
        <RecordedAt iso={ranks?.updated_at ?? null} />
      </div>

      {error && <div className="error">{error}</div>}

      {!rows && !error ? (
        <div className="loading">Loading rankings...</div>
      ) : rows && rows.length === 0 ? (
        <div className="hint">No empires returned.</div>
      ) : rows && rows.length > 0 ? (
        <section className="panel">
          <div className="table-scroll">
            <table className="colony-table market-table">
              <thead>
                <tr>
                  <th className="num">Rank</th>
                  <th>Empire</th>
                  <th>Race</th>
                  <th>Federation</th>
                  <th className="num">Power</th>
                  <th className="num">Planets</th>
                  <th>Protection</th>
                  <th>7d Power Trend</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <tr className="empire-row" onClick={() => toggleRow(row.id)}>
                      <td className="num">{row.rank}</td>
                      <td>{row.name}</td>
                      <td>{row.race}</td>
                      <td>{row.fedName ?? <span className="hint">—</span>}</td>
                      <td className="num" title={full(row.power)}>{compact(row.power)}</td>
                      <td className="num">{full(row.planets)}</td>
                      <td>{row.protected ? <span className="badge-dp">DP</span> : <span className="hint">—</span>}</td>
                      <td><Sparkline values={ranks?.sparklines[row.id] ?? []} /></td>
                    </tr>
                    {expandedId === row.id && (
                      <tr>
                        <td colSpan={8} style={{ padding: 0 }}>
                          <div className="empire-detail-panel">
                            <div className="empire-detail-panel__title">{row.name} — last 7 days</div>
                            {historyError && <div className="error">{historyError}</div>}
                            {!detail && !historyError ? (
                              <div className="loading">Loading history...</div>
                            ) : detail ? (
                              <div className="trend-charts-grid">
                                <TrendChart
                                  title="Power"
                                  points={detail.map((p) => ({ t: p.recorded_at, v: p.power }))}
                                  formatValue={(v) => compact(v)}
                                />
                                <TrendChart
                                  title="Planets"
                                  points={detail.map((p) => ({ t: p.recorded_at, v: p.planets }))}
                                  formatValue={(v) => full(v)}
                                />
                                <TrendChart
                                  title="Rank (lower is better)"
                                  points={detail.map((p) => ({ t: p.recorded_at, v: p.rank }))}
                                  formatValue={(v) => `#${full(v)}`}
                                  invert
                                />
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <div className="power-jumps-section">
        <div className="page-head">
          <h1 style={{ fontSize: 20 }}>Power Activity (24h)</h1>
        </div>
        <p className="hint" style={{ textAlign: "center" }}>
          Every recorded power change, newest first — a big single-poll swing usually means a battle or a mass colony grab.
        </p>
        {!jumps && !error ? (
          <div className="loading">Loading power jumps...</div>
        ) : jumps && jumps.length === 0 ? (
          <div className="hint">No jumps recorded yet — check back once a poll or two has run.</div>
        ) : jumps && jumps.length > 0 ? (
          <section className="panel">
            <div className="table-scroll">
              <table className="colony-table market-table">
                <thead>
                  <tr>
                    <th>Empire</th><th>Race</th>
                    <th className="num">Power Before</th><th className="num">Change</th><th className="num">Power Now</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {jumps.map((j, i) => (
                    <tr key={i}>
                      <td>{decodeEntities(j.name)}</td>
                      <td>{j.race}</td>
                      <td className="num">{full(j.power - j.power_delta)}</td>
                      <td className="num"><PowerJumpBadge delta={j.power_delta} /></td>
                      <td className="num">{full(j.power)}</td>
                      <td>{formatDateTime(j.recorded_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
