import { canSubmitReport, getFingerprint, hasUpvoted, markUpvoted, recordSubmission } from "../../src/services/limits";

describe("local limits", () => {
  it("allows five reports per rolling day and blocks the sixth", () => {
    const now = new Date("2026-04-12T08:00:00Z").getTime();
    expect(canSubmitReport(now).allowed).toBe(true);

    for (let index = 0; index < 5; index += 1) recordSubmission(now - index * 1000);

    expect(canSubmitReport(now)).toEqual({ allowed: false, remaining: 0, total: 5 });
    expect(canSubmitReport(now + 86_400_001).allowed).toBe(true);
  });

  it("persists upvote and anonymous fingerprint state", () => {
    const first = getFingerprint();
    const second = getFingerprint();
    expect(first).toBe(second);

    expect(hasUpvoted("report-1")).toBe(false);
    markUpvoted("report-1");
    expect(hasUpvoted("report-1")).toBe(true);
  });
});
