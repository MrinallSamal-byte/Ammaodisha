import { FINGERPRINT_KEY, MAX_REPORTS_PER_DAY, SPAM_KEY, UPVOTE_KEY } from "./constants";

export function getFingerprint() {
  let value = localStorage.getItem(FINGERPRINT_KEY);
  if (!value) {
    value = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(FINGERPRINT_KEY, value);
  }
  return value;
}

export function canSubmitReport(now = Date.now()) {
  try {
    const entries = JSON.parse(localStorage.getItem(SPAM_KEY) || "[]") as number[];
    const cutoff = now - 86_400_000;
    const recent = entries.filter((entry) => entry > cutoff);
    return { allowed: recent.length < MAX_REPORTS_PER_DAY, remaining: MAX_REPORTS_PER_DAY - recent.length, total: MAX_REPORTS_PER_DAY };
  } catch {
    return { allowed: true, remaining: MAX_REPORTS_PER_DAY, total: MAX_REPORTS_PER_DAY };
  }
}

export function recordSubmission(now = Date.now()) {
  const entries = JSON.parse(localStorage.getItem(SPAM_KEY) || "[]") as number[];
  const cutoff = now - 86_400_000;
  localStorage.setItem(SPAM_KEY, JSON.stringify([...entries.filter((entry) => entry > cutoff), now]));
}

export function hasUpvoted(reportId: string) {
  try {
    return (JSON.parse(localStorage.getItem(UPVOTE_KEY) || "[]") as string[]).includes(reportId);
  } catch {
    return false;
  }
}

export function markUpvoted(reportId: string) {
  const entries = JSON.parse(localStorage.getItem(UPVOTE_KEY) || "[]") as string[];
  if (!entries.includes(reportId)) {
    localStorage.setItem(UPVOTE_KEY, JSON.stringify([...entries, reportId]));
  }
}
