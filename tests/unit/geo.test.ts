import {
  distanceKm,
  findNearestWard,
  findWardInGeoJson,
  isInsideBoundary,
  pointInRing
} from "../../src/services/geo";
import type { CityBoundaryFeatureCollection, Ward, WardFeatureCollection } from "../../src/types/domain";

function square(minX: number, minY: number, maxX: number, maxY: number): [number, number][] {
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
    [minX, minY]
  ];
}

function ward(wardNumber: number, centerLat: number, centerLng: number): Ward {
  return {
    ward_number: wardNumber,
    ward_name: `Ward ${wardNumber}`,
    zone: "A",
    assembly_constituency: "A",
    parliamentary_constituency: "P",
    center_lat: centerLat,
    center_lng: centerLng
  };
}

const cityWithHole: CityBoundaryFeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { Name: "Main city" },
      geometry: {
        type: "Polygon",
        coordinates: [square(0, 0, 4, 4), square(1, 1, 3, 3)]
      }
    },
    {
      type: "Feature",
      properties: { Name: "Satellite ward" },
      geometry: {
        type: "MultiPolygon",
        coordinates: [[square(10, 0, 12, 2)], [square(14, 0, 16, 2)]]
      }
    }
  ]
};

describe("pointInRing", () => {
  it("detects points inside and outside a polygon ring", () => {
    const ring = square(0, 0, 1, 1);
    expect(pointInRing([0.5, 0.5], ring)).toBe(true);
    expect(pointInRing([2, 2], ring)).toBe(false);
  });

  it("returns false for an empty ring", () => {
    expect(pointInRing([0, 0], [])).toBe(false);
  });

  it("rejects points that sit outside a concave notch", () => {
    const lShape: [number, number][] = [
      [0, 0],
      [2, 0],
      [2, 1],
      [1, 1],
      [1, 2],
      [0, 2],
      [0, 0]
    ];
    expect(pointInRing([0.5, 1.5], lShape)).toBe(true);
    expect(pointInRing([1.5, 1.5], lShape)).toBe(false);
  });
});

describe("isInsideBoundary", () => {
  it("accepts points inside a polygon and rejects points outside it", () => {
    expect(isInsideBoundary(0.5, 0.5, cityWithHole)).toBe(true);
    expect(isInsideBoundary(20, 20, cityWithHole)).toBe(false);
  });

  it("rejects points inside a polygon hole", () => {
    expect(isInsideBoundary(2, 2, cityWithHole)).toBe(false);
  });

  it("checks every polygon of a MultiPolygon feature", () => {
    expect(isInsideBoundary(1, 11, cityWithHole)).toBe(true);
    expect(isInsideBoundary(1, 15, cityWithHole)).toBe(true);
    expect(isInsideBoundary(1, 13, cityWithHole)).toBe(false);
  });

  it("returns false for an empty boundary collection", () => {
    expect(isInsideBoundary(20.2961, 85.8245, { type: "FeatureCollection", features: [] })).toBe(false);
  });
});

describe("findWardInGeoJson", () => {
  const wards = [ward(1, 0.5, 0.5), ward(2, 11, 1), ward(3, 1, 15)];
  const boundaries: WardFeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { ward_number: 1, ward_name: "Ward 1", assembly_constituency: "A", parliamentary_constituency: "P" },
        geometry: {
          type: "Polygon",
          coordinates: [square(0, 0, 1, 1), square(0.25, 0.25, 0.75, 0.75)]
        }
      },
      {
        type: "Feature",
        properties: { ward_number: 2, ward_name: "Ward 2", assembly_constituency: "A", parliamentary_constituency: "P" },
        geometry: {
          type: "MultiPolygon",
          coordinates: [[square(10, 0, 12, 2)], [square(14, 0, 16, 2)]]
        }
      }
    ]
  };

  it("finds a ward by polygon boundary", () => {
    expect(findWardInGeoJson(0.5, 0.1, wards, boundaries)?.ward_number).toBe(1);
  });

  it("does not match points inside a ward hole", () => {
    expect(findWardInGeoJson(0.5, 0.5, wards, boundaries)).toBeNull();
  });

  it("checks every polygon of a MultiPolygon ward", () => {
    expect(findWardInGeoJson(1, 11, wards, boundaries)?.ward_number).toBe(2);
    expect(findWardInGeoJson(1, 15, wards, boundaries)?.ward_number).toBe(2);
    expect(findWardInGeoJson(1, 13, wards, boundaries)).toBeNull();
  });

  it("returns null when the polygon matches but the ward record is missing", () => {
    expect(findWardInGeoJson(0.5, 0.1, [ward(99, 0, 0)], boundaries)).toBeNull();
  });
});

describe("distanceKm", () => {
  it("returns zero for identical coordinates", () => {
    expect(distanceKm({ latitude: 20.2961, longitude: 85.8245 }, { latitude: 20.2961, longitude: 85.8245 })).toBe(0);
  });

  it("approximates one degree of latitude", () => {
    expect(distanceKm({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 })).toBeCloseTo(111.19, 1);
  });

  it("approximates one degree of longitude at the equator", () => {
    expect(distanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeCloseTo(111.19, 1);
  });

  it("shrinks longitude distance away from the equator", () => {
    const atEquator = distanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 });
    const atBhubaneswar = distanceKm({ latitude: 20.2961, longitude: 85.8245 }, { latitude: 20.2961, longitude: 86.8245 });
    expect(atBhubaneswar).toBeLessThan(atEquator);
    expect(atBhubaneswar).toBeCloseTo(104.28, 0);
  });
});

describe("findNearestWard", () => {
  const wards = [ward(1, 0.5, 0.5), ward(2, 10, 10)];

  it("finds the ward whose center is closest", () => {
    expect(findNearestWard(0.6, 0.6, wards)?.ward_number).toBe(1);
    expect(findNearestWard(9.8, 9.8, wards)?.ward_number).toBe(2);
  });

  it("returns null when no wards are available", () => {
    expect(findNearestWard(20.2961, 85.8245, [])).toBeNull();
  });
});
