import { useEffect, useMemo, useState } from "react";
import { AdminPanel } from "./components/AdminPanel";
import { PublicApp } from "./components/PublicApp";
import { backend } from "./services/backend";
import type { CivicData } from "./types/domain";

function parseRoute(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  if (!parts.length || parts[0] === "admin") return null;
  if (["report", "ward", "mla", "mp"].includes(parts[0]) && parts[1]) {
    return { type: parts[0] as "report" | "ward" | "mla" | "mp", id: decodeURIComponent(parts.slice(1).join("/")) };
  }
  return null;
}

export default function App() {
  const [data, setData] = useState<CivicData | null>(null);
  const [error, setError] = useState("");
  const [path, setPath] = useState(() => window.location.pathname);
  const isAdmin = path === "/admin";

  useEffect(() => {
    backend
      .fetchCivicData()
      .then(setData)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load civic data."));
  }, []);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = (nextPath: string) => {
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
  };

  const routeSelection = useMemo(() => parseRoute(path), [path]);

  if (isAdmin) return <AdminPanel />;

  if (error) {
    return (
      <main className="loading-state">
        <img src="/Favicon.svg" alt="" />
        <h1>Could not load NammaKasa</h1>
        <p>{error}</p>
        <button onClick={() => location.reload()}>Try again</button>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="loading-state">
        <img src="/Favicon.svg" alt="" />
        <p>Loading...</p>
      </main>
    );
  }

  return <PublicApp data={data} routeSelection={routeSelection} onDataChange={setData} navigate={navigate} />;
}
