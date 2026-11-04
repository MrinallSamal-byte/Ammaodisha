import type { SeverityKey } from "../types/domain";

/**
 * User-preference persistence. Stored under a single localStorage key so a
 * returning visitor lands on the same view, sort, and filters they left
 * behind. Every value is validated on read — corrupt or stale data falls
 * back to defaults instead of breaking the app.
 */

const PREFS_KEY = "nk_prefs";

export type SortMode = "newest" | "upvotes" | "oldest";
export type ViewMode = "map" | "list";
export type StatusFilter = "all" | "unresolved" | "resolved";
export type SeverityFilter = "all" | SeverityKey;

export interface UserPrefs {
  viewMode?: ViewMode;
  sortBy?: SortMode;
  severityFilter?: SeverityFilter;
  statusFilter?: StatusFilter;
  staleOnly?: boolean;
  /** ISO timestamp of the previous visit, used for the "what's new" badge. */
  lastVisitAt?: string;
}

const VIEW_MODES: readonly ViewMode[] = ["map", "list"];
const SORT_MODES: readonly SortMode[] = ["newest", "upvotes", "oldest"];
const STATUS_FILTERS: readonly StatusFilter[] = ["all", "unresolved", "resolved"];
const SEVERITY_FILTERS: readonly SeverityFilter[] = ["all", "small", "medium", "large", "massive"];

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

export function sanitizePrefs(value: unknown): UserPrefs {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const prefs: UserPrefs = {};
  if (isOneOf(raw.viewMode, VIEW_MODES)) prefs.viewMode = raw.viewMode;
  if (isOneOf(raw.sortBy, SORT_MODES)) prefs.sortBy = raw.sortBy;
  if (isOneOf(raw.severityFilter, SEVERITY_FILTERS)) prefs.severityFilter = raw.severityFilter;
  if (isOneOf(raw.statusFilter, STATUS_FILTERS)) prefs.statusFilter = raw.statusFilter;
  if (typeof raw.staleOnly === "boolean") prefs.staleOnly = raw.staleOnly;
  if (typeof raw.lastVisitAt === "string" && !Number.isNaN(new Date(raw.lastVisitAt).getTime())) {
    prefs.lastVisitAt = raw.lastVisitAt;
  }
  return prefs;
}

export function loadPrefs(): UserPrefs {
  try {
    return sanitizePrefs(JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") as unknown);
  } catch {
    return {};
  }
}

export function savePrefs(update: UserPrefs): void {
  try {
    const merged = { ...loadPrefs(), ...update };
    localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
  } catch {
    // Storage unavailable (private mode/quota) — preferences just won't persist.
  }
}

// ─── Shareable filtered-view URLs ────────────────────────────────────────────

export interface ViewParams {
  ward?: number;
  severity?: SeverityFilter;
  status?: StatusFilter;
  stale?: boolean;
  q?: string;
}

const MAX_QUERY_LENGTH = 120;

/** Parse and validate `?ward&severity&status&q` from a URL query string. */
export function parseViewParams(search: string, validWardNumbers?: readonly number[]): ViewParams {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return {};
  }
  const next: ViewParams = {};

  const wardRaw = params.get("ward");
  if (wardRaw != null && wardRaw.trim() !== "") {
    const ward = Number(wardRaw);
    const inRange = ward >= 1 && ward <= 999;
    const known = !validWardNumbers || validWardNumbers.includes(ward);
    if (Number.isFinite(ward) && inRange && known) next.ward = Math.trunc(ward);
  }

  const severity = params.get("severity");
  if (isOneOf(severity, SEVERITY_FILTERS) && severity !== "all") next.severity = severity;

  const status = params.get("status");
  if (isOneOf(status, STATUS_FILTERS) && status !== "all") next.status = status;

  // "Open 30+ days" only ever matches unresolved reports, so a stale flag on a
  // resolved link is a contradiction — drop it rather than showing zero rows.
  if (params.get("stale") === "1" && next.status !== "resolved") next.stale = true;

  const q = params.get("q");
  if (q != null) {
    const trimmed = q.trim().slice(0, MAX_QUERY_LENGTH);
    if (trimmed) next.q = trimmed;
  }

  return next;
}

/** Build a shareable URL query string; omits defaults to keep links clean. */
export function buildViewParams(input: {
  ward?: number | null;
  severity?: SeverityFilter;
  status?: StatusFilter;
  stale?: boolean;
  q?: string;
}): string {
  const params = new URLSearchParams();
  if (input.ward != null && Number.isFinite(input.ward)) params.set("ward", String(Math.trunc(input.ward)));
  if (input.severity && input.severity !== "all") params.set("severity", input.severity);
  if (input.status && input.status !== "all") params.set("status", input.status);
  if (input.stale && input.status !== "resolved") params.set("stale", "1");
  const q = (input.q ?? "").trim();
  if (q) params.set("q", q.slice(0, MAX_QUERY_LENGTH));
  return params.toString();
}
