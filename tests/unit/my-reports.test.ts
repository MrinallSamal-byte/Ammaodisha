import { beforeEach, describe, expect, it } from "vitest";
import { getMyReports, isMyReport, trackMyReport } from "../../src/services/my-reports";

const HOUR = 60 * 60 * 1000;

function entry(id: string, hoursAgo: number) {
  return {
    id,
    title: `Dump near ${id}`,
    address: `Unit ${id}, Bhubaneswar`,
    createdAt: new Date(Date.now() - hoursAgo * HOUR).toISOString()
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("trackMyReport / getMyReports", () => {
  it("returns an empty list when nothing is tracked", () => {
    expect(getMyReports()).toEqual([]);
  });

  it("tracks and returns reports newest first", () => {
    trackMyReport(entry("old", 10));
    trackMyReport(entry("new", 1));
    trackMyReport(entry("mid", 5));

    const reports = getMyReports();
    expect(reports.map((report) => report.id)).toEqual(["new", "mid", "old"]);
  });

  it("keeps every stored field intact", () => {
    const report = entry("r1", 0);
    trackMyReport(report);
    expect(getMyReports()[0]).toMatchObject(report);
  });

  it("de-duplicates by id on re-track and moves it to the front", () => {
    trackMyReport(entry("a", 5));
    trackMyReport(entry("b", 2));
    trackMyReport({ ...entry("a", 0), title: "Updated dump" });

    const reports = getMyReports();
    expect(reports).toHaveLength(2);
    expect(reports[0].id).toBe("a");
    expect(reports[0].title).toBe("Updated dump");
  });

  it("caps the registry at 50 entries", () => {
    for (let index = 0; index < 60; index += 1) {
      trackMyReport(entry(`r${index}`, index));
    }
    const reports = getMyReports();
    expect(reports).toHaveLength(50);
    // r0..r9 are evicted as newer reports arrive; r10 is the newest survivor.
    expect(reports[0].id).toBe("r10");
    expect(reports[49].id).toBe("r59");
  });
});

describe("isMyReport", () => {
  it("recognizes tracked report ids only", () => {
    trackMyReport(entry("mine", 0));
    expect(isMyReport("mine")).toBe(true);
    expect(isMyReport("someone-else")).toBe(false);
  });

  it("returns false when the registry is missing", () => {
    expect(isMyReport("anything")).toBe(false);
  });
});

describe("corrupt storage tolerance", () => {
  it("treats invalid JSON as an empty registry", () => {
    localStorage.setItem("ao_my_reports", "{not valid json");
    expect(getMyReports()).toEqual([]);
    expect(isMyReport("x")).toBe(false);
  });

  it("treats non-array JSON as an empty registry", () => {
    localStorage.setItem("ao_my_reports", JSON.stringify({ id: "nope" }));
    expect(getMyReports()).toEqual([]);
  });

  it("drops malformed entries but keeps well-formed ones", () => {
    localStorage.setItem(
      "ao_my_reports",
      JSON.stringify([entry("good", 1), { id: 42 }, null, "junk"])
    );
    const reports = getMyReports();
    expect(reports).toHaveLength(1);
    expect(reports[0].id).toBe("good");
  });
});
