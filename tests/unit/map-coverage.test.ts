import { createCoverageData } from "../../src/services/map-coverage";
import type { CityBoundaryFeatureCollection, WardFeatureCollection } from "../../src/types/domain";

const lShapeRing: [number, number][] = [
  [0, 0],
  [2, 0],
  [2, 1],
  [1, 1],
  [1, 2],
  [0, 2],
  [0, 0]
];

const rectangleWardRing: [number, number][] = [
  [0, 0],
  [2, 0],
  [2, 2],
  [0, 2],
  [0, 0]
];

const cityBoundary: CityBoundaryFeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { Name: "BMC Boundary" },
      geometry: {
        type: "Polygon",
        coordinates: [lShapeRing]
      }
    }
  ]
};

const wardBoundaries: WardFeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        ward_number: 1,
        ward_name: "Ward 1",
        assembly_constituency: "A",
        parliamentary_constituency: "P"
      },
      geometry: {
        type: "Polygon",
        coordinates: [rectangleWardRing]
      }
    }
  ]
};

describe("createCoverageData", () => {
  it("uses the supplied city boundary geometry instead of a convex hull of ward extents", () => {
    const coverage = createCoverageData(wardBoundaries, cityBoundary);
    const border = coverage.border.features[0]?.geometry;
    const mask = coverage.mask.features[0]?.geometry;

    expect(border?.type).toBe("Polygon");
    expect(border?.coordinates[0]).toEqual(lShapeRing);
    expect(border?.coordinates[0]).toContainEqual([1, 1]);
    expect(mask?.coordinates[1]).toEqual([...lShapeRing].reverse());
    expect(coverage.bounds).toEqual([
      [0, 0],
      [2, 2]
    ]);
  });

  it("does not create a fake outline when city boundary data is unavailable", () => {
    const coverage = createCoverageData(wardBoundaries, { type: "FeatureCollection", features: [] });

    expect(coverage.border.features).toHaveLength(0);
    expect(coverage.mask.features).toHaveLength(0);
    expect(coverage.bounds).toEqual([
      [0, 0],
      [2, 2]
    ]);
  });
});
