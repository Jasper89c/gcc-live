// A tiny inline trend line for a table cell — no axes, no hover, just the shape. Colored by
// direction (var(--pos)/var(--neg)) rather than the neutral accent: unlike the full TrendChart
// this has no value/label alongside it, so color is the only signal and direction is the one
// thing worth carrying at this size.
export default function Sparkline({
  values, width = 72, height = 22,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return <span className="hint">—</span>;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);
  const points = values.map(
    (v, i) => `${(i * stepX).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`
  );
  const up = values[values.length - 1] >= values[0];

  return (
    <svg
      width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      className="sparkline" role="img"
      aria-label={up ? "Trending up over the last 7 days" : "Trending down over the last 7 days"}
    >
      <path d={`M ${points.join(" L ")}`} className={`sparkline__line ${up ? "sparkline__line--pos" : "sparkline__line--neg"}`} />
    </svg>
  );
}
