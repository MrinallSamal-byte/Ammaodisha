import { daysToResolve } from "./time";
import type { GarbageReport, Ward } from "../types/domain";

/**
 * CSV export of the current (filtered) report view. Built for RTI filings,
 * BMC follow-ups and journalists: one row per report, RFC-4180 quoting,
 * UTF-8 BOM so Excel renders ward names correctly on Windows.
 */

const EXPORT_COLUMNS = [
  "id",
  "created_at",
  "ward_number",
  "ward_name",
  "address",
  "severity",
  "category",
  "status",
  "upvote_count",
  "days_open",
  "latitude",
  "longitude",
  "resolved_at",
  "photo_url"
] as const;

function escapeCell(value: unknown): string {
  if (value == null) return "";
  let text = String(value);
  // Neutralise spreadsheet formula injection from user-controlled text
  // (address, photo URL) while leaving numeric cells untouched.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  // Quote when the cell contains a comma, quote, or line break; double inner quotes.
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function reportsToCsv(reports: GarbageReport[], wards: Ward[] = []): string {
  const wardNames = new Map(wards.map((ward) => [ward.ward_number, ward.ward_name]));
  const lines = [EXPORT_COLUMNS.join(",")];
  for (const report of reports) {
    const row: Record<(typeof EXPORT_COLUMNS)[number], unknown> = {
      id: report.id,
      created_at: report.created_at,
      ward_number: report.ward_number,
      ward_name: wardNames.get(report.ward_number) ?? "",
      address: report.address,
      severity: report.severity,
      category: report.category,
      status: report.status,
      upvote_count: report.upvote_count ?? 1,
      days_open: daysToResolve(report.created_at, report.resolved_at),
      latitude: report.latitude,
      longitude: report.longitude,
      resolved_at: report.resolved_at ?? "",
      photo_url: report.photo_url ?? ""
    };
    lines.push(EXPORT_COLUMNS.map((column) => escapeCell(row[column])).join(","));
  }
  // BOM prefix for Excel compatibility.
  return `\uFEFF${lines.join("\r\n")}`;
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function csvFilename(date = new Date()): string {
  const stamp = date.toISOString().slice(0, 10).replace(/-/g, "");
  return `amma-odisha-reports-${stamp}.csv`;
}
