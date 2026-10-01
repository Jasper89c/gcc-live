# GCC Live (standalone)

Top Empires, Deep Space Radar and Market Watch from gcc.jasperlabs.uk as one static site,
live at https://jasper89c.github.io/gcc-live/. There is no server: a scheduled GitHub
Actions job records data from the game's official API, and the pages read what it recorded.

| Page | Address |
|---|---|
| Top Empires | https://jasper89c.github.io/gcc-live/#/top-empires |
| Deep Space Radar | https://jasper89c.github.io/gcc-live/#/deep-space-radar |
| Market Watch | https://jasper89c.github.io/gcc-live/#/market-watch |

## How it works

1. **The recorder** (`.github/workflows/poll.yml`, running `scripts/poll.mjs`) starts about
   every 15 minutes. It calls the game's API with the key held in the repository secret
   `GCC_API_KEY`, adds the results to the recorded data and republishes the site.
2. **The recorded data** lives on the `data` branch, as a single commit that is replaced on
   every run (so the repository doesn't grow). It is both what the pages show and the
   recorder's memory: 7 days of market prices and empire rankings, 30 days of battles, and
   all-time attacker tallies.
3. **The site** is `docs/index.html` from `main` plus the data files under `data/`.

The API key never reaches the browser; the pages only ever fetch the recorded JSON files.

## What to expect

- Everything shown is as of the recorder's last run. Each page says how long ago that was,
  and flags it when the recorder is more than an hour behind.
- GitHub starts scheduled jobs late when it is busy, so the gap is often longer than 15
  minutes.
- GitHub switches scheduled workflows off in a repository that has had no activity for 60
  days, and emails the owner first. Re-enable it on the repository's Actions tab if so.
- The battle feed needs the key's account to keep its Deep Space Radar project running
  in-game. If that lapses, the battle section stops updating; the other two carry on.
- "All time" battle rankings reach back only as far as the first run could fetch (the
  newest 5,000 battles per server at the time).
- The recorded data is public, like the pages.

## Looking after it

**The recorder failed or is stuck.** Open the repository's Actions tab → "Record and
publish". A failed run leaves the published site as it was. "Run workflow" starts one by
hand. If only one section failed (say the market call), the run still succeeds and
`data/status.json` on the site lists what went wrong.

**The API key changed.** Settings → Secrets and variables → Actions → `GCC_API_KEY` → update.

**Starting the history again.** Delete the `data` branch; the next run starts from empty.

## Layout

| Path | What it is |
|---|---|
| `scripts/poll.mjs` | The recorder — a port of the poller in the GCR backend's `app/api/gcc_live.py` |
| `.github/workflows/poll.yml` | Schedule, data-branch handling and site publishing |
| `src/data.ts` | Loads the recorded files for the pages |
| `src/pages/` | The three pages — the GCR site's pages with the API calls replaced and the links to empire/federation profiles removed |
| `src/components/` | Charts copied from the GCR site, plus the "Recorded N min ago" label |
| `test/poll.test.mjs` | Runs the recorder against a stand-in API |
| `docs/index.html` | The built site (one self-contained file) |

## Develop

```
npm install
npm test         # recorder tests
npm run build    # rebuild docs/index.html

# Preview with real data: record into docs/data (ignored by git), then serve docs/
GCC_API_KEY=... node scripts/poll.mjs docs/data
npx vite preview
```

A push to `main` republishes the site straight away, along with a fresh recording.
