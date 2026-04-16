import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { backend } from "./services/backend";
import type { CivicData } from "./types/domain";

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
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((nextPath: string) => {
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
  }, []);

  const routeSelection = useMemo(() => parseRoute(path), [path]);

  // Admin panel is independent — render before any civic-data guards.
  if (isAdmin) {
    return (
      <Suspense
        fallback={
          <main className="loading-state">
            <img src="/Favicon.svg" alt="" />
            <p>Loading admin panel...</p>
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
        <img src="/Favicon.svg" alt="" />
        <h1>Could not load Amma Odisha</h1>
        <p>{error}</p>
        <button onClick={() => location.reload()}>Try again</button>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="loading-state">
        <img src="/Favicon.svg" alt="" />
        <p>Fetching Bhubaneswar ward data...</p>
        <span className="loading-progress" aria-hidden="true" />
      </main>
    );
  }

  return (
    <Suspense
      fallback={
        <main className="loading-state">
          <img src="/Favicon.svg" alt="" />
          <p>Loading map experience...</p>
        </main>
      }
    >
      <PublicApp data={data} routeSelection={routeSelection} onDataChange={setData} navigate={navigate} />
    </Suspense>
  );
}
