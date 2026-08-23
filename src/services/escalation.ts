import { ESCALATION_THRESHOLDS } from "./constants";

export const ESCALATION_LABELS: readonly string[] = ["New", "Active", "Aging", "Stale", "Critical", "Emergency"];

/** Number of escalation thresholds a report has passed (0..ESCALATION_THRESHOLDS.length). */
export function escalationLevel(daysOpen: number): number {
  let level = 0;
  for (const threshold of ESCALATION_THRESHOLDS) {
    if (daysOpen >= threshold) level += 1;
    else break;
  }
  return level;
}
