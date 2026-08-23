import clsx from "clsx";
import {
  ArrowUpRight,
  BarChart3,
  Bookmark,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  Info,
  Layers,
  List,
  LoaderCircle,
  Map as MapIcon,
  MapPin,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Send,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  ThumbsUp,
  Trophy,
  X
} from "lucide-react";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { BMC_CONTACTS, BMC_HELPLINE, BMC_NUMBER, CHANGELOG, CATEGORIES, PARTY_COLORS, SEVERITY, STATUS_LABELS } from "../services/constants";
import { backend } from "../services/backend";
import { findNearbyReports, type NearbyMatch } from "../services/duplicate-check";
import { escalationLevel } from "../services/escalation";
import { distanceKm, findNearestWard, findWardInGeoJson, isInsideBoundary } from "../services/geo";
import { t, useLang } from "../services/i18n";
import { canSubmitReport, hasUpvoted } from "../services/limits";
import { getMyReports, trackMyReport } from "../services/my-reports";
import { LOCAL_REPORT_PHOTO_FALLBACK_URL, ODISHA_GARBAGE_FALLBACK_IMAGE } from "../services/report-images";
import { generateBMCComplaint, getReportShareText, getWhatsAppUrl, shareOrCopy, shareReportViaWhatsApp } from "../services/share";
import { daysActive, shortDate, timeAgoI18n } from "../services/time";
import type {
  CivicData,
  GarbageReport,
  NewReportInput,
  RealtimeConnectionStatus,
  Representative,
  SeverityKey,
  Ward,
  WasteCategory
} from "../types/domain";

const MapView = lazy(async () => ({ default: (await import("./MapView")).MapView }));
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const POPULAR_WARD_NUMBERS = [40, 30, 36, 37, 38, 41, 34, 19];
const SEVERITY_I18N_KEYS: Record<SeverityKey, "low" | "medium" | "high" | "critical"> = {
  small: "low",
  medium: "medium",
  large: "high",
  massive: "critical"
};
const SEVERITY_SHORT_DESCRIPTIONS: Record<SeverityKey, string> = {
  small: "Under 1m²",
  medium: "About 1–5m²",
  large: "Covers 5–20m²",
  massive: "20m²+ or a full stretch"
};
const SEVERITY_PRIORITY: Record<SeverityKey, number> = {
  small: 1,
  medium: 2,
  large: 3,
  massive: 4
};
const SEVERITY_TEXT_COLORS: Record<SeverityKey, string> = {
  small: "#B45309",
  medium: "#C2410C",
  large: "#B91C1C",
  massive: "#991B1B"
};

// Dark, contrast-safe text variants of PARTY_COLORS for use as text on light
// backgrounds (raw party hues like TDP #FFD600 fail contrast as text color).
const PARTY_TEXT_COLORS: Record<string, string> = {
  BJP: "#B45309",
  BJD: "#047857",
  INC: "#0369A1",
  JDS: "#15803D",
  AAP: "#4338CA",
  SP: "#B91C1C",
  BSP: "#1E40AF",
  TMC: "#15803D",
  DMK: "#B91C1C",
  YSRCP: "#6D28D9",
  TDP: "#A16207",
  SS: "#C2410C",
  NCP: "#1D4ED8",
  RJD: "#C2410C",
  JDU: "#0F766E",
  INDEPENDENT: "#546E7A"
};

type RouteSelection =
  | { type: "report"; id: string }
  | { type: "ward"; id: string }
  | { type: "mla"; id: string }
  | { type: "mp"; id: string }
  | null;
type ProfileSelection = Extract<Exclude<RouteSelection, null>, { type: "ward" | "mla" | "mp" }>;

type ExternalPreviewAction =
  | { kind: "maps"; value: string }
  | { kind: "tel"; value: string }
  | { kind: "whatsapp"; value: string };

interface ExternalPreviewConfig {
  action: ExternalPreviewAction;
  confirmLabel: string;
  details: string;
  helper: string;
  title: string;
}

interface PublicAppProps {
  autoOpenReport?: boolean;
  connectionStatus?: RealtimeConnectionStatus;
  data: CivicData;
  lastRefreshedAt?: string | null;
  onSuccessfulRefresh?: () => void;
  routeSelection: RouteSelection;
  routeState?: {
    returnProfile?: { id: string; type: "ward" | "mla" | "mp" } | null;
    returnReportId?: string;
  } | null;
  onDataChange: (data: CivicData) => void;
  navigate: (path: string, state?: { returnProfile?: ProfileSelection | null; returnReportId?: string }) => void;
}

function getRouteSelectionPath(selection: Exclude<RouteSelection, null>) {
  return `/${selection.type}/${encodeURIComponent(selection.id)}`;
}

function getRouteSelectionLabel(selection: Exclude<RouteSelection, null>) {
  if (selection.type === "ward") return `Ward ${selection.id}`;
  if (selection.type === "mla") return "MLA profile";
  if (selection.type === "mp") return "MP profile";
  return "Report";
}

function getStoredReturnProfile(value?: { id: string; type: string } | null): ProfileSelection | null {
  if (!value || !["ward", "mla", "mp"].includes(value.type) || !value.id) return null;
  return { type: value.type as "ward" | "mla" | "mp", id: value.id };
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

function severityLabel(severity: SeverityKey) {
  return t(`severity.${SEVERITY_I18N_KEYS[severity]}`);
}

function daysOpen(report: GarbageReport) {
  return daysActive(report.created_at);
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
  const dragRef = useRef<{ active: boolean; lastDelta: number; pointerId: number; startY: number } | null>(null);
  const onCloseRef = useRef(onClose);
  const disableEscapeRef = useRef(disableEscape);
  const disableFocusTrapRef = useRef(disableFocusTrap);
  onCloseRef.current = onClose;
  disableEscapeRef.current = disableEscape;
  disableFocusTrapRef.current = disableFocusTrap;
  const supportsSwipeDismiss = className
    .split(/\s+/)
    .some((name) => ["detail-sheet", "form-sheet", "profile-sheet", "insights-sheet", "filter-sheet"].includes(name));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const preferredFocus = dialog.querySelector<HTMLElement>("[data-autofocus]");
      const firstFocusable = getFocusableElements(dialog)[0];
      (preferredFocus ?? firstFocusable ?? dialog).focus({ preventScroll: true });
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !disableEscapeRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab" || disableFocusTrapRef.current) return;

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
  }, []);

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
        onPointerDown={(event) => {
          if (!supportsSwipeDismiss || window.innerWidth >= 720) return;
          if (event.pointerType === "mouse" && event.button !== 0) return;

          const target = event.target as HTMLElement;
          const sheet = event.currentTarget;
          const topOffset = event.clientY - sheet.getBoundingClientRect().top;
          if (topOffset > 44) return;
          if (target !== sheet && target.closest("button,a,input,select,textarea,label")) return;

          dragRef.current = { active: true, lastDelta: 0, pointerId: event.pointerId, startY: event.clientY };
          sheet.setPointerCapture?.(event.pointerId);
          sheet.classList.add("is-dragging");
          sheet.style.transition = "none";
          sheet.style.willChange = "transform";
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag?.active || drag.pointerId !== event.pointerId) return;
          const delta = Math.max(0, event.clientY - drag.startY);
          drag.lastDelta = delta;
          if (delta > 2) event.preventDefault();
          event.currentTarget.style.transform = `translateY(${Math.round(delta)}px)`;
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current;
          if (!drag?.active || drag.pointerId !== event.pointerId) return;
          const shouldClose = drag.lastDelta > 120;
          dragRef.current = null;
          event.currentTarget.releasePointerCapture?.(event.pointerId);
          event.currentTarget.classList.remove("is-dragging");
          event.currentTarget.style.transition = "";
          event.currentTarget.style.transform = "";
          event.currentTarget.style.willChange = "";
          if (shouldClose) onClose();
        }}
        onPointerCancel={(event) => {
          const drag = dragRef.current;
          if (!drag?.active || drag.pointerId !== event.pointerId) return;
          dragRef.current = null;
          event.currentTarget.releasePointerCapture?.(event.pointerId);
          event.currentTarget.classList.remove("is-dragging");
          event.currentTarget.style.transition = "";
          event.currentTarget.style.transform = "";
          event.currentTarget.style.willChange = "";
        }}
      >
        {children}
      </article>
    </div>
  );
}

export function PublicApp({ autoOpenReport = false, connectionStatus, data, lastRefreshedAt = null, onSuccessfulRefresh, routeSelection, routeState, onDataChange, navigate }: PublicAppProps) {
  const [lang, setLang] = useLang();
  const [reports, setReports] = useState(data.reports);
  const [selectedReport, setSelectedReport] = useState<GarbageReport | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<RouteSelection>(null);
  const [returnProfile, setReturnProfile] = useState<ProfileSelection | null>(null);
  const [returnReport, setReturnReport] = useState<GarbageReport | null>(null);
  const [focusWardNumber, setFocusWardNumber] = useState<number | null>(null);
  const [focusRequestId, setFocusRequestId] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "upvotes" | "oldest">("newest");
  const [wardFilterNumber, setWardFilterNumber] = useState<number | null>(null);
  const [wardFilterState, setWardFilterState] = useState<"idle" | "locating" | "error">("idle");
  const [showReportForm, setShowReportForm] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [showMyReports, setShowMyReports] = useState(false);
  const [showIntro, setShowIntro] = useState(() => readStorageValue("nk_intro_seen") !== "1");
  const [showAbout, setShowAbout] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [showMobileQR, setShowMobileQR] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [showReportCoach, setShowReportCoach] = useState(() => readStorageValue("nk_report_coach_seen") !== "1");
  const [filterPulse, setFilterPulse] = useState(false);
  const [viewMode, setViewMode] = useState<"map" | "list">("map");
  const [showFilters, setShowFilters] = useState(false);
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);
  const [severityFilter, setSeverityFilter] = useState<"all" | SeverityKey>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "unresolved" | "resolved">("all");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [routeReportLoading, setRouteReportLoading] = useState(false);
  const [routeFetchedReport, setRouteFetchedReport] = useState<GarbageReport | null>(null);
  const fetchedRouteReportIdRef = useRef<string | null>(null);

  const wardsByNumber = useMemo(() => new globalThis.Map(data.wards.map((ward) => [ward.ward_number, ward])), [data.wards]);

  useEffect(() => {
    setReports(data.reports);
  }, [data.reports]);

  useEffect(() => {
    if (viewMode !== "map") setMapLoaded(false);
  }, [viewMode]);

  useEffect(() => {
    if (!autoOpenReport) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("action");
    window.history.replaceState(window.history.state ?? {}, "", `${url.pathname}${url.search}${url.hash}`);
    setShowIntro(false);
    writeStorageValue("nk_intro_seen", "1");
    setShowReportForm(true);
  }, [autoOpenReport]);

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
    const storedReturnProfile = getStoredReturnProfile(routeState?.returnProfile ?? null);
    const storedReturnReport = routeState?.returnReportId
      ? reports.find((item) => item.id === routeState.returnReportId) ?? null
      : null;

    if (!routeSelection) {
      setSelectedReport(null);
      setSelectedProfile(null);
      setReturnProfile(null);
      setReturnReport(null);
      setRouteFetchedReport(null);
      setRouteReportLoading(false);
      return;
    }
    if (routeSelection.type === "report") {
      const report = reports.find((item) => item.id === routeSelection.id);
      if (report) setSelectedReport(report);
      else if (routeFetchedReport?.id === routeSelection.id) setSelectedReport(routeFetchedReport);
      setSelectedProfile(null);
      setReturnProfile(storedReturnProfile);
      setReturnReport(null);
    } else {
      setSelectedProfile(routeSelection);
      setSelectedReport(null);
      setReturnReport(storedReturnReport);
      setReturnProfile(null);
    }
  }, [reports, routeFetchedReport, routeSelection, routeState]);

  useEffect(() => {
    if (routeSelection?.type !== "report") return;
    const reportId = routeSelection.id;
    if (reports.some((item) => item.id === reportId)) return;
    if (fetchedRouteReportIdRef.current === reportId) return;
    fetchedRouteReportIdRef.current = reportId;
    let cancelled = false;
    setRouteFetchedReport(null);
    setRouteReportLoading(true);
    backend
      .fetchReportById(reportId)
      .then((report) => {
        if (!cancelled) setRouteFetchedReport(report);
      })
      .catch(() => {
        if (!cancelled) setRouteFetchedReport(null);
      })
      .finally(() => {
        if (!cancelled) setRouteReportLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reports, routeSelection]);

  const representativeSearchByWard = useMemo(() => {
    const mlaByConstituency = new Map<string, Representative>();
    const mpByConstituency = new Map<string, Representative>();

    data.representatives.forEach((rep) => {
      if (rep.role === "mla") mlaByConstituency.set(rep.constituency, rep);
      if (rep.role === "mp") mpByConstituency.set(rep.constituency, rep);
    });

    return new Map(
      data.wards.map((ward) => {
        const reps = [
          mlaByConstituency.get(ward.assembly_constituency),
          mpByConstituency.get(ward.parliamentary_constituency)
        ]
          .filter((rep): rep is Representative => Boolean(rep))
          .map((rep) => `${rep.name} ${rep.party} ${rep.constituency}`)
          .join(" ");

        return [ward.ward_number, reps];
      })
    );
  }, [data.representatives, data.wards]);

  const filteredReports = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return reports.filter((report) => {
      if (severityFilter !== "all" && report.severity !== severityFilter) return false;
      if (statusFilter !== "all" && report.status !== statusFilter) return false;
      if (wardFilterNumber != null && report.ward_number !== wardFilterNumber) return false;
      if (!query) return true;
      const ward = wardsByNumber.get(report.ward_number);
      const haystack = [
        report.address,
        `ward ${report.ward_number}`,
        ward?.ward_name,
        ward?.locality_name,
        ward?.zone,
        ward?.assembly_constituency,
        ward?.parliamentary_constituency,
        CATEGORIES[report.category],
        SEVERITY[report.severity]?.label,
        STATUS_LABELS[report.status],
        representativeSearchByWard.get(report.ward_number)
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [reports, representativeSearchByWard, searchQuery, severityFilter, statusFilter, wardFilterNumber, wardsByNumber]);

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

  // Map only shows unresolved reports — resolved ones are removed from the map
  // after admin approves a cleanup, but remain visible in the list view.
  const mapReports = useMemo(
    () => visibleReports.filter((report) => report.status !== "resolved"),
    [visibleReports]
  );

  const { unresolved, resolved } = useMemo(() => {
    const nextUnresolved: GarbageReport[] = [];
    const nextResolved: GarbageReport[] = [];
    reports.forEach((report) => {
      if (report.status === "resolved") nextResolved.push(report);
      else nextUnresolved.push(report);
    });
    return { unresolved: nextUnresolved, resolved: nextResolved };
  }, [reports]);
  const worstWards = useMemo(() => getWorstWards(filteredReports, data.wards), [filteredReports, data.wards]);
  const introStats = useMemo(
    () => ({
      wardCount: data.wards.length,
      mlaCount: new Set(data.representatives.filter((rep) => rep.role === "mla").map((rep) => rep.constituency)).size,
      mpCount: new Set(data.representatives.filter((rep) => rep.role === "mp").map((rep) => rep.constituency)).size
    }),
    [data.representatives, data.wards]
  );
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
      onSuccessfulRefresh?.();
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
    setHasInteracted(true);
    setShowReportForm(false);
    setReturnProfile(null);
    setReturnReport(null);
    setSelectedReport(report);
    navigate(`/report/${report.id}`);
  };

  const dismissIntro = () => {
    writeStorageValue("nk_intro_seen", "1");
    setShowIntro(false);
  };

  const dismissReportCoach = () => {
    writeStorageValue("nk_report_coach_seen", "1");
    setShowReportCoach(false);
  };

  const applyFilters = () => {
    setShowFilters(false);
    if (!activeFilterCount) return;
    setFilterPulse(true);
    window.setTimeout(() => setFilterPulse(false), 900);
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
        if (!isInsideBoundary(lat, lng, data.cityBoundary)) {
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
  }, [data.cityBoundary, data.wardBoundaries, data.wards, focusWardOnMap]);

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
      setReturnProfile(null);
      setReturnReport(null);
      setSelectedReport(report);
      navigate(`/report/${report.id}`);
    },
    [navigate]
  );

  const handleMapWardSelect = useCallback(
    (wardNumber: number) => {
      setReturnProfile(null);
      setReturnReport(null);
      focusWardOnMap(wardNumber);
      setSelectedProfile({ type: "ward", id: String(wardNumber) });
      navigate(`/ward/${wardNumber}`);
    },
    [focusWardOnMap, navigate]
  );

  const showMapEmptyState = viewMode === "map" && mapReports.length === 0;
  const mapEmptyHasListResults = visibleReports.length > 0;
  const mapEmptyTitle = mapEmptyHasListResults
    ? "Only cleaned reports match"
    : hasActiveFilters
      ? "No reports match your filters"
      : "No active reports visible yet";
  const mapEmptyDescription = mapEmptyHasListResults
    ? "Resolved reports stay in the issue feed so the map stays focused on active garbage spots."
    : hasActiveFilters
      ? "Clear filters to bring active map markers back."
      : "New approved reports will appear here as active map markers.";

  const connectionBadge =
    connectionStatus === "live" ? (
      <span className="conn-badge is-live">{t("conn.live")}</span>
    ) : connectionStatus === "reconnecting" || (connectionStatus === "offline" && navigator.onLine !== false) ? (
      <span className="conn-badge">{t("conn.reconnecting")}</span>
    ) : null;
  const freshnessNote = !refreshing && lastRefreshedAt && (
    <p className="freshness-note" role="status">
      {t("freshness.updated")} {timeAgoI18n(lastRefreshedAt, t)}
      {connectionBadge}
    </p>
  );

  return (
    <div className="app-frame">
      {viewMode === "map" && (
        <Suspense
          fallback={
            <div className="map-shell map-loading-shell" aria-label={t("map.loading")}>
              <div className="map-loading-pill">{t("map.loading")}</div>
            </div>
          }
        >
          <MapView
            reports={mapReports}
            cityBoundary={data.cityBoundary}
            wardBoundaries={data.wardBoundaries}
            onSelectReport={handleMapReportSelect}
            onSelectWard={handleMapWardSelect}
            focusWardNumber={focusWardNumber}
            focusRequestId={focusRequestId}
            onMapReady={() => setMapLoaded(true)}
            totalReportCount={visibleReports.length}
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
        </div>
        <div className="topbar-actions">
          <button
            className="lang-toggle-button"
            type="button"
            onClick={() => setLang(lang === "en" ? "or" : "en")}
            aria-label={lang === "en" ? t("aria.switchToOdia") : t("aria.switchToEnglish")}
            title={t("action.language")}
          >
            {lang === "en" ? "ଓଡ଼ିଆ" : "EN"}
          </button>
          <span className="sr-only" role="status">
            {lang === "en" ? t("aria.langChangedEnglish") : t("aria.langChangedOdia")}
          </span>
          <button
            className="my-reports-entry"
            type="button"
            onClick={() => setShowMyReports(true)}
            aria-label={t("nav.myReports")}
            title={t("nav.myReports")}
          >
            <Bookmark size={16} />
            <span>{t("nav.myReports")}</span>
          </button>
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
        <div className="quick-filter-group" aria-label="Quick filters">
          <label className="quick-select">
            <span className="sr-only">{t("filters.severity")}</span>
            <select
              name="severityFilter"
              value={severityFilter}
              onChange={(event) => setSeverityFilter(event.target.value as "all" | SeverityKey)}
              aria-label={t("filters.bySeverity")}
            >
              <option value="all">{t("severity.all")}</option>
              <option value="small">{t("severity.low")}</option>
              <option value="medium">{t("severity.medium")}</option>
              <option value="large">{t("severity.high")}</option>
              <option value="massive">{t("severity.critical")}</option>
            </select>
            <ChevronDown size={15} aria-hidden="true" />
          </label>
          <label className="quick-select">
            <span className="sr-only">{t("filters.status")}</span>
            <select
              name="statusFilter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "all" | "unresolved" | "resolved")}
              aria-label={t("filters.byStatus")}
            >
              <option value="all">{t("status.all")}</option>
              <option value="unresolved">{t("status.unresolved")}</option>
              <option value="resolved">{t("status.resolved")}</option>
            </select>
            <ChevronDown size={15} aria-hidden="true" />
          </label>
        </div>
        <div className="control-actions">
          <div className="map-mode-toggle">
            <SegmentedButton active={viewMode === "map"} onClick={() => setViewMode("map")} icon={<MapIcon size={14} />} label={t("nav.map")} />
            <SegmentedButton active={viewMode === "list"} onClick={() => setViewMode("list")} icon={<List size={14} />} label={t("nav.list")} />
          </div>
          <button
            className={clsx("filter-button", activeFilterCount > 0 && "is-active", filterPulse && "is-pulsing")}
            onClick={() => setShowFilters(true)}
            type="button"
            aria-label={t("aria.openFilters")}
          >
            <SlidersHorizontal size={14} />
            {t("nav.filters")}
            {activeFilterCount > 0 && <span>{activeFilterCount}</span>}
          </button>
          {wardFilterNumber != null ? (
            <span className="chip-button is-active near-me-active-chip">
              <Layers size={14} />
              Ward {wardFilterNumber}
              <button
                type="button"
                className="near-me-clear"
                aria-label={t("aria.clearWard", { ward: wardFilterNumber })}
                onClick={(event) => {
                  event.stopPropagation();
                  setWardFilterNumber(null);
                  setWardFilterState("idle");
                }}
              >
                <X size={11} />
              </button>
            </span>
          ) : (
            <button
              className={clsx("chip-button", wardFilterState === "locating" && "is-active")}
              onClick={detectAndFilterMyWard}
              type="button"
              aria-label={t("aria.nearMe")}
            >
              {wardFilterState === "locating" ? <LoaderCircle className="spin" size={14} /> : <Layers size={14} />}
              {t("nav.nearMe")}
            </button>
          )}
        </div>
      </section>

      {(isOffline || wardFilterState === "error" || refreshError) && (
        <div className="control-alert-stack" aria-label="Map alerts">
          {isOffline && (
            <div className="notice amber offline-status" role="status">
              <CircleAlert size={16} />
              <span>
                <strong>{t("offline.notice")}</strong>
                Cached reports are still available, but submitting may fail.
              </span>
            </div>
          )}
          {wardFilterState === "error" && (
            <div className="notice amber" role="alert">
              <CircleAlert size={16} />
              <span>
                <strong>{t("error.locationNotFound")}</strong>
                Choose filters manually or try again when GPS is available.
              </span>
            </div>
          )}
          {refreshError && (
            <div className="notice amber control-error-action" role="alert">
              <CircleAlert size={16} />
              <span>
                <strong>{t("error.refreshFailed")}</strong>
                {refreshError}
              </span>
              <button type="button" onClick={() => void refreshReports()}>
                {t("action.retry")}
              </button>
            </div>
          )}
        </div>
      )}

      {viewMode === "map" && freshnessNote}

      {showFilters && (
        <FilterSheet
          activeFilterCount={activeFilterCount}
          activeFilterSummary={activeFilterSummary}
          clearFilters={clearFilters}
          detectAndFilterMyWard={detectAndFilterMyWard}
          onApply={applyFilters}
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
          wardFilterNumber={wardFilterNumber}
          wardFilterState={wardFilterState}
        />
      )}

      {showMapEmptyState && (
        <div className="map-empty-state" role="status">
          <Search size={18} />
          <strong>{mapEmptyTitle}</strong>
          <span>{mapEmptyDescription}</span>
          <div className="map-empty-actions">
            {mapEmptyHasListResults ? (
              <button type="button" onClick={() => setViewMode("list")}>
                Open list
              </button>
            ) : (
              <button type="button" onClick={hasActiveFilters ? clearFilters : () => setShowReportForm(true)}>
                {hasActiveFilters ? "Clear filters" : "Report garbage"}
              </button>
            )}
            {mapEmptyHasListResults && (
              <button className="secondary-map-action" type="button" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
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
                placeholder={t("nav.searchPlaceholder")}
                aria-label={t("aria.searchReports")}
              />
            </label>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as "newest" | "upvotes" | "oldest")}
              aria-label={t("aria.sortReports")}
            >
              <option value="newest">{t("list.sortNewest")}</option>
              <option value="upvotes">{t("list.sortUpvoted")}</option>
              <option value="oldest">{t("list.sortOldest")}</option>
            </select>
            <div className="list-stats-row" aria-label="Report statistics">
              <span className="list-stat list-stat-red">
                <strong>{unresolved.length}</strong> {t("stats.active").toLowerCase()}
              </span>
              <span className="list-stat list-stat-green">
                <strong>{resolved.length}</strong> {t("stats.cleaned").toLowerCase()}
              </span>
            </div>
          </div>
          {freshnessNote}
          <ReportList
            reports={visibleReports}
            resetKey={`main:${sortBy}`}
            totalReports={reports.length}
            wards={data.wards}
            representatives={data.representatives}
            hasActiveFilters={hasActiveFilters}
            refreshing={refreshing}
            onClearFilters={clearFilters}
            onSelect={handleMapReportSelect}
          />
        </div>
      )}

      {viewMode === "list" && (
        <section className="stats-strip" aria-label="Amma Odisha report statistics">
          <Stat label={t("stats.active")} value={unresolved.length} tone="red" />
          <Stat label={t("stats.cleaned")} value={resolved.length} tone="green" />
          <Stat label={t("stats.total")} value={reports.length} tone="gray" />
        </section>
      )}

      <footer className="bottom-action-bar safe-bottom">
        <button
          className="report-cta-button"
          type="button"
          onClick={() => setShowReportForm(true)}
          aria-label={t("aria.reportCta")}
        >
          <Camera size={17} />
          {t("action.reportGarbage")}
        </button>
        <button
          className="scan-qr-cta-button"
          type="button"
          onClick={() => setShowMobileQR(true)}
          aria-label={t("aria.scanQr")}
        >
          <Smartphone size={17} />
          {t("aria.scanQr")}
        </button>
        <button className="insights-button" type="button" onClick={() => setShowInsights(true)} aria-label="Open Amma Odisha insights">
          <BarChart3 size={18} />
          <span>
            <strong>{visibleReports.length}</strong>
            <small>{t("nav.insights")}</small>
          </span>
        </button>
      </footer>

      {showReportCoach && !showIntro && mapLoaded && !showReportForm && !selectedReport && !selectedProfile && !showInsights && !showMobileQR && (
        <div className="report-coach-mark" role="status">
          <span>Ready to report?</span>
          <strong>Use the bottom button to add a garbage spot with photo proof.</strong>
          <button type="button" onClick={dismissReportCoach} aria-label="Dismiss report tip">
            <X size={12} />
          </button>
        </div>
      )}

      {showIntro && !routeSelection && (viewMode !== "map" || mapLoaded) && (
        <IntroOverlay
          onClose={dismissIntro}
          onStartReport={() => {
            dismissIntro();
            setShowReportForm(true);
          }}
          wardCount={introStats.wardCount}
          mlaCount={introStats.mlaCount}
          mpCount={introStats.mpCount}
        />
      )}
      {showAbout && <AboutSheet onClose={() => setShowAbout(false)} onOpenChangelog={() => { setShowAbout(false); setShowChangelog(true); }} />}
      {showChangelog && <ChangelogSheet onClose={() => setShowChangelog(false)} />}
      {showInsights && (
        <InsightsSheet
          reports={reports}
          visibleReports={visibleReports}
          filteredWardNumber={filteredWard?.ward_number ?? null}
          hasActiveFilters={hasActiveFilters}
          unresolvedCount={unresolved.length}
          resolvedCount={resolved.length}
          worstWards={worstWards}
          onClose={() => setShowInsights(false)}
          onOpenReport={(report) => {
            setShowInsights(false);
            handleMapReportSelect(report);
          }}
          onOpenWard={(wardNumber) => {
            setShowInsights(false);
            focusWardOnMap(wardNumber);
            setSelectedProfile({ type: "ward", id: String(wardNumber) });
            navigate(`/ward/${wardNumber}`);
          }}
        />
      )}
      {showMobileQR && <MobileQRModal url={`${window.location.origin}/?action=report`} onClose={() => setShowMobileQR(false)} />}
      {!showIntro && !showReportForm && !selectedReport && !selectedProfile && !showInsights && !showMobileQR && !showAbout && !showChangelog && !showFilters && !showMyReports && (
        <TelegramToast trigger={hasInteracted} />
      )}
      {showReportForm && (
        <ReportForm
          data={data}
          reports={reports}
          onClose={() => setShowReportForm(false)}
          onSubmit={onSubmitted}
          onViewReport={(report) => {
            setShowReportForm(false);
            handleMapReportSelect(report);
          }}
        />
      )}
      {showMyReports && (
        <MyReportsSheet
          reports={reports}
          reportsUnavailable={Boolean(refreshError)}
          onRetry={() => void refreshReports()}
          navigate={navigate}
          onClose={() => setShowMyReports(false)}
          onSelectReport={(report) => {
            setShowMyReports(false);
            handleMapReportSelect(report);
          }}
        />
      )}
      {selectedReport ? (
        <ReportDetail
          report={selectedReport}
          data={data}
          backLabel={returnProfile ? `Back to ${getRouteSelectionLabel(returnProfile)}` : "Back to map"}
          onBack={
            returnProfile
              ? () => {
                  const profile = returnProfile;
                  setReturnProfile(null);
                  setSelectedReport(null);
                  setSelectedProfile(profile);
                  navigate(getRouteSelectionPath(profile), { returnProfile: null });
                }
              : undefined
          }
          onClose={() => {
            setReturnProfile(null);
            setReturnReport(null);
            setSelectedReport(null);
            navigate("/");
          }}
          onUpdate={updateReport}
          onInteract={() => setHasInteracted(true)}
          openProfile={(profile) => {
            setReturnReport(selectedReport);
            setReturnProfile(null);
            setSelectedReport(null);
            setSelectedProfile(profile);
            navigate(getRouteSelectionPath(profile), { returnReportId: selectedReport.id });
          }}
        />
      ) : routeSelection?.type === "report" ? (
        routeReportLoading ? (
          <DialogSurface ariaLabel="Loading report" className="mini-card" onClose={() => navigate("/")}>
            <button className="close-button" onClick={() => navigate("/")} aria-label="Close report detail">
              <X size={18} />
            </button>
            <h2>Loading report…</h2>
            <div className="loading-progress" aria-hidden="true" />
          </DialogSurface>
        ) : (
          <DialogSurface ariaLabel="Report unavailable" className="mini-card" onClose={() => navigate("/")}>
            <button className="close-button" onClick={() => navigate("/")} aria-label="Close report detail">
              <X size={18} />
            </button>
            <h2>Report unavailable</h2>
            <p>This report may have been removed or the link may be outdated.</p>
            <div className="preview-actions">
              <button className="primary-cta" type="button" onClick={() => navigate("/")}>
                Back to map
              </button>
            </div>
          </DialogSurface>
        )
      ) : null}
      {selectedProfile && (
        <ProfileSheet
          selection={selectedProfile}
          data={{ ...data, reports }}
          returnReport={returnReport}
          onBackToReport={
            returnReport
              ? () => {
                  const report = returnReport;
                  setReturnReport(null);
                  setSelectedProfile(null);
                  setSelectedReport(report);
                  navigate(`/report/${report.id}`, { returnProfile: selectedProfile as ProfileSelection });
                }
              : undefined
          }
          onClose={() => {
            setReturnProfile(null);
            setReturnReport(null);
            setSelectedProfile(null);
            navigate("/");
          }}
          onSelectReport={(report) => {
            setReturnProfile(selectedProfile as ProfileSelection);
            setReturnReport(null);
            setSelectedProfile(null);
            setSelectedReport(report);
            navigate(`/report/${report.id}`, { returnProfile: selectedProfile as ProfileSelection });
          }}
        />
      )}
    </div>
  );
}

function SegmentedButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={clsx("segmented-button", active && "is-active")} onClick={onClick} type="button" aria-pressed={active}>
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
  detectAndFilterMyWard,
  onApply,
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
  visibleCount,
  wardFilterNumber,
  wardFilterState
}: {
  activeFilterCount: number;
  activeFilterSummary: string[];
  clearFilters: () => void;
  detectAndFilterMyWard: () => void;
  onApply: () => void;
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
  wardFilterNumber: number | null;
  wardFilterState: "idle" | "locating" | "error";
}) {
  const severityOptions: { key: "all" | SeverityKey; label: string }[] = [
    { key: "all", label: t("severity.all") },
    { key: "small", label: `${t("severity.low")} (<1m²)` },
    { key: "medium", label: `${t("severity.medium")} (1-5m²)` },
    { key: "large", label: `${t("severity.high")} (5-20m²)` },
    { key: "massive", label: `${t("severity.critical")} (20m²+)` }
  ];

  return (
    <DialogSurface ariaLabel={t("filters.dialogLabel")} className="filter-sheet" onClose={onClose}>
      <button className="close-button" onClick={onClose} aria-label="Close filters">
        <X size={18} />
      </button>
      <div className="sheet-title-row">
        <div>
          <p className="eyebrow">{t("filters.title")}</p>
          <h2>Find reports faster</h2>
        </div>
        <SlidersHorizontal size={20} />
      </div>
      <div className="filter-location-row">
        <button
          type="button"
          className="detect-ward-action"
          onClick={() => {
            onClose();
            detectAndFilterMyWard();
          }}
          disabled={wardFilterState === "locating"}
        >
          {wardFilterState === "locating" ? <LoaderCircle className="spin" size={17} /> : <Layers size={17} />}
          {wardFilterNumber != null ? `Showing Ward ${wardFilterNumber} - tap to change` : "Use my current location"}
        </button>
      </div>
      <label className="filter-field">
        <span>{t("filters.search")}</span>
        <div className="filter-search">
          <Search size={15} />
          <input
            data-autofocus="true"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t("filters.searchPlaceholder")}
            aria-label={t("aria.searchReports")}
          />
        </div>
      </label>
      <div className="filter-grid">
        <label className="filter-field">
          <span>{t("filters.severity")}</span>
          <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as "all" | SeverityKey)} aria-label={t("filters.bySeverity")}>
            {severityOptions.map((option) => (
              <option value={option.key} key={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span>{t("filters.status")}</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | "unresolved" | "resolved")} aria-label={t("filters.byStatus")}>
            <option value="all">{t("status.all")}</option>
            <option value="unresolved">{t("filter.statusActive")}</option>
            <option value="resolved">{t("filter.statusCleaned")}</option>
          </select>
        </label>
        <label className="filter-field">
          <span>Sort</span>
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value as "newest" | "upvotes" | "oldest")} aria-label={t("aria.sortReports")}>
            <option value="newest">{t("list.sortNewest")}</option>
            <option value="upvotes">{t("list.sortUpvoted")}</option>
            <option value="oldest">{t("list.sortOldest")}</option>
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
          {t("filters.clear")}
        </button>
        <button type="button" className="secondary-cta" onClick={() => void onRefresh()} disabled={refreshing}>
          {refreshing ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
          Refresh
        </button>
        <button type="button" className="primary-cta" onClick={onApply}>
          {t("filters.apply")}
        </button>
      </div>
    </DialogSurface>
  );
}

function InsightsSheet({
  reports,
  visibleReports,
  filteredWardNumber,
  hasActiveFilters,
  unresolvedCount,
  resolvedCount,
  worstWards,
  onClose,
  onOpenReport,
  onOpenWard
}: {
  reports: GarbageReport[];
  visibleReports: GarbageReport[];
  filteredWardNumber: number | null;
  hasActiveFilters: boolean;
  unresolvedCount: number;
  resolvedCount: number;
  worstWards: ReturnType<typeof getWorstWards>;
  onClose: () => void;
  onOpenReport: (report: GarbageReport) => void;
  onOpenWard: (wardNumber: number) => void;
}) {
  const activeShare = Math.round((unresolvedCount / Math.max(1, reports.length)) * 100);
  const priorityQueue = useMemo(() => {
    return visibleReports
      .filter((report) => report.status !== "resolved")
      .sort((a, b) => {
        const severityDelta = SEVERITY_PRIORITY[b.severity] - SEVERITY_PRIORITY[a.severity];
        if (severityDelta !== 0) return severityDelta;
        const upvoteDelta = (b.upvote_count ?? 0) - (a.upvote_count ?? 0);
        if (upvoteDelta !== 0) return upvoteDelta;
        return daysActive(b.created_at) - daysActive(a.created_at);
      });
  }, [visibleReports]);
  const priorityReports = priorityQueue.slice(0, 4);
  const scopeSuffix = hasActiveFilters ? " in current view" : "";

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
            <h2>{t("insights.title")}</h2>
          </div>
          <Trophy size={20} />
        </div>
        <p className="muted">
          Showing {visibleReports.length} reports{filteredWardNumber ? ` in Ward ${filteredWardNumber}` : ""}. Every report is mapped to a ward and linked to civic accountability.
        </p>

        <div className="metric-grid insights-metrics">
          <Metric label="Active" value={unresolvedCount} />
          <Metric label="Resolved" value={resolvedCount} />
          <Metric label="Still Open" value={`${activeShare}%`} />
        </div>

        <div className="accountability-card">
          <h3>How pressure builds</h3>
          <p>Citizens report a spot, others upvote it, and the issue stays visible with ward, MLA, and MP context until it is cleaned.</p>
        </div>

        <div className="priority-queue">
          <div className="sheet-title-row compact">
            <h3>Priority Queue{scopeSuffix}</h3>
            <span className="pill red">{priorityQueue.length} active</span>
          </div>
          {priorityReports.length ? (
            priorityReports.map((report) => {
              const severity = SEVERITY[report.severity] ?? SEVERITY.medium;
              return (
                <button
                  className="priority-report-row"
                  key={report.id}
                  type="button"
                  onClick={() => onOpenReport(report)}
                  aria-label={`Open priority report in Ward ${report.ward_number}`}
                >
                  <span className="priority-report-severity" style={{ color: severity.color }}>
                    <SeverityMark severityKey={report.severity} />
                  </span>
                  <span className="priority-report-main">
                    <strong>{report.address}</strong>
                    <small>
                      Ward {report.ward_number} - {severityLabel(report.severity)} - {daysActive(report.created_at)} days open
                    </small>
                  </span>
                  <span className="priority-report-score">
                    <strong>{report.upvote_count ?? 0}</strong>
                    <small>upvotes</small>
                  </span>
                </button>
              );
            })
          ) : (
            <p className="empty">No active reports match this view.</p>
          )}
        </div>

        <div className="leaderboard">
          <div className="sheet-title-row compact">
            <h3>Worst Wards by Active Reports{scopeSuffix}</h3>
            <span className="pill red">{worstWards.length} wards</span>
          </div>
          {worstWards.length ? (
            worstWards.slice(0, 6).map((item, index) => {
              const wardName = getDistinctWardName(item.ward);
              return (
                <button
                  className="ward-bar-row"
                  key={item.ward.ward_number}
                  onClick={() => onOpenWard(item.ward.ward_number)}
                >
                  <span className="ward-bar-rank">{index + 1}</span>
                  <span className="ward-bar-info">
                    <strong>Ward {item.ward.ward_number}</strong>
                    <small>{wardName || "Bhubaneswar"}</small>
                  </span>
                  <span className="ward-bar-track">
                    <span
                      className="ward-bar-fill"
                      style={{
                        width: `${Math.round((item.count / Math.max(1, worstWards[0].count)) * 100)}%`
                      }}
                      aria-label={`${item.count} active reports`}
                    />
                    <b>{item.count}</b>
                  </span>
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

function IntroOverlay({ mlaCount, mpCount, onClose, onStartReport, wardCount }: { mlaCount: number; mpCount: number; onClose: () => void; onStartReport: () => void; wardCount: number }) {
  const statsLabel = [
    wardCount > 0 ? `${wardCount} wards` : "",
    mlaCount > 0 ? `${mlaCount} MLA${mlaCount === 1 ? "" : "s"}` : "",
    mpCount > 0 ? `${mpCount} MP${mpCount === 1 ? "" : "s"}` : "",
    "All of Bhubaneswar"
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <DialogSurface layerClassName="intro-nudge" className="intro-card" ariaLabel="Amma Odisha intro" onClose={onClose}>
      <button className="toast-close" onClick={onClose} aria-label="Dismiss intro">
        <X size={12} />
      </button>
      <IntroHeroImage />
      <div className="intro-card-body">
        <img src="/logo.png" alt="" />
        <p className="eyebrow">Bhubaneswar (BMC)</p>
        <h2>{t("appTagline")}</h2>
        <p>Every garbage dump is mapped, photographed, and linked to the responsible ward, MLA, and MP.</p>
        <p className="intro-action-copy">Tap a red dot on the map to see a report, or start a new one.</p>
        <b>{statsLabel}</b>
        <button className="primary-cta intro-report-cta" onClick={onStartReport} aria-label="Report a garbage dump near you">
          <Plus size={16} />
          Report garbage near me
        </button>
        <button className="intro-explore-link" onClick={onClose} type="button">
          Start using map
        </button>
      </div>
    </DialogSurface>
  );
}

function IntroHeroImage() {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="intro-hero-fallback" role="img" aria-label="Amma Odisha">
        <img src="/logo.png" alt="" />
      </div>
    );
  }

  return <img className="intro-hero-image" src="/garbage-hero.jpg" alt="Garbage on streets of Bhubaneswar" onError={() => setFailed(true)} />;
}

function ReportList({
  emptyDescription,
  emptyTitle,
  hasActiveFilters = false,
  initialLimit = 60,
  onClearFilters,
  refreshing = false,
  reports,
  resetKey = "",
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
  refreshing?: boolean;
  reports: GarbageReport[];
  resetKey?: string;
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
  }, [initialLimit, resetKey]);

  return (
    <div className="report-list" aria-busy={refreshing}>
      <div className="report-list-header">
        <div>
          <p className="eyebrow">Live Reports</p>
          <h2>{reports.length} visible issues</h2>
        </div>
        <span className="pill red">Public</span>
      </div>
      {refreshing ? (
        <ReportListSkeleton count={6} />
      ) : reports.length ? (
        <>
          {visibleItems.map((report) => {
            const ward = wardsByNumber.get(report.ward_number);
            const mla = ward ? mlaByConstituency.get(ward.assembly_constituency) : undefined;
            return <ReportListItem key={report.id} report={report} ward={ward} mla={mla} onSelect={onSelect} />;
          })}
          {hasMore && (
            <button className="load-more-button" type="button" onClick={() => setVisibleCount((count) => count + initialLimit)}>
              {t("action.loadMore")}
            </button>
          )}
        </>
      ) : (
        <div className="empty-state">
          <p className="empty-title">
            {hasActiveFilters ? t("list.empty") : emptyTitle ?? t("myReports.empty")}
          </p>
          <p className="empty">
            {hasActiveFilters
              ? `Try a different search, status, or ward filter. There are ${totalReports} total reports available.`
              : emptyDescription ?? t("list.emptyArea")}
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

function ReportListSkeleton({ count }: { count: number }) {
  return (
    <div className="report-list-skeleton" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="report-skeleton-card" key={index}>
          <span className="skeleton-photo" />
          <span className="skeleton-lines">
            <span />
            <span />
            <span />
          </span>
        </div>
      ))}
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
  const wardName = getDistinctWardName(ward);
  const upvoteCount = report.upvote_count ?? 0;
  const severityText = severityLabel(report.severity);
  const statusText = t(report.status === "resolved" ? "status.resolvedShort" : "status.unresolvedShort");
  const tagLabel = `${severityText}, ${statusText}${mla ? `, MLA: ${mla.name}` : ""}`;
  const days = daysOpen(report);
  const escLevel = escalationLevel(days);
  const escalationText = escLevel >= 3 ? t("escalation.dotAria", { label: t(`escalation.level${escLevel}`), days }) : "";
  return (
    <button
      className="report-item"
      onClick={() => onSelect(report)}
      onFocus={() => preloadImage(report.photo_url)}
      onPointerEnter={() => preloadImage(report.photo_url)}
      aria-label={`${wardName || report.address} — ${severityText} garbage, ${statusText}, ${upvoteCount} ${upvoteCount === 1 ? "upvote" : "upvotes"}${escalationText ? `, ${escalationText}` : ""}`}
    >
      <ReportPhoto
        src={report.photo_url}
        thumbSrc={report.photo_thumb_url}
        alt=""
        variant="thumb"
        loading="lazy"
        width={report.photo_width}
        height={report.photo_height}
      />
      <span className="report-item-badge" aria-label={`${upvoteCount} ${upvoteCount === 1 ? "upvote" : "upvotes"}`}>
        <strong>{upvoteCount}</strong>
        <small>{upvoteCount === 1 ? "upvote" : "upvotes"}</small>
      </span>
      <span className="report-item-body">
        <strong>{wardName || report.address}</strong>
        <small>
          {report.address}{wardName ? ` · Ward #${report.ward_number}` : ""} · {timeAgoI18n(report.created_at, t)}
        </small>
      </span>
      <span className="report-item-tags" aria-label={tagLabel}>
        {escLevel >= 3 && (
          <span className={clsx("aging-dot", escLevel >= 5 && "is-critical")} title={`${t(`escalation.level${escLevel}`)} - ${t("detail.daysOpen", { count: days })}`}>
            <span className="sr-only">{escalationText}</span>
          </span>
        )}
        <em className={`severity-chip severity-${report.severity}`}>
          <SeverityMark severityKey={report.severity} />
          {severityText}
        </em>
        <span className={clsx("status-chip", report.status === "resolved" ? "is-resolved" : "is-open")}>
          {statusText}
        </span>
      </span>
      <ChevronDown size={14} className="sideways" aria-hidden="true" />
    </button>
  );
}

const preloadedImageUrls = new Set<string>();

function preloadImage(src?: string | null) {
  if (!src || preloadedImageUrls.has(src)) return;
  preloadedImageUrls.add(src);
  const image = new Image();
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  image.src = src;
}

function ReportPhoto({
  alt,
  height,
  loading,
  src,
  thumbSrc,
  variant,
  width
}: {
  alt: string;
  height?: number | null;
  loading?: "eager" | "lazy";
  src?: string | null;
  thumbSrc?: string | null;
  variant: "detail" | "thumb";
  width?: number | null;
}) {
  const preferredSrc = variant === "thumb" ? thumbSrc || src : src;
  const [fallbackFailed, setFallbackFailed] = useState(false);
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
    setFallbackFailed(false);
  }, [preferredSrc, src]);

  const fallbackSrc = fallbackFailed ? LOCAL_REPORT_PHOTO_FALLBACK_URL : ODISHA_GARBAGE_FALLBACK_IMAGE.photo_url;
  const candidates = useMemo(() => {
    const next: string[] = [];
    if (preferredSrc) next.push(preferredSrc);
    if (src && src !== preferredSrc) next.push(src);
    next.push(fallbackSrc);
    return next;
  }, [fallbackSrc, preferredSrc, src]);
  const safeCandidateIndex = Math.min(candidateIndex, candidates.length - 1);
  const imageSrc = candidates[safeCandidateIndex] ?? LOCAL_REPORT_PHOTO_FALLBACK_URL;
  const usingRemoteFallback = imageSrc === ODISHA_GARBAGE_FALLBACK_IMAGE.photo_url;
  const imageWidth = usingRemoteFallback ? ODISHA_GARBAGE_FALLBACK_IMAGE.width : width;
  const imageHeight = usingRemoteFallback ? ODISHA_GARBAGE_FALLBACK_IMAGE.height : height;

  return (
    <img
      className={variant === "detail" ? "detail-photo" : "report-thumb"}
      src={imageSrc}
      alt={alt}
      loading={loading ?? (variant === "thumb" ? "lazy" : "eager")}
      decoding="async"
      referrerPolicy="no-referrer"
      sizes={variant === "thumb" ? "54px" : "(max-width: 640px) 100vw, 420px"}
      width={imageWidth ?? undefined}
      height={imageHeight ?? undefined}
      onError={() => {
        if (safeCandidateIndex < candidates.length - 1) {
          setCandidateIndex((index) => Math.min(index + 1, candidates.length - 1));
          return;
        }
        if (!fallbackFailed) {
          setFallbackFailed(true);
        }
      }}
    />
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
  backLabel = "Back to map",
  report,
  data,
  onBack,
  onClose,
  onInteract,
  onUpdate,
  openProfile
}: {
  backLabel?: string;
  report: GarbageReport;
  data: CivicData;
  onBack?: () => void;
  onClose: () => void;
  onInteract?: () => void;
  onUpdate: (report: GarbageReport) => void;
  openProfile: (selection: ProfileSelection) => void;
}) {
  const [isUpvoting, setIsUpvoting] = useState(false);
  const [upvoted, setUpvoted] = useState(() => hasUpvoted(report.id));
  const [upvoteBump, setUpvoteBump] = useState(false);
  const [alreadyVotedNote, setAlreadyVotedNote] = useState(false);
  const [upvoteFailedNote, setUpvoteFailedNote] = useState(false);
  const [showResolve, setShowResolve] = useState(false);
  const [shareNote, setShareNote] = useState<"idle" | "copied" | "error">("idle");
  const [compareValue, setCompareValue] = useState(50);
  const [externalPreview, setExternalPreview] = useState<ExternalPreviewConfig | null>(null);
  const compareRef = useRef<HTMLElement | null>(null);
  const alreadyVotedTimerRef = useRef<number | null>(null);
  const upvoteFailedTimerRef = useRef<number | null>(null);
  const shareNoteTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setUpvoted(hasUpvoted(report.id));
    setIsUpvoting(false);
    setUpvoteBump(false);
    setAlreadyVotedNote(false);
    setUpvoteFailedNote(false);
    setShowResolve(false);
    setShareNote("idle");
    setCompareValue(50);
    setExternalPreview(null);
  }, [report.id]);

  useEffect(() => {
    return () => {
      if (alreadyVotedTimerRef.current != null) window.clearTimeout(alreadyVotedTimerRef.current);
      if (upvoteFailedTimerRef.current != null) window.clearTimeout(upvoteFailedTimerRef.current);
      if (shareNoteTimerRef.current != null) window.clearTimeout(shareNoteTimerRef.current);
    };
  }, []);

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
  const days = daysOpen(report);
  const escLevel = escalationLevel(days);

  const upvote = async () => {
    if (isUpvoting || upvoted) return;
    setIsUpvoting(true);
    try {
      const result = await backend.upvoteReport(report.id);
      setUpvoted(true);
      if (!result.alreadyVoted && result.newCount != null) {
        setUpvoteBump(true);
        navigator.vibrate?.(20);
        onInteract?.();
        onUpdate({ ...report, upvote_count: result.newCount });
      } else if (result.alreadyVoted) {
        setAlreadyVotedNote(true);
        if (alreadyVotedTimerRef.current != null) window.clearTimeout(alreadyVotedTimerRef.current);
        alreadyVotedTimerRef.current = window.setTimeout(() => setAlreadyVotedNote(false), 3500);
      }
    } catch (error) {
      console.error("Upvote failed", error);
      setUpvoteFailedNote(true);
      if (upvoteFailedTimerRef.current != null) window.clearTimeout(upvoteFailedTimerRef.current);
      upvoteFailedTimerRef.current = window.setTimeout(() => setUpvoteFailedNote(false), 3500);
    } finally {
      setIsUpvoting(false);
    }
  };

  const shareReport = async () => {
    const url = `${location.origin}/report/${report.id}`;
    const text = getReportShareText(report, ward, mla);
    try {
      const result = await shareOrCopy({ title: `Garbage Report — ${ward?.ward_name ?? "Bhubaneswar"}`, text, url }, url);
      if (result === "copied") {
        setShareNote("copied");
        if (shareNoteTimerRef.current != null) window.clearTimeout(shareNoteTimerRef.current);
        shareNoteTimerRef.current = window.setTimeout(() => setShareNote("idle"), 2000);
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      console.error("Share failed", caught);
      setShareNote("error");
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
      action: { kind: "whatsapp", value: text },
      confirmLabel: "Open WhatsApp",
      details: text,
      helper: "This opens WhatsApp with a ready-to-send message. You can review or edit it before sending.",
      title: "Send complaint on WhatsApp"
    });
  };

  const prepareDirections = () => {
    setExternalPreview({
      action: { kind: "maps", value: `${report.latitude},${report.longitude}` },
      confirmLabel: "Open Maps",
      details: `${report.address}\nWard ${report.ward_number}\n${report.latitude}, ${report.longitude}`,
      helper: "This opens Google Maps in a new tab so you can navigate to the reported spot.",
      title: "Open directions"
    });
  };

  const prepareCall = (label: string, value: string) => {
    setExternalPreview({
      action: { kind: "tel", value },
      confirmLabel: "Call now",
      details: value,
      helper: `This will start a phone call to ${label}.`,
      title: `Call ${label}`
    });
  };

  const confirmExternalAction = () => {
    if (!externalPreview) return;
    if (externalPreview.action.kind === "whatsapp") {
      window.open(getWhatsAppUrl(externalPreview.action.value), "_blank", "noopener,noreferrer");
    } else if (externalPreview.action.kind === "maps") {
      window.open(`https://www.google.com/maps?q=${externalPreview.action.value}`, "_blank", "noopener,noreferrer");
    } else {
      window.location.href = `tel:${externalPreview.action.value}`;
    }
    setExternalPreview(null);
  };

  return (
    <DialogSurface
      ariaLabel="Report details"
      className="detail-sheet"
      onClose={onClose}
      disableEscape={showResolve || Boolean(externalPreview)}
    >
        {/* ── Mobile drag pill ── */}
        <div className="detail-drag-pill" aria-hidden="true" />

        {/* ── Header: severity + status chips | share + close ── */}
        <div className="detail-header">
          <div className="detail-header-left">
            {onBack && (
              <button className="detail-back-btn" type="button" onClick={onBack} aria-label={backLabel}>
                <ChevronLeft size={16} />
              </button>
            )}
            <div className="detail-header-chips">
              <span className="pill" style={{ background: `${severity.color}15`, color: SEVERITY_TEXT_COLORS[report.severity] }}>
                <SeverityMark severityKey={report.severity} />
                {severityLabel(report.severity)}
              </span>
              <span className={clsx("pill", report.status === "resolved" ? "green" : "red")}>
                {t(report.status === "resolved" ? "status.resolved" : "status.unresolved")}
              </span>
              {escLevel >= 1 && (
                <span
                  className={clsx("pill", escLevel >= 5 ? "red" : escLevel >= 3 ? "orange" : "amber")}
                  title={t("detail.daysOpen", { count: days })}
                >
                  <span aria-hidden="true" className="escalation-dot" />
                  {t(`escalation.level${escLevel}`)} - {t("detail.daysOpen", { count: days })}
                </span>
              )}
            </div>
          </div>
          <div className="detail-header-actions">
            <button
              className="detail-icon-btn whatsapp-share-btn"
              onClick={() => shareReportViaWhatsApp(report, `${window.location.origin}/report/${report.id}`)}
              aria-label={t("action.shareWhatsApp")}
              title={t("action.shareWhatsApp")}
            >
              <MessageCircle size={17} />
            </button>
            <button className="detail-icon-btn" onClick={() => void shareReport()} aria-label={t("aria.shareReport")}>
              <Share2 size={17} />
            </button>
            <button className="detail-icon-btn" onClick={onClose} aria-label="Close report detail">
              <X size={17} />
            </button>
          </div>
        </div>

        {/* ── Title + location ── */}
        <div className="detail-title-area">
          <h2>{ward?.locality_name?.trim() || getDistinctWardName(ward) || ward?.ward_name || `Ward ${report.ward_number}`}</h2>
          <p className="detail-location">
            <MapPin size={13} />
            {report.address}
          </p>
        </div>

        {/* ── Photo with I've-seen-this overlay ── */}
        <div className="detail-photo-wrap">
          <ReportPhoto
            src={report.photo_url}
            alt="Garbage report"
            variant="detail"
            width={report.photo_width}
            height={report.photo_height}
          />
          <button
            className={clsx("detail-upvote-overlay", upvoted && "is-upvoted", upvoteBump && "is-bumped")}
            onClick={() => void upvote()}
            disabled={upvoted || isUpvoting}
            aria-label={t("aria.seenThis")}
          >
            {isUpvoting ? <LoaderCircle className="spin" size={14} /> : <ThumbsUp size={14} />}
            {t("action.confirmSeen")}
          </button>
        </div>

        {/* ── Trust block: verification, absolute dates, cleaner & photo credit ── */}
        <div className="detail-trust-block">
          {report.moderation_status === "approved" && (
            <span className="pill green trust-verified-chip">
              <ShieldCheck size={12} />
              {t("detail.verified")}
            </span>
          )}
          <p className="trust-dates">
            {t("detail.reportedOn", { date: shortDate(report.created_at) })}
            {report.status === "resolved" && report.resolved_at && (
              <> · {t("detail.cleanedOn", { date: shortDate(report.resolved_at) })}</>
            )}
          </p>
          {(report.resolved_by_name || report.photo_credit || report.photo_source_url) && (
            <p className="trust-meta">
              {report.resolved_by_name && <span>{t("detail.cleanedBy", { name: report.resolved_by_name })}</span>}
              {(report.photo_credit || report.photo_source_url) && (
                <small className="trust-photo-credit">
                  {report.photo_credit ? t("detail.photoCredit", { credit: report.photo_credit }) : null}
                  {report.photo_source_url && (
                    <>
                      {report.photo_credit ? " · " : ""}
                      <a href={report.photo_source_url} target="_blank" rel="noreferrer">
                        {report.photo_source_title || report.photo_source_url}
                      </a>
                    </>
                  )}
                </small>
              )}
            </p>
          )}
        </div>

        {/* ── Stats strip ── */}
        <div className="detail-stats-row">
          <div className="detail-stat">
            <strong style={{ color: severity.color }}>{report.upvote_count ?? 0}</strong>
            <span>Reports</span>
          </div>
          <div className="detail-stat-divider" aria-hidden="true" />
          <div className="detail-stat">
            <strong style={{ color: "#f97316" }}>{daysActive(report.created_at)}</strong>
            <span>Days</span>
          </div>
          <div className="detail-stat-divider" aria-hidden="true" />
          <div className="detail-stat detail-stat-text">
            <strong style={{ color: "var(--blue)" }}>{CATEGORIES[report.category]}</strong>
            <span>Waste Type</span>
          </div>
        </div>

        {/* ── Body content ── */}
        <div className="detail-content">
          {alreadyVotedNote && (
            <p className="already-voted-note" role="status">
              You already supported this report from another device.
            </p>
          )}
          {upvoteFailedNote && (
            <p className="already-voted-note" role="alert">
              Your vote could not be recorded. Check your connection and try again.
            </p>
          )}
          {shareNote === "copied" && (
            <p className="already-voted-note" role="status">
              Copied to clipboard.
            </p>
          )}
          {shareNote === "error" && (
            <p className="warning-text" role="alert">
              Sharing failed. Check your connection and try again.
            </p>
          )}
          {report.moderation_status === "flagged" && (
            <div className="notice info pending-review-notice" role="status">
              <ShieldCheck size={16} />
              <span>
                {report.moderation_metadata?.cleanup_pending ? (
                  <><strong>Cleanup proof submitted</strong> Admin is reviewing your cleanup photo. The report will be marked resolved once approved.</>
                ) : (
                  <><strong>Pending review</strong> Visible to you now. It becomes public once the photo is approved.</>
                )}
              </span>
            </div>
          )}

          {canCompareResolvedPhotos && (
            <>
              <button
                className="cleanup-teaser-chip"
                type="button"
                onClick={() => compareRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                <CheckCircle2 size={13} />
                See cleanup photo
                <ChevronDown size={13} />
              </button>
              <section ref={compareRef} className="resolved-compare" aria-label="Before and after cleanup photos">
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
                    aria-valuetext={`${compareValue}% cleaned`}
                    aria-label="Before and after cleanup comparison"
                  />
                </label>
              </section>
            </>
          )}

          <h3>Accountability</h3>
          <div className="rep-grid">
            <RepCard label="MLA" rep={mla} area={ward?.assembly_constituency} onClick={() => mla && openProfile({ type: "mla", id: mla.constituency })} />
            <RepCard label="MP" rep={mp} area={ward?.parliamentary_constituency} onClick={() => mp && openProfile({ type: "mp", id: mp.constituency })} />
          </div>

          <div className="detail-actions">
            <button className="directions-link" onClick={prepareDirections}>
              <ArrowUpRight size={15} />
              {t("action.directions")}
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
                  {t("action.callBmc")}
                </button>
                <button onClick={() => prepareCall("Helpline 1929", BMC_HELPLINE)}>
                  <Phone size={16} />
                  Helpline 1929
                </button>
              </div>
            </div>
            {report.status !== "resolved" && (
              <div className="resolve-action-group">
                <button className="green-action" onClick={() => setShowResolve(true)}>
                  <CheckCircle2 size={16} />
                  Submit Cleanup Proof
                </button>
                <small>You must be at the spot. Take a photo as proof — admin will review before the report is marked cleaned.</small>
              </div>
            )}
          </div>
          <p className="anonymous">
            <ShieldCheck size={13} /> All reports are anonymous
          </p>
        </div>
      {showResolve && <ResolveModal report={report} onClose={() => setShowResolve(false)} onResolved={onUpdate} />}
      {externalPreview && (
        <ExternalAppPreview
          config={externalPreview}
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

function UploadProgressBar({ label, value }: { label: string; value: number | null }) {
  const safeValue = value == null ? 8 : Math.max(0, Math.min(100, Math.round(value)));
  return (
    <span
      className={clsx("upload-progress-bar", value == null && "is-indeterminate")}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value == null ? undefined : safeValue}
    >
      <span style={{ width: `${value == null ? 42 : Math.max(5, safeValue)}%` }} />
    </span>
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

function getPartyColor(party?: string): string {
  if (!party) return "var(--text-faint)";
  return PARTY_COLORS[party.toUpperCase()] ?? "var(--text-faint)";
}

/** Contrast-safe dark variant of the party color for text on light surfaces. */
function getPartyTextColor(party?: string): string {
  const key = party?.toUpperCase() ?? "";
  return PARTY_TEXT_COLORS[key] ?? getPartyColor(party);
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
  const [status, setStatus] = useState<ResolveStatus>("locating");
  const [verifiedPosition, setVerifiedPosition] = useState<{ lat: number; lng: number; distanceMeters: number } | null>(null);
  const [failedDistance, setFailedDistance] = useState<number | null>(null);
  const [geoFailure, setGeoFailure] = useState<"denied" | "timeout" | "unavailable" | null>(null);
  const [saveError, setSaveError] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  // Clean up object URLs to prevent memory leaks
  const previewRef = useRef<string | null>(null);
  const didCheckLocationRef = useRef(false);
  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  const checkProximity = useCallback(() => {
    setSaveError("");
    setVerifiedPosition(null);
    setGeoFailure(null);

    if (!navigator.geolocation) {
      setStatus("mismatch");
      return;
    }

    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const distanceMeters =
          distanceKm({ latitude: lat, longitude: lng }, { latitude: report.latitude, longitude: report.longitude }) * 1000;
        setFailedDistance(distanceMeters);
        if (distanceMeters > 500) {
          setStatus("mismatch");
          return;
        }
        setVerifiedPosition({ lat, lng, distanceMeters });
        setStatus("verified");
      },
      (geoError) => {
        if (geoError.code === geoError.PERMISSION_DENIED) setGeoFailure("denied");
        else if (geoError.code === geoError.TIMEOUT) setGeoFailure("timeout");
        else setGeoFailure("unavailable");
        setStatus("mismatch");
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, [report.latitude, report.longitude]);

  useEffect(() => {
    if (didCheckLocationRef.current) return;
    didCheckLocationRef.current = true;
    checkProximity();
  }, [checkProximity]);
  const saveVerification = async (allowUnverified = false) => {
    setSaveError("");

    if (!verifiedPosition && !allowUnverified) {
      checkProximity();
      return;
    }
    if (!photo) return;

    setStatus("saving");
    setUploadProgress(0);
    try {
      const upload = await backend.uploadReportPhoto(photo, { onProgress: setUploadProgress });
      const delta = await backend.resolveReport(report.id, {
        photoThumbUrl: upload?.thumbUrl ?? null,
        photoUrl: upload?.url ?? null,
        lat: verifiedPosition?.lat ?? report.latitude,
        lng: verifiedPosition?.lng ?? report.longitude
      });
      navigator.vibrate?.(35);
      // Spread the delta over the original full report so the UI keeps address,
      // photo_url, severity, etc. while reflecting the updated cleanup/status fields.
      onResolved({ ...report, ...delta });
      onClose();
    } catch (caught) {
      setUploadProgress(null);
      setSaveError(caught instanceof Error ? caught.message : "Save failed. Please try again.");
      setStatus("error");
    }
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
  const canSave = status === "verified" || status === "error";

  return (
    <DialogSurface layerClassName="nested-modal" className="mini-card" ariaLabel="Mark report as cleaned" onClose={onClose}>
        <button className="sheet-back-button" type="button" onClick={onClose}>
          <ChevronLeft size={16} />
          Back to report
        </button>
        <button className="close-button" onClick={onClose} aria-label="Close resolve modal">
          <X size={18} />
        </button>
        <h2>{t("resolve.title")}</h2>
        <p>First confirm you are near the spot, then add the cleanup photo.</p>
        <div className={clsx("notice resolve-distance-notice", status === "verified" ? "success" : "amber")}>
          {status === "verified" ? <CheckCircle2 size={16} /> : status === "locating" ? <LoaderCircle className="spin" size={16} /> : <CircleAlert size={16} />}
          <span>
            <strong>
              {status === "verified" ? "You are close enough" : status === "locating" ? "Checking your distance" : "Move closer to the reported spot"}
            </strong>
            {status === "verified"
              ? `Distance confirmed at about ${Math.max(1, Math.round(verifiedPosition?.distanceMeters ?? 0))}m.`
              : status === "mismatch" && failedDistance != null
                ? `You appear to be about ${Math.round(failedDistance)}m away. Move closer to the spot (within 500m) and try again.`
                : "You must be within 500m before uploading the cleaned photo."}
          </span>
        </div>
        <label
          className={clsx(
            "photo-drop",
            preview && "has-photo",
            status !== "verified" && status !== "mismatch" && "is-disabled"
          )}
          aria-disabled={status !== "verified" && status !== "mismatch" ? "true" : undefined}
        >
          {preview ? <img src={preview} alt="" /> : <Camera size={28} />}
          <span>{preview ? "Change cleanup photo" : "Add cleanup photo"}</span>
          <small>Take a new photo or choose from your gallery.</small>
          <input
            type="file"
            accept="image/*"
            aria-label="Upload cleanup proof photo"
            disabled={status !== "verified" && status !== "mismatch"}
            onChange={(event) => onFile(event.target.files?.[0])}
          />
        </label>
        {status === "saving" && uploadProgress != null && (
          <div className="upload-progress-panel" role="status">
            <span>
              <strong>Uploading cleanup photo</strong>
              {Math.round(uploadProgress)}%
            </span>
            <UploadProgressBar label="Cleanup photo upload progress" value={uploadProgress} />
          </div>
        )}
        <button className="primary-cta" onClick={() => void saveVerification()} disabled={isBusy || !canSave}>
          {isBusy ? <LoaderCircle className="spin" size={17} /> : <CheckCircle2 size={17} />}
          {status === "verified" && t("resolve.submit")}
          {status === "locating" && "Verifying your location..."}
          {status === "saving" && "Saving verification..."}
          {status === "error" && "Try saving again"}
          {status === "mismatch" && "Move closer first"}
        </button>
        {canRetry && status !== "error" && (
          <button className="secondary-cta" type="button" onClick={checkProximity}>
            {t("resolve.checkAgain")}
          </button>
        )}
        {status === "mismatch" && (
          <div className="resolve-fallback">
            <p>Can't get close enough? Submit your cleanup photo without GPS verification — it will be flagged for manual review.</p>
            <button
              className="secondary-cta"
              type="button"
              disabled={!photo || isBusy}
              onClick={() => void saveVerification(true)}
            >
              {photo ? "Submit with photo only (unverified)" : "Select a cleanup photo above to continue"}
            </button>
          </div>
        )}
        {status === "mismatch" && (
          <p className="warning-text" role="alert">
            {geoFailure === "denied"
              ? t("resolve.denied")
              : geoFailure === "timeout"
                ? t("resolve.timeout")
                : t("resolve.tooFar")}
          </p>
        )}
        {status === "error" && saveError && (
          <p className="warning-text" role="alert">{saveError}</p>
        )}
    </DialogSurface>
  );
}

function ExternalAppPreview({ config, onClose, onConfirm }: { config: ExternalPreviewConfig; onClose: () => void; onConfirm: () => void }) {
  const isWhatsAppPreview = config.action.kind === "whatsapp";

  return (
    <DialogSurface layerClassName="nested-modal" className="mini-card external-preview" ariaLabel={config.title} onClose={onClose}>
      <button className="sheet-back-button" type="button" onClick={onClose}>
        <ChevronLeft size={16} />
        Back to report
      </button>
      <button className="close-button" onClick={onClose} aria-label="Close WhatsApp preview">
        <X size={18} />
      </button>
      <h2>{config.title}</h2>
      <p>{config.helper}</p>
      {isWhatsAppPreview ? (
        <div className="whatsapp-bubble-preview">
          <div className="whatsapp-bubble-header">
            <span className="whatsapp-sender-dot" aria-hidden="true" />
            <span className="whatsapp-sender-name">Amma Odisha -&gt; BMC</span>
          </div>
          <div className="whatsapp-bubble-body">
            {config.details.split("\n").map((line, index) => (
              line.trim() ? <p key={index}>{line}</p> : <br key={index} />
            ))}
          </div>
          <p className="whatsapp-bubble-hint">
            You can review and edit this message in WhatsApp before sending.
          </p>
        </div>
      ) : (
        <pre>{config.details}</pre>
      )}
      <div className="preview-actions">
        <button className="secondary-cta" type="button" onClick={onClose}>
          Not now
        </button>
        <button className="primary-cta" type="button" onClick={onConfirm}>
          <ArrowUpRight size={16} />
          {config.confirmLabel}
        </button>
      </div>
    </DialogSurface>
  );
}

function DiscardReportDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <DialogSurface layerClassName="nested-modal" className="mini-card discard-dialog" ariaLabel={t("form.discardTitle")} onClose={onCancel}>
      <h2>{t("form.discardTitle")}</h2>
      <p>Your photo and details will be lost.</p>
      <div className="preview-actions">
        <button className="secondary-cta" type="button" onClick={onCancel}>
          {t("form.keepEditing")}
        </button>
        <button className="primary-cta danger" type="button" onClick={onConfirm}>
          {t("action.discard")}
        </button>
      </div>
    </DialogSurface>
  );
}

function DiscardViewDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <DialogSurface layerClassName="nested-modal" className="mini-card discard-dialog" ariaLabel={t("form.discardViewTitle")} onClose={onCancel}>
      <h2>{t("form.discardViewTitle")}</h2>
      <p>{t("form.discardViewBody")}</p>
      <div className="preview-actions">
        <button className="secondary-cta" type="button" onClick={onCancel}>
          {t("form.keepEditing")}
        </button>
        <button className="primary-cta danger" type="button" onClick={onConfirm}>
          {t("action.discard")}
        </button>
      </div>
    </DialogSurface>
  );
}

type MyReportState = "cleaned" | "live" | "inReviewOrRemoved";

function MyReportsSheet({ reports, reportsUnavailable = false, onRetry, navigate, onClose, onSelectReport }: { reports: GarbageReport[]; reportsUnavailable?: boolean; onRetry?: () => void | Promise<void>; navigate: (path: string) => void; onClose: () => void; onSelectReport: (report: GarbageReport) => void }) {
  const entries = useMemo(() => getMyReports(), []);
  const rows = useMemo(
    () =>
      entries.map((entry) => {
        const report = reports.find((item) => item.id === entry.id) ?? null;
        const state: MyReportState = !report ? "inReviewOrRemoved" : report.status === "resolved" ? "cleaned" : "live";
        return { entry, report, state };
      }),
    [entries, reports]
  );

  return (
    <DialogSurface ariaLabel={t("myReports.title")} className="profile-sheet small my-reports-sheet" onClose={onClose}>
      <button className="close-button" onClick={onClose} aria-label={t("action.close")}>
        <X size={18} />
      </button>
      <div className="sheet-title-row compact">
        <div>
          <p className="eyebrow">{t("myReports.description")}</p>
          <h2>{t("myReports.title")}</h2>
        </div>
        <Bookmark size={20} />
      </div>
      {reportsUnavailable && (
        <div className="empty-state" role="alert">
          <p className="empty">{t("myReports.unavailable")}</p>
          {onRetry && (
            <button className="secondary-cta" type="button" onClick={() => void onRetry()}>
              {t("action.retry")}
            </button>
          )}
        </div>
      )}
      {rows.length ? (
        <div className="my-reports-list">
          {rows.map(({ entry, report, state }) => (
            <div className={clsx("my-report-row", `is-${state}`)} key={entry.id}>
              <span className="my-report-info">
                <strong>{report?.address || entry.address || entry.title}</strong>
                <small>
                  {shortDate(entry.createdAt)}
                  {entry.title ? ` · ${entry.title}` : ""}
                </small>
              </span>
              <span
                className={clsx(
                  "status-chip",
                  state === "cleaned" && "is-resolved",
                  state === "live" && "is-live"
                )}
              >
                {state === "cleaned" ? t("status.cleaned") : state === "live" ? t("myReports.live") : t("myReports.inReviewOrRemoved")}
              </span>
              {report ? (
                <button type="button" className="tiny-action my-report-view-action" onClick={() => onSelectReport(report)}>
                  {t("myReports.view")}
                </button>
              ) : (
                <button
                  type="button"
                  className="tiny-action my-report-view-action view-deep"
                  onClick={() => navigate(`/report/${entry.id}`)}
                  aria-label={`${t("myReports.view")}: ${entry.address || entry.title}`}
                >
                  {t("myReports.view")}
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <Bookmark size={22} aria-hidden="true" />
          <p className="empty">{t("myReports.empty")}</p>
        </div>
      )}
    </DialogSurface>
  );
}

type ReportFormStep = 1 | 2 | 3;
type ReportFieldKey = "photo" | "ward" | "address";

function ReportForm({ data, reports, onClose, onSubmit, onViewReport }: { data: CivicData; reports: GarbageReport[]; onClose: () => void; onSubmit: (report: GarbageReport) => void; onViewReport: (report: GarbageReport) => void }) {
  const [formStep, setFormStep] = useState<ReportFormStep>(1);
  const [wardNumber, setWardNumber] = useState("");
  const [wardSearch, setWardSearch] = useState("");
  const [wardPickerOpen, setWardPickerOpen] = useState(false);
  const [activeWardIndex, setActiveWardIndex] = useState(-1);
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
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [slowSubmit, setSlowSubmit] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submittedReviewStatus, setSubmittedReviewStatus] = useState<GarbageReport["moderation_status"] | null>(null);
  const [submittedReport, setSubmittedReport] = useState<GarbageReport | null>(null);
  const [formError, setFormError] = useState("");
  const [liveMessage, setLiveMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ReportFieldKey, string>>>({});
  const [formOffline, setFormOffline] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [pendingViewReport, setPendingViewReport] = useState<GarbageReport | null>(null);
  const [shareNote, setShareNote] = useState<"idle" | "copied" | "error">("idle");
  const limit = canSubmitReport();
  const selectedWard = detectedWard ?? data.wards.find((ward) => ward.ward_number === Number(wardNumber));
  const selectedWardLabel = selectedWard ? getWardSelectLabel(selectedWard) : "";
  const starterWardOptions = useMemo(() => {
    const wardsByNumber = new Map(data.wards.map((ward) => [ward.ward_number, ward]));
    const starters = POPULAR_WARD_NUMBERS.map((wardNumber) => wardsByNumber.get(wardNumber)).filter((ward): ward is Ward => Boolean(ward));
    const starterNumbers = new Set(starters.map((ward) => ward.ward_number));
    return [...starters, ...data.wards.filter((ward) => !starterNumbers.has(ward.ward_number))];
  }, [data.wards]);
  const filteredWardOptions = useMemo(() => {
    const query = wardSearch.trim().toLowerCase();
    const digits = query.replace(/\D/g, "");
    if (!query) {
      if (selectedWard) {
        return [selectedWard, ...starterWardOptions.filter((ward) => ward.ward_number !== selectedWard.ward_number)];
      }
      return starterWardOptions;
    }
    if (selectedWard && query === getWardSelectLabel(selectedWard).toLowerCase()) {
      return [selectedWard, ...starterWardOptions.filter((ward) => ward.ward_number !== selectedWard.ward_number)];
    }
    const matches = query
      ? data.wards.filter((ward) => getWardSearchText(ward).includes(query) || (digits ? String(ward.ward_number).includes(digits) : false))
      : data.wards;

    if (selectedWard && !matches.some((ward) => ward.ward_number === selectedWard.ward_number)) {
      return [selectedWard, ...matches];
    }
    return matches;
  }, [data.wards, selectedWard, starterWardOptions, wardSearch]);
  const visibleWardOptions = filteredWardOptions.slice(0, 8);
  // Duplicate check: active reports within 100m of the user-provided GPS coords (review step only).
  const nearbyDuplicates = useMemo(() => {
    if (formStep !== 3 || !reports.length || !location) return [];
    return findNearbyReports(reports, location.lat, location.lng, 100)
      .map((match: NearbyMatch) => ({ match, report: reports.find((item) => item.id === match.report.id) }))
      .filter((item): item is { match: NearbyMatch; report: GarbageReport } => Boolean(item.report));
  }, [formStep, location, reports]);
  const progressLabel =
    formStep === 1
      ? t("form.chooseArea")
      : formStep === 2
        ? t("form.addEvidence")
        : t("form.reviewSubmit");
  const currentStepTitle =
    formStep === 1
      ? t("form.step1Title")
      : formStep === 2
        ? t("form.step2Title")
        : t("form.step3Title");
  const hasUnsavedInput =
    Boolean(wardNumber || detectedWard || location || address.trim() || photo) || severity !== "medium" || category !== "mixed";

  // Track the current object URL so we can revoke it when the user picks a
  // new photo (preventing Blob URL memory leaks on repeated retakes).
  const photoPreviewRef = useRef<string | null>(null);
  const wardSearchRef = useRef<HTMLInputElement | null>(null);
  const successRef = useRef<HTMLDivElement | null>(null);
  const shareNoteTimerRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (photoPreviewRef.current) URL.revokeObjectURL(photoPreviewRef.current);
      if (shareNoteTimerRef.current != null) window.clearTimeout(shareNoteTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!wardPickerOpen) {
      setActiveWardIndex(-1);
      return;
    }
    setActiveWardIndex((index) => {
      if (!visibleWardOptions.length) return -1;
      if (index < 0) return 0;
      return Math.min(index, visibleWardOptions.length - 1);
    });
  }, [visibleWardOptions.length, wardPickerOpen]);

  useEffect(() => {
    const activeWard = activeWardIndex >= 0 ? visibleWardOptions[activeWardIndex] : undefined;
    if (!activeWard) return;
    document.getElementById(`report-ward-option-${activeWard.ward_number}`)?.scrollIntoView({ block: "nearest" });
  }, [activeWardIndex, visibleWardOptions]);

  useEffect(() => {
    if (submitSuccess) successRef.current?.focus({ preventScroll: true });
  }, [submitSuccess]);

  useEffect(() => {
    const syncOnlineState = () => setFormOffline(navigator.onLine === false);
    window.addEventListener("online", syncOnlineState);
    window.addEventListener("offline", syncOnlineState);
    return () => {
      window.removeEventListener("online", syncOnlineState);
      window.removeEventListener("offline", syncOnlineState);
    };
  }, []);

  useEffect(() => {
    if (!submitting) return;
    const warnUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnUnload);
    return () => window.removeEventListener("beforeunload", warnUnload);
  }, [submitting]);

  const guideToWardSearch = useCallback(() => {
    window.setTimeout(() => wardSearchRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 200);
    window.setTimeout(() => wardSearchRef.current?.focus({ preventScroll: true }), 350);
  }, []);

  const openSubmittedReport = useCallback(
    (report?: GarbageReport | null) => {
      const nextReport = report ?? submittedReport;
      if (!nextReport) return;
      if ((nextReport.moderation_status ?? "flagged") !== "approved") return;
      onSubmit(nextReport);
    },
    [onSubmit, submittedReport]
  );

  const shareSubmittedReport = useCallback(async () => {
    const url = submittedReport ? `${window.location.origin}/report/${submittedReport.id}` : window.location.origin;
    const wardLabel = selectedWard ? getWardSelectLabel(selectedWard) : "Bhubaneswar";
    const text = submittedReport
      ? `I just reported a garbage dump in ${wardLabel} on Amma Odisha. Support this report: ${url}`
      : `I just reported a garbage dump in Bhubaneswar on Amma Odisha. Join me in holding our ward accountable: ${url}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Amma Odisha", text, url });
        setShareNote("idle");
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setShareNote("copied");
        if (shareNoteTimerRef.current != null) window.clearTimeout(shareNoteTimerRef.current);
        shareNoteTimerRef.current = window.setTimeout(() => setShareNote("idle"), 2000);
      } else {
        throw new Error("Clipboard unavailable");
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      console.error("Share failed", caught);
      setShareNote("error");
    }
  }, [selectedWard, submittedReport]);

  const requestClose = useCallback(() => {
    if (submitting) return;
    if (submitSuccess || !hasUnsavedInput) {
      onClose();
      return;
    }
    setShowDiscardConfirm(true);
  }, [hasUnsavedInput, onClose, submitSuccess, submitting]);

  const requestViewReport = (report: GarbageReport) => {
    setPendingViewReport(report);
  };

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
    setLocation(null);
    setWardNumber(String(ward.ward_number));
    setWardSearch(getWardSelectLabel(ward));
    setWardPickerOpen(false);
    setActiveWardIndex(-1);
    setLocationState("manual");
    clearFieldError("ward");
    setFormError("");
  };

  const onWardSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setWardPickerOpen(true);
      setActiveWardIndex((index) => {
        if (!visibleWardOptions.length) return -1;
        return Math.min(index < 0 ? 0 : index + 1, visibleWardOptions.length - 1);
      });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setWardPickerOpen(true);
      setActiveWardIndex((index) => {
        if (!visibleWardOptions.length) return -1;
        return Math.max(index < 0 ? visibleWardOptions.length - 1 : index - 1, 0);
      });
    } else if (event.key === "Enter") {
      const activeWard = visibleWardOptions[activeWardIndex >= 0 ? activeWardIndex : 0];
      if (activeWard) {
        event.preventDefault();
        chooseWard(activeWard);
      }
    } else if (event.key === "Escape") {
      event.stopPropagation();
      setWardPickerOpen(false);
      setActiveWardIndex(-1);
    }
  };

  const validateStep = useCallback(
    (step: ReportFormStep) => {
      const nextFieldErrors: Partial<Record<ReportFieldKey, string>> = {};
      if (step === 1 && !selectedWard) {
        nextFieldErrors.ward = "Search for your area and tap a result to continue.";
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
      guideToWardSearch();
      return;
    }
    setLocationState("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const accuracy = Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null;
        setLocation({ lat, lng, accuracy, recordedAt: new Date(position.timestamp || Date.now()).toISOString() });
        if (!isInsideBoundary(lat, lng, data.cityBoundary)) {
          setLocationState("outside");
          guideToWardSearch();
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
          guideToWardSearch();
        }
      },
      (geoError) => {
        setLocationState(geoError.code === geoError.PERMISSION_DENIED ? "denied" : "manual");
        guideToWardSearch();
      },
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
    if (locationState === "locating") return "Your browser may ask for permission - we only use it for this report.";
    if (locationState === "detecting") return "Matching your coordinates to the local ward boundary...";
    if (locationState === "detected") return `Detected Ward ${selectedWard?.ward_number ?? ""}. You can still change it manually.`;
    if (locationState === "outside") return "Your location appears to be outside Bhubaneswar. Search manually below.";
    if (locationState === "denied") return "Location access was denied. Type a nearby market or colony name below.";
    if (locationState === "unavailable") return "Location not available in this browser. Choose your area manually.";
    if (locationState === "manual" && selectedWard) return "Area selected manually.";
    if (locationState === "manual") return "We couldn't detect your area. Please search below.";
    return "We'll find your neighbourhood and match it to the right area.";
  })();
  const needsWardSearchGuidance = ["denied", "outside", "unavailable", "manual"].includes(locationState) && !selectedWard;

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
      const offlineMessage = t("form.offlineWarning");
      setFormError(offlineMessage);
      announce(offlineMessage);
      return;
    }
    const gpsLocation = location && detectedWard?.ward_number === selectedWard.ward_number ? location : null;
    setSubmitting(true);
    setUploadProgress(null);
    const slowTimer = window.setTimeout(() => setSlowSubmit(true), 4500);
    try {
      setSubmitStage("uploading");
      setUploadProgress(0);
      const upload = await backend.uploadReportPhoto(photo, { onProgress: setUploadProgress });
      const input: NewReportInput = {
        latitude: gpsLocation?.lat ?? selectedWard.center_lat,
        longitude: gpsLocation?.lng ?? selectedWard.center_lng,
        gps_latitude: gpsLocation?.lat ?? null,
        gps_longitude: gpsLocation?.lng ?? null,
        gps_accuracy_meters: gpsLocation?.accuracy ?? null,
        gps_recorded_at: gpsLocation?.recordedAt ?? null,
        location_source: gpsLocation ? "gps" : "ward_center",
        ward_number: selectedWard.ward_number,
        address: address.trim(),
        severity,
        category,
        photo_thumb_url: upload.thumbUrl ?? null,
        photo_url: upload.url
      };
      setSubmitStage("saving");
      const submitted = await backend.submitReport(input);
      // Track locally so "My Reports" can list this submission on this device.
      trackMyReport({
        id: submitted.id,
        title: getWardSelectLabel(selectedWard),
        address: address.trim(),
        createdAt: submitted.created_at
      });
      setSubmittedReviewStatus(submitted.moderation_status ?? "flagged");
      setSubmittedReport(submitted);
      setSubmitSuccess(true);
      navigator.vibrate?.(35);
    } catch (caught) {
      console.error("Submit failed", caught);
      const rawMessage = caught instanceof Error ? caught.message : "";
      const lowered = rawMessage.toLowerCase();
      const message = lowered.includes("daily limit")
        ? t("form.errDailyLimit")
        : ["timed out", "unavailable", "fetch"].some((needle) => lowered.includes(needle))
          ? t("form.errNetwork")
          : t("form.errGeneric");
      setFormError(message);
      announce(message);
    } finally {
      window.clearTimeout(slowTimer);
      setSubmitStage("idle");
      setUploadProgress(null);
      setSlowSubmit(false);
      setSubmitting(false);
    }
  };

  return (
    <DialogSurface ariaLabel="Report garbage" className="form-sheet" disableEscape={showDiscardConfirm || Boolean(pendingViewReport)} onClose={requestClose}>
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
          <h2>{t("action.reportGarbage")}</h2>
          <p>
            <strong>{currentStepTitle}</strong>{" "}
            {formStep === 1 && "Pick the area for this report."}
            {formStep === 2 && "Add the proof people need to find the spot."}
            {formStep === 3 && "Confirm the details before submitting."}
          </p>
        </div>
      </div>
      <div className="sr-only" aria-live="assertive" role="alert">
        {liveMessage}
      </div>
      {submitSuccess && (
        <div
          ref={successRef}
          className="submit-success-screen"
          role="status"
          tabIndex={0}
          aria-label="Report submitted."
          style={{ cursor: "default" }}
        >
          <CheckCircle2 size={36} />
          <p className="eyebrow">{t("success.eyebrow")}</p>
          <h3>{t("success.title")}</h3>
          <p>
            {submittedReviewStatus === "approved"
              ? t("success.subtitle")
              : "Thank you for your submission. We review every photo before it appears publicly. Misleading photos or information will be rejected by the admin."}
          </p>
          {submittedReviewStatus === "approved" ? (
            <>
              <button
                className="primary-cta submit-open-button"
                type="button"
                onClick={() => openSubmittedReport()}
              >
                <ArrowUpRight size={14} />
                {t("action.viewMyReport")}
              </button>
              <button
                className="secondary-cta submit-share-button"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void shareSubmittedReport();
                }}
              >
                <Share2 size={15} />
                {t("action.shareYourReport")}
              </button>
            </>
          ) : (
            <button className="primary-cta submit-open-button" type="button" onClick={onClose}>
              <CheckCircle2 size={14} />
              {t("action.back")}
            </button>
          )}
          {shareNote === "copied" && (
            <p className="already-voted-note" role="status">Copied to clipboard.</p>
          )}
          {shareNote === "error" && (
            <p className="warning-text" role="alert">Sharing failed. Check your connection and try again.</p>
          )}
        </div>
      )}
      {!submitSuccess && (
        <>
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
          <div className="detect-ward-card">
            <button className="detect-ward-action" onClick={detectWard} type="button" disabled={locationState === "locating" || locationState === "detecting"}>
              {locationState === "locating" || locationState === "detecting" ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}
              {locationState === "detected"
                ? "Refresh location"
                : locationState === "detecting"
                  ? "Detecting your area..."
                  : locationState === "locating"
                    ? "Finding your location..."
                    : "Use my current location"}
            </button>
            <span>
              <strong>Fastest - works automatically</strong>
              <small>{locationHelp}</small>
            </span>
          </div>
          {needsWardSearchGuidance && (
            <div className="ward-recovery-callout" role="status">
              <strong>Can't detect your area?</strong>
              <span>Type the name of a nearby market, colony, or landmark - for example Unit 4, Sahid Nagar, or Nayapalli.</span>
            </div>
          )}
          <div className="field">
            <label className="field-label" htmlFor="report-ward-search" id="report-step-ward">
              Or search by name <b>*</b>
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
                  ref={wardSearchRef}
                  id="report-ward-search"
                  value={wardSearch}
                  onFocus={() => setWardPickerOpen(true)}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setWardSearch(nextValue);
                    setWardPickerOpen(true);
                    setActiveWardIndex(0);
                    if (selectedWard && nextValue !== selectedWardLabel) {
                      setWardNumber("");
                      setDetectedWard(null);
                    }
                    clearFieldError("ward");
                  }}
                  onKeyDown={onWardSearchKeyDown}
                  placeholder="Neighbourhood, market, colony, or ward number"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={wardPickerOpen}
                  aria-controls="report-ward-options"
                  aria-activedescendant={
                    wardPickerOpen && activeWardIndex >= 0 && visibleWardOptions[activeWardIndex]
                      ? `report-ward-option-${visibleWardOptions[activeWardIndex].ward_number}`
                      : undefined
                  }
                  aria-invalid={Boolean(fieldErrors.ward)}
                  aria-describedby={fieldErrors.ward ? "report-ward-error" : selectedWard ? "selected-ward" : undefined}
                />
              </div>
              {wardPickerOpen && (
                <div className="ward-options" id="report-ward-options" role="listbox" aria-label="Matching wards">
                  {wardSearch.trim() === "" && !selectedWard && (
                    <p className="ward-options-hint">
                      Type a nearby market, colony, or ward number to search.
                    </p>
                  )}
                  {visibleWardOptions.length ? (
                    visibleWardOptions.map((ward, index) => {
                      const wardLabel = getWardSelectLabel(ward);
                      const isSelected = selectedWard?.ward_number === ward.ward_number;
                      const isActive = activeWardIndex === index;
                      return (
                        <button
                          id={`report-ward-option-${ward.ward_number}`}
                          key={ward.ward_number}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          aria-current={isActive ? "true" : undefined}
                          className={clsx(isSelected && "is-selected", isActive && "is-active")}
                          onMouseEnter={() => setActiveWardIndex(index)}
                          onPointerDown={(event) => event.preventDefault()}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => chooseWard(ward)}
                        >
                          <strong>{wardLabel}</strong>
                          <small>{ward.locality_name || ward.assembly_constituency}</small>
                        </button>
                      );
                    })
                  ) : (
                    <p>No matching areas. Try a ward number or locality.</p>
                  )}
                </div>
              )}
            </div>
            {selectedWard && (
              <p className="selected-ward" id="selected-ward" role="status">
                <CheckCircle2 size={14} />
                Found: {selectedWardLabel}
              </p>
            )}
            {fieldErrors.ward && (
              <p className="field-error" id="report-ward-error">
                {fieldErrors.ward}
              </p>
            )}
          </div>
          <p className="privacy-note">Your GPS coordinates are used only to identify the right area and are not shared publicly. Manual search still works if location is unavailable.</p>
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
              <p className="field-error" id="report-address-error">
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
              <em>{photoPreview ? "Change photo" : "Add photo"}</em>
              <small>Take a new photo or choose from your gallery.</small>
              <input
                type="file"
                accept="image/*"
                aria-label="Upload garbage photo"
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
              <p className="field-error" id="report-photo-error">
                {fieldErrors.photo}
              </p>
            )}
          </div>
        </section>
      )}

      {formStep === 3 && (
        <section className="wizard-panel" aria-labelledby="report-step-review">
          {!location && <p className="muted">{t("dupes.noGps")}</p>}
          {nearbyDuplicates.length > 0 && (
            <div className="notice amber duplicate-warning" role="alert">
              <CircleAlert size={16} />
              <span>
                <strong>{t("dupes.title")}</strong>
                {nearbyDuplicates.slice(0, 2).map(({ match, report: nearby }) => (
                  <span className="duplicate-match" key={nearby.id}>
                    <em>{nearby.address}</em> · {t("dupes.metersAway", { count: Math.max(1, Math.round(match.distanceMeters)) })}
                    <button type="button" className="tiny-action duplicate-view-action" onClick={() => requestViewReport(nearby)}>
                      {t("dupes.viewReport")}
                    </button>
                  </span>
                ))}
                {nearbyDuplicates.length > 2 && (
                  <span className="duplicate-match">
                    <em>{t("dupes.more", { count: nearbyDuplicates.length - 2 })}</em>
                  </span>
                )}
              </span>
            </div>
          )}
          <div className={clsx("review-card", !photo && "has-error")} id="report-step-review">
            <strong>{selectedWard ? selectedWardLabel : "Ward not selected"}</strong>
            <span>{address || "No landmark added yet"}</span>
            <small className={clsx(!photo && "is-error")}>{photo ? "Photo attached" : "Photo missing - go back and add a clear photo."}</small>
          </div>
          <label className="field">
            <span>How Bad Is It?</span>
            <div className="option-grid">
              {Object.keys(SEVERITY).map((key) => (
                <button type="button" className={clsx(severity === key && "is-selected")} onClick={() => setSeverity(key as SeverityKey)} key={key}>
                  <SeverityMark severityKey={key as SeverityKey} />
                  <strong>{severityLabel(key as SeverityKey)}</strong>
                  <small>{SEVERITY_SHORT_DESCRIPTIONS[key as SeverityKey]}</small>
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
        {submitting && (
          <div className="notice info upload-status" role="status">
            <LoaderCircle className="spin" size={16} />
            <span>
              <strong>{submitProgressText}</strong>
              Keep this screen open while we send your photo and report details.
              {submitStage === "uploading" && (
                <UploadProgressBar label="Report photo upload progress" value={uploadProgress} />
              )}
            </span>
          </div>
        )}
        {slowSubmit && (
          <p className="warning-text" role="alert">This is taking longer than usual. Your photo may be on a slow connection, so please keep the form open.</p>
        )}
        {formOffline && <p className="warning-text" role="alert">{t("form.offlineWarning")}</p>}
        {formError && <p className="warning-text" role="alert">{formError}</p>}
        <div className="form-footer-meta">
          <p className="anonymous form-trust-badge">
            <ShieldCheck size={13} /> All reports are anonymous
          </p>
          <p className="quota-note">{t("quota.left", { count: limit.remaining, total: limit.total })}</p>
        </div>
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
            <button className={clsx("primary-cta", formOffline && "is-offline")} onClick={() => void submit()} disabled={submitting || submitSuccess || formOffline}>
              {submitting ? <LoaderCircle className="spin" size={17} /> : submitSuccess ? <CheckCircle2 size={17} /> : <Send size={17} />}
              {submitSuccess ? t("form.submitted") : submitting ? submitProgressText : formOffline ? t("form.offlineButton") : t("action.submit")}
            </button>
          )}
        </div>
      </div>
        </>
      )}
      {showDiscardConfirm && (
        <DiscardReportDialog
          onCancel={() => setShowDiscardConfirm(false)}
          onConfirm={() => {
            setShowDiscardConfirm(false);
            onClose();
          }}
        />
      )}
      {pendingViewReport && (
        <DiscardViewDialog
          onCancel={() => setPendingViewReport(null)}
          onConfirm={() => {
            const target = pendingViewReport;
            setPendingViewReport(null);
            onViewReport(target);
          }}
        />
      )}
    </DialogSurface>
  );
}

function ProfileSheet({
  selection,
  data,
  onBackToReport,
  onClose,
  returnReport,
  onSelectReport
}: {
  selection: Exclude<RouteSelection, null>;
  data: CivicData;
  onBackToReport?: () => void;
  onClose: () => void;
  returnReport?: GarbageReport | null;
  onSelectReport: (report: GarbageReport) => void;
}) {
  const isWard = selection.type === "ward";
  const ward = isWard ? data.wards.find((item) => item.ward_number === Number(selection.id)) : null;
  const rep = !isWard
    ? data.representatives.find((item) => item.role === selection.type && item.constituency === selection.id)
    : null;
  const profileReports = useMemo(
    () =>
      data.reports.filter((report) => {
        const itemWard = data.wards.find((item) => item.ward_number === report.ward_number);
        if (ward) return report.ward_number === ward.ward_number;
        if (selection.type === "mla") return itemWard?.assembly_constituency === rep?.constituency;
        return itemWard?.parliamentary_constituency === rep?.constituency;
      }),
    [data.reports, data.wards, rep?.constituency, selection.type, ward]
  );
  const activeReports = profileReports.filter((report) => report.status !== "resolved");
  const wardName = getDistinctWardName(ward);
  const wardMla = ward ? data.representatives.find((item) => item.role === "mla" && item.constituency === ward.assembly_constituency) : null;
  const wardMp = ward ? data.representatives.find((item) => item.role === "mp" && item.constituency === ward.parliamentary_constituency) : null;
  const contactRep = rep ?? wardMla;
  const [externalPreview, setExternalPreview] = useState<ExternalPreviewConfig | null>(null);
  const [shareNote, setShareNote] = useState<"idle" | "copied" | "error">("idle");
  const shareNoteTimerRef = useRef<number | null>(null);
  const averageActiveDays = Math.round(activeReports.reduce((sum, report) => sum + daysActive(report.created_at), 0) / Math.max(1, activeReports.length));

  useEffect(() => {
    return () => {
      if (shareNoteTimerRef.current != null) window.clearTimeout(shareNoteTimerRef.current);
    };
  }, []);

  const previewCall = (label: string, value: string) => {
    setExternalPreview({
      action: { kind: "tel", value },
      confirmLabel: "Call now",
      details: value,
      helper: `This will start a phone call to ${label}.`,
      title: `Call ${label}`
    });
  };

  const shareWardData = async () => {
    if (!ward) return;
    const url = `${window.location.origin}/ward/${ward.ward_number}`;
    const active = activeReports.length;
    const name = wardName ? `Ward ${ward.ward_number} (${wardName})` : `Ward ${ward.ward_number}`;
    const dayText = active ? ` for an avg of ${averageActiveDays} days` : "";
    const text = `${name} has ${active} active garbage ${active === 1 ? "dump" : "dumps"} unresolved${dayText}. See: ${url}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `Amma Odisha - ${name}`, text, url });
        setShareNote("idle");
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setShareNote("copied");
        if (shareNoteTimerRef.current != null) window.clearTimeout(shareNoteTimerRef.current);
        shareNoteTimerRef.current = window.setTimeout(() => setShareNote("idle"), 2000);
      } else {
        throw new Error("Clipboard unavailable");
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      console.error("Share failed", caught);
      setShareNote("error");
    }
  };

  const confirmProfileExternalAction = () => {
    if (!externalPreview) return;
    if (externalPreview.action.kind === "tel") {
      window.location.href = `tel:${externalPreview.action.value}`;
    }
    setExternalPreview(null);
  };

  if (isWard && !ward) {
    return (
      <DialogSurface
        ariaLabel="Ward not found"
        className="profile-sheet"
        onClose={onClose}
      >
        <button className="sheet-back-button" type="button" onClick={onClose}>
          <ChevronLeft size={16} />
          Back to map
        </button>
        <button className="close-button" onClick={onClose} aria-label="Close profile">
          <X size={18} />
        </button>
        <div className="profile-hero">
          <Layers size={28} />
          <div>
            <p className="eyebrow">Ward Profile</p>
            <h2>Ward {selection.id}</h2>
            <p>No data available</p>
          </div>
        </div>
        <div className="accountability-card">
          <h3>Ward not found</h3>
          <p>This ward couldn't be found in our data. It may have been renumbered or the link may be outdated.</p>
        </div>
      </DialogSurface>
    );
  }

  if (!isWard && !rep) {
    return (
      <DialogSurface
        ariaLabel="Representative not found"
        className="profile-sheet"
        onClose={onClose}
      >
        <button className="sheet-back-button" type="button" onClick={onClose}>
          <ChevronLeft size={16} />
          Back to map
        </button>
        <button className="close-button" onClick={onClose} aria-label="Close profile">
          <X size={18} />
        </button>
        <div className="profile-hero">
          <ShieldCheck size={28} />
          <div>
            <p className="eyebrow">{selection.type.toUpperCase()} Profile</p>
            <h2>{selection.id}</h2>
            <p>No data available</p>
          </div>
        </div>
        <div className="accountability-card">
          <h3>Representative not found</h3>
          <p>This representative couldn't be found in our data. The link may be outdated or the constituency may have changed.</p>
        </div>
      </DialogSurface>
    );
  }

  return (
    <DialogSurface
      ariaLabel={isWard ? "Ward profile" : "Representative profile"}
      className="profile-sheet"
      disableEscape={Boolean(externalPreview)}
      onClose={onClose}
    >
        <button className="sheet-back-button" type="button" onClick={onBackToReport ?? onClose}>
          <ChevronLeft size={16} />
          {returnReport ? "Back to report" : "Back to map"}
        </button>
        <button className="close-button" onClick={onClose} aria-label="Close profile">
          <X size={18} />
        </button>
        <p className="sheet-breadcrumb">
          {returnReport ? `Report · Ward ${returnReport.ward_number}` : getRouteSelectionLabel(selection)}
        </p>
        <div className="profile-hero">
          {rep ? <Avatar rep={rep} /> : <Layers size={28} />}
          <div>
            <p className="eyebrow">{isWard ? "Ward Profile" : selection.type.toUpperCase()}</p>
            <h2>{ward ? `Ward ${ward.ward_number}` : rep?.name}</h2>
            <p>{ward ? wardName || "Bhubaneswar" : `${rep?.party} · ${rep?.constituency}`}</p>
          </div>
        </div>
        <div className="metric-grid">
          <Metric label="Unresolved" value={activeReports.length} />
          <Metric label="Total Reports" value={profileReports.length} />
          <Metric label="Avg Days" value={averageActiveDays} />
        </div>
        {isWard && ward ? (
          <div className="elected-reps-section">
            <p className="eyebrow elected-reps-eyebrow">Elected Representatives for this Ward</p>
            <div className="elected-reps-grid">
              <div className="elected-rep-card">
                <Avatar rep={wardMla ?? undefined} />
                <strong>{wardMla?.name ?? "Not mapped"}</strong>
                <span className="elected-rep-role" style={{ color: getPartyTextColor(wardMla?.party) }}>
                  {wardMla ? `${wardMla.party} · MLA` : `${ward.assembly_constituency} · MLA`}
                </span>
              </div>
              <div className="elected-rep-card">
                <Avatar rep={wardMp ?? undefined} />
                <strong>{wardMp?.name ?? "Not mapped"}</strong>
                <span className="elected-rep-role" style={{ color: getPartyTextColor(wardMp?.party) }}>
                  {wardMp ? `${wardMp.party} · MP` : `${ward.parliamentary_constituency} · MP`}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="accountability-card">
            <h3>{selection.type === "mla" ? "Assembly Constituencies" : "Wards"}</h3>
            <p>Tap to view reports and top locations across this constituency.</p>
          </div>
        )}
        {isWard && ward && (
          <button className="share-ward-button" type="button" aria-label={`Share data for Ward ${ward.ward_number}`} onClick={() => void shareWardData()}>
            <Share2 size={14} />
            Share ward data
          </button>
        )}
        {isWard && ward && shareNote === "copied" && (
          <p className="already-voted-note" role="status">Copied to clipboard.</p>
        )}
        {isWard && ward && shareNote === "error" && (
          <p className="warning-text" role="alert">Sharing failed. Check your connection and try again.</p>
        )}
        {contactRep && (contactRep.phone || contactRep.email || contactRep.twitter_handle || contactRep.profile_url) && (
          <div className="rep-contact-card">
            <h3>{isWard ? "Representative contact" : "Contact"}</h3>
            {contactRep.phone && (
              <button className="rep-contact-row" type="button" onClick={() => previewCall(contactRep.name, contactRep.phone ?? "")}>
                <Phone size={14} />
                <span>{contactRep.phone}</span>
              </button>
            )}
            {contactRep.email && (
              <a className="rep-contact-row" href={`mailto:${contactRep.email}`}>
                <MessageCircle size={14} />
                <span>{contactRep.email}</span>
              </a>
            )}
            {contactRep.twitter_handle && (
              <a className="rep-contact-row" href={`https://x.com/${contactRep.twitter_handle.replace(/^@/, "")}`} target="_blank" rel="noreferrer">
                <ExternalLink size={14} />
                <span>@{contactRep.twitter_handle.replace(/^@/, "")}</span>
              </a>
            )}
            {contactRep.profile_url && (
              <a className="rep-contact-row" href={contactRep.profile_url} target="_blank" rel="noreferrer">
                <ArrowUpRight size={14} />
                <span>Official profile</span>
              </a>
            )}
          </div>
        )}
        <h3>Top Locations</h3>
        <ReportList
          reports={profileReports}
          resetKey={`${selection.type}:${selection.id}`}
          wards={data.wards}
          representatives={data.representatives}
          initialLimit={12}
          emptyTitle="No reports linked here yet."
          emptyDescription="When citizens report spots in this area, they will appear here."
          onSelect={onSelectReport}
        />
      {externalPreview && (
        <ExternalAppPreview
          config={externalPreview}
          onClose={() => setExternalPreview(null)}
          onConfirm={confirmProfileExternalAction}
        />
      )}
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
        <img className="about-hero-image" src="/garbage-about.jpg" alt="Illegal garbage dumping in Bhubaneswar" />
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
          <a href="https://x.com/MrinallSamal" target="_blank" rel="noreferrer" aria-label="Follow Amma Odisha on X (Twitter)">
            Follow updates <ExternalLink size={13} />
          </a>
          <a href="https://x.com/realmojojojo_" target="_blank" rel="noreferrer">
            Built by Mrinall Samal
          </a>
          <a href="https://ammaodisha.me" target="_blank" rel="noreferrer">
            ammaodisha.me
          </a>
          <button
            className="secondary-cta compact"
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
        <div className="sheet-title-row compact changelog-header">
          <h2>Changelog</h2>
        </div>
        <p className="muted">What's new in Amma Odisha</p>
        {CHANGELOG.map((entry) => (
          <div className="changelog-entry" key={entry.version}>
            <div className="sheet-title-row compact">
              <strong>v{entry.version}</strong>
              <span className="pill green">{entry.tag}</span>
              <small>{entry.date}</small>
            </div>
            {entry.changes.map((change, index) => (
              <p key={index}>
                <span aria-hidden="true">{change.type.toUpperCase()}</span> {change.text}
              </p>
            ))}
          </div>
        ))}
    </DialogSurface>
  );
}

function MobileQRModal({ onClose, url }: { onClose: () => void; url: string }) {
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(url)}`;
  const [qrFailed, setQrFailed] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current != null) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleShareOrCopy = async () => {
    setCopyState("idle");
    try {
      const result = await shareOrCopy(
        { title: "Report on Amma Odisha", text: "Open Amma Odisha on your phone to report with the camera.", url },
        url
      );
      if (result === "copied") {
        setCopyState("copied");
        if (copyTimerRef.current != null) window.clearTimeout(copyTimerRef.current);
        copyTimerRef.current = window.setTimeout(() => setCopyState("idle"), 2000);
      }
    } catch (caught) {
      console.error("Share failed", caught);
      setCopyState("error");
    }
  };

  return (
    <DialogSurface ariaLabel="Report on mobile" className="mini-card mobile-qr-modal" onClose={onClose}>
      <button className="close-button" onClick={onClose} aria-label="Close mobile QR code">
        <X size={18} />
      </button>
      <h2>Report on your phone</h2>
      <p className="mobile-qr-desc">Scan this code to open Amma Odisha with the report form ready for your camera.</p>
      <div className="mobile-qr-frame">
        {qrFailed ? (
          <p className="mobile-qr-fallback">
            QR image unavailable.<br />
            Copy the link below instead.
          </p>
        ) : (
          <img
            src={qrUrl}
            alt="QR code to open the report form on mobile"
            width={220}
            height={220}
            loading="lazy"
            onError={() => setQrFailed(true)}
          />
        )}
      </div>
      <p className="mobile-qr-url">{url}</p>
      <button className="secondary-cta" type="button" onClick={() => void handleShareOrCopy()}>
        <Share2 size={15} />
        {copyState === "copied" ? "Link copied" : "Copy link"}
      </button>
      {copyState === "error" && (
        <p className="warning-text" role="alert">Could not copy the link. Long-press the URL above to copy it manually.</p>
      )}
    </DialogSurface>
  );
}

function TelegramToast({ trigger }: { trigger: boolean }) {
  const [hidden, setHidden] = useState(() => readStorageValue("nk_telegram_hidden") === "1");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (hidden || !trigger) return;
    const timer = window.setTimeout(() => setReady(true), 8000);
    return () => window.clearTimeout(timer);
  }, [hidden, trigger]);

  if (hidden || !ready) return null;
  return (
    <div className="telegram-toast" role="status" aria-live="polite" aria-atomic="true">
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
      <MessageCircle size={16} />
      <span>
        <strong>Join the community</strong>
        Feedback, ideas & updates on Telegram
      </span>
      <a href="https://t.me/+23jgBr4Gz6BkYTFl" target="_blank" rel="noreferrer" aria-label="Join the Amma Odisha Telegram community">
        Join
      </a>
    </div>
  );
}
