// "Recorded N min ago" for the toolbar. The data is only as fresh as the recorder's last
// scheduled run (about every 15 minutes, and GitHub can start scheduled jobs late), so a
// reading that's well overdue is flagged rather than passed off as current.
const STALE_AFTER_MINS = 60;

function ago(mins: number): string {
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ${mins % 60}m ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

export default function RecordedAt({ iso }: { iso: string | null }) {
  if (!iso) return null;
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  const stale = mins >= STALE_AFTER_MINS;
  return (
    <span className="hint" style={stale ? { color: "var(--warn)" } : undefined} title={new Date(iso).toLocaleString()}>
      Recorded {ago(mins)}{stale ? " — the recorder is running late" : ""}
    </span>
  );
}
