import { CITY_BOUNDARY } from "./constants";
import type { Ward, WardFeatureCollection } from "../types/domain";

export function pointInRing(point: [number, number], ring: [number, number][]) {
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

export function isInsideCity(lat: number, lng: number) {
  return pointInRing([lng, lat], CITY_BOUNDARY);
}

export function findWardInGeoJson(lat: number, lng: number, wards: Ward[], boundaries: WardFeatureCollection) {
  const point: [number, number] = [lng, lat];
  for (const feature of boundaries.features) {
    const geometry = feature.geometry;
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    const inFeature = polygons.some((polygon) => {
      const outer = polygon[0] as [number, number][];
      const holes = polygon.slice(1) as [number, number][][];
      return pointInRing(point, outer) && !holes.some((hole) => pointInRing(point, hole));
    });
    if (inFeature) {
      return wards.find((ward) => ward.ward_number === feature.properties.ward_number) ?? null;
    }
  }
  return null;
}

export function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function findNearestWard(lat: number, lng: number, wards: Ward[]) {
  return wards
    .map((ward) => ({
      ward,
      distance: distanceKm(
        { latitude: lat, longitude: lng },
        { latitude: Number(ward.center_lat), longitude: Number(ward.center_lng) }
      )
    }))
    .sort((a, b) => a.distance - b.distance)[0]?.ward ?? null;
}
