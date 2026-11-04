import { safeExternalUrl, sanitizeHandle } from "../../src/services/url";

describe("safeExternalUrl", () => {
  it("allows http and https URLs", () => {
    expect(safeExternalUrl("https://example.com/page")).toBe("https://example.com/page");
    expect(safeExternalUrl("http://example.com")).toBe("http://example.com");
    expect(safeExternalUrl("  https://example.com  ")).toBe("https://example.com");
  });

  it("rejects javascript:, data:, protocol-relative and plain-domain input", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("JaVaScRiPt:alert(1)")).toBeNull();
    expect(safeExternalUrl("data:text/html,<script>")).toBeNull();
    expect(safeExternalUrl("//example.com")).toBeNull();
    expect(safeExternalUrl("example.com")).toBeNull();
    expect(safeExternalUrl("")).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
  });
});

describe("sanitizeHandle", () => {
  it("strips leading @ signs", () => {
    expect(sanitizeHandle("@mla_naveen")).toBe("mla_naveen");
    expect(sanitizeHandle("@@double")).toBe("double");
  });

  it("removes characters X does not allow in handles", () => {
    expect(sanitizeHandle("naveen kumar!")).toBe("naveenkumar");
    expect(sanitizeHandle("naveen/party?ref=1")).toBe("naveenpartyref1");
    expect(sanitizeHandle("")).toBe("");
    expect(sanitizeHandle(null)).toBe("");
    expect(sanitizeHandle(undefined)).toBe("");
  });
});
