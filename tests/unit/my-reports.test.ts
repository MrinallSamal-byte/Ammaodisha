import { readMyReports, removeMyReport, resolveMyReportEntries } from "../../src/services/my-reports";
import { LOCAL_REPORTS_KEY } from "../../src/services/constants";
import type { GarbageReport } from "../../src/types/domain";

const NOW = Date.now();

const mine = (id: string, createdOffsetDays = 0): GarbageReport => ({
  id,
  latitude: 20.29,
  longitude: 85.82,
  ward_number: 40,
  address: `Spot ${id}`,
  severity: "medium",
  category: "mixed",
  status: "unresolved",
  created_at: new Date(NOW - createdOffsetDays * 86_400_000).toISOString(),
  upvote_count: 1,
  moderation_status: "flagged"
});

const live = (id: string, status: "unresolved" | "resolved"): GarbageReport => ({
  ...mine(id),
  moderation_status: "approved",
  status
});

describe("my-reports storage", () => {
  beforeEach(() => localStorage.clear());

  it("returns an empty list for missing or corrupt storage", () => {
    expect(readMyReports()).toEqual([]);
    localStorage.setItem(LOCAL_REPORTS_KEY, "{oops");
    expect(readMyReports()).toEqual([]);
    localStorage.setItem(LOCAL_REPORTS_KEY, '[{"noId": true}]');
    expect(readMyReports()).toEqual([]);
  });

  it("drops malformed entries and sorts newest first", () => {
    localStorage.setItem(
      LOCAL_REPORTS_KEY,
      JSON.stringify([mine("old", 10), mine("new", 1), { broken: true }])
    );
    expect(readMyReports().map((report) => report.id)).toEqual(["new", "old"]);
  });

  it("removes only the targeted report", () => {
    localStorage.setItem(LOCAL_REPORTS_KEY, JSON.stringify([mine("a"), mine("b"), mine("c")]));
    const remaining = removeMyReport("b").map((report) => report.id);
    expect(remaining).toEqual(["a", "c"]);
    expect(readMyReports().map((report) => report.id)).toEqual(["a", "c"]);
  });
});

describe("resolveMyReportEntries", () => {
  beforeEach(() => localStorage.clear());

  it("marks submissions that are not publicly visible as pending", () => {
    const entries = resolveMyReportEntries([], [mine("mine-1")]);
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("pending");
  });

  it("keeps a report pending when only a flagged copy is present", () => {
    const flaggedCopy = { ...mine("mine-1"), moderation_status: "flagged" as const };
    const entries = resolveMyReportEntries([flaggedCopy], [mine("mine-1")]);
    expect(entries[0].status).toBe("pending");
  });

  it("marks visible unresolved reports as live and resolved ones as cleaned", () => {
    const entries = resolveMyReportEntries([live("mine-1", "unresolved"), live("mine-2", "resolved")], [mine("mine-1"), mine("mine-2")]);
    expect(entries.find((entry) => entry.report.id === "mine-1")?.status).toBe("live");
    expect(entries.find((entry) => entry.report.id === "mine-2")?.status).toBe("cleaned");
  });
});
