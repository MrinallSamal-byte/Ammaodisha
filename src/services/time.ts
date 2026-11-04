export function daysActive(createdAt: string): number {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return 0;
  return Math.max(0, Math.floor((Date.now() - created) / 86_400_000));
}

/**
 * Days a report stayed open: creation → resolution. Falls back to days since
 * creation when the report is unresolved or `resolved_at` is missing/invalid.
 */
export function daysToResolve(createdAt: string, resolvedAt?: string | null): number {
  if (!resolvedAt) return daysActive(createdAt);
  const created = new Date(createdAt).getTime();
  const resolved = new Date(resolvedAt).getTime();
  if (Number.isNaN(created) || Number.isNaN(resolved)) return daysActive(createdAt);
  return Math.max(0, Math.floor((resolved - created) / 86_400_000));
}

export function timeAgo(createdAt: string): string {
  const diff = Math.max(0, Date.now() - new Date(createdAt).getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/** Returns a short absolute date string like "Apr 5" or "Apr 5, 2024" for older dates. */
export function shortDate(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric"
  });
}
