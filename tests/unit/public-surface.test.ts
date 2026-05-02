import type { isPublicReport as IsPublicReport } from "../../src/services/backend";

let isPublicReport: typeof IsPublicReport;

beforeAll(async () => {
  vi.stubEnv("VITE_LOCAL_ADMIN_KEY", "test-admin-key");
  ({ isPublicReport } = await import("../../src/services/backend"));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("public report surface", () => {
  it("only exposes approved reports publicly", () => {
    expect(isPublicReport({ moderation_status: "approved" })).toBe(true);
    expect(isPublicReport({ moderation_status: undefined })).toBe(true);
    expect(isPublicReport({ moderation_status: "flagged" })).toBe(false);
    expect(isPublicReport({ moderation_status: "rejected" })).toBe(false);
  });
});
