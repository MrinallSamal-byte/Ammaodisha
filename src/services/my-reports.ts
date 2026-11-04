import { LOCAL_REPORTS_KEY } from "./constants";
import type { GarbageReport } from "../types/domain";

/**
 * "My Reports" — the submissions this browser has filed. Supabase inserts are
 * mirrored into localStorage by the backend so citizens can find their own
 * reports even while they wait in the moderation queue (pending reports are
 * not exposed by the public view until approved).
 */

export type MyReportStatus = "pending" | "live" | "cleaned";

export interface MyReportEntry {
  report: GarbageReport;
  status: MyReportStatus;
}

function isReportLike(value: unknown): value is GarbageReport {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GarbageReport>;
  return typeof candidate.id === "string" && candidate.id.length > 0 && typeof candidate.created_at === "string";
}

export function readMyReports(): GarbageReport[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_REPORTS_KEY) || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isReportLike)
      .map((report) => ({ ...report, upvote_count: Number.isFinite(report.upvote_count) ? report.upvote_count : 1 }))
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  } catch {
    return [];
  }
}

export function removeMyReport(reportId: string): GarbageReport[] {
  const remaining = readMyReports().filter((report) => report.id !== reportId);
  try {
    localStorage.setItem(LOCAL_REPORTS_KEY, JSON.stringify(remaining));
  } catch {
    // Storage unavailable — nothing else we can do; the in-memory list still updates.
  }
  return remaining;
}

/**
 * Cross-check locally stored submissions against the reports currently
 * visible to the public. Approved reports appear in `publicReports`; a
 * flagged/pending report will not, which means "still in review".
 */
export function resolveMyReportEntries(publicReports: GarbageReport[], localReports: GarbageReport[]): MyReportEntry[] {
  const byId = new Map(publicReports.map((report) => [report.id, report]));
  return localReports.map((report) => {
    const live = byId.get(report.id);
    // `publicReports` can briefly contain a just-submitted flagged report
    // (prepended optimistically), so presence alone is not enough.
    if (!live || (live.moderation_status ?? "approved") !== "approved") {
      return { report: live ? { ...report, ...live } : report, status: "pending" as const };
    }
    if (live.status === "resolved") {
      return { report: { ...report, ...live }, status: "cleaned" as const };
    }
    return { report: { ...report, ...live }, status: "live" as const };
  });
}
