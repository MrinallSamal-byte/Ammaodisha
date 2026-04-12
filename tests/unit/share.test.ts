import { generateBBMPComplaint, getReportShareText, getWhatsAppUrl } from "../../src/services/share";
import type { GarbageReport, Representative, Ward } from "../../src/types/domain";

describe("share helpers", () => {
  it("generates a BBMP WhatsApp complaint with ward, severity, category, and photo", () => {
    const message = generateBBMPComplaint({
      address: "Banaswadi flyover",
      wardName: "Maruthi Seva Nagar",
      wardNumber: 102,
      severity: "small",
      category: "mixed",
      photoUrl: "https://example.com/photo.jpg",
      lat: 13.008,
      lng: 77.623
    });

    expect(message).toContain("Garbage Complaint — Ward #102, Maruthi Seva Nagar");
    expect(message).toContain("Severity: Minor");
    expect(message).toContain("Waste Type: Mixed Waste");
    expect(getWhatsAppUrl(message)).toContain("https://wa.me/919448197197");
  });

  it("generates report share text with accountability", () => {
    const report = {
      id: "abc",
      address: "Opp RMZ millenia",
      created_at: new Date(Date.now() - 2 * 86_400_000).toISOString()
    } as GarbageReport;
    const ward = { ward_name: "Benniganahalli" } as Ward;
    const mla = { name: "A. Citizen", party: "INC" } as Representative;

    expect(getReportShareText(report, ward, mla, "https://nammakasa.in")).toContain("MLA: A. Citizen (INC)");
  });
});
