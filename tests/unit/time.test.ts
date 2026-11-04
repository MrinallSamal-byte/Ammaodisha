import { daysActive, daysToResolve, shortDate, timeAgo } from "../../src/services/time";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("daysActive", () => {
  it("returns 0 for a just-created report", () => {
    expect(daysActive(new Date().toISOString())).toBe(0);
  });

  it("counts full days elapsed", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * DAY).toISOString();
    expect(daysActive(threeDaysAgo)).toBe(3);
  });

  it("returns 0 for an invalid date string", () => {
    expect(daysActive("not-a-date")).toBe(0);
  });

  it("never returns a negative number", () => {
    const future = new Date(Date.now() + 2 * DAY).toISOString();
    expect(daysActive(future)).toBe(0);
  });
});

describe("daysToResolve", () => {
  it("counts full days between creation and resolution", () => {
    expect(daysToResolve("2026-01-01T00:00:00Z", "2026-01-07T00:00:00Z")).toBe(6);
  });

  it("falls back to days since creation when unresolved", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * DAY).toISOString();
    expect(daysToResolve(threeDaysAgo)).toBe(3);
  });

  it("falls back to days since creation when resolved_at is invalid", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * DAY).toISOString();
    expect(daysToResolve(threeDaysAgo, "not-a-date")).toBe(3);
  });

  it("never returns a negative number when resolved before creation", () => {
    expect(daysToResolve("2026-01-07T00:00:00Z", "2026-01-01T00:00:00Z")).toBe(0);
  });
});

describe("timeAgo", () => {
  it('returns "just now" for sub-minute events', () => {
    expect(timeAgo(new Date(Date.now() - 30_000).toISOString())).toBe("just now");
  });

  it("formats minutes correctly", () => {
    expect(timeAgo(new Date(Date.now() - 5 * 60 * 1000).toISOString())).toBe("5m ago");
  });

  it("formats hours correctly", () => {
    expect(timeAgo(new Date(Date.now() - 3 * HOUR).toISOString())).toBe("3h ago");
  });

  it('returns "yesterday" for 1+ day ago', () => {
    expect(timeAgo(new Date(Date.now() - 1 * DAY - 60_000).toISOString())).toBe("yesterday");
  });

  it("formats days correctly", () => {
    expect(timeAgo(new Date(Date.now() - 10 * DAY).toISOString())).toBe("10d ago");
  });

  it("formats months correctly", () => {
    expect(timeAgo(new Date(Date.now() - 45 * DAY).toISOString())).toBe("1mo ago");
  });

  it("formats years correctly", () => {
    expect(timeAgo(new Date(Date.now() - 400 * DAY).toISOString())).toBe("1y ago");
  });
});

describe("shortDate", () => {
  it("returns empty string for invalid input", () => {
    expect(shortDate("garbage")).toBe("");
  });

  it("omits the year for dates in the current year", () => {
    const thisYear = new Date();
    thisYear.setMonth(0);
    thisYear.setDate(15);
    const result = shortDate(thisYear.toISOString());
    expect(result).not.toContain(String(thisYear.getFullYear()));
    expect(result).toMatch(/\d/);
  });

  it("includes the year for dates in past years", () => {
    expect(shortDate("2023-06-01T00:00:00Z")).toContain("2023");
  });
});
