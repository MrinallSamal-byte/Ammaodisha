import { csvFilename, reportsToCsv } from "../../src/services/export";
import type { GarbageReport, Ward } from "../../src/types/domain";

const baseReport: GarbageReport = {
  id: "r-1",
  latitude: 20.2961,
  longitude: 85.8245,
  ward_number: 40,
  address: "Near Unit 4 market",
  severity: "large",
  category: "mixed",
  status: "unresolved",
  created_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  upvote_count: 7
};

describe("reportsToCsv", () => {
  it("emits a header row and one line per report with a BOM prefix", () => {
    const csv = reportsToCsv([baseReport], []);
    const lines = csv.split("\r\n");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(lines[0]).toContain("id,created_at,ward_number");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("r-1");
    expect(lines[1]).toContain("large");
  });

  it("quotes cells containing commas, quotes and newlines", () => {
    const tricky: GarbageReport = { ...baseReport, address: 'Dump, "behind" \\n shop\nLane 2' };
    const csv = reportsToCsv([tricky], []);
    expect(csv).toContain('"Dump, ""behind"" \\n shop\nLane 2"');
  });

  it("resolves ward names from the wards list", () => {
    const wards = [{ ward_number: 40, ward_name: "Sahid Nagar" } as Ward];
    const csv = reportsToCsv([baseReport], wards);
    expect(csv).toContain("Sahid Nagar");
  });

  it("leaves ward_name empty for unknown wards", () => {
    const csv = reportsToCsv([baseReport], []);
    const line = csv.split("\r\n")[1];
    const cells = line.split(",");
    // ward_name is column index 3
    expect(cells[3]).toBe("");
  });

  it("neutralises spreadsheet formulas in user-controlled text", () => {
    const malicious: GarbageReport = { ...baseReport, address: '=HYPERLINK("https://evil.example","click")' };
    const csv = reportsToCsv([malicious], []);
    expect(csv).toContain(`"'=HYPERLINK(""https://evil.example"",""click"")"`);
  });

  it("reports days_open as the time it took to resolve cleaned reports", () => {
    const resolved: GarbageReport = {
      ...baseReport,
      status: "resolved",
      created_at: "2026-04-09T13:54:10.481Z",
      resolved_at: "2026-04-11T13:54:10.481Z"
    };
    const lines = reportsToCsv([resolved], []).split("\r\n");
    const headers = lines[0].split(",");
    const cells = lines[1].split(",");
    expect(cells[headers.indexOf("days_open")]).toBe("2");
  });

  it("produces a filename with a dash-free date stamp", () => {
    expect(csvFilename(new Date("2026-11-03T10:00:00Z"))).toBe("amma-odisha-reports-20261103.csv");
  });
});
