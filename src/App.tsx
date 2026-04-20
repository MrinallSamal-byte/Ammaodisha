import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { backend } from "./services/backend";
import type { CivicData } from "./types/domain";

interface RouteHistoryState {
  returnProfile?: { id: string; type: "ward" | "mla" | "mp" } | null;
  returnReportId?: string;
}

const AdminPanel = lazy(async () => ({ default: (await import("./components/AdminPanel")).AdminPanel }));
const PublicApp = lazy(async () => ({ default: (await import("./components/PublicApp")).PublicApp }));

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseRoute(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  if (!parts.length || parts[0] === "admin") return null;
  if (["report", "ward", "mla", "mp"].includes(parts[0]) && parts[1]) {
    return { type: parts[0] as "report" | "ward" | "mla" | "mp", id: safeDecode(parts.slice(1).join("/")) };
  }
  return null;
}

export default function App() {
  const [data, setData] = useState<CivicData | null>(null);
  const [error, setError] = useState("");
  const [path, setPath] = useState(() => window.location.pathname);
  const [routeState, setRouteState] = useState<RouteHistoryState>(() => (window.history.state ?? {}) as RouteHistoryState);
  const isAdmin = path === "/admin";

  // Skip the civic-data fetch entirely when on the admin route — the admin panel
  // has its own data loading and does not depend on CivicData.
  useEffect(() => {
    if (isAdmin) return;
    backend
      .fetchCivicData()
      .then(setData)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load civic data."));
  }, [isAdmin]);

  useEffect(() => {
    const onPop = () => {
      setPath(window.location.pathname);
      setRouteState((window.history.state ?? {}) as RouteHistoryState);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((nextPath: string, state: RouteHistoryState = {}) => {
    window.history.pushState(state, "", nextPath);
    setPath(nextPath);
    setRouteState(state);
  }, []);

  const routeSelection = useMemo(() => parseRoute(path), [path]);
  const [autoOpenReport] = useState(() => new URLSearchParams(window.location.search).get("action") === "report");

  // Admin panel is independent — render before any civic-data guards.
  if (isAdmin) {
    return (
      <Suspense
        fallback={
          <main className="loading-state">
            <img src="/logo.png" alt="Amma Odisha" />
            <p>Loading admin panel…</p>
          </main>
        }
      >
        <AdminPanel />
      </Suspense>
    );
  }

  if (error) {
    return (
      <main className="loading-state">
        <img src="/logo.png" alt="Amma Odisha" />
        <h1>Couldn’t load the map</h1>
        <p>Check your connection and try again.<br /><small>{error}</small></p>
        <button onClick={() => location.reload()}>Reload</button>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="loading-state">
        <img src="/logo.png" alt="Amma Odisha" />
        <p>Loading Bhubaneswar ward data…</p>
        <span className="loading-progress" aria-hidden="true" />
        <div className="loading-skeleton-list" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </main>
    );
  }

  return (
    <Suspense
      fallback={
          <main className="loading-state">
            <img src="/logo.png" alt="Amma Odisha" />
            <p>Loading map experience…</p>
          </main>
        }
    >
      <PublicApp
        autoOpenReport={autoOpenReport}
        data={data}
        routeSelection={routeSelection}
        routeState={routeState}
        onDataChange={setData}
        navigate={navigate}
      />
    </Suspense>
  );
}
