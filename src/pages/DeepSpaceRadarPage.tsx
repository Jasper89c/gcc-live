import { useCallback, useEffect, useState } from "react";
import { DataError, loadDsr, type DsrData, type Server } from "../data.ts";
import { compact, decodeEntities, full } from "../format.ts";
import RecordedAt from "../components/RecordedAt";

type Window = "seven_day" | "thirty_day" | "all_time";

const WINDOW_LABEL: Record<Window, string> = {
  seven_day: "Last 7 Days",
  thirty_day: "Last 30 Days",
  all_time: "All Time",
};

interface BattleRow {
  eventId: number;
  foughtAt: string;
  attackerName: string;
  attackerPower: number;
  defenderName: string;
  defenderPower: number;
  attackerWon: boolean;
  coloniesTaken: number;
}

function toBattleRow(raw: Record<string, unknown>): BattleRow | null {
  const eventId = raw.event_id;
  const attacker = raw.attacker as Record<string, unknown> | undefined;
  const defender = raw.defender as Record<string, unknown> | undefined;
  if (typeof eventId !== "number" || !attacker || !defender) return null;
  return {
    eventId,
    foughtAt: typeof raw.fought_at === "string" ? raw.fought_at : "",
    attackerName: typeof attacker.name === "string" ? decodeEntities(attacker.name) : "",
    attackerPower: typeof attacker.power === "number" ? attacker.power : 0,
    defenderName: typeof defender.name === "string" ? decodeEntities(defender.name) : "",
    defenderPower: typeof defender.power === "number" ? defender.power : 0,
    attackerWon: raw.attacker_won === true,
    coloniesTaken: typeof raw.colonies_taken === "number" ? raw.colonies_taken : 0,
  };
}

function formatDateTime(s: string): string {
  // fought_at is the server's own local timestamp string, not ISO — Date() still parses
  // "YYYY-MM-DD HH:MM:SS" correctly in every evergreen browser.
  const d = new Date(s.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function DeepSpaceRadarPage() {
  const [server, setServer] = useState<Server>("RT");
  const [dsr, setDsr] = useState<DsrData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [windowTab, setWindowTab] = useState<Window>("seven_day");

  const load = useCallback((srv: Server) => {
    setLoading(true);
    setError(null);
    loadDsr(srv)
      .then(setDsr)
      .catch((e) => { setDsr(null); setError(e instanceof DataError ? e.message : "Failed to load the battle feed"); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(server); }, [server, load]);

  const battles = dsr ? dsr.battles.map(toBattleRow).filter((x): x is BattleRow => x !== null) : null;
  const activeRows = dsr ? dsr[windowTab] : null;
  const allTimeSince = dsr?.all_time_since ?? null;

  return (
    <main className="content content--wide">
      <div className="page-head">
        <h1>Deep Space Radar</h1>
      </div>
      <p className="hint" style={{ textAlign: "center" }}>
        Server-wide battles picked up by the Deep Space Radar project, via the game's official API — recorded about every 15 minutes.
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
        <RecordedAt iso={dsr?.updated_at ?? null} />
      </div>

      <div className="page-head">
        <h1 style={{ fontSize: 20 }}>Recent Attacks</h1>
      </div>

      {error && <div className="error">{error}</div>}
      {!battles && !error ? (
        <div className="loading">Loading battle feed...</div>
      ) : battles && battles.length === 0 ? (
        <div className="hint">No battles recorded yet.</div>
      ) : battles && battles.length > 0 ? (
        <section className="panel">
          <div className="table-scroll">
            <table className="colony-table market-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Attacker</th>
                  <th>Defender</th>
                  <th>Result</th>
                  <th className="num">Colonies Taken</th>
                </tr>
              </thead>
              <tbody>
                {battles.map((b) => (
                  <tr key={b.eventId}>
                    <td>{formatDateTime(b.foughtAt)}</td>
                    <td title={`Power: ${full(b.attackerPower)}`}>{b.attackerName}</td>
                    <td title={`Power: ${full(b.defenderPower)}`}>{b.defenderName}</td>
                    <td>
                      {b.attackerWon ? (
                        <span className="power-jump power-jump--pos">Attacker won</span>
                      ) : (
                        <span className="power-jump power-jump--neg">Defender held</span>
                      )}
                    </td>
                    <td className="num">{b.coloniesTaken > 0 ? full(b.coloniesTaken) : <span className="hint">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <div className="page-head">
        <h1 style={{ fontSize: 20 }}>Attacker Rankings</h1>
      </div>
      <p className="hint" style={{ textAlign: "center" }}>
        Ranked by hits (attacks made). Win rate and colonies taken are shown for context, not used for ranking.
      </p>

      <div className="market-watch-toolbar">
        {(Object.keys(WINDOW_LABEL) as Window[]).map((w) => (
          <button
            key={w}
            className={`btn btn-sm ${windowTab === w ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setWindowTab(w)}
          >
            {WINDOW_LABEL[w]}
          </button>
        ))}
      </div>
      {windowTab === "all_time" && allTimeSince && (
        <p className="hint" style={{ textAlign: "center" }}>
          Recorded since {formatDateTime(allTimeSince)} — the game's API only exposes recent history, so this is
          "all time since we started tracking," not the server's full history.
        </p>
      )}

      {!dsr && !error ? (
        <div className="loading">Loading rankings...</div>
      ) : activeRows && activeRows.length === 0 ? (
        <div className="hint">No hits recorded in this window yet.</div>
      ) : activeRows && activeRows.length > 0 ? (
        <section className="panel">
          <div className="table-scroll">
            <table className="colony-table market-table">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Empire</th>
                  <th className="num">Hits</th>
                  <th className="num">Wins</th>
                  <th className="num">Win Rate</th>
                  <th className="num">Colonies Taken</th>
                </tr>
              </thead>
              <tbody>
                {activeRows.map((row, i) => (
                  <tr key={row.empire_id}>
                    <td className="num">{i + 1}</td>
                    <td>{decodeEntities(row.name)}</td>
                    <td className="num">{full(row.hits)}</td>
                    <td className="num">{full(row.wins)}</td>
                    <td className="num">{(row.win_rate * 100).toFixed(0)}%</td>
                    <td className="num">{row.colonies_taken > 0 ? full(row.colonies_taken) : compact(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}
