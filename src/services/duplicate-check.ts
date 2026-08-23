import type { GarbageReport } from "../types/domain";
import { distanceKm } from "./geo";

export type NearbyCandidate = Pick<GarbageReport, "id" | "latitude" | "longitude" | "status" | "moderation_status">;

export interface NearbyMatch {
  report: NearbyCandidate;
  distanceMeters: number;
}

const DEFAULT_RADIUS_METERS = 100;

/** Active (non-resolved) reports within `radiusMeters` of the given point, closest first. */
export function findNearbyReports(
  reports: NearbyCandidate[],
  lat: number,
  lng: number,
  radiusMeters = DEFAULT_RADIUS_METERS
): NearbyMatch[] {
  const origin = { latitude: lat, longitude: lng };
  return reports
    .filter((report) => report.status !== "resolved")
    .filter((report) => !report.moderation_status || report.moderation_status === "approved")
    .map((report) => ({ report, distanceMeters: distanceKm(origin, report) * 1000 }))
    .filter((match) => match.distanceMeters <= radiusMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}
