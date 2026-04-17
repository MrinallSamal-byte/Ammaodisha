import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { CITY_MAX_BOUNDS } from "./constants";
import type { CityBoundaryFeatureCollection, WardFeatureCollection } from "../types/domain";

export type LngLatTuple = [number, number];
export type BoundsTuple = [[number, number], [number, number]];
export type MaskCollection = FeatureCollection<Polygon, Record<string, never>>;
export type BorderCollection = FeatureCollection<Polygon | MultiPolygon, Record<string, unknown>>;

const MAP_MASK_PADDING = 0.55;

export function collectBoundaryPoints(boundaries: FeatureCollection<Polygon | MultiPolygon, unknown>) {
  const points: LngLatTuple[] = [];

  boundaries.features.forEach((feature) => {
    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    polygons.forEach((polygon) => {
      polygon.forEach((ring) => {
        ring.forEach(([lng, lat]) => {
          if (Number.isFinite(lng) && Number.isFinite(lat)) {
            points.push([lng, lat]);
          }
        });
      });
    });
  });

  return points;
}

export function getBounds(points: LngLatTuple[]): BoundsTuple {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  points.forEach(([lng, lat]) => {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  });

  if (!Number.isFinite(minLng) || !Number.isFinite(maxLng) || !Number.isFinite(minLat) || !Number.isFinite(maxLat)) {
    return CITY_MAX_BOUNDS;
  }

  return [
    [minLng, minLat],
    [maxLng, maxLat]
  ];
}

function collectBoundaryExteriorRings(cityBoundary: CityBoundaryFeatureCollection) {
  const rings: LngLatTuple[][] = [];

  cityBoundary.features.forEach((feature) => {
    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    polygons.forEach((polygon) => {
      const exterior = polygon[0]
        ?.map(([lng, lat]) => [lng, lat] as LngLatTuple)
        .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
      if (exterior && exterior.length >= 4) {
        rings.push(exterior);
      }
    });
  });

  return rings;
}

function createRectangleRing(bounds: BoundsTuple, padding: number): LngLatTuple[] {
  const [[minLng, minLat], [maxLng, maxLat]] = bounds;
  return [
    [minLng - padding, minLat - padding],
    [maxLng + padding, minLat - padding],
    [maxLng + padding, maxLat + padding],
    [minLng - padding, maxLat + padding],
    [minLng - padding, minLat - padding]
  ];
}

function createBorderData(cityBoundary: CityBoundaryFeatureCollection): BorderCollection {
  return {
    type: "FeatureCollection",
    features: cityBoundary.features.map((feature) => ({
      type: "Feature",
      properties: feature.properties ?? {},
      geometry: feature.geometry
    }))
  };
}

function createMaskData(cityBoundary: CityBoundaryFeatureCollection, bounds: BoundsTuple): MaskCollection {
  const maskHoles = collectBoundaryExteriorRings(cityBoundary).map((ring) => [...ring].reverse());

  if (!maskHoles.length) {
    return { type: "FeatureCollection", features: [] };
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [createRectangleRing(bounds, MAP_MASK_PADDING), ...maskHoles]
        }
      }
    ]
  };
}

export function createCoverageData(wardBoundaries: WardFeatureCollection, cityBoundary: CityBoundaryFeatureCollection) {
  const cityPoints = collectBoundaryPoints(cityBoundary);
  const wardPoints = collectBoundaryPoints(wardBoundaries);
  const bounds = getBounds(cityPoints.length ? cityPoints : wardPoints);

  return {
    border: createBorderData(cityBoundary),
    bounds,
    mask: createMaskData(cityBoundary, bounds)
  };
}
