import { buildViewParams, loadPrefs, parseViewParams, sanitizePrefs, savePrefs } from "../../src/services/prefs";

describe("sanitizePrefs", () => {
  it("keeps only known, well-typed values", () => {
    expect(
      sanitizePrefs({
        viewMode: "list",
        sortBy: "upvotes",
        severityFilter: "massive",
        statusFilter: "resolved",
        staleOnly: true,
        lastVisitAt: "2026-11-01T00:00:00.000Z"
      })
    ).toEqual({
      viewMode: "list",
      sortBy: "upvotes",
      severityFilter: "massive",
      statusFilter: "resolved",
      staleOnly: true,
      lastVisitAt: "2026-11-01T00:00:00.000Z"
    });
  });

  it("drops invalid values instead of trusting them", () => {
    expect(
      sanitizePrefs({
        viewMode: "grid",
        sortBy: "popularity",
        severityFilter: "apocalyptic",
        statusFilter: "maybe",
        staleOnly: "yes",
        lastVisitAt: "not a date"
      })
    ).toEqual({});
    expect(sanitizePrefs(null)).toEqual({});
    expect(sanitizePrefs("junk")).toEqual({});
    expect(sanitizePrefs(42)).toEqual({});
  });
});

describe("loadPrefs/savePrefs", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips preferences through localStorage", () => {
    savePrefs({ viewMode: "list", staleOnly: true });
    expect(loadPrefs()).toEqual({ viewMode: "list", staleOnly: true });
  });

  it("merges partial updates with stored values", () => {
    savePrefs({ viewMode: "list", sortBy: "oldest" });
    savePrefs({ staleOnly: true });
    expect(loadPrefs()).toEqual({ viewMode: "list", sortBy: "oldest", staleOnly: true });
  });

  it("survives corrupt stored JSON", () => {
    localStorage.setItem("nk_prefs", "{not json");
    expect(loadPrefs()).toEqual({});
  });
});

describe("parseViewParams", () => {
  it("accepts valid values", () => {
    expect(parseViewParams("?ward=40&severity=massive&status=unresolved&q=unit+4", [40])).toEqual({
      ward: 40,
      severity: "massive",
      status: "unresolved",
      q: "unit 4"
    });
  });

  it("restores the Open 30+ days filter", () => {
    expect(parseViewParams("?status=unresolved&stale=1")).toEqual({ status: "unresolved", stale: true });
  });

  it("drops a stale flag on a resolved link", () => {
    expect(parseViewParams("?status=resolved&stale=1")).toEqual({ status: "resolved" });
  });

  it("rejects wards not in the known list", () => {
    expect(parseViewParams("?ward=999", [40])).toEqual({});
    expect(parseViewParams("?ward=abc")).toEqual({});
  });

  it("rejects out-of-range and junk scalars", () => {
    expect(parseViewParams("?ward=0")).toEqual({});
    expect(parseViewParams("?ward=1000")).toEqual({});
    expect(parseViewParams("?severity=critical")).toEqual({});
    expect(parseViewParams("?status=unknown")).toEqual({});
  });

  it("ignores default-ish and blank params", () => {
    expect(parseViewParams("?severity=all&status=all&q=")).toEqual({});
  });

  it("caps oversized search queries", () => {
    const long = "a".repeat(500);
    expect(parseViewParams(`?q=${long}`).q).toHaveLength(120);
  });
});

describe("buildViewParams", () => {
  it("omits defaults to keep shared links clean", () => {
    expect(buildViewParams({})).toBe("");
    expect(buildViewParams({ ward: null, severity: "all", status: "all", q: "   " })).toBe("");
  });

  it("serializes the active filters", () => {
    expect(buildViewParams({ ward: 40, severity: "massive", status: "unresolved", stale: true, q: "unit 4" })).toBe(
      "ward=40&severity=massive&status=unresolved&stale=1&q=unit+4"
    );
  });

  it("never emits a stale flag with a resolved status", () => {
    expect(buildViewParams({ status: "resolved", stale: true })).toBe("status=resolved");
  });
});
