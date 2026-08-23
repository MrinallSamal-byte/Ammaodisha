import { BMC_WHATSAPP, CATEGORIES, SEVERITY } from "./constants";
import type { GarbageReport, Representative, Ward } from "../types/domain";
import { daysActive } from "./time";

export function generateBMCComplaint(input: {
  address: string;
  wardName: string;
  wardNumber: number | string;
  severity: keyof typeof SEVERITY;
  category: keyof typeof CATEGORIES;
  photoUrl?: string | null;
  lat: number;
  lng: number;
}) {
  const severity = SEVERITY[input.severity]?.label ?? input.severity;
  const category = CATEGORIES[input.category] ?? input.category;
  return [
    `Garbage Complaint — Ward #${input.wardNumber}, ${input.wardName}`,
    "",
    `Location: ${input.address}`,
    `Ward: #${input.wardNumber} — ${input.wardName}`,
    `Severity: ${severity}`,
    `Waste Type: ${category}`,
    `GPS: ${input.lat.toFixed(4)}, ${input.lng.toFixed(4)}`,
    input.photoUrl ? `Photo: ${input.photoUrl}` : null,
    "",
    "Please arrange immediate cleanup and prevent repeat dumping at this location.",
    "Reported via Amma Odisha."
  ]
    .filter(Boolean)
    .join("\n");
}

export function getReportShareText(report: GarbageReport, ward?: Ward, mla?: Representative, origin = window.location.origin) {
  const url = `${origin}/report/${report.id}`;
  return `Garbage dump at ${report.address}, ${ward?.ward_name ?? "Bhubaneswar"} — ${daysActive(
    report.created_at
  )} days unresolved.
MLA: ${mla?.name ?? "?"} (${mla?.party ?? "?"})
Tracked on Amma Odisha → ${url}

Report garbage in your ward → ${origin}`;
}

export function getWhatsAppUrl(message: string) {
  return `https://wa.me/${BMC_WHATSAPP}?text=${encodeURIComponent(message)}`;
}

/** Compact per-report share text: location, severity, days open, link. */
export function buildReportShareText(report: GarbageReport, url: string) {
  const severity = SEVERITY[report.severity]?.label ?? report.severity;
  return [
    `Location: ${report.address}`,
    `Severity: ${severity}`,
    `Days open: ${daysActive(report.created_at)}`,
    `Link: ${url}`
  ].join("\n");
}

export function shareReportViaWhatsApp(report: GarbageReport, url: string) {
  const text = `${buildReportShareText(report, url)}\n\nvia Amma Odisha`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "true");
  input.style.position = "fixed";
  input.style.opacity = "0";
  input.style.pointerEvents = "none";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Clipboard unavailable");
}

export async function shareOrCopy(data: ShareData, fallbackUrl: string) {
  if (navigator.share) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      throw error;
    }
  }
  await copyText(data.url ?? fallbackUrl);
  return "copied";
}
