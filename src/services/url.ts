/**
 * URL safety helpers for rendering externally supplied links.
 * Only http(s) URLs may become clickable anchors; anything else
 * (e.g. `javascript:`) is dropped. Social handles are reduced to the
 * characters X allows.
 */

export function safeExternalUrl(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

export function sanitizeHandle(value?: string | null): string {
  return (value ?? "").replace(/^@+/, "").replace(/[^A-Za-z0-9_]/g, "");
}
