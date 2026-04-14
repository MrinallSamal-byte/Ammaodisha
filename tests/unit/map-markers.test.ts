import { createMarkerPlacements } from "../../src/services/map-markers";
import type { GarbageReport } from "../../src/types/domain";
import type { WardFeatureCollection } from "../../src/types/domain";

function makeReport(id: string, latitude: number, longitude: number): GarbageReport {
  return {
    id,
    latitude,
    longitude,
    ward_number: 1,
    address: `Report ${id}`,
    severity: "medium",
    category: "mixed",
    status: "unresolved",
    location_source: "gps",
    upvote_count: 1,
    created_at: "2026-04-14T00:00:00.000Z"
  };
}

const boundaries: WardFeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        ward_number: 11,
        ward_name: "Ward 11",
        assembly_constituency: "A",
        parliamentary_constituency: "P"
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [85.82, 20.29],
            [85.83, 20.29],
            [85.83, 20.30],
            [85.82, 20.30],
            [85.82, 20.29]
          ]
        ]
      }
    }
  ]
};

describe("createMarkerPlacements", () => {
  it("returns one placement per report", () => {
    const reports = [
      makeReport("a", 20.2961, 85.8245),
      makeReport("b", 20.2962, 85.8246),
      makeReport("c", 20.2963, 85.8247)
    ];

    const placements = createMarkerPlacements(reports, boundaries);
    expect(placements).toHaveLength(reports.length);
  });

  it("spreads overlapping coordinates into unique marker positions", () => {
    const reports = [
      makeReport("a", 20.2961, 85.8245),
      makeReport("b", 20.2961, 85.8245),
      makeReport("c", 20.2961, 85.8245),
      makeReport("d", 20.2961, 85.8245)
    ];

    const placements = createMarkerPlacements(reports, boundaries);
    const uniqueCoordinates = new Set(
      placements.map((placement) => `${placement.latitude.toFixed(7)},${placement.longitude.toFixed(7)}`)
    );

    expect(uniqueCoordinates.size).toBe(placements.length);
  });

  it("skips invalid coordinates instead of creating broken markers", () => {
    const reports = [
      makeReport("a", 20.2961, 85.8245),
      makeReport("bad", Number.NaN, 85.8245),
      makeReport("also-bad", 20.2961, Number.POSITIVE_INFINITY)
    ];

    const placements = createMarkerPlacements(reports, boundaries);
    expect(placements).toHaveLength(1);
    expect(placements[0].report.id).toBe("a");
  });

  it("spreads ward-center reports by ward even when coordinates are the same anchor", () => {
    const reports = [
      { ...makeReport("a", 20.2961, 85.8245), ward_number: 11, location_source: "ward_center" as const },
      { ...makeReport("b", 20.2961, 85.8245), ward_number: 11, location_source: "ward_center" as const },
      { ...makeReport("c", 20.2961, 85.8245), ward_number: 11, location_source: "ward_center" as const },
      { ...makeReport("d", 20.2961, 85.8245), ward_number: 11, location_source: "ward_center" as const }
    ];

    const placements = createMarkerPlacements(reports, boundaries);
    const uniqueCoordinates = new Set(
      placements.map((placement) => `${placement.latitude.toFixed(7)},${placement.longitude.toFixed(7)}`)
    );

    expect(uniqueCoordinates.size).toBe(placements.length);
    placements.forEach((placement) => {
      expect(placement.latitude).toBeGreaterThanOrEqual(20.29);
      expect(placement.latitude).toBeLessThanOrEqual(20.30);
      expect(placement.longitude).toBeGreaterThanOrEqual(85.82);
      expect(placement.longitude).toBeLessThanOrEqual(85.83);
    });
  });
});
