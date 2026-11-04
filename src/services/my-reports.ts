import type { GarbageReport } from "../types/domain";

export interface MyReportEntry {
  id: string;
  title: string;
  address: string;
  createdAt: string;
}

export type MyReportState = "cleaned" | "live" | "inReviewOrRemoved";

/**
 * A tracked report only counts as live once it is publicly approved. Newly
 * submitted reports and cleanup proofs waiting in moderation stay pending.
 */
export function getMyReportState(
  report: Pick<GarbageReport, "status" | "moderation_status"> | null | undefined
): MyReportState {
  if (!report) return "inReviewOrRemoved";
  if (report.status === "resolved") return "cleaned";
  if ((report.moderation_status ?? "approved") !== "approved") return "inReviewOrRemoved";
  return "live";
}

const STORAGE_KEY = "ao_my_reports";
const CAP = 50;

function isEntry(value: unknown): value is MyReportEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === "string" && typeof entry.title === "string" && typeof entry.address === "string" && typeof entry.createdAt === "string";
}

function readEntries(): MyReportEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry);
  } catch {
    return [];
  }
}

function writeEntries(entries: MyReportEntry[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function sortByNewestFirst(entries: MyReportEntry[]): MyReportEntry[] {
  return [...entries].sort((a, b) => toTime(b.createdAt) - toTime(a.createdAt));
}

function toTime(isoDate: string): number {
  const time = Date.parse(isoDate);
  return Number.isNaN(time) ? 0 : time;
}

export function trackMyReport(report: Pick<MyReportEntry, "id" | "title" | "address" | "createdAt">): void {
  try {
    const existing = readEntries().filter((entry) => entry.id !== report.id);
    writeEntries([report, ...existing].slice(0, CAP));
  } catch {
    /* storage unavailable or corrupt — tracking is best-effort */
  }
}

export function getMyReports(): MyReportEntry[] {
  try {
    return sortByNewestFirst(readEntries()).slice(0, CAP);
  } catch {
    return [];
  }
}

export function isMyReport(id: string): boolean {
  try {
    return readEntries().some((entry) => entry.id === id);
  } catch {
    return false;
  }
}
