import { BMC_WHATSAPP, CATEGORIES, SEVERITY } from "./constants";
import type { GarbageReport, Representative, Ward } from "../types/domain";
import { daysActive, daysToResolve } from "./time";

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
  const age = report.status === "resolved"
    ? daysToResolve(report.created_at, report.resolved_at)
    : daysActive(report.created_at);
  const statusLine = report.status === "resolved"
    ? `cleaned after ${age} days`
    : `${age} days unresolved`;
  return `Garbage dump at ${report.address}, ${ward?.ward_name ?? "Bhubaneswar"} — ${statusLine}.
MLA: ${mla?.name ?? "?"} (${mla?.party ?? "?"})
Tracked on Amma Odisha → ${url}

Report garbage in your ward → ${origin}`;
}

export function getWhatsAppUrl(message: string) {
  return `https://wa.me/${BMC_WHATSAPP}?text=${encodeURIComponent(message)}`;
}

export async function copyTextToClipboard(text: string) {
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

/**
 * Notify the shell that something was copied — PublicApp renders a transient
 * "Link copied" toast. Decoupled via a DOM event so deep components don't
 * need prop-drilled callbacks.
 */
export function notifyCopied() {
  try {
    window.dispatchEvent(new CustomEvent("amma:copied"));
  } catch {
    // Non-DOM environment (tests) — nothing to notify.
  }
}

export async function shareOrCopy(data: ShareData, fallbackUrl: string) {
  if (navigator.share) {
    await navigator.share(data);
    return "shared";
  }
  await copyTextToClipboard(data.url ?? fallbackUrl);
  notifyCopied();
  return "copied";
}
