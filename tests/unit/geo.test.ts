import { findNearestWard, findWardInGeoJson, pointInRing } from "../../src/services/geo";
import type { Ward, WardFeatureCollection } from "../../src/types/domain";

describe("geo helpers", () => {
  it("detects points inside a polygon ring", () => {
    const square: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0]
    ];
    expect(pointInRing([0.5, 0.5], square)).toBe(true);
    expect(pointInRing([2, 2], square)).toBe(false);
  });

  it("finds ward by GeoJSON boundary or nearest center", () => {
    const wards = [
      {
        ward_number: 1,
        ward_name: "One",
        zone: "A",
        assembly_constituency: "A",
        parliamentary_constituency: "P",
        center_lat: 0.5,
        center_lng: 0.5
      },
      {
        ward_number: 2,
        ward_name: "Two",
        zone: "B",
        assembly_constituency: "B",
        parliamentary_constituency: "P",
        center_lat: 10,
        center_lng: 10
      }
    ] satisfies Ward[];
    const boundaries: WardFeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { ward_number: 1, ward_name: "One", assembly_constituency: "A", parliamentary_constituency: "P" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
                [0, 0]
              ]
            ]
          }
        }
      ]
    };

    expect(findWardInGeoJson(0.5, 0.5, wards, boundaries)?.ward_number).toBe(1);
    expect(findNearestWard(9.8, 9.8, wards)?.ward_number).toBe(2);
  });
});
