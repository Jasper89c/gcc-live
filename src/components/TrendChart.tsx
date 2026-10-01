import { useRef, useState, type PointerEvent } from "react";

export interface TrendPoint {
  t: string; // ISO datetime
  v: number;
}

// A compact single-series line chart for one metric over time (power, planets, rank, ...).
// One hue (var(--accent)) — a single series needs no legend, the card title names it.
const VIEW_W = 320;
const VIEW_H = 130;
const PLOT_X0 = 42;
const PLOT_X1 = VIEW_W - 8;
const PLOT_Y0 = 8;
const PLOT_Y1 = VIEW_H - 20;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function TrendChart({
  title,
  points,
  formatValue = (v: number) => Math.round(v).toLocaleString(),
  invert = false,
}: {
  title: string;
  points: TrendPoint[];
  formatValue?: (v: number) => string;
  invert?: boolean; // true for "lower is better" metrics (rank) — climbing on-screen means improving
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (points.length < 2) {
    return (
      <div className="trend-chart-card">
        <div className="trend-chart-card__title">{title}</div>
        <div className="hint trend-chart-empty">Recording history — check back soon.</div>
      </div>
    );
  }

  const times = points.map((p) => new Date(p.t).getTime());
  const tMin = times[0];
  const tMax = times[times.length - 1];
  const values = points.map((p) => p.v);
  let vMin = Math.min(...values);
  let vMax = Math.max(...values);
  if (vMin === vMax) {
    const bump = Math.max(1, Math.abs(vMin) * 0.1);
    vMin -= bump;
    vMax += bump;
  }
  const pad = (vMax - vMin) * 0.08;
  vMin -= pad;
  vMax += pad;

  const scaleX = (t: number) =>
    PLOT_X0 + (tMax === tMin ? 0.5 : (t - tMin) / (tMax - tMin)) * (PLOT_X1 - PLOT_X0);
  const scaleY = (v: number) => {
    const frac = (v - vMin) / (vMax - vMin);
    return invert ? PLOT_Y0 + frac * (PLOT_Y1 - PLOT_Y0) : PLOT_Y1 - frac * (PLOT_Y1 - PLOT_Y0);
  };

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${scaleX(times[i]).toFixed(1)} ${scaleY(p.v).toFixed(1)}`)
    .join(" ");
  const last = points[points.length - 1];
  const lastX = scaleX(times[times.length - 1]);
  const lastY = scaleY(last.v);
  const yTicks = [vMin, (vMin + vMax) / 2, vMax];

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
    <div className="trend-chart-card">
      <div className="trend-chart-card__title">{title}</div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="trend-chart"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${title} over the last 7 days`}
      >
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={PLOT_X0} x2={PLOT_X1} y1={scaleY(v)} y2={scaleY(v)} className="trend-chart__grid" />
            <text x={PLOT_X0 - 6} y={scaleY(v)} className="trend-chart__ytick" textAnchor="end" dominantBaseline="middle">
              {Math.round(v).toLocaleString()}
            </text>
          </g>
        ))}

        <path d={linePath} className="trend-chart__line" />

        {hoverIdx !== null && (
          <line
            x1={scaleX(times[hoverIdx])} x2={scaleX(times[hoverIdx])}
            y1={PLOT_Y0} y2={PLOT_Y1}
            className="trend-chart__crosshair"
          />
        )}

        <circle cx={lastX} cy={lastY} r={4} className="trend-chart__dot" />

        <text x={PLOT_X0} y={VIEW_H - 4} className="trend-chart__xtick">{formatDate(points[0].t)}</text>
        <text x={PLOT_X1} y={VIEW_H - 4} className="trend-chart__xtick" textAnchor="end">
          {formatDate(points[points.length - 1].t)}
        </text>

        <rect
          x={PLOT_X0} y={PLOT_Y0} width={PLOT_X1 - PLOT_X0} height={PLOT_Y1 - PLOT_Y0}
          fill="transparent"
          onPointerMove={handleMove}
          onPointerLeave={() => setHoverIdx(null)}
        />
      </svg>

      <div className="trend-chart__readout">
        <strong>{formatValue(readoutPoint.v)}</strong>
        <span className="hint trend-chart__readout-date">{isLive ? "now" : formatDateTime(readoutPoint.t)}</span>
      </div>
    </div>
  );
}
