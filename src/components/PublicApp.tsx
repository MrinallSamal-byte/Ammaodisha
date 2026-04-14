import clsx from "clsx";
import {
  ArrowUpRight,
  BarChart3,
  Camera,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Home,
  Info,
  Layers,
  List,
  LoaderCircle,
  Map as MapIcon,
  MessageCircle,
  Plus,
  RefreshCw,
  Send,
  Share2,
  ShieldCheck,
  Sparkles,
  ThumbsUp,
  Trophy,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MapView } from "./MapView";
import { CHANGELOG, CATEGORIES, SEVERITY, STATUS_LABELS } from "../services/constants";
import { backend } from "../services/backend";
import { findNearestWard, findWardInGeoJson, isInsideCity } from "../services/geo";
import { canSubmitReport, hasUpvoted } from "../services/limits";
import { generateBMCComplaint, getReportShareText, getWhatsAppUrl } from "../services/share";
import { daysActive, timeAgo } from "../services/time";
import type {
  CivicData,
  GarbageReport,
  NewReportInput,
  Representative,
  SeverityKey,
  Ward,
  WasteCategory
} from "../types/domain";

type RouteSelection =
  | { type: "report"; id: string }
  | { type: "ward"; id: string }
  | { type: "mla"; id: string }
  | { type: "mp"; id: string }
  | null;

interface PublicAppProps {
  data: CivicData;
  routeSelection: RouteSelection;
  onDataChange: (data: CivicData) => void;
  navigate: (path: string) => void;
}

function normalizeWardText(value?: string | null) {
  return (value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function getDistinctWardName(ward?: Pick<Ward, "ward_number" | "ward_name"> | null) {
  if (!ward) return "";

  const wardName = ward.ward_name?.trim() || "";
  if (!wardName) return "";

  const normalized = normalizeWardText(wardName);
  const match = normalized.match(/^ward(?:\s+no\.?)?[\s#:-]*0*(\d+)$/);
  if (match && Number(match[1]) === ward.ward_number) {
    return "";
  }
  return wardName;
}

function getWardSelectLabel(ward: Ward) {
  const distinctName = getDistinctWardName(ward);
  return distinctName ? `Ward ${ward.ward_number} - ${distinctName}` : `Ward ${ward.ward_number}`;
}

export function PublicApp({ data, routeSelection, onDataChange, navigate }: PublicAppProps) {
  const [reports, setReports] = useState(data.reports);
  const [selectedReport, setSelectedReport] = useState<GarbageReport | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<RouteSelection>(null);
  const [focusWardNumber, setFocusWardNumber] = useState<number | null>(null);
  const [focusRequestId, setFocusRequestId] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "upvotes" | "oldest">("newest");
  const [wardFilterNumber, setWardFilterNumber] = useState<number | null>(null);
  const [wardFilterState, setWardFilterState] = useState<"idle" | "locating" | "error">("idle");
  const [showReportForm, setShowReportForm] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [showIntro, setShowIntro] = useState(() => localStorage.getItem("nk_intro_seen") !== "1");
  const [showAbout, setShowAbout] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [showCivicNotice, setShowCivicNotice] = useState(() => localStorage.getItem("nk_civic_hidden") !== "1");
  const [viewMode, setViewMode] = useState<"map" | "list">("map");
  const [severityFilter, setSeverityFilter] = useState<"all" | SeverityKey>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "unresolved" | "resolved">("all");
  const [refreshing, setRefreshing] = useState(false);

  const wardsByNumber = useMemo(() => new globalThis.Map(data.wards.map((ward) => [ward.ward_number, ward])), [data.wards]);

  useEffect(() => {
    setReports(data.reports);
  }, [data.reports]);

  // Sync modal visibility with browser navigation (back/forward buttons).
  // When the URL returns to "/" (routeSelection === null) any open detail panel
  // should close so the UI and URL stay in sync.
  // Both selectedReport AND selectedProfile are cleared in each branch to
  // prevent two modals rendering simultaneously when navigating between routes
  // (e.g. /report/abc → /ward/5 must close ReportDetail before opening ProfileSheet).
  useEffect(() => {
    if (!routeSelection) {
      setSelectedReport(null);
      setSelectedProfile(null);
      return;
    }
    if (routeSelection.type === "report") {
      const report = reports.find((item) => item.id === routeSelection.id);
      if (report) setSelectedReport(report);
      setSelectedProfile(null);
    } else {
      setSelectedProfile(routeSelection);
      setSelectedReport(null);
    }
  }, [reports, routeSelection]);

  const filteredReports = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return reports.filter((report) => {
      if (severityFilter !== "all" && report.severity !== severityFilter) return false;
      if (statusFilter !== "all" && report.status !== statusFilter) return false;
      if (wardFilterNumber != null && report.ward_number !== wardFilterNumber) return false;
      if (!query) return true;
      const ward = wardsByNumber.get(report.ward_number);
      const haystack = `${report.address} ${ward?.ward_name ?? ""} ward ${report.ward_number}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [reports, severityFilter, statusFilter, wardFilterNumber, searchQuery, wardsByNumber]);

  const visibleReports = useMemo(() => {
    const next = [...filteredReports];
    if (sortBy === "upvotes") {
      next.sort((a, b) => (b.upvote_count ?? 0) - (a.upvote_count ?? 0));
      return next;
    }
    if (sortBy === "oldest") {
      next.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
      return next;
    }
    next.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    return next;
  }, [filteredReports, sortBy]);

  const unresolved = reports.filter((report) => report.status !== "resolved");
  const resolved = reports.filter((report) => report.status === "resolved");
  const worstWards = useMemo(() => getWorstWards(filteredReports, data.wards), [filteredReports, data.wards]);
  const filteredWard = wardFilterNumber != null ? wardsByNumber.get(wardFilterNumber) : null;

  // Refresh: surface errors as a brief visual indicator rather than silently failing.
  const refreshReports = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const nextReports = await backend.fetchReports();
      setReports(nextReports);
      onDataChange({ ...data, reports: nextReports });
    } catch (err) {
      console.error("Refresh failed", err);
      // Data remains unchanged; we do not wipe existing reports on fetch failure.
    } finally {
      setRefreshing(false);
    }
  };

  const updateReport = (updated: GarbageReport) => {
    const nextReports = reports.map((report) => (report.id === updated.id ? updated : report));
    setReports(nextReports);
    setSelectedReport(updated);
    onDataChange({ ...data, reports: nextReports });
  };

  const onSubmitted = (report: GarbageReport) => {
    const nextReports = [report, ...reports];
    setReports(nextReports);
    onDataChange({ ...data, reports: nextReports });
    setShowReportForm(false);
    setSelectedReport(report);
    navigate(`/report/${report.id}`);
  };

  const dismissIntro = () => {
    localStorage.setItem("nk_intro_seen", "1");
    setShowIntro(false);
  };

  const focusWardOnMap = useCallback((wardNumber: number) => {
    setFocusWardNumber(wardNumber);
    setFocusRequestId((id) => id + 1);
  }, []);

  const detectAndFilterMyWard = useCallback(() => {
    if (!navigator.geolocation) {
      setWardFilterState("error");
      return;
    }
    setWardFilterState("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        if (!isInsideCity(lat, lng)) {
          setWardFilterState("error");
          return;
        }
        const ward = findWardInGeoJson(lat, lng, data.wards, data.wardBoundaries) ?? findNearestWard(lat, lng, data.wards);
        if (!ward) {
          setWardFilterState("error");
          return;
        }
        setWardFilterNumber(ward.ward_number);
        focusWardOnMap(ward.ward_number);
        setWardFilterState("idle");
      },
      () => setWardFilterState("error"),
      { enableHighAccuracy: true, timeout: 9000 }
    );
  }, [data.wardBoundaries, data.wards, focusWardOnMap]);

  const clearFilters = useCallback(() => {
    setSeverityFilter("all");
    setStatusFilter("all");
    setWardFilterNumber(null);
    setSearchQuery("");
    setSortBy("newest");
    setWardFilterState("idle");
  }, []);

  useEffect(() => {
    if (routeSelection?.type !== "ward") return;
    const wardNumber = Number(routeSelection.id);
    if (Number.isFinite(wardNumber)) {
      focusWardOnMap(wardNumber);
    }
  }, [focusWardOnMap, routeSelection]);

  const handleMapReportSelect = useCallback(
    (report: GarbageReport) => {
      setSelectedReport(report);
      navigate(`/report/${report.id}`);
    },
    [navigate]
  );

  const handleMapWardSelect = useCallback(
    (wardNumber: number) => {
      focusWardOnMap(wardNumber);
      setSelectedProfile({ type: "ward", id: String(wardNumber) });
      navigate(`/ward/${wardNumber}`);
    },
    [focusWardOnMap, navigate]
  );

  return (
    <div className={clsx("app-frame", !showCivicNotice && "civic-hidden")}>
      <MapView
        reports={visibleReports}
        wardBoundaries={data.wardBoundaries}
        onSelectReport={handleMapReportSelect}
        onSelectWard={handleMapWardSelect}
        focusWardNumber={focusWardNumber}
        focusRequestId={focusRequestId}
      />

      <header className="topbar safe-top">
        <button className="brand-chip" onClick={() => navigate("/")} aria-label="Go to Amma Odisha map">
          <span className="brand-wordmark">
            <strong>
              Amma <b>Odisha</b>
            </strong>
            {/* Version badge — opens the changelog on click */}
            <small
              role="button"
              tabIndex={0}
              style={{ cursor: "pointer", textDecoration: "underline dotted" }}
              title="View changelog"
              onClick={(e) => { e.stopPropagation(); setShowChangelog(true); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setShowChangelog(true); } }}
            >
              v0.3.0
            </small>
          </span>
        </button>
        <div className="topbar-actions">
          <button
            className="icon-button"
            onClick={() => setShowAbout(true)}
            aria-label="About Amma Odisha"
            title="About"
          >
            <Info size={17} />
          </button>
          <a className="icon-button" href="https://x.com/MrinallSamal" target="_blank" rel="noreferrer" aria-label="Follow on X">
            <X size={17} />
          </a>
        </div>
      </header>

      {showCivicNotice && (
        <section className="civic-notice" aria-label="Amma Odisha civic reporting context">
          <Home size={15} />
          <span>
            <strong>Amma Odisha</strong>{" "}
            Report, verify, and track ward accountability across Bhubaneswar. →{" "}
            <a href="https://ammaodisha.me" target="_blank" rel="noreferrer"><strong>ammaodisha.me</strong></a>
          </span>
          <button type="button" className="civic-dismiss" onClick={() => { localStorage.setItem("nk_civic_hidden", "1"); setShowCivicNotice(false); }} aria-label="Dismiss notice">
            <X size={14} />
          </button>
        </section>
      )}

      <section className="control-dock" aria-label="Filter reports">
        <div className="control-grid">
          <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as "all" | SeverityKey)} aria-label="Filter by severity">
            <option value="all">All Severity</option>
            {Object.entries(SEVERITY).map(([key, value]) => (
              <option value={key} key={key}>
                {value.label}
              </option>
            ))}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | "unresolved" | "resolved")} aria-label="Filter by status">
            <option value="all">All Status</option>
            <option value="unresolved">Unresolved</option>
            <option value="resolved">Cleaned</option>
          </select>
          <input
            className="search-control"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search locality, ward, landmark"
            aria-label="Search reports"
          />
          <select
            className="sort-control"
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as "newest" | "upvotes" | "oldest")}
            aria-label="Sort reports"
          >
            <option value="newest">Newest</option>
            <option value="upvotes">Most Upvoted</option>
            <option value="oldest">Oldest</option>
          </select>
        </div>
        <div className="map-mode-toggle">
          <SegmentedButton active={viewMode === "map"} onClick={() => setViewMode("map")} icon={<MapIcon size={14} />} label="Map" />
          <SegmentedButton active={viewMode === "list"} onClick={() => setViewMode("list")} icon={<List size={14} />} label="List" />
        </div>
        <div className="quick-actions-row">
          <button className={clsx("chip-button", wardFilterNumber != null && "is-active")} onClick={detectAndFilterMyWard} type="button">
            {wardFilterState === "locating" ? <LoaderCircle className="spin" size={14} /> : <Layers size={14} />}
            {wardFilterNumber != null ? `Ward ${wardFilterNumber}` : "Use My Ward"}
          </button>
          <button className="chip-button" onClick={clearFilters} type="button">
            <X size={14} />
            Clear
          </button>
          <button
            className="chip-button refresh-chip"
            onClick={() => void refreshReports()}
            type="button"
            disabled={refreshing}
            aria-label="Refresh reports"
          >
            {refreshing ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
            Refresh
          </button>
        </div>
        {wardFilterState === "error" && <p className="control-error">Could not detect your location inside Bhubaneswar. You can still filter manually.</p>}
      </section>

      {viewMode === "list" && (
        <div className="list-overlay">
          <ReportList reports={visibleReports} wards={data.wards} representatives={data.representatives} onSelect={handleMapReportSelect} />
        </div>
      )}

      <section className="stats-strip" aria-label="Amma Odisha report statistics">
        <Stat label="Active" value={unresolved.length} tone="red" />
        <Stat label="Reports" value={reports.length} tone="gray" />
      </section>

      <footer className="bottom-action-bar safe-bottom">
        <button className="primary-cta" onClick={() => setShowReportForm(true)}>
          <Plus size={19} />
          Report Garbage
        </button>
        <button className="insights-button" type="button" onClick={() => setShowInsights(true)} aria-label="Open Amma Odisha insights">
          <BarChart3 size={18} />
          <span>
            <strong>{visibleReports.length}</strong>
          </span>
        </button>
      </footer>

      {showIntro && <IntroOverlay onClose={dismissIntro} />}
      {showAbout && <AboutSheet onClose={() => setShowAbout(false)} onOpenChangelog={() => { setShowAbout(false); setShowChangelog(true); }} />}
      {showChangelog && <ChangelogSheet onClose={() => setShowChangelog(false)} />}
      {showInsights && (
        <InsightsSheet
          reports={reports}
          visibleReports={visibleReports}
          filteredWardNumber={filteredWard?.ward_number ?? null}
          unresolvedCount={unresolved.length}
          resolvedCount={resolved.length}
          worstWards={worstWards}
          onClose={() => setShowInsights(false)}
          onOpenWard={(wardNumber) => {
            setShowInsights(false);
            focusWardOnMap(wardNumber);
            setSelectedProfile({ type: "ward", id: String(wardNumber) });
            navigate(`/ward/${wardNumber}`);
          }}
        />
      )}
      {!showIntro && !showReportForm && !selectedReport && !selectedProfile && !showInsights && <TelegramToast />}
      {showReportForm && <ReportForm data={data} onClose={() => setShowReportForm(false)} onSubmit={onSubmitted} />}
      {selectedReport && (
        <ReportDetail
          report={selectedReport}
          data={data}
          onClose={() => {
            setSelectedReport(null);
            navigate("/");
          }}
          onUpdate={updateReport}
          openProfile={(profile) => {
            setSelectedReport(null);
            setSelectedProfile(profile);
            navigate(`/${profile.type}/${encodeURIComponent(profile.id)}`);
          }}
        />
      )}
      {selectedProfile && (
        <ProfileSheet
          selection={selectedProfile}
          data={{ ...data, reports }}
          onClose={() => {
            setSelectedProfile(null);
            navigate("/");
          }}
          onSelectReport={(report) => {
            setSelectedProfile(null);
            setSelectedReport(report);
            navigate(`/report/${report.id}`);
          }}
        />
      )}
    </div>
  );
}

function SegmentedButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={clsx("segmented-button", active && "is-active")} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`stat stat-${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function InsightsSheet({
  reports,
  visibleReports,
  filteredWardNumber,
  unresolvedCount,
  resolvedCount,
  worstWards,
  onClose,
  onOpenWard
}: {
  reports: GarbageReport[];
  visibleReports: GarbageReport[];
  filteredWardNumber: number | null;
  unresolvedCount: number;
  resolvedCount: number;
  worstWards: ReturnType<typeof getWorstWards>;
  onClose: () => void;
  onOpenWard: (wardNumber: number) => void;
}) {
  const activeShare = Math.round((unresolvedCount / Math.max(1, reports.length)) * 100);

  return (
    <div className="modal-layer" onMouseDown={onClose}>
      <article className="insights-sheet" onMouseDown={(event) => event.stopPropagation()}>
        <button className="close-button" onClick={onClose} aria-label="Close insights">
          <X size={18} />
        </button>
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-title-row">
          <div>
            <p className="eyebrow">Public Accountability</p>
            <h2>Citywide report pulse</h2>
          </div>
          <Trophy size={20} />
        </div>
        <p className="muted">
          Showing {visibleReports.length} reports{filteredWardNumber ? ` in Ward ${filteredWardNumber}` : ""}. Every report is mapped to a ward and linked to civic accountability.
        </p>

        <div className="metric-grid insights-metrics">
          <Metric label="active reports" value={unresolvedCount} />
          <Metric label="resolved" value={resolvedCount} />
          <Metric label="still open" value={`${activeShare}%`} />
        </div>

        <div className="accountability-card">
          <h3>How pressure builds</h3>
          <p>Citizens report a spot, others upvote it, and the issue stays visible with ward, MLA, and MP context until it is cleaned.</p>
        </div>

        <div className="leaderboard">
          <div className="sheet-title-row compact">
            <h3>Worst Wards by Active Reports</h3>
            <span className="pill red">{worstWards.length} wards</span>
          </div>
          {worstWards.length ? (
            worstWards.slice(0, 6).map((item, index) => {
              const wardName = getDistinctWardName(item.ward);
              return (
                <button className="ward-row" key={item.ward.ward_number} onClick={() => onOpenWard(item.ward.ward_number)}>
                  <span className="rank">{index + 1}</span>
                  <span>
                    <strong>Ward {item.ward.ward_number}</strong>
                    {wardName ? <small>{wardName}</small> : <small>Bhubaneswar</small>}
                  </span>
                  <b>{item.count}</b>
                </button>
              );
            })
          ) : (
            <p className="empty">No active ward hotspots right now.</p>
          )}
        </div>
      </article>
    </div>
  );
}

function IntroOverlay({ onClose }: { onClose: () => void }) {
  return (
    <aside className="intro-nudge" role="dialog" aria-label="Amma Odisha intro">
      <button className="toast-close" onClick={onClose} aria-label="Dismiss intro">
        <X size={12} />
      </button>
      <div className="intro-card">
        <img src="/logo.png" alt="" />
        <p className="eyebrow">Bhubaneswar (BMC)</p>
        <h2>Garbage reports, mapped in public.</h2>
        <p>Report it. Photograph it. Track who is responsible.</p>
        <small>Every dump is linked to a ward, MLA, and MP so cleanup pressure stays visible.</small>
        <b>67 wards · 4 MLAs · 1 MP · All of Bhubaneswar</b>
        <button className="secondary-cta" onClick={onClose}>
          Start using map
        </button>
      </div>
    </aside>
  );
}

function ReportList({
  reports,
  wards,
  representatives,
  onSelect
}: {
  reports: GarbageReport[];
  wards: Ward[];
  representatives?: Representative[];
  onSelect: (report: GarbageReport) => void;
}) {
  return (
    <div className="report-list">
      <div className="report-list-header">
        <div>
          <p className="eyebrow">Live Reports</p>
          <h2>{reports.length} visible issues</h2>
        </div>
        <span className="pill red">Public</span>
      </div>
      {reports.length ? (
        reports.map((report) => (
          <ReportListItem
            key={report.id}
            report={report}
            ward={wards.find((ward) => ward.ward_number === report.ward_number)}
            mla={representatives?.find((rep) => {
              const w = wards.find((ward) => ward.ward_number === report.ward_number);
              return rep.role === "mla" && w && rep.constituency === w.assembly_constituency;
            })}
            onSelect={onSelect}
          />
        ))
      ) : (
        <p className="empty">No reports yet. Be the first to report a garbage dump in your area!</p>
      )}
    </div>
  );
}

function ReportListItem({
  report,
  ward,
  mla,
  onSelect
}: {
  report: GarbageReport;
  ward?: Ward;
  mla?: Representative;
  onSelect: (report: GarbageReport) => void;
}) {
  const severity = SEVERITY[report.severity] ?? SEVERITY.medium;
  const wardName = getDistinctWardName(ward);
  return (
    <button className="report-item" onClick={() => onSelect(report)}>
      <span className="report-item-badge">{report.upvote_count ?? 0}</span>
      <span className="report-item-body">
        <strong>{wardName || report.address}</strong>
        <small>
          {report.address}{wardName ? ` · Ward #${report.ward_number}` : ""} · {timeAgo(report.created_at)}
        </small>
      </span>
      <span className="report-item-tags" aria-label={`${severity.label}, ${STATUS_LABELS[report.status]}`}>
        <em className={`severity-chip severity-${report.severity}`}>{severity.label}</em>
        {mla ? <small className="mla-label">{mla.name}</small> : <span className={clsx("status-chip", report.status === "resolved" ? "is-resolved" : "is-open")}>{STATUS_LABELS[report.status]}</span>}
      </span>
      <ChevronDown size={14} className="sideways" />
    </button>
  );
}

function getWorstWards(reports: GarbageReport[], wards: Ward[]) {
  const counts = new globalThis.Map<number, number>();
  reports
    .filter((report) => report.status !== "resolved")
    .forEach((report) => counts.set(report.ward_number, (counts.get(report.ward_number) ?? 0) + 1));
  return wards
    .map((ward) => ({ ward, count: counts.get(ward.ward_number) ?? 0 }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);
}

function ReportDetail({
  report,
  data,
  onClose,
  onUpdate,
  openProfile
}: {
  report: GarbageReport;
  data: CivicData;
  onClose: () => void;
  onUpdate: (report: GarbageReport) => void;
  openProfile: (selection: Exclude<RouteSelection, null>) => void;
}) {
  const [isUpvoting, setIsUpvoting] = useState(false);
  const [upvoted, setUpvoted] = useState(() => hasUpvoted(report.id));
  const [showResolve, setShowResolve] = useState(false);

  useEffect(() => {
    setUpvoted(hasUpvoted(report.id));
    setIsUpvoting(false);
  }, [report.id]);

  const ward = data.wards.find((item) => item.ward_number === report.ward_number);
  const wardName = getDistinctWardName(ward);
  const mla = data.representatives.find((rep) => rep.role === "mla" && rep.constituency === ward?.assembly_constituency);
  const mp = data.representatives.find((rep) => rep.role === "mp" && rep.constituency === ward?.parliamentary_constituency);
  const severity = SEVERITY[report.severity] ?? SEVERITY.medium;

  const upvote = async () => {
    if (isUpvoting || upvoted) return;
    setIsUpvoting(true);
    try {
      const result = await backend.upvoteReport(report.id);
      setUpvoted(true);
      if (!result.alreadyVoted && result.newCount != null) {
        onUpdate({ ...report, upvote_count: result.newCount });
      }
    } catch (error) {
      console.error("Upvote failed", error);
    } finally {
      setIsUpvoting(false);
    }
  };

  const shareReport = async () => {
    const url = `${location.origin}/report/${report.id}`;
    const text = getReportShareText(report, ward, mla);
    if (navigator.share) {
      await navigator.share({ title: `Garbage Report — ${ward?.ward_name ?? "Bhubaneswar"}`, text, url });
    } else {
      await navigator.clipboard?.writeText(url);
    }
  };

  const complaint = () => {
    const text = generateBMCComplaint({
      address: report.address,
      wardName: wardName || "Bhubaneswar",
      wardNumber: ward?.ward_number ?? "?",
      severity: report.severity,
      category: report.category,
      photoUrl: report.photo_url,
      lat: report.latitude,
      lng: report.longitude
    });
    window.open(getWhatsAppUrl(text), "_blank", "noopener,noreferrer");
  };

  const openDirections = () => {
    window.open(`https://www.google.com/maps?q=${report.latitude},${report.longitude}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="modal-layer" onMouseDown={onClose}>
      <article className="detail-sheet" onMouseDown={(event) => event.stopPropagation()}>
        <button className="close-button" onClick={onClose} aria-label="Close report detail">
          <X size={18} />
        </button>
        {report.photo_url ? <img className="detail-photo" src={report.photo_url} alt="Garbage report" /> : <div className="detail-photo empty">No Photo</div>}
        <div className="detail-content">
          <div className="pill-row">
            <span className="pill" style={{ background: `${severity.color}15`, color: severity.color }}>
              {severity.label}
            </span>
            <span className={clsx("pill", report.status === "resolved" ? "green" : "red")}>{STATUS_LABELS[report.status]}</span>
          </div>
          <h2>{report.address}</h2>
          <p>
            Ward #{report.ward_number}
            {wardName ? ` - ${wardName}` : ""} · {daysActive(report.created_at)} Days
          </p>

          <div className="metric-grid">
            <Metric label="Upvotes" value={report.upvote_count || 1} />
            <Metric label="Waste Type" value={CATEGORIES[report.category]} />
            <Metric label="Age" value={`${daysActive(report.created_at)} days`} />
          </div>

          <h3>Accountability</h3>
          <div className="rep-grid">
            <RepCard label="MLA" rep={mla} area={ward?.assembly_constituency} onClick={() => mla && openProfile({ type: "mla", id: mla.constituency })} />
            <RepCard label="MP" rep={mp} area={ward?.parliamentary_constituency} onClick={() => mp && openProfile({ type: "mp", id: mp.constituency })} />
          </div>

          <div className="action-grid">
            <button onClick={() => void upvote()} disabled={upvoted || isUpvoting}>
              {isUpvoting ? <LoaderCircle className="spin" size={16} /> : <ThumbsUp size={16} />}
              {upvoted ? "Upvoted" : "Upvote"}
            </button>
            <button onClick={() => void shareReport()}>
              <Share2 size={16} />
              Share
            </button>
            <button onClick={openDirections}>
              <ArrowUpRight size={16} />
              Directions
            </button>
            <button onClick={complaint}>
              <MessageCircle size={16} />
              WhatsApp BMC
            </button>
            {report.status !== "resolved" && (
              <button onClick={() => setShowResolve(true)} className="green-action">
                <CheckCircle2 size={16} />
                It is Cleaned Up - Verify
              </button>
            )}
          </div>
          <p className="anonymous">
            <ShieldCheck size={13} /> All reports are anonymous
          </p>
        </div>
      </article>
      {showResolve && <ResolveModal report={report} onClose={() => setShowResolve(false)} onResolved={onUpdate} />}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function RepCard({ label, rep, area, onClick }: { label: string; rep?: Representative; area?: string; onClick: () => void }) {
  return (
    <button className="rep-card" onClick={onClick} disabled={!rep}>
      <Avatar rep={rep} />
      <span>
        <small>{label}</small>
        <strong>{rep?.name ?? "Not mapped"}</strong>
        <em>
          {rep?.party ?? "—"} · {area ?? "Unknown"}
        </em>
      </span>
      <ArrowUpRight size={14} />
    </button>
  );
}

function Avatar({ rep }: { rep?: Representative }) {
  if (rep?.photo_url) return <img className="avatar" src={rep.photo_url} alt={rep.name} />;
  const initials = (rep?.name ?? "NK")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
  return <span className="avatar initials">{initials}</span>;
}

type ResolveStatus = "idle" | "locating" | "verified" | "mismatch" | "saving" | "error";

function ResolveModal({ report, onClose, onResolved }: { report: GarbageReport; onClose: () => void; onResolved: (report: GarbageReport) => void }) {
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<ResolveStatus>("idle");
  const [saveError, setSaveError] = useState("");

  // Clean up object URLs to prevent memory leaks
  const previewRef = useRef<string | null>(null);
  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  const verify = async () => {
    setSaveError("");

    if (!navigator.geolocation) {
      setStatus("mismatch");
      return;
    }

    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const distanceMeters = Math.hypot((lat - report.latitude) * 111_000, (lng - report.longitude) * 111_000);
        if (distanceMeters > 500) {
          setStatus("mismatch");
          return;
        }
        setStatus("saving");
        try {
          const photoUrl = photo ? await backend.uploadReportPhoto(photo) : null;
          const resolved = await backend.resolveReport(report.id, { photoUrl, lat, lng });
          onResolved(resolved);
          onClose();
        } catch (caught) {
          setSaveError(caught instanceof Error ? caught.message : "Save failed. Please try again.");
          setStatus("error");
        }
      },
      () => setStatus("mismatch"),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const onFile = (file?: File) => {
    if (!file) return;
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = URL.createObjectURL(file);
    previewRef.current = url;
    setPhoto(file);
    setPreview(url);
  };

  const isBusy = status === "locating" || status === "saving";
  const canRetry = status === "mismatch" || status === "error";

  return (
    <div className="nested-modal">
      <article className="mini-card">
        <button className="close-button" onClick={onClose} aria-label="Close resolve modal">
          <X size={18} />
        </button>
        <h2>Mark as Cleaned</h2>
        <p>Take a photo to verify this spot has been cleaned up.</p>
        <label className={clsx("photo-drop", preview && "has-photo")}>
          {preview ? <img src={preview} alt="" /> : <Camera size={28} />}
          <span>{preview ? "Tap to Retake" : "Take a Verification Photo"}</span>
          <input type="file" accept="image/*" capture="environment" onChange={(event) => onFile(event.target.files?.[0])} />
        </label>
        <button className="primary-cta" onClick={() => void verify()} disabled={isBusy}>
          {isBusy ? <LoaderCircle className="spin" size={17} /> : <CheckCircle2 size={17} />}
          {status === "idle" && "Show that this spot is now clean"}
          {status === "locating" && "Verifying your location..."}
          {status === "saving" && "Saving verification..."}
          {canRetry && "Try Again"}
        </button>
        {status === "mismatch" && (
          <p className="warning-text">Location mismatch — you appear to be more than 500 m from the original report.</p>
        )}
        {status === "error" && saveError && (
          <p className="warning-text">{saveError}</p>
        )}
      </article>
    </div>
  );
}

function ReportForm({ data, onClose, onSubmit }: { data: CivicData; onClose: () => void; onSubmit: (report: GarbageReport) => void }) {
  const [wardNumber, setWardNumber] = useState("");
  const [detectedWard, setDetectedWard] = useState<Ward | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number; accuracy: number | null; recordedAt: string } | null>(null);
  const [locationState, setLocationState] = useState<"idle" | "locating" | "detecting" | "detected" | "manual" | "outside">("idle");
  const [address, setAddress] = useState("");
  const [severity, setSeverity] = useState<SeverityKey>("medium");
  const [category, setCategory] = useState<WasteCategory>("mixed");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const limit = canSubmitReport();
  const selectedWard = detectedWard ?? data.wards.find((ward) => ward.ward_number === Number(wardNumber));

  // Track the current object URL so we can revoke it when the user picks a
  // new photo (preventing Blob URL memory leaks on repeated retakes).
  const photoPreviewRef = useRef<string | null>(null);
  useEffect(() => {
    return () => {
      if (photoPreviewRef.current) URL.revokeObjectURL(photoPreviewRef.current);
    };
  }, []);

  // Stable ref so detectWard can be called from the mount effect without
  // being listed in its dependency array (runs once on open, like componentDidMount).
  const detectWardRef = useRef<() => void>();

  const detectWard = () => {
    if (!navigator.geolocation) {
      setLocationState("manual");
      return;
    }
    setLocationState("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const accuracy = Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null;
        setLocation({ lat, lng, accuracy, recordedAt: new Date(position.timestamp || Date.now()).toISOString() });
        if (!isInsideCity(lat, lng)) {
          setLocationState("outside");
          return;
        }
        setLocationState("detecting");
        const ward = findWardInGeoJson(lat, lng, data.wards, data.wardBoundaries) ?? findNearestWard(lat, lng, data.wards);
        if (ward) {
          setDetectedWard(ward);
          setWardNumber(String(ward.ward_number));
          setLocationState("detected");
        } else {
          setLocationState("manual");
        }
      },
      () => setLocationState("manual"),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  detectWardRef.current = detectWard;

  // Run once on mount so the form immediately mirrors the live GPS-first UX.
  useEffect(() => {
    detectWardRef.current?.();
  }, []);

  const onFile = (file?: File) => {
    if (!file) return;
    if (photoPreviewRef.current) URL.revokeObjectURL(photoPreviewRef.current);
    const url = URL.createObjectURL(file);
    photoPreviewRef.current = url;
    setPhoto(file);
    setPhotoPreview(url);
  };

  const submit = async () => {
    setError("");
    if (!limit.allowed) {
      setError("Thank you, amazing citizen! To protect our platform from spam, we limit reports to 5 per day.");
      return;
    }
    if (!selectedWard || !address.trim() || !photo) {
      setError("Photo, ward, and landmark are required.");
      return;
    }
    setSubmitting(true);
    try {
      const photoUrl = await backend.uploadReportPhoto(photo);
      const input: NewReportInput = {
        latitude: location?.lat ?? selectedWard.center_lat,
        longitude: location?.lng ?? selectedWard.center_lng,
        gps_latitude: location?.lat ?? null,
        gps_longitude: location?.lng ?? null,
        gps_accuracy_meters: location?.accuracy ?? null,
        gps_recorded_at: location?.recordedAt ?? null,
        location_source: location ? "gps" : "ward_center",
        ward_number: selectedWard.ward_number,
        address: address.trim(),
        severity,
        category,
        photo_url: photoUrl
      };
      onSubmit(await backend.submitReport(input));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to submit report.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-layer" onMouseDown={onClose}>
      <article className="form-sheet" onMouseDown={(event) => event.stopPropagation()}>
        <div className="form-header">
          <div>
            <p className="eyebrow">Garbage Report</p>
            <h2>Report Garbage</h2>
            <p>Take a photo, confirm the ward, and add a landmark citizens can recognize.</p>
          </div>
          <button className="close-button" onClick={onClose} aria-label="Close report form">
            <X size={18} />
          </button>
        </div>
        {locationState === "outside" && (
          <div className="notice amber">
            <CircleAlert size={16} />
            <span>
              <strong>We are not live in your area yet</strong>
              You can still browse reports and explore the map.
            </span>
          </div>
        )}
        <label className="field">
          <span>
            Photo <b>*</b>
          </span>
          <label className={clsx("photo-drop", photoPreview && "has-photo")}>
            {photoPreview ? <img src={photoPreview} alt="" /> : <Camera size={30} />}
            <em>{photoPreview ? "Tap to Retake" : "Take a Photo"}</em>
            <small>A photo makes your report 10x more credible</small>
            <input type="file" accept="image/*" capture="environment" onChange={(event) => onFile(event.target.files?.[0])} />
          </label>
        </label>
        <label className="field">
          <span>
            Ward <b>*</b>
          </span>
          <select
            value={wardNumber}
            onChange={(event) => {
              setWardNumber(event.target.value);
              setDetectedWard(null);
              setLocationState("manual");
            }}
          >
            <option value="">Select Ward...</option>
            {data.wards.map((ward) => (
              <option key={ward.ward_number} value={ward.ward_number}>
                {getWardSelectLabel(ward)}
              </option>
            ))}
          </select>
          <button className="tiny-action" onClick={detectWard} type="button">
            {locationState === "locating" || locationState === "detecting" ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}
            {locationState === "detected"
              ? `Detected Ward ${selectedWard?.ward_number ?? ""}`
              : locationState === "detecting"
                ? "Detecting ward..."
                : locationState === "locating"
                  ? "Finding location..."
                  : "Use current location"}
          </button>
        </label>
        <label className="field">
          <span>
            Landmark / Address <b>*</b>
          </span>
          <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="e.g., Near Unit 4 market, beside the temple" />
          <small>Please add a landmark or address so others can find this spot.</small>
        </label>
        <label className="field">
          <span>How Bad Is It?</span>
          <div className="option-grid">
            {Object.entries(SEVERITY).map(([key, value]) => (
              <button type="button" className={clsx(severity === key && "is-selected")} onClick={() => setSeverity(key as SeverityKey)} key={key}>
                <i style={{ background: value.color }} />
                <strong>{value.label}</strong>
                <small>{value.description}</small>
              </button>
            ))}
          </div>
        </label>
        <label className="field">
          <span>Waste Type</span>
          <select value={category} onChange={(event) => setCategory(event.target.value as WasteCategory)}>
            {Object.entries(CATEGORIES).map(([key, value]) => (
              <option key={key} value={key}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <div className="form-footer">
          {error && <p className="warning-text">{error}</p>}
          <button className="primary-cta" onClick={() => void submit()} disabled={submitting}>
            {submitting ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}
            {submitting ? "Submitting..." : "Report Garbage"}
          </button>
          <p className="anonymous">
            <ShieldCheck size={13} /> All reports are anonymous
          </p>
        </div>
      </article>
    </div>
  );
}

function ProfileSheet({
  selection,
  data,
  onClose,
  onSelectReport
}: {
  selection: Exclude<RouteSelection, null>;
  data: CivicData;
  onClose: () => void;
  onSelectReport: (report: GarbageReport) => void;
}) {
  const isWard = selection.type === "ward";
  const ward = isWard ? data.wards.find((item) => item.ward_number === Number(selection.id)) : null;
  const rep = !isWard
    ? data.representatives.find((item) => item.role === selection.type && item.constituency === decodeURIComponent(selection.id))
    : null;
  const profileReports = data.reports.filter((report) => {
    const itemWard = data.wards.find((item) => item.ward_number === report.ward_number);
    if (ward) return report.ward_number === ward.ward_number;
    if (selection.type === "mla") return itemWard?.assembly_constituency === rep?.constituency;
    return itemWard?.parliamentary_constituency === rep?.constituency;
  });
  const activeReports = profileReports.filter((report) => report.status !== "resolved");
  const wardName = getDistinctWardName(ward);

  return (
    <div className="modal-layer" onMouseDown={onClose}>
      <article className="profile-sheet" onMouseDown={(event) => event.stopPropagation()}>
        <button className="close-button" onClick={onClose} aria-label="Close profile">
          <X size={18} />
        </button>
        <div className="profile-hero">
          {rep ? <Avatar rep={rep} /> : <Layers size={28} />}
          <div>
            <p className="eyebrow">{isWard ? "Ward Profile" : selection.type.toUpperCase()}</p>
            <h2>{ward ? `Ward ${ward.ward_number}` : rep?.name}</h2>
            <p>{ward ? wardName || "Bhubaneswar" : `${rep?.party} · ${rep?.constituency}`}</p>
          </div>
        </div>
        <div className="metric-grid">
          <Metric label="unresolved" value={activeReports.length} />
          <Metric label="Total Reports" value={profileReports.length} />
          <Metric label="Avg Days" value={Math.round(activeReports.reduce((sum, report) => sum + daysActive(report.created_at), 0) / Math.max(1, activeReports.length))} />
        </div>
        {isWard && ward ? (
          <div className="accountability-card">
            <h3>Responsible MLA</h3>
            <p>{ward.assembly_constituency}</p>
            <p>{ward.parliamentary_constituency}</p>
          </div>
        ) : (
          <div className="accountability-card">
            <h3>{selection.type === "mla" ? "Assembly Constituencies" : "Wards"}</h3>
            <p>Tap to view reports and top locations across this constituency.</p>
          </div>
        )}
        <h3>Top Locations</h3>
        <ReportList reports={profileReports} wards={data.wards} representatives={data.representatives} onSelect={onSelectReport} />
      </article>
    </div>
  );
}

function AboutSheet({ onClose, onOpenChangelog }: { onClose: () => void; onOpenChangelog: () => void }) {
  return (
    <div className="modal-layer top" onMouseDown={onClose}>
      <article className="top-sheet" onMouseDown={(event) => event.stopPropagation()}>
        <button className="close-button" onClick={onClose} aria-label="Close about">
          <X size={18} />
        </button>
        <h2>Why Amma Odisha?</h2>
        <p className="eyebrow">AMMA ODISHA</p>
        <p>
          Bhubaneswar generates over <strong>1,200 tonnes</strong> of waste daily. Despite BMC's efforts, illegal dumping persists across the city — on sidewalks,
          vacant plots, and road corners. Citizens complain, but complaints disappear into bureaucratic black holes.
        </p>
        <p>
          <strong>Amma Odisha changes the equation.</strong> Every garbage dump is mapped, photographed, and linked to the responsible ward, MLA, and MP. When
          enough citizens report the same spot, it becomes impossible to ignore. The data is public, the accountability is permanent.
        </p>
        <p>This is crowdsourced civic infrastructure — built by citizens, for citizens.</p>
        <div className="social-row">
          <a href="https://x.com/realmojojojo_" target="_blank" rel="noreferrer">
            Built by @realmojojojo_
          </a>
          <a href="https://ammaodisha.me" target="_blank" rel="noreferrer">
            ammaodisha.me
          </a>
          <button
            className="secondary-cta"
            style={{ minHeight: 38, fontSize: 12 }}
            onClick={onOpenChangelog}
          >
            View Changelog
          </button>
        </div>
      </article>
    </div>
  );
}

function ChangelogSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-layer" onMouseDown={onClose}>
      <article className="profile-sheet small" onMouseDown={(event) => event.stopPropagation()}>
        <button className="close-button" onClick={onClose} aria-label="Close changelog">
          <X size={18} />
        </button>
        <h2>Changelog</h2>
        <p className="muted">What's new in Amma Odisha</p>
        {CHANGELOG.map((entry) => (
          <div className="changelog-entry" key={entry.version}>
            <div className="sheet-title-row compact">
              <strong>v{entry.version}</strong>
              <span className="pill green">{entry.tag}</span>
              <small>{entry.date}</small>
            </div>
            {entry.changes.map((change) => (
              <p key={change.text}>
                <span>NEW</span> {change.text}
              </p>
            ))}
          </div>
        ))}
      </article>
    </div>
  );
}

function TelegramToast() {
  const [hidden, setHidden] = useState(() => localStorage.getItem("nk_telegram_hidden") === "1");
  if (hidden) return null;
  return (
    <div className="telegram-toast">
      <button
        className="toast-close"
        onClick={() => {
          localStorage.setItem("nk_telegram_hidden", "1");
          setHidden(true);
        }}
        aria-label="Dismiss Telegram community toast"
      >
        <X size={12} />
      </button>
      <Sparkles size={16} />
      <span>
        <strong>Join the community</strong>
        Feedback, ideas & updates on Telegram
      </span>
      <a href="https://t.me/+23jgBr4Gz6BkYTFl" target="_blank" rel="noreferrer">
        Join
      </a>
    </div>
  );
}
