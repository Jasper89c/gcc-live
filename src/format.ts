// Number formatting helpers matching the game's compact style (11.6B, 151.2M, ...).
export function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(1) + "T";
  if (abs >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return Math.round(n).toString();
}

export function full(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

// The live game's API sends empire/federation names with non-Latin characters as HTML
// entities (e.g. &#922;) — decode before display. Harmless on plain text, which round-trips
// unchanged.
export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  const el = document.createElement("textarea");
  el.innerHTML = s;
  return el.value;
}
