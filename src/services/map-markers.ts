import type { GarbageReport, WardFeatureCollection } from "../types/domain";

export interface MarkerPlacement {
  report: GarbageReport;
  latitude: number;
  longitude: number;
}

const COORDINATE_PRECISION = 6;
// Slightly larger offset so overlapping points are visible at city-level zoom.
const BASE_OFFSET_DEGREES = 0.00018;
const MAX_POINTS_PER_RING = 8;

function coordinateKey(latitude: number, longitude: number) {
  return `${latitude.toFixed(COORDINATE_PRECISION)},${longitude.toFixed(COORDINATE_PRECISION)}`;
}

function hashString(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  return () => {
    let next = (seed += 0x6d2b79f5);
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function pointInRing(point: [number, number], ring: [number, number][]) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function isPointInPolygon(point: [number, number], polygon: [number, number][][]) {
  const outer = polygon[0] as [number, number][];
  const holes = polygon.slice(1) as [number, number][][];
  return pointInRing(point, outer) && !holes.some((hole) => pointInRing(point, hole));
}

function getPolygonBbox(polygon: [number, number][][]) {
  const outer = polygon[0] as [number, number][];
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  outer.forEach(([lng, lat]) => {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  });

  return { minLng, maxLng, minLat, maxLat };
}

function getWardPolygonSamplePoint(
  wardNumber: number,
  reportId: string,
  wardBoundaries?: WardFeatureCollection
): [number, number] | null {
  if (!wardBoundaries) return null;

  const feature = wardBoundaries.features.find((item) => Number(item.properties?.ward_number) === wardNumber);
  if (!feature) return null;

  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  if (!polygons.length) return null;

  const rng = mulberry32(hashString(`${reportId}:${wardNumber}:marker`));
  const polygon = polygons[Math.floor(rng() * polygons.length)] as [number, number][][];
  const bounds = getPolygonBbox(polygon);

  for (let attempts = 0; attempts < 100; attempts += 1) {
    const lng = bounds.minLng + (bounds.maxLng - bounds.minLng) * rng();
    const lat = bounds.minLat + (bounds.maxLat - bounds.minLat) * rng();
    const point: [number, number] = [lng, lat];
    if (isPointInPolygon(point, polygon)) return point;
  }

  return null;
}

export function createMarkerPlacements(reports: GarbageReport[], wardBoundaries?: WardFeatureCollection): MarkerPlacement[] {
  const grouped = new Map<string, { latitude: number; longitude: number; reports: GarbageReport[] }>();

  for (const report of reports) {
    const sourceLatitude = Number(report.latitude);
    const sourceLongitude = Number(report.longitude);
    const wardPoint =
      report.location_source === "ward_center" && Number.isFinite(report.ward_number)
        ? getWardPolygonSamplePoint(Number(report.ward_number), report.id, wardBoundaries)
        : null;

    const latitude = wardPoint ? wardPoint[1] : sourceLatitude;
    const longitude = wardPoint ? wardPoint[0] : sourceLongitude;

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

    const key = `coord:${coordinateKey(latitude, longitude)}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.reports.push(report);
      continue;
    }

    grouped.set(key, { latitude, longitude, reports: [report] });
  }

  const placements: MarkerPlacement[] = [];

  for (const group of grouped.values()) {
    if (group.reports.length === 1) {
      placements.push({
        report: group.reports[0],
        latitude: group.latitude,
        longitude: group.longitude
      });
      continue;
    }

    const ordered = [...group.reports].sort((a, b) => a.id.localeCompare(b.id));

    ordered.forEach((report, index) => {
      const ring = Math.floor(index / MAX_POINTS_PER_RING) + 1;
      const indexOnRing = index % MAX_POINTS_PER_RING;
      const remaining = ordered.length - (ring - 1) * MAX_POINTS_PER_RING;
      const pointsOnRing = Math.min(MAX_POINTS_PER_RING, remaining);
      const angle = (Math.PI * 2 * indexOnRing) / pointsOnRing;
      const radius = BASE_OFFSET_DEGREES * ring;

      placements.push({
        report,
        latitude: group.latitude + Math.sin(angle) * radius,
        longitude: group.longitude + Math.cos(angle) * radius
      });
    });
  }

  return placements;
}
