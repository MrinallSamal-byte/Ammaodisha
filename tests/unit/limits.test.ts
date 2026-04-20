import { canSubmitReport, getFingerprint, hasUpvoted, markUpvoted, recordSubmission } from "../../src/services/limits";

describe("local limits", () => {
  it("allows five reports per rolling day and blocks the sixth", () => {
    const now = new Date("2026-04-12T08:00:00Z").getTime();
    expect(canSubmitReport(now).allowed).toBe(true);

    for (let index = 0; index < 5; index += 1) recordSubmission(now - index * 1000);

    expect(canSubmitReport(now)).toEqual({ allowed: false, remaining: 0, total: 5 });
    expect(canSubmitReport(now + 86_400_001).allowed).toBe(true);
  });

  it("tracks the remaining count correctly as reports accumulate", () => {
    const now = new Date("2026-04-13T10:00:00Z").getTime();
    expect(canSubmitReport(now).remaining).toBe(5);
    recordSubmission(now);
    expect(canSubmitReport(now).remaining).toBe(4);
    recordSubmission(now + 1000);
    expect(canSubmitReport(now + 1000).remaining).toBe(3);
  });

  it("does not count submissions outside the 24-hour rolling window", () => {
    const now = new Date("2026-04-14T12:00:00Z").getTime();
    const oldSubmission = now - 86_400_001; // just over 24h ago
    recordSubmission(oldSubmission);
    expect(canSubmitReport(now).remaining).toBe(5);
  });

  it("persists upvote and anonymous fingerprint state", () => {
    const first = getFingerprint();
    const second = getFingerprint();
    expect(first).toBe(second);

    expect(hasUpvoted("report-1")).toBe(false);
    markUpvoted("report-1");
    expect(hasUpvoted("report-1")).toBe(true);
  });

  it("does not double-mark the same report upvote", () => {
    markUpvoted("report-2");
    markUpvoted("report-2"); // second call should be idempotent
    const stored = JSON.parse(localStorage.getItem("nk_upvotes") ?? "[]") as string[];
    expect(stored.filter((id) => id === "report-2")).toHaveLength(1);
  });
});
