import { describe, expect, it } from "vitest";
import { findNearbyReports } from "../../src/services/duplicate-check";
import type { NearbyCandidate } from "../../src/services/duplicate-check";

// ~0.0009° of latitude ≈ 100 m in Bhubaneswar.
const BASE = { lat: 20.2961, lng: 85.8245 };

function candidate(
  id: string,
  lat: number,
  lng: number,
  status: NearbyCandidate["status"] = "unresolved",
  moderationStatus?: NearbyCandidate["moderation_status"]
): NearbyCandidate {
  return { id, latitude: lat, longitude: lng, status, moderation_status: moderationStatus };
}

describe("findNearbyReports", () => {
  it("returns an empty array for empty input", () => {
    expect(findNearbyReports([], BASE.lat, BASE.lng)).toEqual([]);
  });

  it("matches a report at the exact same coordinates", () => {
    const matches = findNearbyReports([candidate("same", BASE.lat, BASE.lng)], BASE.lat, BASE.lng);
    expect(matches).toHaveLength(1);
    expect(matches[0].report.id).toBe("same");
    expect(matches[0].distanceMeters).toBe(0);
  });

  it("includes reports within the default 100m radius", () => {
    // ~55 m north of base.
    const nearby = candidate("near", BASE.lat + 0.0005, BASE.lng);
    expect(findNearbyReports([nearby], BASE.lat, BASE.lng)).toHaveLength(1);
  });

  it("excludes reports outside the radius", () => {
    // ~5.5 km north of base.
    const far = candidate("far", BASE.lat + 0.05, BASE.lng);
    expect(findNearbyReports([far], BASE.lat, BASE.lng)).toEqual([]);
  });

  it("honors a custom radius", () => {
    const near = candidate("near", BASE.lat + 0.0005, BASE.lng);
    const far = candidate("far", BASE.lat + 0.0045, BASE.lng);

    expect(findNearbyReports([near, far], BASE.lat, BASE.lng, 60).map((match) => match.report.id)).toEqual(["near"]);
    expect(findNearbyReports([near, far], BASE.lat, BASE.lng, 600).map((match) => match.report.id)).toEqual(["near", "far"]);
  });

  it("excludes resolved (cleaned) reports", () => {
    const resolved = candidate("resolved", BASE.lat, BASE.lng, "resolved");
    expect(findNearbyReports([resolved], BASE.lat, BASE.lng)).toEqual([]);
  });

  it("excludes flagged reports from duplicate matching", () => {
    const flagged = candidate("flagged", BASE.lat, BASE.lng, "unresolved", "flagged");
    expect(findNearbyReports([flagged], BASE.lat, BASE.lng)).toEqual([]);
  });

  it("excludes rejected reports but keeps approved ones", () => {
    const rejected = candidate("rejected", BASE.lat + 0.0001, BASE.lng, "unresolved", "rejected");
    const approved = candidate("approved", BASE.lat + 0.0002, BASE.lng, "unresolved", "approved");
    expect(findNearbyReports([rejected, approved], BASE.lat, BASE.lng).map((match) => match.report.id)).toEqual(["approved"]);
  });

  it("sorts matches by distance ascending", () => {
    const mid = candidate("mid", BASE.lat + 0.0007, BASE.lng);
    const close = candidate("close", BASE.lat + 0.0002, BASE.lng);
    const nearer = candidate("nearer", BASE.lat + 0.0001, BASE.lng);

    const ids = findNearbyReports([mid, close, nearer], BASE.lat, BASE.lng).map((match) => match.report.id);
    expect(ids).toEqual(["nearer", "close", "mid"]);
  });
});
