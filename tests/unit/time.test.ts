import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  daysActive,
  daysToResolve,
  shortDate,
  shortDateI18n,
  timeAgo,
  timeAgoI18n
} from "../../src/services/time";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date("2026-06-15T12:00:00.000Z");

function isoAgo(offsetMs: number): string {
  return new Date(NOW.getTime() - offsetMs).toISOString();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("daysActive", () => {
  it("returns 0 for a just-created report", () => {
    expect(daysActive(NOW.toISOString())).toBe(0);
  });

  it("counts full days elapsed", () => {
    expect(daysActive(isoAgo(3 * DAY))).toBe(3);
  });

  it("rounds down partial days", () => {
    expect(daysActive(isoAgo(3 * DAY + 23 * HOUR))).toBe(3);
  });

  it("returns 0 for an invalid date string", () => {
    expect(daysActive("not-a-date")).toBe(0);
  });

  it("never returns a negative number", () => {
    expect(daysActive(new Date(NOW.getTime() + 2 * DAY).toISOString())).toBe(0);
  });
});

describe("daysToResolve", () => {
  it("counts full days between creation and resolution", () => {
    expect(daysToResolve("2026-01-01T00:00:00Z", "2026-01-07T00:00:00Z")).toBe(6);
  });

  it("falls back to days since creation when unresolved", () => {
    expect(daysToResolve(isoAgo(3 * DAY))).toBe(3);
  });

  it("falls back to days since creation when resolved_at is invalid", () => {
    expect(daysToResolve(isoAgo(3 * DAY), "not-a-date")).toBe(3);
  });

  it("never returns a negative number when resolved before creation", () => {
    expect(daysToResolve("2026-01-07T00:00:00Z", "2026-01-01T00:00:00Z")).toBe(0);
  });
});

describe("timeAgo", () => {
  it('returns "just now" for sub-minute events', () => {
    expect(timeAgo(isoAgo(30_000))).toBe("just now");
  });

  it("formats minutes correctly", () => {
    expect(timeAgo(isoAgo(5 * 60 * 1000))).toBe("5m ago");
  });

  it("switches from minutes to hours at sixty minutes", () => {
    expect(timeAgo(isoAgo(59 * 60 * 1000))).toBe("59m ago");
    expect(timeAgo(isoAgo(60 * 60 * 1000))).toBe("1h ago");
  });

  it("formats hours correctly", () => {
    expect(timeAgo(isoAgo(3 * HOUR))).toBe("3h ago");
  });

  it('returns "yesterday" for 1+ day ago', () => {
    expect(timeAgo(isoAgo(1 * DAY + 60_000))).toBe("yesterday");
  });

  it("formats days correctly", () => {
    expect(timeAgo(isoAgo(10 * DAY))).toBe("10d ago");
  });

  it("formats months correctly", () => {
    expect(timeAgo(isoAgo(45 * DAY))).toBe("1mo ago");
  });

  it("formats years correctly", () => {
    expect(timeAgo(isoAgo(400 * DAY))).toBe("1y ago");
  });
});

describe("timeAgoI18n", () => {
  const t = (key: string, vars?: Record<string, string | number>) =>
    vars && "count" in vars ? `${key}=${vars.count}` : key;

  it("uses translated keys for every relative-time bucket", () => {
    expect(timeAgoI18n(isoAgo(30_000), t)).toBe("time.justNow");
    expect(timeAgoI18n(isoAgo(5 * 60 * 1000), t)).toBe("units.minutesAgo=5");
    expect(timeAgoI18n(isoAgo(3 * HOUR), t)).toBe("units.hoursAgo=3");
    expect(timeAgoI18n(isoAgo(DAY + 60_000), t)).toBe("time.yesterday");
    expect(timeAgoI18n(isoAgo(10 * DAY), t)).toBe("units.daysAgo=10");
  });

  it("keeps day counts beyond a year instead of switching to years", () => {
    expect(timeAgoI18n(isoAgo(400 * DAY), t)).toBe("units.daysAgo=400");
  });

  it("accepts dates and timestamps", () => {
    expect(timeAgoI18n(new Date(NOW.getTime() - 2 * HOUR), t)).toBe("units.hoursAgo=2");
    expect(timeAgoI18n(NOW.getTime() - 2 * 60 * 1000, t)).toBe("units.minutesAgo=2");
  });

  it("clamps future timestamps to just now", () => {
    expect(timeAgoI18n(new Date(NOW.getTime() + DAY), t)).toBe("time.justNow");
  });
});

describe("shortDate", () => {
  it("returns empty string for invalid input", () => {
    expect(shortDate("garbage")).toBe("");
  });

  it("omits the year for dates in the current year", () => {
    const date = new Date("2026-04-05T12:00:00Z");
    const expected = date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    expect(shortDate(date.toISOString())).toBe(expected);
  });

  it("includes the year for dates in past years", () => {
    const date = new Date("2023-06-01T12:00:00Z");
    const expected = date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    expect(shortDate(date.toISOString())).toBe(expected);
  });
});

describe("shortDateI18n", () => {
  const t = (key: string) => key.replace("months.", "");

  it("returns empty string for invalid input", () => {
    expect(shortDateI18n("garbage", t)).toBe("");
    expect(shortDateI18n(Number.NaN, t)).toBe("");
  });

  it("translates the month and omits the year in the current year", () => {
    const date = new Date("2026-04-05T12:00:00Z");
    const month = date.toLocaleDateString("en-IN", { month: "short" }).toLowerCase();
    expect(shortDateI18n(date, t)).toBe(`${month} 5`);
  });

  it("includes the year for dates in past years", () => {
    const date = new Date("2023-06-01T12:00:00Z");
    const month = date.toLocaleDateString("en-IN", { month: "short" }).toLowerCase();
    expect(shortDateI18n(date, t)).toBe(`${month} 1, 2023`);
  });

  it("accepts timestamps", () => {
    const date = new Date("2026-04-05T12:00:00Z");
    const month = date.toLocaleDateString("en-IN", { month: "short" }).toLowerCase();
    expect(shortDateI18n(date.getTime(), t)).toBe(`${month} 5`);
  });
});
