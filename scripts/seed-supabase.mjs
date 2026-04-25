import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const inheritedEnvKeys = new Set(Object.keys(process.env));
await loadEnvFiles([".env", ".env.local"], inheritedEnvKeys);

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const dryRun = process.env.SEED_DRY_RUN === "1" || process.env.SEED_DRY_RUN === "true";

if (!dryRun && (!supabaseUrl || !serviceRoleKey)) {
  throw new Error("Set VITE_SUPABASE_URL/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SECRET_KEY before seeding.");
}

const supabase = dryRun ? null : createClient(supabaseUrl, serviceRoleKey);
const root = new URL("../public/", import.meta.url);
const [wards, boundaries, representatives, reports] = await Promise.all([
  readJson("wards.json"),
  readJson("ward-boundaries.json"),
  readJson("representatives.json"),
  readJson("reports.json")
]);

const boundaryByWard = new Map(boundaries.features.map((feature) => [feature.properties.ward_number, feature]));
const wardRows = wards.map((ward) => ({ ...ward, boundary_geojson: boundaryByWard.get(ward.ward_number) ?? null }));
const representativeRows = representatives.map(toRepresentativeRow);
const reportRows = normalizeReportsForSeed(reports, wards, boundaries);

if (dryRun) {
  const originalWardNumbers = new Set(wards.map((ward) => Number(ward.ward_number)));
  const remappedReports = reports.filter((report, index) => Number(report.ward_number) !== reportRows[index].ward_number);
  console.log(
    JSON.stringify(
      {
        wards: wardRows.length,
        representatives: representativeRows.length,
        reports: reportRows.length,
        reportsRemappedToValidWards: remappedReports.length
      },
      null,
      2
    )
  );
  console.log(`Seed dry run complete. Valid ward numbers: ${originalWardNumbers.size}.`);
  process.exit(0);
}

await upsertChunk("wards", wardRows, "ward_number");
await upsertChunk("representatives", representativeRows, "role,constituency");
await upsertChunk("garbage_reports", reportRows, "id");

console.log("Supabase seed complete.");

async function readJson(fileName) {
  return JSON.parse(await readFile(new URL(fileName, root), "utf8"));
}

async function upsertChunk(table, rows, onConflict) {
  for (let index = 0; index < rows.length; index += 100) {
    const chunk = rows.slice(index, index + 100);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) throw error;
    console.log(`upserted ${chunk.length} rows into ${table}`);
  }
}

function toRepresentativeRow(representative) {
  return {
    name: representative.name,
    role: representative.role,
    party: representative.party,
    constituency: representative.constituency,
    phone: representative.phone ?? null,
    email: representative.email ?? null,
    photo_url: representative.photo_url ?? null,
    twitter_handle: representative.twitter_handle ?? null,
    active: representative.active ?? true
  };
}

function normalizeReportsForSeed(sourceReports, sourceWards, sourceBoundaries) {
  const wardsByNumber = new Map(sourceWards.map((ward) => [Number(ward.ward_number), ward]));
  const sortedWards = [...sourceWards].sort((a, b) => Number(a.ward_number) - Number(b.ward_number));

  return sourceReports.map((report) => {
    const lat = Number(report.latitude);
    const lng = Number(report.longitude);
    const detectedWard = findWardByLocation(lat, lng, wardsByNumber, sourceBoundaries);
    const fallbackWard = getFallbackWard(Number(report.ward_number), sortedWards, wardsByNumber);
    const ward = detectedWard ?? fallbackWard;
    const shouldUseWardCenter = !detectedWard;

    return {
      id: report.id,
      latitude: shouldUseWardCenter ? Number(ward.center_lat) : lat,
      longitude: shouldUseWardCenter ? Number(ward.center_lng) : lng,
      gps_latitude: shouldUseWardCenter ? null : lat,
      gps_longitude: shouldUseWardCenter ? null : lng,
      gps_accuracy_meters: report.gps_accuracy_meters ?? null,
      gps_recorded_at: shouldUseWardCenter ? null : (report.gps_recorded_at ?? report.created_at),
      location_source: shouldUseWardCenter ? "ward_center" : "gps",
      ward_number: Number(ward.ward_number),
      address: shouldUseWardCenter ? getBhubaneswarAddress(ward) : report.address,
      severity: normalizeSeverity(report.severity),
      category: normalizeCategory(report.category),
      status: report.status ?? "unresolved",
      photo_url: report.photo_url ?? null,
      photo_thumb_url: report.photo_thumb_url ?? report.photo_url ?? null,
      reporter_id: report.reporter_id ?? null,
      reporter_name: report.reporter_name ?? null,
      upvote_count: report.upvote_count ?? 1,
      resolved_at: report.resolved_at ?? null,
      resolved_photo_url: report.resolved_photo_url ?? null,
      resolved_photo_thumb_url: report.resolved_photo_thumb_url ?? null,
      resolved_by_name: report.resolved_by_name ?? null,
      resolved_lat: report.resolved_lat ?? null,
      resolved_lng: report.resolved_lng ?? null,
      notes: report.notes ?? null,
      created_at: report.created_at,
      updated_at: report.updated_at ?? report.created_at,
      is_test: report.is_test ?? false,
      moderation_status: report.moderation_status ?? "approved",
      moderation_metadata: report.moderation_metadata ?? {},
      flag_count: report.flag_count ?? 0
    };
  });
}

function normalizeSeverity(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "low" || normalized === "minor" || normalized === "small") return "small";
  if (normalized === "medium" || normalized === "moderate") return "medium";
  if (normalized === "high" || normalized === "severe" || normalized === "large") return "large";
  if (normalized === "critical" || normalized === "massive") return "massive";
  return "medium";
}

function normalizeCategory(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "household" || normalized === "organic") return "household";
  if (normalized === "construction") return "construction";
  if (normalized === "e-waste" || normalized === "ewaste") return "e-waste";
  if (normalized === "biomedical") return "biomedical";
  return "mixed";
}

function getFallbackWard(sourceWardNumber, sortedWards, wardsByNumber) {
  const sameNumber = wardsByNumber.get(sourceWardNumber);
  if (sameNumber) return sameNumber;
  const index = (Math.abs(sourceWardNumber || 1) - 1) % sortedWards.length;
  return sortedWards[index] ?? sortedWards[0];
}

function getBhubaneswarAddress(ward) {
  const locality = ward.locality_name?.trim();
  const wardName = ward.ward_name?.trim();
  if (locality) return `${locality}, Ward ${ward.ward_number}, Bhubaneswar`;
  if (wardName && !/^ward(?:\s+no\.?)?[\s#:-]*\d+$/i.test(wardName)) {
    return `${wardName}, Ward ${ward.ward_number}, Bhubaneswar`;
  }
  return `Ward ${ward.ward_number}, Bhubaneswar`;
}

function findWardByLocation(lat, lng, wardsByNumber, sourceBoundaries) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const point = [lng, lat];

  for (const feature of sourceBoundaries.features) {
    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    if (polygons.some((polygon) => isPointInPolygon(point, polygon))) {
      return wardsByNumber.get(Number(feature.properties.ward_number)) ?? null;
    }
  }

  return null;
}

function isPointInPolygon(point, polygon) {
  const [outer, ...holes] = polygon;
  return pointInRing(point, outer) && !holes.some((hole) => pointInRing(point, hole));
}

function pointInRing([lng, lat], ring) {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current, current += 1) {
    const [currentLng, currentLat] = ring[current];
    const [previousLng, previousLat] = ring[previous];
    const intersects =
      currentLat > lat !== previousLat > lat &&
      lng < ((previousLng - currentLng) * (lat - currentLat)) / (previousLat - currentLat) + currentLng;
    if (intersects) inside = !inside;
  }
  return inside;
}

async function loadEnvFiles(files, inheritedKeys) {
  for (const file of files) {
    if (!existsSync(file)) continue;
    const contents = await readFile(file, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (!match) continue;

      const key = match[1];
      if (inheritedKeys.has(key)) continue;

      process.env[key] = stripEnvValue(match[2] ?? "");
    }
  }
}

function stripEnvValue(rawValue) {
  const value = rawValue.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value.replace(/\s+#.*$/, "");
}
