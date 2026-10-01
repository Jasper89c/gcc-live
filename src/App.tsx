import { useEffect, useState } from "react";
import DeepSpaceRadarPage from "./pages/DeepSpaceRadarPage";
import MarketWatchPage from "./pages/MarketWatchPage";
import TopEmpiresPage from "./pages/TopEmpiresPage";

// One static site, three pages. Routing is by URL hash (#/market-watch) so every page works
// from the single index.html GitHub Pages serves, with no server-side routing to configure.
const PAGES = [
  { path: "top-empires", title: "Top Empires", Page: TopEmpiresPage },
  { path: "deep-space-radar", title: "Deep Space Radar", Page: DeepSpaceRadarPage },
  { path: "market-watch", title: "Market Watch", Page: MarketWatchPage },
];

const currentPath = () => window.location.hash.replace(/^#\/?/, "");

export default function App() {
  const [path, setPath] = useState(currentPath);

  useEffect(() => {
    const onHashChange = () => setPath(currentPath());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const page = PAGES.find((p) => p.path === path) ?? PAGES[0];

  useEffect(() => { document.title = `${page.title} — GCC`; }, [page]);

  return (
    <div className="app">
      <header className="topbar topbar--standalone toolsbar">
        <span className="topbar-brand toolsbar__brand">GCC</span>
        <nav className="toolsbar__links">
          {PAGES.map((p) => (
            <a key={p.path} className={`toolsbar__link${p === page ? " is-active" : ""}`} href={`#/${p.path}`}>
              {p.title}
            </a>
          ))}
        </nav>
      </header>
      <page.Page />
    </div>
  );
}
