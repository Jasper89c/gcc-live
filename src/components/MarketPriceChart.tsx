import { useRef, useState, type PointerEvent } from "react";
import type { GccMarketHistoryPoint } from "../data.ts";
import { compact, full } from "../format.ts";

// A single-series (avg price) line chart with a min–max range band, for one good's 7-day
// history. One hue (var(--accent)) throughout — a single series needs no legend, the card
// title already names what's plotted.
const VIEW_W = 480;
const VIEW_H = 160;
const PLOT_X0 = 46;
const PLOT_X1 = VIEW_W - 10;
const PLOT_Y0 = 10;
const PLOT_Y1 = VIEW_H - 22;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// Consecutive points that actually traded (avg_price present) — a gap in trading breaks the
// line instead of interpolating a price across it.
function splitRuns(points: GccMarketHistoryPoint[]): GccMarketHistoryPoint[][] {
  const runs: GccMarketHistoryPoint[][] = [];
  let current: GccMarketHistoryPoint[] = [];
  for (const p of points) {
    if (p.avg_price === null) {
      if (current.length) runs.push(current);
      current = [];
    } else {
      current.push(p);
    }
  }
  if (current.length) runs.push(current);
  return runs;
}

export default function MarketPriceChart({ good, points }: { good: string; points: GccMarketHistoryPoint[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const traded = points.filter((p) => p.avg_price !== null);

  if (points.length < 2 || traded.length === 0) {
    return (
      <div className="panel market-chart-card">
        <div className="market-chart-card__title">{good}</div>
        <div className="hint market-chart-empty">
          {points.length < 2
            ? "Recording price history — check back soon for a 7-day chart."
            : "No trades recorded in the last 7 days."}
        </div>
      </div>
    );
  }

  const times = points.map((p) => new Date(p.recorded_at).getTime());
  const tMin = times[0];
  const tMax = times[times.length - 1];

  const lows = traded.map((p) => p.min_price as number);
  const highs = traded.map((p) => p.max_price as number);
  let yMin = Math.min(...lows);
  let yMax = Math.max(...highs);
  if (yMin === yMax) {
    const bump = Math.max(1, yMin * 0.1);
    yMin -= bump;
    yMax += bump;
  }
  const pad = (yMax - yMin) * 0.08;
  yMin = Math.max(0, yMin - pad);
  yMax += pad;

  const scaleX = (t: number) =>
    PLOT_X0 + (tMax === tMin ? 0.5 : (t - tMin) / (tMax - tMin)) * (PLOT_X1 - PLOT_X0);
  const scaleY = (v: number) => PLOT_Y1 - ((v - yMin) / (yMax - yMin)) * (PLOT_Y1 - PLOT_Y0);

  const runs = splitRuns(points);

  const linePath = runs
    .map((run) =>
      run
        .map((p, i) => {
          const cmd = i === 0 ? "M" : "L";
          return `${cmd} ${scaleX(new Date(p.recorded_at).getTime()).toFixed(1)} ${scaleY(p.avg_price as number).toFixed(1)}`;
        })
        .join(" ")
    )
    .join(" ");

  const bandPath = runs
    .map((run) => {
      const top = run.map(
        (p) => `${scaleX(new Date(p.recorded_at).getTime()).toFixed(1)} ${scaleY(p.max_price as number).toFixed(1)}`
      );
      const bottom = [...run]
        .reverse()
        .map((p) => `${scaleX(new Date(p.recorded_at).getTime()).toFixed(1)} ${scaleY(p.min_price as number).toFixed(1)}`);
      return `M ${top.join(" L ")} L ${bottom.join(" L ")} Z`;
    })
    .join(" ");

  const last = traded[traded.length - 1];
  const lastX = scaleX(new Date(last.recorded_at).getTime());
  const lastY = scaleY(last.avg_price as number);
  const yTicks = [yMin, (yMin + yMax) / 2, yMax];

  function handleMove(e: PointerEvent<SVGRectElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * VIEW_W;
    const t = tMin + ((svgX - PLOT_X0) / (PLOT_X1 - PLOT_X0)) * (tMax - tMin);
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < times.length; i++) {
      const d = Math.abs(times[i] - t);
      if (d < best) {
        best = d;
        nearest = i;
      }
    }
    setHoverIdx(nearest);
  }

  const readoutPoint = hoverIdx !== null ? points[hoverIdx] : last;
  const isLive = hoverIdx === null;

  return (
    <div className="panel market-chart-card">
      <div className="market-chart-card__title">{good}</div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="market-chart"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${good} average price over the last 7 days`}
      >
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={PLOT_X0} x2={PLOT_X1} y1={scaleY(v)} y2={scaleY(v)} className="market-chart__grid" />
            <text x={PLOT_X0 - 6} y={scaleY(v)} className="market-chart__ytick" textAnchor="end" dominantBaseline="middle">
              {compact(v)}
            </text>
          </g>
        ))}

        <path d={bandPath} className="market-chart__band" />
        <path d={linePath} className="market-chart__line" />

        {hoverIdx !== null && points[hoverIdx].avg_price !== null && (
          <line
            x1={scaleX(times[hoverIdx])} x2={scaleX(times[hoverIdx])}
            y1={PLOT_Y0} y2={PLOT_Y1}
            className="market-chart__crosshair"
          />
        )}

        <circle cx={lastX} cy={lastY} r={4} className="market-chart__dot" />
        <text x={Math.min(lastX + 7, VIEW_W - 2)} y={lastY} className="market-chart__endlabel" dominantBaseline="middle">
          {compact(last.avg_price as number)}
        </text>

        <text x={PLOT_X0} y={VIEW_H - 6} className="market-chart__xtick">{formatDate(points[0].recorded_at)}</text>
        <text x={PLOT_X1} y={VIEW_H - 6} className="market-chart__xtick" textAnchor="end">
          {formatDate(points[points.length - 1].recorded_at)}
        </text>

        <rect
          x={PLOT_X0} y={PLOT_Y0} width={PLOT_X1 - PLOT_X0} height={PLOT_Y1 - PLOT_Y0}
          fill="transparent"
          onPointerMove={handleMove}
          onPointerLeave={() => setHoverIdx(null)}
        />
      </svg>

      <div className="market-chart__readout">
        <span className="market-chart__readout-key" />
        {readoutPoint.avg_price === null ? (
          <span className="hint">No trades — {formatDateTime(readoutPoint.recorded_at)}</span>
        ) : (
          <>
            <strong>{full(readoutPoint.avg_price)}</strong>
            <span className="hint"> avg ({full(readoutPoint.min_price as number)}–{full(readoutPoint.max_price as number)})</span>
            <span className="hint"> · {full(readoutPoint.units)} units · {readoutPoint.sellers} seller{readoutPoint.sellers === 1 ? "" : "s"}</span>
            <span className="hint market-chart__readout-date">
              {isLive ? "now" : formatDateTime(readoutPoint.recorded_at)}
            </span>
          </>
        )}
      </div>

      <details className="market-chart__table-toggle">
        <summary>View as table</summary>
        <div className="table-scroll">
          <table className="colony-table">
            <thead>
              <tr>
                <th>Date</th><th className="num">Min</th><th className="num">Avg</th>
                <th className="num">Max</th><th className="num">Units</th><th className="num">Sellers</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.recorded_at}>
                  <td>{formatDateTime(p.recorded_at)}</td>
                  <td className="num">{p.min_price === null ? "—" : full(p.min_price)}</td>
                  <td className="num">{p.avg_price === null ? "—" : full(p.avg_price)}</td>
                  <td className="num">{p.max_price === null ? "—" : full(p.max_price)}</td>
                  <td className="num">{compact(p.units)}</td>
                  <td className="num">{p.sellers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
