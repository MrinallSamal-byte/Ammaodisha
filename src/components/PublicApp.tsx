import clsx from "clsx";
import {
  ArrowUpRight,
  BarChart3,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  Home,
  Info,
  Layers,
  List,
  LoaderCircle,
  Map as MapIcon,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Send,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  ThumbsUp,
  Trophy,
  X
} from "lucide-react";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BMC_CONTACTS, BMC_HELPLINE, BMC_NUMBER, CHANGELOG, CATEGORIES, SEVERITY, STATUS_LABELS } from "../services/constants";
import { backend } from "../services/backend";
import { findNearestWard, findWardInGeoJson, isInsideCity } from "../services/geo";
import { canSubmitReport, hasUpvoted } from "../services/limits";
import { generateBMCComplaint, getReportShareText, getWhatsAppUrl, shareOrCopy } from "../services/share";
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

const MapView = lazy(async () => ({ default: (await import("./MapView")).MapView }));
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type RouteSelection =
  | { type: "report"; id: string }
  | { type: "ward"; id: string }
  | { type: "mla"; id: string }
  | { type: "mp"; id: string }
  | null;

interface ExternalPreviewConfig {
  confirmLabel: string;
  details: string;
  helper: string;
  title: string;
}

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

function getWardSearchText(ward: Ward) {
  return [
    getWardSelectLabel(ward),
    ward.locality_name ?? "",
    ward.zone ?? "",
    ward.assembly_constituency,
    ward.parliamentary_constituency
  ]
    .join(" ")
    .toLowerCase();
}

function readStorageValue(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageValue(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage write failures (private mode/quota exceeded).
  }
}

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

function DialogSurface({
  ariaLabel,
  ariaLabelledBy,
  children,
  className,
  disableEscape = false,
  disableFocusTrap = false,
  layerClassName = "modal-layer",
  onClose
}: {
  ariaLabel?: string;
  ariaLabelledBy?: string;
  children: ReactNode;
  className: string;
  disableEscape?: boolean;
  disableFocusTrap?: boolean;
  layerClassName?: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const firstFocusable = getFocusableElements(dialog)[0];
      (firstFocusable ?? dialog).focus({ preventScroll: true });
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !disableEscape) {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || disableFocusTrap) return;

      const focusable = getFocusableElements(dialog);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (active instanceof HTMLElement && !dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus({ preventScroll: true });
    };
  }, [disableEscape, disableFocusTrap, onClose]);

  return (
    <div
      className={layerClassName}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <article
        ref={dialogRef}
        className={className}
        role="dialog"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-modal="true"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </article>
    </div>
  );
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
  const [showIntro, setShowIntro] = useState(() => readStorageValue("nk_intro_seen") !== "1");
  const [showAbout, setShowAbout] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [showCivicNotice, setShowCivicNotice] = useState(() => readStorageValue("nk_civic_hidden") !== "1");
  const [viewMode, setViewMode] = useState<"map" | "list">("map");
  const [showFilters, setShowFilters] = useState(false);
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);
  const [severityFilter, setSeverityFilter] = useState<"all" | SeverityKey>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "unresolved" | "resolved">("all");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");

  const wardsByNumber = useMemo(() => new globalThis.Map(data.wards.map((ward) => [ward.ward_number, ward])), [data.wards]);

  useEffect(() => {
    setReports(data.reports);
  }, [data.reports]);

  useEffect(() => {
    const syncOnlineState = () => setIsOffline(navigator.onLine === false);
    window.addEventListener("online", syncOnlineState);
    window.addEventListener("offline", syncOnlineState);
    return () => {
      window.removeEventListener("online", syncOnlineState);
      window.removeEventListener("offline", syncOnlineState);
    };
  }, []);

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
  const hasActiveFilters =
    Boolean(searchQuery.trim()) || severityFilter !== "all" || statusFilter !== "all" || wardFilterNumber != null;

  // Refresh: surface errors as a brief visual indicator rather than silently failing.
  const refreshReports = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshError("");
    try {
      const nextReports = await backend.fetchReports();
      setReports(nextReports);
      onDataChange({ ...data, reports: nextReports });
    } catch (err) {
      console.error("Refresh failed", err);
      setRefreshError("Could not refresh reports. Check your connection and try again.");
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
    writeStorageValue("nk_intro_seen", "1");
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

  const activeFilterSummary = useMemo(() => {
    const labels: string[] = [];
    const query = searchQuery.trim();
    if (query) labels.push(`Search: ${query}`);
    if (severityFilter !== "all") labels.push(`Severity: ${SEVERITY[severityFilter].label}`);
    if (statusFilter !== "all") labels.push(`Status: ${statusFilter === "resolved" ? "Cleaned" : "Unresolved"}`);
    if (wardFilterNumber != null) labels.push(`Ward ${wardFilterNumber}`);
    return labels;
  }, [searchQuery, severityFilter, statusFilter, wardFilterNumber]);
  const activeFilterCount = activeFilterSummary.length;

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
      {viewMode === "map" && (
        <Suspense
          fallback={
            <div className="map-shell map-loading-shell" aria-label="Loading map">
              <div className="map-loading-pill">Loading map...</div>
            </div>
          }
        >
          <MapView
            reports={visibleReports}
            wardBoundaries={data.wardBoundaries}
            onSelectReport={handleMapReportSelect}
            onSelectWard={handleMapWardSelect}
            focusWardNumber={focusWardNumber}
            focusRequestId={focusRequestId}
          />
        </Suspense>
      )}

      <header className="topbar safe-top">
        <div className="brand-chip">
          <button className="brand-home" onClick={() => navigate("/")} aria-label="Go to Amma Odisha map">
            <span className="brand-wordmark">
              <strong>
                Amma <b>Odisha</b>
              </strong>
            </span>
          </button>
          <button type="button" className="version-badge" title="View changelog" onClick={() => setShowChangelog(true)}>
            v0.3.0
          </button>
        </div>
        {showCivicNotice && (
          <div className="topbar-nudge" aria-label="Amma Odisha civic reporting context">
            <Home size={14} />
            <span>New here? Tap reports and wards to see Bhubaneswar accountability.</span>
            <button
              type="button"
              onClick={() => {
                writeStorageValue("nk_civic_hidden", "1");
                setShowCivicNotice(false);
              }}
              aria-label="Dismiss notice"
            >
              Got it
            </button>
          </div>
        )}
        <div className="topbar-actions">
          <button
            className="icon-button"
            onClick={() => setShowAbout(true)}
            aria-label="About Amma Odisha"
            title="About"
          >
            <Info size={17} />
          </button>
        </div>
      </header>

      <section className="control-dock" aria-label="Map and report controls">
        <div className="map-mode-toggle">
          <SegmentedButton active={viewMode === "map"} onClick={() => setViewMode("map")} icon={<MapIcon size={14} />} label="Map" />
          <SegmentedButton active={viewMode === "list"} onClick={() => setViewMode("list")} icon={<List size={14} />} label="List" />
        </div>
        <button
          className={clsx("filter-button", activeFilterCount > 0 && "is-active")}
          onClick={() => setShowFilters(true)}
          type="button"
          aria-label="Open search and filters"
        >
          <SlidersHorizontal size={14} />
          Filter
          {activeFilterCount > 0 && <span>{activeFilterCount}</span>}
        </button>
        <button className="chip-button refresh-control" onClick={() => void refreshReports()} type="button" disabled={refreshing}>
          {refreshing ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
          Refresh
        </button>
        <button className={clsx("chip-button", wardFilterNumber != null && "is-active")} onClick={detectAndFilterMyWard} type="button">
          {wardFilterState === "locating" ? <LoaderCircle className="spin" size={14} /> : <Layers size={14} />}
          {wardFilterNumber != null ? `Ward ${wardFilterNumber}` : "Use My Ward"}
        </button>
        {isOffline && <p className="control-error offline-status" role="status">You are offline. You can browse cached reports, but submitting may fail.</p>}
        {wardFilterState === "error" && <p className="control-error" role="alert">Could not detect your location inside Bhubaneswar. You can still filter manually.</p>}
        {refreshError && (
          <div className="control-error control-error-action" role="alert">
            <span>{refreshError}</span>
            <button type="button" onClick={() => void refreshReports()}>
              Retry
            </button>
          </div>
        )}
      </section>

      {showFilters && (
        <FilterSheet
          activeFilterCount={activeFilterCount}
          activeFilterSummary={activeFilterSummary}
          clearFilters={clearFilters}
          onClose={() => setShowFilters(false)}
          onRefresh={refreshReports}
          refreshing={refreshing}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          setSeverityFilter={setSeverityFilter}
          setSortBy={setSortBy}
          setStatusFilter={setStatusFilter}
          severityFilter={severityFilter}
          sortBy={sortBy}
          statusFilter={statusFilter}
          visibleCount={visibleReports.length}
        />
      )}

      {viewMode === "map" && hasActiveFilters && visibleReports.length === 0 && (
        <div className="map-empty-state" role="status">
          <Search size={18} />
          <strong>No reports match your filters</strong>
          <span>Clear filters to bring the map back.</span>
          <button type="button" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      )}

      {viewMode === "list" && (
        <div className="list-overlay">
          <div className="list-tools" aria-label="Search and sort list reports">
            <label>
              <Search size={14} />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search ward, address, landmark"
                aria-label="Search reports"
              />
            </label>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as "newest" | "upvotes" | "oldest")}
              aria-label="Sort reports"
            >
              <option value="newest">Sort: Newest</option>
              <option value="upvotes">Sort: Most Upvoted</option>
              <option value="oldest">Sort: Oldest</option>
            </select>
          </div>
          <ReportList
            reports={visibleReports}
            totalReports={reports.length}
            wards={data.wards}
            representatives={data.representatives}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={clearFilters}
            onSelect={handleMapReportSelect}
          />
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
            <strong>Insights</strong>
            <small>{visibleReports.length} visible</small>
          </span>
        </button>
      </footer>

      {showIntro && !routeSelection && <IntroOverlay onClose={dismissIntro} />}
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

function FilterSheet({
  activeFilterCount,
  activeFilterSummary,
  clearFilters,
  onClose,
  onRefresh,
  refreshing,
  searchQuery,
  setSearchQuery,
  setSeverityFilter,
  setSortBy,
  setStatusFilter,
  severityFilter,
  sortBy,
  statusFilter,
  visibleCount
}: {
  activeFilterCount: number;
  activeFilterSummary: string[];
  clearFilters: () => void;
  onClose: () => void;
  onRefresh: () => void | Promise<void>;
  refreshing: boolean;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  setSeverityFilter: (value: "all" | SeverityKey) => void;
  setSortBy: (value: "newest" | "upvotes" | "oldest") => void;
  setStatusFilter: (value: "all" | "unresolved" | "resolved") => void;
  severityFilter: "all" | SeverityKey;
  sortBy: "newest" | "upvotes" | "oldest";
  statusFilter: "all" | "unresolved" | "resolved";
  visibleCount: number;
}) {
  return (
    <DialogSurface ariaLabel="Search and filter reports" className="filter-sheet" onClose={onClose}>
      <button className="close-button" onClick={onClose} aria-label="Close filters">
        <X size={18} />
      </button>
      <div className="sheet-title-row">
        <div>
          <p className="eyebrow">Search & Filter</p>
          <h2>Find reports faster</h2>
        </div>
        <SlidersHorizontal size={20} />
      </div>
      <label className="filter-field">
        <span>Search</span>
        <div className="filter-search">
          <Search size={15} />
          <input
            autoFocus
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Address, ward, or landmark"
            aria-label="Search reports"
          />
        </div>
      </label>
      <div className="filter-grid">
        <label className="filter-field">
          <span>Severity</span>
          <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as "all" | SeverityKey)} aria-label="Filter by severity">
            <option value="all">All Severity</option>
            {Object.entries(SEVERITY).map(([key, value]) => (
              <option value={key} key={key}>
                {value.label}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span>Status</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | "unresolved" | "resolved")} aria-label="Filter by status">
            <option value="all">All Status</option>
            <option value="unresolved">Unresolved</option>
            <option value="resolved">Cleaned</option>
          </select>
        </label>
        <label className="filter-field">
          <span>Sort</span>
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value as "newest" | "upvotes" | "oldest")} aria-label="Sort reports">
            <option value="newest">Newest</option>
            <option value="upvotes">Most Upvoted</option>
            <option value="oldest">Oldest</option>
          </select>
        </label>
      </div>
      <div className="filter-summary" aria-label="Active report filters">
        <span>
          <strong>{visibleCount}</strong> matching {visibleCount === 1 ? "report" : "reports"}
        </span>
        {activeFilterCount > 0 ? (
          <div>
            {activeFilterSummary.map((label) => (
              <em key={label}>{label}</em>
            ))}
          </div>
        ) : (
          <p>No filters active.</p>
        )}
      </div>
      <div className="filter-actions">
        <button type="button" className="secondary-cta" onClick={clearFilters} disabled={activeFilterCount === 0 && sortBy === "newest"}>
          <X size={14} />
          Clear
        </button>
        <button type="button" className="secondary-cta" onClick={() => void onRefresh()} disabled={refreshing}>
          {refreshing ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
          Refresh
        </button>
        <button type="button" className="primary-cta" onClick={onClose}>
          Apply
        </button>
      </div>
    </DialogSurface>
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
    <DialogSurface ariaLabel="Amma Odisha insights" className="insights-sheet" onClose={onClose}>
        <button className="sheet-back-button" type="button" onClick={onClose}>
          <ChevronLeft size={16} />
          Back to map
        </button>
        <button className="close-button" onClick={onClose} aria-label="Close insights">
          <X size={18} />
        </button>
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
    </DialogSurface>
  );
}

function IntroOverlay({ onClose }: { onClose: () => void }) {
  return (
    <DialogSurface layerClassName="intro-nudge" className="intro-card" ariaLabel="Amma Odisha intro" onClose={onClose}>
      <button className="toast-close" onClick={onClose} aria-label="Dismiss intro">
        <X size={12} />
      </button>
      <img src="/logo.png" alt="" />
      <p className="eyebrow">Bhubaneswar (BMC)</p>
      <h2>Tap a red dot to see the report.</h2>
      <p>Open a marker, check the ward and BMC actions, or start a new report.</p>
      <small>Every report stays linked to a ward, MLA, and MP until it is cleaned.</small>
      <b>67 wards · 4 MLAs · 1 MP · All of Bhubaneswar</b>
      <button className="secondary-cta" onClick={onClose}>
        Start using map
      </button>
    </DialogSurface>
  );
}

function ReportList({
  emptyDescription,
  emptyTitle,
  hasActiveFilters = false,
  initialLimit = 60,
  onClearFilters,
  reports,
  totalReports = reports.length,
  wards,
  representatives,
  onSelect
}: {
  emptyDescription?: string;
  emptyTitle?: string;
  hasActiveFilters?: boolean;
  initialLimit?: number;
  onClearFilters?: () => void;
  reports: GarbageReport[];
  totalReports?: number;
  wards: Ward[];
  representatives?: Representative[];
  onSelect: (report: GarbageReport) => void;
}) {
  const [visibleCount, setVisibleCount] = useState(initialLimit);
  const wardsByNumber = useMemo(() => new Map(wards.map((ward) => [ward.ward_number, ward])), [wards]);
  const mlaByConstituency = useMemo(() => {
    const map = new Map<string, Representative>();
    (representatives ?? []).forEach((rep) => {
      if (rep.role === "mla") map.set(rep.constituency, rep);
    });
    return map;
  }, [representatives]);
  const visibleItems = reports.slice(0, visibleCount);
  const hasMore = reports.length > visibleCount;

  useEffect(() => {
    setVisibleCount(initialLimit);
  }, [initialLimit, reports]);

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
        <>
          {visibleItems.map((report) => {
            const ward = wardsByNumber.get(report.ward_number);
            const mla = ward ? mlaByConstituency.get(ward.assembly_constituency) : undefined;
            return <ReportListItem key={report.id} report={report} ward={ward} mla={mla} onSelect={onSelect} />;
          })}
          {hasMore && (
            <button className="load-more-button" type="button" onClick={() => setVisibleCount((count) => count + initialLimit)}>
              Load more reports
            </button>
          )}
        </>
      ) : (
        <div className="empty-state">
          <p className="empty-title">
            {hasActiveFilters ? "No reports match your current filters." : emptyTitle ?? "No reports yet."}
          </p>
          <p className="empty">
            {hasActiveFilters
              ? `Try a different search, status, or ward filter. There are ${totalReports} total reports available.`
              : emptyDescription ?? "Be the first to report a garbage dump in your area!"}
          </p>
          {hasActiveFilters && onClearFilters && (
            <button className="secondary-cta" type="button" onClick={onClearFilters}>
              Clear filters
            </button>
          )}
        </div>
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
  const upvoteCount = report.upvote_count ?? 0;
  return (
    <button className="report-item" onClick={() => onSelect(report)}>
      {report.photo_url ? (
        <img className="report-thumb" src={report.photo_url} alt="" loading="lazy" />
      ) : (
        <span className="photo-placeholder" aria-hidden="true">
          <Camera size={16} />
        </span>
      )}
      <span className="report-item-badge" aria-label={`${upvoteCount} ${upvoteCount === 1 ? "upvote" : "upvotes"}`}>
        <strong>{upvoteCount}</strong>
        <small>{upvoteCount === 1 ? "upvote" : "upvotes"}</small>
      </span>
      <span className="report-item-body">
        <strong>{wardName || report.address}</strong>
        <small>
          {report.address}{wardName ? ` · Ward #${report.ward_number}` : ""} · {timeAgo(report.created_at)}
        </small>
      </span>
      <span className="report-item-tags" aria-label={`${severity.label}, ${STATUS_LABELS[report.status]}`}>
        <em className={`severity-chip severity-${report.severity}`}>
          <SeverityMark severityKey={report.severity} />
          {severity.label}
        </em>
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
  const [upvoteBump, setUpvoteBump] = useState(false);
  const [showResolve, setShowResolve] = useState(false);
  const [compareValue, setCompareValue] = useState(50);
  const [externalPreview, setExternalPreview] = useState<ExternalPreviewConfig | null>(null);

  useEffect(() => {
    setUpvoted(hasUpvoted(report.id));
    setIsUpvoting(false);
    setUpvoteBump(false);
  }, [report.id]);

  useEffect(() => {
    if (!upvoteBump) return;
    const timer = window.setTimeout(() => setUpvoteBump(false), 650);
    return () => window.clearTimeout(timer);
  }, [upvoteBump]);

  const ward = data.wards.find((item) => item.ward_number === report.ward_number);
  const wardName = getDistinctWardName(ward);
  const mla = data.representatives.find((rep) => rep.role === "mla" && rep.constituency === ward?.assembly_constituency);
  const mp = data.representatives.find((rep) => rep.role === "mp" && rep.constituency === ward?.parliamentary_constituency);
  const severity = SEVERITY[report.severity] ?? SEVERITY.medium;
  const canCompareResolvedPhotos = Boolean(report.photo_url && report.resolved_photo_url);

  const upvote = async () => {
    if (isUpvoting || upvoted) return;
    setIsUpvoting(true);
    try {
      const result = await backend.upvoteReport(report.id);
      setUpvoted(true);
      if (!result.alreadyVoted && result.newCount != null) {
        setUpvoteBump(true);
        navigator.vibrate?.(20);
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
    try {
      await shareOrCopy({ title: `Garbage Report — ${ward?.ward_name ?? "Bhubaneswar"}`, text, url }, url);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      console.error("Share failed", caught);
    }
  };

  const prepareComplaint = () => {
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
    setExternalPreview({
      confirmLabel: "Open WhatsApp",
      details: text,
      helper: "This opens WhatsApp with a ready-to-send message. You can review or edit it before sending.",
      title: "Send complaint on WhatsApp"
    });
  };

  const prepareDirections = () => {
    setExternalPreview({
      confirmLabel: "Open Maps",
      details: `${report.address}\nWard ${report.ward_number}\n${report.latitude}, ${report.longitude}`,
      helper: "This opens Google Maps in a new tab so you can navigate to the reported spot.",
      title: "Open directions"
    });
  };

  const prepareCall = (label: string, value: string) => {
    setExternalPreview({
      confirmLabel: "Call now",
      details: value,
      helper: `This will start a phone call to ${label}.`,
      title: `Call ${label}`
    });
  };

  const confirmExternalAction = () => {
    if (!externalPreview) return;
    if (externalPreview.confirmLabel === "Open WhatsApp") {
      window.open(getWhatsAppUrl(externalPreview.details), "_blank", "noopener,noreferrer");
    } else if (externalPreview.confirmLabel === "Open Maps") {
      window.open(`https://www.google.com/maps?q=${report.latitude},${report.longitude}`, "_blank", "noopener,noreferrer");
    } else {
      window.location.href = `tel:${externalPreview.details}`;
    }
    setExternalPreview(null);
  };

  return (
    <DialogSurface
      ariaLabel="Report details"
      className="detail-sheet"
      onClose={onClose}
      disableEscape={showResolve || Boolean(externalPreview)}
      disableFocusTrap={showResolve || Boolean(externalPreview)}
    >
        <button className="sheet-back-button" type="button" onClick={onClose}>
          <ChevronLeft size={16} />
          Back to map
        </button>
        <button className="close-button" onClick={onClose} aria-label="Close report detail">
          <X size={18} />
        </button>
        {report.photo_url ? <img className="detail-photo" src={report.photo_url} alt="Garbage report" /> : <div className="detail-photo empty">No Photo</div>}
        <div className="detail-content">
          <div className="pill-row">
            <span className="pill" style={{ background: `${severity.color}15`, color: severity.color }}>
              <SeverityMark severityKey={report.severity} />
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

          {canCompareResolvedPhotos && (
            <section className="resolved-compare" aria-label="Before and after cleanup photos">
              <div className="sheet-title-row compact">
                <h3>Before and after</h3>
                <span className="pill green">Cleaned</span>
              </div>
              <div className="photo-compare">
                <img src={report.photo_url ?? ""} alt="Before cleanup" />
                <div className="photo-compare-after" style={{ clipPath: `inset(0 ${100 - compareValue}% 0 0)` }}>
                  <img src={report.resolved_photo_url ?? ""} alt="After cleanup" />
                </div>
                <span className="compare-label before">Before</span>
                <span className="compare-label after">After</span>
              </div>
              <label className="compare-slider">
                <span>Slide to compare</span>
                <input
                  type="range"
                  min="15"
                  max="85"
                  value={compareValue}
                  onChange={(event) => setCompareValue(Number(event.target.value))}
                />
              </label>
            </section>
          )}

          <h3>Accountability</h3>
          <div className="rep-grid">
            <RepCard label="MLA" rep={mla} area={ward?.assembly_constituency} onClick={() => mla && openProfile({ type: "mla", id: mla.constituency })} />
            <RepCard label="MP" rep={mp} area={ward?.parliamentary_constituency} onClick={() => mp && openProfile({ type: "mp", id: mp.constituency })} />
          </div>

          <div className="detail-actions">
            <div className="primary-action-row">
              <button className={clsx("primary-detail-action", upvoteBump && "is-bumped")} onClick={() => void upvote()} disabled={upvoted || isUpvoting}>
                {isUpvoting ? <LoaderCircle className="spin" size={16} /> : <ThumbsUp size={16} />}
                {upvoted ? "Upvoted" : "Upvote"}
              </button>
              <button className="primary-detail-action" onClick={() => void shareReport()}>
                <Share2 size={16} />
                Share
              </button>
            </div>
            <button className="directions-link" onClick={prepareDirections}>
              <ArrowUpRight size={15} />
              Get directions
            </button>
            <div className="contact-panel">
              <div className="contact-heading">
                <MessageCircle size={15} />
                <span>Contact BMC</span>
                <span>Visible now</span>
              </div>
              <div className="contact-actions">
                <button onClick={prepareComplaint}>
                  <MessageCircle size={16} />
                  WhatsApp BMC
                </button>
                <button onClick={() => prepareCall("BMC", BMC_NUMBER)}>
                  <Phone size={16} />
                  Call BMC
                </button>
                <button onClick={() => prepareCall("Helpline 1929", BMC_HELPLINE)}>
                  <Phone size={16} />
                  Helpline 1929
                </button>
              </div>
            </div>
            {report.status !== "resolved" && (
              <button onClick={() => setShowResolve(true)} className="green-action">
                <CheckCircle2 size={16} />
                Mark as Cleaned
              </button>
            )}
          </div>
          <p className="anonymous">
            <ShieldCheck size={13} /> All reports are anonymous
          </p>
        </div>
      {showResolve && <ResolveModal report={report} onClose={() => setShowResolve(false)} onResolved={onUpdate} />}
      {externalPreview && (
        <ExternalAppPreview
          confirmLabel={externalPreview.confirmLabel}
          details={externalPreview.details}
          helper={externalPreview.helper}
          title={externalPreview.title}
          onClose={() => setExternalPreview(null)}
          onConfirm={confirmExternalAction}
        />
      )}
    </DialogSurface>
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

function SeverityMark({ severityKey }: { severityKey: SeverityKey }) {
  return <span className={`severity-mark severity-mark-${severityKey}`} aria-hidden="true" />;
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
          navigator.vibrate?.(35);
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
    <DialogSurface layerClassName="nested-modal" className="mini-card" ariaLabel="Mark report as cleaned" onClose={onClose}>
        <button className="sheet-back-button" type="button" onClick={onClose}>
          <ChevronLeft size={16} />
          Back to report
        </button>
        <button className="close-button" onClick={onClose} aria-label="Close resolve modal">
          <X size={18} />
        </button>
        <h2>Mark as Cleaned</h2>
        <p>Take a photo to verify this spot has been cleaned up.</p>
        <div className="notice amber resolve-distance-notice">
          <CircleAlert size={16} />
          <span>
            <strong>Be near the reported spot</strong>
            You must be within 500m before this can be marked cleaned.
          </span>
        </div>
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
          <p className="warning-text" role="alert">We could not verify that you are within 500m of this report. Move closer to the spot and try again.</p>
        )}
        {status === "error" && saveError && (
          <p className="warning-text" role="alert">{saveError}</p>
        )}
    </DialogSurface>
  );
}

function ExternalAppPreview({
  confirmLabel,
  details,
  helper,
  onClose,
  onConfirm,
  title
}: {
  confirmLabel: string;
  details: string;
  helper: string;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
}) {
  return (
    <DialogSurface layerClassName="nested-modal" className="mini-card external-preview" ariaLabel={title} onClose={onClose}>
      <button className="sheet-back-button" type="button" onClick={onClose}>
        <ChevronLeft size={16} />
        Back to report
      </button>
      <button className="close-button" onClick={onClose} aria-label="Close WhatsApp preview">
        <X size={18} />
      </button>
      <h2>{title}</h2>
      <p>{helper}</p>
      <pre>{details}</pre>
      <div className="preview-actions">
        <button className="secondary-cta" type="button" onClick={onClose}>
          Not now
        </button>
        <button className="primary-cta" type="button" onClick={onConfirm}>
          <ArrowUpRight size={16} />
          {confirmLabel}
        </button>
      </div>
    </DialogSurface>
  );
}

type ReportFormStep = 1 | 2 | 3;
type ReportFieldKey = "photo" | "ward" | "address";

function ReportForm({ data, onClose, onSubmit }: { data: CivicData; onClose: () => void; onSubmit: (report: GarbageReport) => void }) {
  const [formStep, setFormStep] = useState<ReportFormStep>(1);
  const [wardNumber, setWardNumber] = useState("");
  const [wardSearch, setWardSearch] = useState("");
  const [wardPickerOpen, setWardPickerOpen] = useState(false);
  const [detectedWard, setDetectedWard] = useState<Ward | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number; accuracy: number | null; recordedAt: string } | null>(null);
  const [locationState, setLocationState] = useState<"idle" | "locating" | "detecting" | "detected" | "manual" | "outside" | "unavailable" | "denied">("idle");
  const [address, setAddress] = useState("");
  const [severity, setSeverity] = useState<SeverityKey>("medium");
  const [category, setCategory] = useState<WasteCategory>("mixed");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitStage, setSubmitStage] = useState<"idle" | "uploading" | "saving">("idle");
  const [slowSubmit, setSlowSubmit] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submittedReviewStatus, setSubmittedReviewStatus] = useState<GarbageReport["moderation_status"] | null>(null);
  const [formError, setFormError] = useState("");
  const [liveMessage, setLiveMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ReportFieldKey, string>>>({});
  const [formOffline, setFormOffline] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);
  const limit = canSubmitReport();
  const selectedWard = detectedWard ?? data.wards.find((ward) => ward.ward_number === Number(wardNumber));
  const selectedWardLabel = selectedWard ? getWardSelectLabel(selectedWard) : "";
  const filteredWardOptions = useMemo(() => {
    const query = wardSearch.trim().toLowerCase();
    const digits = query.replace(/\D/g, "");
    if (!query || (selectedWard && query === getWardSelectLabel(selectedWard).toLowerCase())) {
      return data.wards;
    }
    const matches = query
      ? data.wards.filter((ward) => getWardSearchText(ward).includes(query) || (digits ? String(ward.ward_number).includes(digits) : false))
      : data.wards;

    if (selectedWard && !matches.some((ward) => ward.ward_number === selectedWard.ward_number)) {
      return [selectedWard, ...matches];
    }
    return matches;
  }, [data.wards, selectedWard, wardSearch]);
  const visibleWardOptions = filteredWardOptions.slice(0, 8);
  const progressLabel =
    formStep === 1
      ? "Choose ward"
      : formStep === 2
        ? "Add evidence"
        : "Review and submit";
  const currentStepTitle =
    formStep === 1
      ? "Where is the garbage?"
      : formStep === 2
        ? "Add photo and landmark"
        : "Review report";
  const hasUnsavedInput =
    Boolean(wardNumber || detectedWard || location || address.trim() || photo) || severity !== "medium" || category !== "mixed";

  // Track the current object URL so we can revoke it when the user picks a
  // new photo (preventing Blob URL memory leaks on repeated retakes).
  const photoPreviewRef = useRef<string | null>(null);
  const submitTimeoutRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (photoPreviewRef.current) URL.revokeObjectURL(photoPreviewRef.current);
      if (submitTimeoutRef.current != null) window.clearTimeout(submitTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const syncOnlineState = () => setFormOffline(navigator.onLine === false);
    window.addEventListener("online", syncOnlineState);
    window.addEventListener("offline", syncOnlineState);
    return () => {
      window.removeEventListener("online", syncOnlineState);
      window.removeEventListener("offline", syncOnlineState);
    };
  }, []);

  const requestClose = useCallback(() => {
    if (submitting) return;
    if (submitSuccess || !hasUnsavedInput || window.confirm("Discard this report? Your photo and details will be lost.")) {
      onClose();
    }
  }, [hasUnsavedInput, onClose, submitSuccess, submitting]);

  const announce = useCallback((message: string) => {
    setLiveMessage("");
    window.setTimeout(() => setLiveMessage(message), 20);
  }, []);

  const clearFieldError = (field: ReportFieldKey) => {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const chooseWard = (ward: Ward) => {
    setDetectedWard(null);
    setWardNumber(String(ward.ward_number));
    setWardSearch(getWardSelectLabel(ward));
    setWardPickerOpen(false);
    setLocationState("manual");
    clearFieldError("ward");
    setFormError("");
  };

  const validateStep = useCallback(
    (step: ReportFormStep) => {
      const nextFieldErrors: Partial<Record<ReportFieldKey, string>> = {};
      if (step === 1 && !selectedWard) {
        nextFieldErrors.ward = "Search for your ward and tap a result to continue.";
      }
      if (step === 2) {
        if (!photo) nextFieldErrors.photo = "Add a clear photo of the garbage spot.";
        if (!address.trim()) nextFieldErrors.address = "Add a nearby landmark or address so others can find the spot.";
      }

      if (Object.keys(nextFieldErrors).length) {
        setFieldErrors((current) => ({ ...current, ...nextFieldErrors }));
        announce(Object.values(nextFieldErrors)[0] ?? "Complete the required fields to continue.");
        return false;
      }

      setFieldErrors((current) => {
        const next = { ...current };
        if (step === 1) delete next.ward;
        if (step === 2) {
          delete next.photo;
          delete next.address;
        }
        return next;
      });
      return true;
    },
    [address, announce, photo, selectedWard]
  );

  const goToNextStep = () => {
    if (formStep >= 3) return;
    if (!validateStep(formStep)) return;
    setFormError("");
    setFormStep((step) => (Math.min(3, step + 1) as ReportFormStep));
  };

  const goToPreviousStep = () => {
    if (formStep <= 1) return;
    setFormError("");
    setFormStep((step) => (Math.max(1, step - 1) as ReportFormStep));
  };

  const detectWard = () => {
    if (!navigator.geolocation) {
      setLocationState("unavailable");
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
          setWardSearch(getWardSelectLabel(ward));
          setWardPickerOpen(false);
          setLocationState("detected");
          clearFieldError("ward");
        } else {
          setLocationState("manual");
        }
      },
      (geoError) => setLocationState(geoError.code === geoError.PERMISSION_DENIED ? "denied" : "manual"),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const onFile = (file?: File) => {
    if (!file) return;
    if (photoPreviewRef.current) URL.revokeObjectURL(photoPreviewRef.current);
    const url = URL.createObjectURL(file);
    photoPreviewRef.current = url;
    setPhoto(file);
    setPhotoPreview(url);
    clearFieldError("photo");
  };

  const removePhoto = () => {
    if (photoPreviewRef.current) URL.revokeObjectURL(photoPreviewRef.current);
    photoPreviewRef.current = null;
    setPhoto(null);
    setPhotoPreview(null);
  };

  const locationHelp = (() => {
    if (locationState === "locating") return "Your browser will ask for permission. We only use it to detect the ward for this report.";
    if (locationState === "detecting") return "Finding the matching Bhubaneswar ward...";
    if (locationState === "detected") return `Detected Ward ${selectedWard?.ward_number ?? ""}. You can still change it manually.`;
    if (locationState === "outside") return "Your location appears outside Bhubaneswar. Choose the ward manually if this report is inside the city.";
    if (locationState === "denied") return "Location permission was not allowed. Choose the ward manually to continue.";
    if (locationState === "unavailable") return "This browser cannot share location. Choose the ward manually to continue.";
    if (locationState === "manual" && selectedWard) return "Ward selected manually. The report will use the ward center if GPS is not added.";
    if (locationState === "manual") return "We could not detect your ward. Choose it manually to continue.";
    return "Use current location to detect your ward faster. You can also choose the ward yourself.";
  })();

  const submitProgressText =
    submitStage === "uploading"
      ? "Uploading photo..."
      : submitStage === "saving"
        ? "Saving report..."
        : "Submitting...";

  const submit = async () => {
    if (submitSuccess) return;
    setFormError("");
    setSlowSubmit(false);
    if (!limit.allowed) {
      setFormError("Daily report limit reached. Please try again tomorrow.");
      announce("Daily report limit reached. Please try again tomorrow.");
      return;
    }
    if (!validateStep(1)) {
      setFormStep(1);
      return;
    }
    if (!validateStep(2)) {
      setFormStep(2);
      return;
    }
    if (!photo || !selectedWard) return;
    if (formOffline || navigator.onLine === false) {
      setFormError("You appear to be offline. Reconnect and submit the report again.");
      announce("You are offline. Reconnect to submit this report.");
      return;
    }
    setSubmitting(true);
    const slowTimer = window.setTimeout(() => setSlowSubmit(true), 4500);
    try {
      setSubmitStage("uploading");
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
      setSubmitStage("saving");
      const submitted = await backend.submitReport(input);
      setSubmittedReviewStatus(submitted.moderation_status ?? "flagged");
      setSubmitSuccess(true);
      navigator.vibrate?.(35);
      submitTimeoutRef.current = window.setTimeout(() => onSubmit(submitted), 1800);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to submit report. Please try again.";
      setFormError(message);
      announce(message);
    } finally {
      window.clearTimeout(slowTimer);
      setSubmitStage("idle");
      setSlowSubmit(false);
      setSubmitting(false);
    }
  };

  return (
    <DialogSurface ariaLabel="Report garbage" className="form-sheet" onClose={requestClose}>
      {formStep > 1 && (
        <button className="sheet-back-button form-back" type="button" onClick={goToPreviousStep}>
          <ChevronLeft size={16} />
          Back
        </button>
      )}
      <button className="close-button" onClick={requestClose} aria-label="Close report form">
        <X size={18} />
      </button>
      <div className="form-header">
        <div>
          <p className="eyebrow">Garbage Report</p>
          <h2>Report Garbage</h2>
          <p>
            <strong>{currentStepTitle}</strong>{" "}
            {formStep === 1 && "Pick the ward for this report."}
            {formStep === 2 && "Add the proof people need to find the spot."}
            {formStep === 3 && "Confirm the details before submitting."}
          </p>
        </div>
      </div>
      <div className="sr-only" aria-live="assertive" role="alert">
        {liveMessage}
      </div>
      <div className="form-progress" aria-label={`Report progress step ${formStep} of 3`}>
        <div>
          <span>Step {formStep} of 3</span>
          <strong>{progressLabel}</strong>
        </div>
        <em>{formStep === 3 ? "Final check" : "Guided report"}</em>
        <i>
          <b style={{ width: `${(formStep / 3) * 100}%` }} />
        </i>
      </div>
      {locationState === "outside" && (
        <div className="notice amber" role="alert">
          <CircleAlert size={16} />
          <span>
            <strong>We are not live in your area yet</strong>
            You can still browse reports and explore the map.
          </span>
        </div>
      )}

      {formStep === 1 && (
        <section className="wizard-panel" aria-labelledby="report-step-ward">
          <div className="field">
            <label className="field-label" htmlFor="report-ward-search" id="report-step-ward">
              Ward <b>*</b>
            </label>
            <div
              className="ward-combobox"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setWardPickerOpen(false);
                }
              }}
            >
              <div className="ward-search">
                <Search size={14} />
                <input
                  id="report-ward-search"
                  value={wardSearch}
                  onFocus={() => setWardPickerOpen(true)}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setWardSearch(nextValue);
                    setWardPickerOpen(true);
                    if (selectedWard && nextValue !== selectedWardLabel) {
                      setWardNumber("");
                      setDetectedWard(null);
                    }
                    clearFieldError("ward");
                  }}
                  placeholder="Type ward number or locality"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={wardPickerOpen}
                  aria-controls="report-ward-options"
                  aria-invalid={Boolean(fieldErrors.ward)}
                  aria-describedby={fieldErrors.ward ? "report-ward-error" : selectedWard ? "selected-ward" : undefined}
                />
              </div>
              {wardPickerOpen && (
                <div className="ward-options" id="report-ward-options" role="listbox" aria-label="Matching wards">
                  {visibleWardOptions.length ? (
                    visibleWardOptions.map((ward) => {
                      const wardLabel = getWardSelectLabel(ward);
                      const isSelected = selectedWard?.ward_number === ward.ward_number;
                      return (
                        <button
                          key={ward.ward_number}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          className={clsx(isSelected && "is-selected")}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => chooseWard(ward)}
                        >
                          <strong>{wardLabel}</strong>
                          <small>{ward.locality_name || ward.assembly_constituency}</small>
                        </button>
                      );
                    })
                  ) : (
                    <p>No matching wards. Try a ward number or locality.</p>
                  )}
                </div>
              )}
            </div>
            {selectedWard && (
              <p className="selected-ward" id="selected-ward" role="status">
                <CheckCircle2 size={14} />
                Selected {selectedWardLabel}
              </p>
            )}
            {fieldErrors.ward && (
              <p className="field-error" id="report-ward-error" role="alert">
                {fieldErrors.ward}
              </p>
            )}
          </div>
          <div className="location-helper">
            <span>
              <strong>Use location to detect your ward faster</strong>
              <small>{locationHelp}</small>
            </span>
            <button className="tiny-action" onClick={detectWard} type="button" disabled={locationState === "locating" || locationState === "detecting"}>
              {locationState === "locating" || locationState === "detecting" ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}
              {locationState === "detected"
                ? "Refresh location"
                : locationState === "detecting"
                  ? "Detecting..."
                  : locationState === "locating"
                    ? "Finding..."
                    : "Use current location"}
            </button>
          </div>
          <p className="privacy-note">Your GPS coordinates are used only to identify the ward and are not shared publicly.</p>
        </section>
      )}

      {formStep === 2 && (
        <section className="wizard-panel" aria-labelledby="report-step-evidence">
          <label className="field" id="report-step-evidence">
            <span>
              Landmark / Address <b>*</b>
            </span>
            <input
              value={address}
              onChange={(event) => {
                setAddress(event.target.value);
                clearFieldError("address");
              }}
              aria-invalid={Boolean(fieldErrors.address)}
              aria-describedby={fieldErrors.address ? "report-address-error" : undefined}
              placeholder="e.g., Near Unit 4 market, beside the temple"
            />
            <small>Please add a landmark or address so others can find this spot.</small>
            {fieldErrors.address && (
              <p className="field-error" id="report-address-error" role="alert">
                {fieldErrors.address}
              </p>
            )}
          </label>
          <div className="field">
            <span>
              Photo <b>*</b>
            </span>
            <label className={clsx("photo-drop", photoPreview && "has-photo")}>
              {photoPreview ? <img src={photoPreview} alt="" /> : <Camera size={30} />}
              <em>{photoPreview ? "Tap to Retake" : "Take a Photo"}</em>
              <small>Attach a clear photo of the garbage spot.</small>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                aria-invalid={Boolean(fieldErrors.photo)}
                aria-describedby={fieldErrors.photo ? "report-photo-error" : undefined}
                onChange={(event) => onFile(event.target.files?.[0])}
              />
            </label>
            {photoPreview && (
              <button className="tiny-action remove-photo" type="button" onClick={removePhoto}>
                Remove photo
              </button>
            )}
            {fieldErrors.photo && (
              <p className="field-error" id="report-photo-error" role="alert">
                {fieldErrors.photo}
              </p>
            )}
          </div>
        </section>
      )}

      {formStep === 3 && (
        <section className="wizard-panel" aria-labelledby="report-step-review">
          <div className="review-card" id="report-step-review">
            <strong>{selectedWard ? selectedWardLabel : "Ward not selected"}</strong>
            <span>{address || "No landmark added yet"}</span>
            <small>{photo ? "Photo attached" : "Photo missing"}</small>
          </div>
          <label className="field">
            <span>How Bad Is It?</span>
            <div className="option-grid">
              {Object.entries(SEVERITY).map(([key, value]) => (
                <button type="button" className={clsx(severity === key && "is-selected")} onClick={() => setSeverity(key as SeverityKey)} key={key}>
                  <SeverityMark severityKey={key as SeverityKey} />
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
        </section>
      )}

      <div className="form-footer">
        {submitSuccess && (
          <div className="notice success" role="status">
            <CheckCircle2 size={16} />
            <span>
              <strong>Report submitted</strong>
              {submittedReviewStatus === "approved"
                ? "Opening your report now."
                : "Submitted for review. It may take a moment before appearing publicly."}
            </span>
          </div>
        )}
        {submitting && (
          <div className="notice info" role="status">
            <LoaderCircle className="spin" size={16} />
            <span>
              <strong>{submitProgressText}</strong>
              Keep this screen open while we send your photo and report details.
            </span>
          </div>
        )}
        {slowSubmit && (
          <p className="warning-text" role="alert">This is taking longer than usual. Your photo may be on a slow connection, so please keep the form open.</p>
        )}
        {formOffline && <p className="warning-text" role="alert">You are offline. Reconnect to submit this report.</p>}
        {formError && <p className="warning-text" role="alert">{formError}</p>}
        <div className="wizard-actions">
          {formStep > 1 && (
            <button className="secondary-cta" type="button" onClick={goToPreviousStep} disabled={submitting}>
              <ChevronLeft size={16} />
              Back
            </button>
          )}
          {formStep < 3 ? (
            <button className="primary-cta" type="button" onClick={goToNextStep}>
              Next
            </button>
          ) : (
            <button className="primary-cta" onClick={() => void submit()} disabled={submitting || submitSuccess || formOffline}>
              {submitting ? <LoaderCircle className="spin" size={17} /> : submitSuccess ? <CheckCircle2 size={17} /> : <Send size={17} />}
              {submitSuccess ? "Report submitted" : submitting ? submitProgressText : formOffline ? "Offline - reconnect" : "Submit Report"}
            </button>
          )}
        </div>
        <p className="anonymous">
          <ShieldCheck size={13} /> All reports are anonymous
        </p>
      </div>
    </DialogSurface>
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
    <DialogSurface ariaLabel={isWard ? "Ward profile" : "Representative profile"} className="profile-sheet" onClose={onClose}>
        <button className="sheet-back-button" type="button" onClick={onClose}>
          <ChevronLeft size={16} />
          Back to map
        </button>
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
        <ReportList
          reports={profileReports}
          wards={data.wards}
          representatives={data.representatives}
          initialLimit={12}
          emptyTitle="No reports linked here yet."
          emptyDescription="When citizens report spots in this area, they will appear here."
          onSelect={onSelectReport}
        />
    </DialogSurface>
  );
}

function AboutSheet({ onClose, onOpenChangelog }: { onClose: () => void; onOpenChangelog: () => void }) {
  const wardStart = BMC_CONTACTS.ward_numbers[0];
  const wardEnd = BMC_CONTACTS.ward_numbers[BMC_CONTACTS.ward_numbers.length - 1];

  return (
    <DialogSurface layerClassName="modal-layer top" ariaLabel="About Amma Odisha" className="top-sheet" onClose={onClose}>
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
        <div className="accountability-card">
          <h3>{BMC_CONTACTS.name} ({BMC_CONTACTS.short_name})</h3>
          <p>
            Main Contact: <a href={`tel:${BMC_CONTACTS.main_contact_number}`}>{BMC_CONTACTS.main_contact_number}</a> · Helpline: <a href={`tel:${BMC_CONTACTS.helpline_number}`}>{BMC_CONTACTS.helpline_number}</a>
          </p>
          <p>
            Email: <a href={`mailto:${BMC_CONTACTS.email}`}>{BMC_CONTACTS.email}</a> · Grievance: <a href={`mailto:${BMC_CONTACTS.grievance_email}`}>{BMC_CONTACTS.grievance_email}</a>
          </p>
          <p>North Zone: {BMC_CONTACTS.zone_contacts.north_zone} · South-West Zone: {BMC_CONTACTS.zone_contacts.south_west_zone} · South-East Zone: {BMC_CONTACTS.zone_contacts.south_east_zone}</p>
          <p>{BMC_CONTACTS.address}</p>
          <p>Coverage: {BMC_CONTACTS.total_wards} wards (Ward {wardStart} to Ward {wardEnd}).</p>
        </div>
        <div className="social-row">
          <a href="https://x.com/MrinallSamal" target="_blank" rel="noreferrer">
            Follow updates <ExternalLink size={13} />
          </a>
          <a href="https://x.com/realmojojojo_" target="_blank" rel="noreferrer">
            Build By Mrinall Samal
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
    </DialogSurface>
  );
}

function ChangelogSheet({ onClose }: { onClose: () => void }) {
  return (
    <DialogSurface ariaLabel="Changelog" className="profile-sheet small" onClose={onClose}>
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
    </DialogSurface>
  );
}

function TelegramToast() {
  const [hidden, setHidden] = useState(() => readStorageValue("nk_telegram_hidden") === "1");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (hidden) return;
    const timer = window.setTimeout(() => setReady(true), 30000);
    return () => window.clearTimeout(timer);
  }, [hidden]);

  if (hidden || !ready) return null;
  return (
    <div className="telegram-toast">
      <button
        className="toast-close"
        onClick={() => {
          writeStorageValue("nk_telegram_hidden", "1");
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
