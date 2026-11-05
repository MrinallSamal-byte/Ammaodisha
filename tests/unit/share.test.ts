import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildReportShareText,
  generateBMCComplaint,
  getReportShareText,
  getWhatsAppUrl,
  shareOrCopy,
  shareReportViaWhatsApp
} from "../../src/services/share";
import type { GarbageReport, Representative, Ward } from "../../src/types/domain";

const NOW = new Date("2026-06-15T12:00:00.000Z");
const DAY = 86_400_000;

function setNavigatorProperty(name: "share" | "clipboard", value: unknown) {
  Object.defineProperty(window.navigator, name, { configurable: true, value });
}

function report(overrides: Partial<GarbageReport> = {}): GarbageReport {
  return {
    id: "report-1",
    latitude: 20.2961,
    longitude: 85.8245,
    ward_number: 31,
    address: "Near Master Canteen",
    severity: "medium",
    category: "mixed",
    status: "unresolved",
    upvote_count: 1,
    created_at: new Date(NOW.getTime() - 3 * DAY).toISOString(),
    ...overrides
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window.navigator, "share");
  Reflect.deleteProperty(window.navigator, "clipboard");
  Reflect.deleteProperty(document, "execCommand");
});

describe("generateBMCComplaint", () => {
  it("generates a BMC WhatsApp complaint with ward, severity, category, and photo", () => {
    const message = generateBMCComplaint({
      address: "Janpath Road",
      wardName: "Saheed Nagar",
      wardNumber: 31,
      severity: "small",
      category: "mixed",
      photoUrl: "https://example.com/photo.jpg",
      lat: 20.296,
      lng: 85.825
    });

    expect(message).toContain("Garbage Complaint — Ward #31, Saheed Nagar");
    expect(message).toContain("Severity: Minor");
    expect(message).toContain("Waste Type: Mixed Waste");
    expect(message).toContain("GPS: 20.2960, 85.8250");
    expect(message).toContain("Photo: https://example.com/photo.jpg");
    expect(message).toContain("Reported via Amma Odisha.");
    expect(getWhatsAppUrl(message)).toContain("https://wa.me/916742432100");
  });

  it("omits the photo line when no photo is available", () => {
    const message = generateBMCComplaint({
      address: "Janpath Road",
      wardName: "Saheed Nagar",
      wardNumber: 31,
      severity: "massive",
      category: "construction",
      photoUrl: null,
      lat: 20.2961,
      lng: 85.8245
    });

    expect(message).toContain("Severity: Critical");
    expect(message).toContain("Waste Type: Construction Debris");
    expect(message).not.toContain("Photo:");
  });

  it("URL-encodes the complaint for WhatsApp", () => {
    const url = getWhatsAppUrl("Line one\nLine two & more");
    expect(url).toContain("Line%20one%0ALine%20two%20%26%20more");
  });
});

describe("getReportShareText", () => {
  it("generates report share text with accountability", () => {
    const ward = { ward_name: "Ward 31" } as Ward;
    const mla = { name: "A. Citizen", party: "INC" } as Representative;

    const text = getReportShareText(report(), ward, mla, "https://ammaodisha.in");

    expect(text).toContain("Garbage dump at Near Master Canteen, Ward 31 — 3 days unresolved.");
    expect(text).toContain("MLA: A. Citizen (INC)");
    expect(text).toContain("Tracked on Amma Odisha → https://ammaodisha.in/report/report-1");
    expect(text).toContain("Report garbage in your ward → https://ammaodisha.in");
  });

  it("falls back to Bhubaneswar and unknown accountability when data is missing", () => {
    const text = getReportShareText(report(), undefined, undefined, "https://ammaodisha.in");

    expect(text).toContain("Garbage dump at Near Master Canteen, Bhubaneswar — 3 days unresolved.");
    expect(text).toContain("MLA: ? (?)");
  });

  it("describes resolved reports by cleanup age instead of unresolved age", () => {
    const resolved = report({
      created_at: "2026-01-01T00:00:00Z",
      resolved_at: "2026-01-07T00:00:00Z",
      status: "resolved"
    });

    const text = getReportShareText(resolved, undefined, undefined, "https://ammaodisha.in");

    expect(text).toContain("cleaned after 6 days");
    expect(text).not.toContain("days unresolved");
  });
});

describe("buildReportShareText", () => {
  it("includes location, translated severity, days open, and link", () => {
    const text = buildReportShareText(report({ severity: "large" }), "https://ammaodisha.in/report/report-1");

    expect(text).toBe(
      [
        "Location: Near Master Canteen",
        "Severity: Severe",
        "Days open: 3",
        "Link: https://ammaodisha.in/report/report-1"
      ].join("\n")
    );
  });

  it("counts resolution age for resolved reports", () => {
    const text = buildReportShareText(
      report({
        created_at: "2026-01-01T00:00:00Z",
        resolved_at: "2026-01-11T00:00:00Z",
        status: "resolved"
      }),
      "https://ammaodisha.in/report/report-1"
    );

    expect(text).toContain("Days open: 10");
  });
});

describe("shareReportViaWhatsApp", () => {
  it("opens WhatsApp with the share text and attribution", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    shareReportViaWhatsApp(report(), "https://ammaodisha.in/report/report-1");

    expect(open).toHaveBeenCalledTimes(1);
    const [url, target, features] = open.mock.calls[0] as [string, string, string];
    const message = decodeURIComponent(url.split("text=")[1]);
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(message).toContain("Location: Near Master Canteen");
    expect(message).toContain("Link: https://ammaodisha.in/report/report-1");
    expect(message).toContain("via Amma Odisha");
    expect(target).toBe("_blank");
    expect(features).toBe("noopener,noreferrer");
  });
});

describe("shareOrCopy", () => {
  it("uses the native share sheet when available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setNavigatorProperty("share", share);
    const data: ShareData = { title: "Garbage report", text: "Details", url: "https://ammaodisha.in/report/1" };

    await expect(shareOrCopy(data, "https://fallback.example")).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith(data);
  });

  it("treats a native share abort as a user cancellation", async () => {
    setNavigatorProperty("share", vi.fn().mockRejectedValue(new DOMException("Share cancelled", "AbortError")));

    await expect(shareOrCopy({ title: "Garbage report" }, "https://fallback.example")).resolves.toBe("cancelled");
  });

  it("rethrows unexpected native share failures instead of silently copying", async () => {
    const failure = new Error("Share target crashed");
    setNavigatorProperty("share", vi.fn().mockRejectedValue(failure));
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    setNavigatorProperty("clipboard", clipboard);

    await expect(shareOrCopy({ title: "Garbage report" }, "https://fallback.example")).rejects.toBe(failure);
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it("copies the report URL when the native share sheet is unavailable", async () => {
    setNavigatorProperty("share", undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigatorProperty("clipboard", { writeText });

    await expect(
      shareOrCopy({ title: "Garbage report", url: "https://ammaodisha.in/report/1" }, "https://fallback.example")
    ).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith("https://ammaodisha.in/report/1");
  });

  it("uses the fallback URL when share data has no URL", async () => {
    setNavigatorProperty("share", undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigatorProperty("clipboard", { writeText });

    await expect(shareOrCopy({ title: "Garbage report" }, "https://fallback.example")).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith("https://fallback.example");
  });

  it("falls back to execCommand copy when the Clipboard API is missing", async () => {
    setNavigatorProperty("share", undefined);
    setNavigatorProperty("clipboard", undefined);
    const execCommand = vi.fn((command: string) => {
      const textarea = document.querySelector("textarea");
      expect(command).toBe("copy");
      expect(textarea?.value).toBe("https://ammaodisha.in/report/1");
      expect(textarea?.readOnly).toBe(true);
      return true;
    });
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });

    await expect(
      shareOrCopy({ title: "Garbage report", url: "https://ammaodisha.in/report/1" }, "https://fallback.example")
    ).resolves.toBe("copied");
    expect(execCommand).toHaveBeenCalledTimes(1);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("reports a copy failure when execCommand rejects the copy", async () => {
    setNavigatorProperty("share", undefined);
    setNavigatorProperty("clipboard", undefined);
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => false) });

    await expect(shareOrCopy({ title: "Garbage report" }, "https://fallback.example")).rejects.toThrow(
      "Clipboard unavailable"
    );
    expect(document.querySelector("textarea")).toBeNull();
  });
});
