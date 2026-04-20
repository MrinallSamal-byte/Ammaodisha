import { FINGERPRINT_KEY, MAX_REPORTS_PER_DAY, SPAM_KEY, UPVOTE_KEY } from "./constants";

function readNumberArray(key: string) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is number => Number.isFinite(value)) : [];
  } catch {
    return [];
  }
}

function readStringArray(key: string) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function createFingerprint() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) return `fp-${Date.now().toString(36)}`;
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function getFingerprint() {
  let value = localStorage.getItem(FINGERPRINT_KEY);
  if (!value) {
    value = createFingerprint();
    localStorage.setItem(FINGERPRINT_KEY, value);
  }
  return value;
}

export function canSubmitReport(now = Date.now()) {
  const entries = readNumberArray(SPAM_KEY);
  const cutoff = now - 86_400_000;
  const recent = entries.filter((entry) => entry > cutoff);
  return { allowed: recent.length < MAX_REPORTS_PER_DAY, remaining: MAX_REPORTS_PER_DAY - recent.length, total: MAX_REPORTS_PER_DAY };
}

export function recordSubmission(now = Date.now()) {
  const entries = readNumberArray(SPAM_KEY);
  const cutoff = now - 86_400_000;
  try {
    localStorage.setItem(SPAM_KEY, JSON.stringify([...entries.filter((entry) => entry > cutoff), now]));
  } catch {
    // Ignore write failures (e.g. private mode/quota exceeded).
  }
}

export function hasUpvoted(reportId: string) {
  return readStringArray(UPVOTE_KEY).includes(reportId);
}

export function markUpvoted(reportId: string) {
  const entries = readStringArray(UPVOTE_KEY);
  if (!entries.includes(reportId)) {
    try {
      localStorage.setItem(UPVOTE_KEY, JSON.stringify([...entries, reportId]));
    } catch {
      // Ignore write failures (e.g. private mode/quota exceeded).
    }
  }
}
