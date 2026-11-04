import { generateBMCComplaint, getReportShareText, getWhatsAppUrl } from "../../src/services/share";
import type { GarbageReport, Representative, Ward } from "../../src/types/domain";

describe("share helpers", () => {
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
    expect(getWhatsAppUrl(message)).toContain("https://wa.me/916742432100");
  });

  it("generates report share text with accountability", () => {
    const report = {
      id: "abc",
      address: "Near Master Canteen",
      created_at: new Date(Date.now() - 2 * 86_400_000).toISOString()
    } as GarbageReport;
    const ward = { ward_name: "Ward 31" } as Ward;
    const mla = { name: "A. Citizen", party: "INC" } as Representative;

    expect(getReportShareText(report, ward, mla, "https://ammaodisha.in")).toContain("MLA: A. Citizen (INC)");
    expect(getReportShareText(report, ward, mla, "https://ammaodisha.in")).toContain("→");
    expect(getReportShareText(report, ward, mla, "https://ammaodisha.in")).toContain("days unresolved");
  });

  it("marks resolved reports as cleaned instead of unresolved", () => {
    const resolvedReport = {
      id: "xyz",
      address: "Market Square",
      status: "resolved",
      created_at: new Date(Date.now() - 10 * 86_400_000).toISOString()
    } as GarbageReport;
    expect(getReportShareText(resolvedReport, undefined, undefined, "https://ammaodisha.in")).toContain("cleaned after 10 days");
  });

  it("uses the resolution time rather than the report age for cleaned reports", () => {
    const resolvedReport = {
      id: "xyz",
      address: "Market Square",
      status: "resolved",
      created_at: "2026-04-09T13:54:10.481Z",
      resolved_at: "2026-04-10T04:04:40.630Z"
    } as GarbageReport;
    expect(getReportShareText(resolvedReport, undefined, undefined, "https://ammaodisha.in")).toContain("cleaned after 0 days");
  });
});
