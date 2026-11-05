import { afterEach, describe, expect, it, vi } from "vitest";
import { canSubmitReport, getFingerprint, hasUpvoted, markUpvoted, recordSubmission } from "../../src/services/limits";

const DAY = 86_400_000;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("local limits", () => {
  it("allows five reports per rolling day and blocks the sixth", () => {
    const now = new Date("2026-04-12T08:00:00Z").getTime();
    expect(canSubmitReport(now).allowed).toBe(true);

    for (let index = 0; index < 5; index += 1) recordSubmission(now - index * 1000);

    expect(canSubmitReport(now)).toEqual({ allowed: false, remaining: 0, total: 5 });
    expect(canSubmitReport(now + DAY + 1).allowed).toBe(true);
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
    recordSubmission(now - DAY - 1); // just over 24h ago
    expect(canSubmitReport(now).remaining).toBe(5);
  });

  it("treats a submission exactly 24 hours old as expired", () => {
    const now = new Date("2026-04-14T12:00:00Z").getTime();
    recordSubmission(now - DAY);
    expect(canSubmitReport(now).remaining).toBe(5);
  });

  it("ignores corrupt submission history instead of blocking new reports", () => {
    const now = new Date("2026-04-15T12:00:00Z").getTime();
    localStorage.setItem("nk_report_times", "{not valid json");
    expect(canSubmitReport(now)).toEqual({ allowed: true, remaining: 5, total: 5 });

    recordSubmission(now);
    expect(JSON.parse(localStorage.getItem("nk_report_times") ?? "[]")).toEqual([now]);
  });

  it("ignores non-array submission history", () => {
    const now = new Date("2026-04-15T12:00:00Z").getTime();
    localStorage.setItem("nk_report_times", JSON.stringify({ at: now }));
    expect(canSubmitReport(now).remaining).toBe(5);
  });

  it("filters non-numeric submission entries", () => {
    const now = new Date("2026-04-16T12:00:00Z").getTime();
    localStorage.setItem("nk_report_times", JSON.stringify([now, now, now, now, "junk", null, true]));
    expect(canSubmitReport(now)).toEqual({ allowed: true, remaining: 1, total: 5 });
  });

  it("persists upvote and anonymous fingerprint state", () => {
    const first = getFingerprint();
    const second = getFingerprint();
    expect(first).toBe(second);

    expect(hasUpvoted("report-1")).toBe(false);
    markUpvoted("report-1");
    expect(hasUpvoted("report-1")).toBe(true);
  });

  it("reuses a stored fingerprint across module reloads", async () => {
    localStorage.setItem("nk_fp", "stored-fingerprint");
    vi.resetModules();
    const { getFingerprint: freshFingerprint } = await import("../../src/services/limits");
    expect(freshFingerprint()).toBe("stored-fingerprint");
  });

  it("falls back to an in-memory fingerprint when storage is blocked", async () => {
    vi.resetModules();
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    const { getFingerprint: freshFingerprint } = await import("../../src/services/limits");
    const first = freshFingerprint();
    const second = freshFingerprint();
    getItem.mockRestore();

    expect(typeof first).toBe("string");
    expect(first.length).toBeGreaterThan(0);
    expect(second).toBe(first);
  });

  it("keeps the fingerprint in memory when the initial write fails", async () => {
    vi.resetModules();
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue(null);
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    const { getFingerprint: freshFingerprint } = await import("../../src/services/limits");
    const first = freshFingerprint();
    const second = freshFingerprint();
    setItem.mockRestore();

    expect(second).toBe(first);
  });

  it("does not double-mark the same report upvote", () => {
    markUpvoted("report-2");
    markUpvoted("report-2"); // second call should be idempotent
    const stored = JSON.parse(localStorage.getItem("nk_upvotes") ?? "[]") as string[];
    expect(stored.filter((id) => id === "report-2")).toHaveLength(1);
  });

  it("ignores corrupt upvote history", () => {
    localStorage.setItem("nk_upvotes", "not-json");
    expect(hasUpvoted("report-3")).toBe(false);

    markUpvoted("report-3");
    expect(JSON.parse(localStorage.getItem("nk_upvotes") ?? "[]")).toEqual(["report-3"]);
  });

  it("filters non-string upvote entries", () => {
    localStorage.setItem("nk_upvotes", JSON.stringify(["report-4", 42, null, { id: "x" }]));
    expect(hasUpvoted("report-4")).toBe(true);
    expect(hasUpvoted("42")).toBe(false);
  });

  it("does not throw when a submission cannot be persisted", () => {
    const now = new Date("2026-04-17T12:00:00Z").getTime();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    expect(() => recordSubmission(now)).not.toThrow();
  });

  it("does not throw when an upvote cannot be persisted", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    expect(() => markUpvoted("report-5")).not.toThrow();
  });
});
