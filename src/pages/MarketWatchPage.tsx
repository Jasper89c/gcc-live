import { useCallback, useEffect, useState } from "react";
import { DataError, loadMarket, type GccMarketHistoryPoint, type MarketData, type Server } from "../data.ts";
import { compact, decodeEntities, full } from "../format.ts";
import MarketPriceChart from "../components/MarketPriceChart";
import RecordedAt from "../components/RecordedAt";

type Row = Record<string, unknown>;

// Actual market.prices row shape (confirmed live 2026-09-02):
// { good, good_id, units, sellers, min_price, avg_price, max_price, book_value }
// Still discovered from the response rather than hard-coded, in case the upstream API adds
// or renames fields later — this just controls display order for the ones we know about.
const PREFERRED_COLUMNS = ["good", "units", "sellers", "min_price", "avg_price", "max_price", "book_value"];
// good_id is an internal id with no display value alongside the good's name.
const HIDDEN_COLUMNS = new Set(["good_id"]);

function columnsFor(rows: Row[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) if (!HIDDEN_COLUMNS.has(key)) seen.add(key);
  return [...seen].sort((a, b) => {
    const ia = PREFERRED_COLUMNS.indexOf(a), ib = PREFERRED_COLUMNS.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

function label(col: string): string {
  return col.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return compact(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return decodeEntities(value);
  return JSON.stringify(value);
}

const DAY_MS = 24 * 60 * 60 * 1000;

// % change from the history point nearest 24h ago to `currentAvg`. Returns null when there
// isn't a real ~24h-old reading yet (fresh good, or the recorder hasn't been running long
// enough) rather than comparing against whatever's oldest and calling it "24h".
function change24h(history: GccMarketHistoryPoint[], currentAvg: number | null): number | null {
  if (currentAvg === null || history.length === 0) return null;
  const targetT = Date.now() - DAY_MS;
  if (new Date(history[0].recorded_at).getTime() > targetT) return null;

  let best: GccMarketHistoryPoint | null = null;
  let bestDiff = Infinity;
  for (const p of history) {
    if (p.avg_price === null) continue;
    const diff = Math.abs(new Date(p.recorded_at).getTime() - targetT);
    if (diff < bestDiff) { bestDiff = diff; best = p; }
  }
  if (!best || best.avg_price === null || best.avg_price === 0) return null;
  return ((currentAvg - best.avg_price) / best.avg_price) * 100;
}

function ChangeBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="hint">—</span>;
  const rounded = Math.round(pct * 10) / 10;
  if (Math.abs(rounded) < 0.05) {
    return <span className="market-change market-change--flat">0.0%</span>;
  }
  const up = rounded > 0;
  return (
    <span className={`market-change ${up ? "market-change--pos" : "market-change--neg"}`}>
      {up ? "▲" : "▼"} {up ? "+" : ""}{rounded.toFixed(1)}%
    </span>
  );
}

export default function MarketWatchPage() {
  const [server, setServer] = useState<Server>("RT");
  const [market, setMarket] = useState<MarketData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback((srv: Server) => {
    setLoading(true);
    setError(null);
    loadMarket(srv)
      .then(setMarket)
      .catch((e) => { setMarket(null); setError(e instanceof DataError ? e.message : "Failed to load market data"); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(server); }, [server, load]);

  const rows = market?.prices ?? null;
  const historyByGood = market?.historyByGood ?? new Map<string, GccMarketHistoryPoint[]>();
  const cols = rows ? columnsFor(rows) : [];

  // Chart one good per row currently listed, in the same order as the price table above.
  const goods = rows ? rows.map((r) => String(r.good ?? "")).filter(Boolean) : [];

  return (
    <main className="content content--wide">
      <div className="page-head">
        <h1>Market Watch</h1>
      </div>
      <p className="hint" style={{ textAlign: "center" }}>
        Prices from the real Galactic Conquest market, via the game's official API — recorded about every 15 minutes.
      </p>

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
        <button className="btn btn-sm btn-ghost" onClick={() => load(server)} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
        <RecordedAt iso={market?.updatedAt ?? null} />
      </div>

      {error && <div className="error">{error}</div>}

      {!rows && !error ? (
        <div className="loading">Loading market...</div>
      ) : rows && rows.length === 0 && !error ? (
        <div className="hint">No market data returned.</div>
      ) : rows && rows.length > 0 ? (
        <section className="panel">
          <div className="table-scroll">
            <table className="colony-table market-table">
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th key={c} className={typeof rows[0][c] === "number" ? "num" : undefined}>
                      {label(c)}
                    </th>
                  ))}
                  <th className="num">24h Δ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const good = String(row.good ?? "");
                  const currentAvg = typeof row.avg_price === "number" ? row.avg_price : null;
                  const pct = change24h(historyByGood.get(good) ?? [], currentAvg);
                  return (
                    <tr key={i}>
                      {cols.map((c) => (
                        <td
                          key={c}
                          className={typeof row[c] === "number" ? "num" : undefined}
                          title={typeof row[c] === "number" ? full(row[c] as number) : undefined}
                        >
                          {formatCell(row[c])}
                        </td>
                      ))}
                      <td className="num"><ChangeBadge pct={pct} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {goods.length > 0 && (
        <>
          <div className="page-head">
            <h1 style={{ fontSize: 20 }}>Price History (7 days)</h1>
          </div>
          <div className="market-charts-grid">
            {goods.map((good) => (
              <MarketPriceChart key={good} good={good} points={historyByGood.get(good) ?? []} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}
