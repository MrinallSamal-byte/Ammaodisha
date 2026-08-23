import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { IS_STAGING, LOCAL_REPORTS_KEY, MAX_REPORTS_PER_DAY, OUTSIDE_CITY_LOCALITY_PATTERNS } from "./constants";
import { findNearestWard, findWardInGeoJson, isInsideBoundary, pointInRing } from "./geo";
import { canSubmitReport, getFingerprint, hasUpvoted, markUpvoted, recordSubmission } from "./limits";
import { ODISHA_GARBAGE_FALLBACK_IMAGE } from "./report-images";
import type {
  AdminQueuePage,
  AdminStats,
  Backend,
  CityBoundaryFeatureCollection,
  CivicData,
  GarbageReport,
  ModerationStatus,
  ModerateReportOptions,
  NewReportInput,
  RealtimeConnectionStatus,
  Representative,
  ResolveReportInput,
  SeverityKey,
  UploadReportPhotoOptions,
  UploadReportPhotoResult,
  Ward,
  WardFeatureCollection,
  WasteCategory
} from "../types/domain";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);
const adminFunctionUrl = import.meta.env.VITE_ADMIN_FUNCTION_URL as string | undefined;
const localAdminKey = import.meta.env.DEV ? (import.meta.env.VITE_LOCAL_ADMIN_KEY as string | undefined) || "" : "";
const PUBLIC_REPORTS_VIEW = "public_garbage_reports";
const PUBLIC_REPORT_EVENTS_TABLE = "public_report_change_events";
const ADMIN_QUEUE_EVENTS_TABLE = "admin_queue_change_events";
const ADMIN_REQUEST_TIMEOUT_MS = 20000;
const ADMIN_QUEUE_PAGE_SIZE = 50;
const PUBLIC_REPORT_COLUMNS = [
  "id",
  "latitude",
  "longitude",
  "location_source",
  "ward_number",
  "address",
  "severity",
  "category",
  "status",
  "photo_url",
  "photo_thumb_url",
  "upvote_count",
  "resolved_at",
  "resolved_photo_url",
  "resolved_photo_thumb_url",
  "resolved_lat",
  "resolved_lng",
  "created_at",
  "updated_at",
  "is_test",
  "moderation_status"
].join(",");

if (import.meta.env.DEV && !localAdminKey) {
  console.warn(
    "[Amma Odisha] VITE_LOCAL_ADMIN_KEY is not set. Admin panel is disabled in local mode. Add it to .env.local to enable."
  );
}

interface PoliticalRepresentativeProfile {
  name?: string;
  party_full?: string;
  party_short?: string;
  image_url?: string | null;
  contacts?: {
    email?: string | null;
    phone?: string | null;
    office_address?: string | null;
  };
}

interface PoliticalAssemblyRecord {
  assembly_constituency_no?: number;
  assembly_constituency_name?: string;
  mla_profile?: PoliticalRepresentativeProfile;
  official_extent?: {
    bmc_wards?: number[];
  };
  current_lok_sabha_member?: PoliticalRepresentativeProfile;
}

interface PoliticalMappingData {
  lok_sabha_constituency?: {
    constituency_name?: string;
    current_member?: PoliticalRepresentativeProfile;
  };
  records?: PoliticalAssemblyRecord[];
}

interface ReportImageReplacement {
  credit?: string | null;
  height?: number | null;
  license?: string | null;
  original_url?: string | null;
  photo_url: string;
  source_page?: string | null;
  title?: string | null;
  width?: number | null;
}

interface ReportImageSourceRecord {
  credit?: string | null;
  height?: number | null;
  license?: string | null;
  original_url?: string | null;
  photo_url?: string | null;
  source_page?: string | null;
  title?: string | null;
  width?: number | null;
}

function hasSupabaseConfig() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

function isMissingPublicReportSurface(error: unknown) {
  const code = (error as { code?: string }).code;
  const message = error instanceof Error ? error.message : String((error as { message?: string }).message ?? error);
  return code === "42P01" || message.includes(PUBLIC_REPORTS_VIEW);
}

function isMissingSchemaColumn(error: unknown, column: string) {
  const code = (error as { code?: string }).code;
  const message = error instanceof Error ? error.message : String((error as { message?: string }).message ?? error);
  return code === "PGRST204" && message.includes(`'${column}'`);
}

async function adminResponseMessage(response: Response) {
  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("json")) return "Service temporarily unavailable";
    const payload = (await response.json()) as { message?: unknown; error?: unknown } | null;
    if (!payload || typeof payload !== "object") return "Service temporarily unavailable";
    const detail = payload.message ?? payload.error;
    if (typeof detail !== "string" || !detail.trim()) return "Service temporarily unavailable";
    return detail.trim();
  } catch {
    return "Service temporarily unavailable";
  }
}

async function fetchJson<T>(url: string, timeoutMs = 30_000): Promise<T> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
    return response.json() as Promise<T>;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function normalizeReport(report: GarbageReport): GarbageReport {
  return {
    ...report,
    latitude: Number(report.latitude),
    longitude: Number(report.longitude),
    gps_latitude: report.gps_latitude == null ? null : Number(report.gps_latitude),
    gps_longitude: report.gps_longitude == null ? null : Number(report.gps_longitude),
    gps_accuracy_meters: report.gps_accuracy_meters == null ? null : Number(report.gps_accuracy_meters),
    ward_number: Number(report.ward_number),
    upvote_count: report.upvote_count ?? 1,
    severity: normalizeSeverity(report.severity),
    category: normalizeCategory(report.category),
    status: report.status ?? "unresolved",
    moderation_status: report.moderation_status ?? "approved",
    location_source: report.location_source ?? (report.gps_latitude != null && report.gps_longitude != null ? "gps" : "ward_center")
  };
}

export function isPublicReport(report: Pick<GarbageReport, "moderation_status">) {
  return (report.moderation_status ?? "approved") === "approved";
}

function normalizeSeverity(value: unknown): SeverityKey {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "low" || normalized === "minor" || normalized === "small") return "small";
  if (normalized === "medium" || normalized === "moderate") return "medium";
  if (normalized === "high" || normalized === "severe" || normalized === "large") return "large";
  if (normalized === "critical" || normalized === "massive") return "massive";
  return "medium";
}

function normalizeCategory(value: unknown): WasteCategory {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "household" || normalized === "organic") return "household";
  if (normalized === "construction") return "construction";
  if (normalized === "e-waste" || normalized === "ewaste") return "e-waste";
  if (normalized === "biomedical") return "biomedical";
  return "mixed";
}

function getPartyCode(partyShort?: string | null, partyFull?: string | null) {
  if (partyShort?.trim()) return partyShort.trim();
  const normalized = (partyFull || "").toUpperCase();
  if (normalized.includes("BIJU JANATA DAL")) return "BJD";
  if (normalized.includes("BHARATIYA JANATA PARTY")) return "BJP";
  if (normalized.includes("INDIAN NATIONAL CONGRESS")) return "INC";
  if (normalized.includes("AAM AADMI PARTY")) return "AAP";
  return partyFull?.trim() || "Independent";
}

function representativeKey(input: Pick<Representative, "role" | "constituency">) {
  return `${input.role}:${input.constituency}`.toLowerCase();
}

function buildRepresentativesFromPoliticalMapping(mapping: PoliticalMappingData): Representative[] {
  const representatives: Representative[] = [];
  const mpConstituency = mapping.lok_sabha_constituency?.constituency_name?.trim() || "Bhubaneswar";
  const mpProfile = mapping.lok_sabha_constituency?.current_member ?? mapping.records?.[0]?.current_lok_sabha_member;

  if (mpProfile?.name?.trim()) {
    representatives.push({
      id: 1000,
      name: mpProfile.name.trim(),
      role: "mp",
      constituency: mpConstituency,
      party: getPartyCode(mpProfile.party_short, mpProfile.party_full),
      photo_url: mpProfile.image_url ?? null,
      email: mpProfile.contacts?.email ?? null,
      phone: mpProfile.contacts?.phone ?? null,
      active: true
    });
  }

  (mapping.records || []).forEach((record, index) => {
    const constituency = record.assembly_constituency_name?.trim();
    const mla = record.mla_profile;
    if (!constituency || !mla?.name?.trim()) return;

    representatives.push({
      id: record.assembly_constituency_no ?? 2000 + index,
      name: mla.name.trim(),
      role: "mla",
      constituency,
      party: getPartyCode(mla.party_short, mla.party_full),
      photo_url: mla.image_url ?? null,
      email: mla.contacts?.email ?? null,
      phone: mla.contacts?.phone ?? null,
      active: true
    });
  });

  return representatives;
}

function mergeRepresentativesWithPoliticalMapping(seed: Representative[], mapping: PoliticalMappingData | null) {
  if (!mapping) return seed;
  const mapped = buildRepresentativesFromPoliticalMapping(mapping);
  if (!mapped.length) return seed;

  const byKey = new Map<string, Representative>();
  seed.forEach((rep) => byKey.set(representativeKey(rep), rep));

  mapped.forEach((rep) => {
    const key = representativeKey(rep);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, rep);
      return;
    }
    byKey.set(key, {
      ...existing,
      ...rep,
      phone: rep.phone ?? existing.phone,
      email: rep.email ?? existing.email,
      photo_url: rep.photo_url ?? existing.photo_url
    });
  });

  return Array.from(byKey.values());
}

function applyWardConstituencyMapping(wards: Ward[], mapping: PoliticalMappingData | null) {
  if (!mapping?.records?.length) return wards;

  const wardAssemblyMap = new Map<number, string>();
  mapping.records.forEach((record) => {
    const assemblyName = record.assembly_constituency_name?.trim();
    if (!assemblyName) return;
    (record.official_extent?.bmc_wards || []).forEach((wardNumber) => {
      const normalizedWard = Number(wardNumber);
      if (!Number.isFinite(normalizedWard)) return;
      wardAssemblyMap.set(normalizedWard, assemblyName);
    });
  });

  const parliamentary = mapping.lok_sabha_constituency?.constituency_name?.trim();
  if (!wardAssemblyMap.size && !parliamentary) return wards;

  return wards.map((ward) => {
    const mappedAssembly = wardAssemblyMap.get(ward.ward_number);
    if (!mappedAssembly && !parliamentary) return ward;
    return {
      ...ward,
      assembly_constituency: mappedAssembly ?? ward.assembly_constituency,
      parliamentary_constituency: parliamentary ?? ward.parliamentary_constituency
    };
  });
}

function getFallbackWard(sourceWardNumber: number, wards: Ward[]) {
  if (!wards.length) return null;
  const bySameNumber = wards.find((ward) => ward.ward_number === sourceWardNumber);
  if (bySameNumber) return bySameNumber;
  const sorted = [...wards].sort((a, b) => a.ward_number - b.ward_number);
  const index = (Math.abs(sourceWardNumber || 1) - 1) % sorted.length;
  return sorted[index] ?? sorted[0];
}

function getBhubaneswarAddress(ward: Ward) {
  const locality = ward.locality_name?.trim();
  const wardName = ward.ward_name?.trim() || "";
  const normalizedWardName = wardName.toLowerCase().replace(/\s+/g, " ");
  const match = normalizedWardName.match(/^ward(?:\s+no\.?)?[\s#:-]*0*(\d+)$/);
  const hasDistinctWardName = Boolean(wardName) && !(match && Number(match[1]) === ward.ward_number);

  if (locality) return `${locality}, Ward ${ward.ward_number}, Bhubaneswar`;
  if (hasDistinctWardName) return `${wardName}, Ward ${ward.ward_number}, Bhubaneswar`;
  return `Ward ${ward.ward_number}, Bhubaneswar`;
}

function hashString(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const INDIA_GARBAGE_IMAGE_POOL: ReportImageReplacement[] = [
  { photo_url: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Garbage%20Burning%20-%20Kanpur%2020220509%20083327.jpg", title: "Garbage Burning, Kanpur 2022", source_page: null, license: "CC BY-SA 4.0", credit: "Wikimedia Commons", width: 1280, height: 720 },
  { photo_url: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Burning%20Garbage%20-%20East%20Kolkata%20Wetlands%20-%20Nalban%20-%20Kolkata%202017-06-09%202031.JPG", title: "Burning Garbage, East Kolkata Wetlands 2017", source_page: null, license: "CC BY-SA 4.0", credit: "Wikimedia Commons", width: 1280, height: 960 },
  { photo_url: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Garbage%20Burning%20-%20Nicco%20Park%20-%20Jheel%20Meel%20-%20Salt%20Lake%20City%20-%20Kolkata%2020171110091127.jpg", title: "Garbage Burning, Salt Lake City, Kolkata 2017", source_page: null, license: "CC BY-SA 4.0", credit: "Wikimedia Commons", width: 1280, height: 960 },
  { photo_url: "https://upload.wikimedia.org/wikipedia/commons/8/84/Garbage_heap_in_Batla_House%2C_New_Delhi%2C_18_June_2024.jpg", title: "Garbage heap, Batla House, New Delhi 2024", source_page: null, license: "CC BY-SA 4.0", credit: "Wikimedia Commons", width: 4000, height: 3000 },
  { photo_url: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Cow%20in%20Delhi-1.jpg", title: "Street garbage with cow, Delhi", source_page: null, license: "CC BY-SA 3.0", credit: "Wikimedia Commons", width: 1024, height: 768 },
  { photo_url: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Cow%20in%20Delhi-2.jpg", title: "Street waste with cattle, Delhi", source_page: null, license: "CC BY-SA 3.0", credit: "Wikimedia Commons", width: 1024, height: 768 },
  { photo_url: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Cow%20in%20Delhi-3.jpg", title: "Roadside garbage, Delhi", source_page: null, license: "CC BY-SA 3.0", credit: "Wikimedia Commons", width: 1024, height: 768 },
  { photo_url: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Clean%20your%20city-P1080552.jpg", title: "Garbage pile on street, Kolkata", source_page: null, license: "CC BY-SA 3.0", credit: "Wikimedia Commons", width: 1024, height: 768 },
  { photo_url: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Dol%20Aftermath.jpg", title: "Post-festival waste on street, Kolkata", source_page: null, license: "CC BY-SA 3.0", credit: "Wikimedia Commons", width: 1024, height: 768 },
  { photo_url: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Close%20up%20image%20displaying%20trash%20scattered%20by%20the%20road%20side.jpg", title: "Roadside trash, India", source_page: null, license: "CC BY-SA 3.0", credit: "Wikimedia Commons", width: 1024, height: 768 },
  { photo_url: "https://upload.wikimedia.org/wikipedia/commons/b/b7/The_waste_dumped_in_drainage.jpg", title: "Waste dumped in drain, India", source_page: null, license: "CC BY-SA 4.0", credit: "Wikimedia Commons", width: 348, height: 260 },
  { photo_url: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Garbej%20dump%20on%20the%20Delhi%20-%20Karnal%20Road%2004.jpg", title: "Garbage dump on Delhi-Karnal Road 2023", source_page: null, license: "CC BY-SA 4.0", credit: "Wikimedia Commons", width: 1024, height: 768 },
  { photo_url: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Garbej%20dump%20on%20the%20Delhi%20-%20Karnal%20Road%2003.jpg", title: "Garbage dump on Delhi-Karnal Road 2023", source_page: null, license: "CC BY-SA 4.0", credit: "Wikimedia Commons", width: 1024, height: 768 },
  { photo_url: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Garbage%20dumped%20in%20the%20Tulsian%20Bawri%2C%20Jhunjhunu.jpg", title: "Garbage dumped in Tulsian Bawri, Jhunjhunu 2022", source_page: null, license: "CC BY-SA 4.0", credit: "Wikimedia Commons", width: 1024, height: 768 },
  { photo_url: "https://www.orissapost.com/wp-content/uploads/2025/09/Daringbadi.jpg", title: "Garbage dumps, Daringbadi, Odisha", source_page: null, license: null, credit: "OrissaPOST", width: 1280, height: 545 }
];

let reportImageReplacementCache: Promise<ReportImageReplacement[]> | null = null;

function fetchReportImageReplacements() {
  if (!reportImageReplacementCache) {
    reportImageReplacementCache = fetchJson<ReportImageSourceRecord[]>("/report-image-sources.json")
      .then((sources) => {
        const normalized: ReportImageReplacement[] = [];
        sources.forEach((source) => {
          const photoUrl = source.photo_url?.trim();
          if (!photoUrl) return;

          normalized.push({
            photo_url: photoUrl,
            title: source.title ?? null,
            source_page: source.source_page ?? null,
            original_url: source.original_url ?? null,
            license: source.license ?? null,
            credit: source.credit ?? "Wikimedia Commons",
            width: source.width ?? null,
            height: source.height ?? null
          });
        });

        const deduped = [...new Map(normalized.map((source) => [source.photo_url, source])).values()];
        return deduped.length ? deduped : INDIA_GARBAGE_IMAGE_POOL;
      })
      .catch(() => {
        // Reset so the next call retries instead of caching the fallback forever.
        reportImageReplacementCache = null;
        return INDIA_GARBAGE_IMAGE_POOL;
      });
  }
  return reportImageReplacementCache;
}

function isLegacyReportPhoto(report: GarbageReport) {
  const photoUrl = report.photo_url ?? "";
  return /tcldazhypyuutdpoksfx\.supabase\.co\/storage\/v1\/object\/public\/garbage-photos\/reports\//i.test(photoUrl);
}

function addReportImageAttribution(report: GarbageReport, image: ReportImageReplacement): GarbageReport {
  return {
    ...report,
    photo_url: image.photo_url,
    photo_thumb_url: image.photo_url,
    photo_source_url: image.source_page ?? report.photo_source_url ?? null,
    photo_source_title: image.title ?? report.photo_source_title ?? null,
    photo_license: image.license ?? report.photo_license ?? null,
    photo_credit: image.credit ?? report.photo_credit ?? "Wikimedia Commons",
    photo_width: image.width ?? report.photo_width ?? null,
    photo_height: image.height ?? report.photo_height ?? null
  };
}

function applyReportImageReplacements(reports: GarbageReport[], replacements: ReportImageReplacement[]) {
  const uniqueReplacements = [
    ...new Map([...replacements, ODISHA_GARBAGE_FALLBACK_IMAGE].map((image) => [image.photo_url, image])).values()
  ];
  if (!uniqueReplacements.length) return reports;

  const replacementsByUrl = new Map(uniqueReplacements.map((image) => [image.photo_url, image]));
  // Track every source already shown (genuine claims and assigned replacements)
  // so each distinct report ends up with a different image.
  const claimedPhotoUrls = new Set<string>();
  const assignedSourceUrls = new Set<string>();

  const pickAssignment = (seed: string) => {
    const startIndex = hashString(seed) % uniqueReplacements.length;
    for (let offset = 0; offset < uniqueReplacements.length; offset += 1) {
      const candidate = uniqueReplacements[(startIndex + offset) % uniqueReplacements.length];
      if (!claimedPhotoUrls.has(candidate.photo_url) && !assignedSourceUrls.has(candidate.photo_url)) {
        assignedSourceUrls.add(candidate.photo_url);
        return candidate;
      }
    }

    // Once we exhaust the pool, rotate deterministically by assignment ordinal
    // instead of collapsing every remaining report to one fallback image.
    const rotated = uniqueReplacements[assignedSourceUrls.size % uniqueReplacements.length];
    assignedSourceUrls.add(rotated.photo_url);
    return rotated;
  };

  return reports.map((report, index) => {
    const currentPhotoUrl = report.photo_url ?? "";

    // If the report already has a photo URL nobody else is showing yet
    if (currentPhotoUrl && !claimedPhotoUrls.has(currentPhotoUrl) && !assignedSourceUrls.has(currentPhotoUrl)) {
      claimedPhotoUrls.add(currentPhotoUrl);
      const existingReplacement = replacementsByUrl.get(currentPhotoUrl);
      if (existingReplacement) {
        return addReportImageAttribution(report, existingReplacement);
      }
      // Not in replacement pool but has a URL — keep as-is (user-uploaded or external)
      if (!isLegacyReportPhoto(report)) {
        return report;
      }
    }

    // Assign a distinct replacement image for reports with no photo, legacy photos, or duplicate URLs
    return addReportImageAttribution(report, pickAssignment(`${report.id}:${index}:reassign`));
  });
}

function mulberry32(seed: number) {
  return () => {
    let next = (seed += 0x6d2b79f5);
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function isPointInPolygon(point: [number, number], polygon: [number, number][][]) {
  const outer = polygon[0] as [number, number][];
  const holes = polygon.slice(1) as [number, number][][];
  return pointInRing(point, outer) && !holes.some((hole) => pointInRing(point, hole));
}

function getPolygonBbox(polygon: [number, number][][]) {
  const outer = polygon[0] as [number, number][];
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  outer.forEach(([lng, lat]) => {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  });
  return { minLng, maxLng, minLat, maxLat };
}

function getPolygonCentroid(polygon: [number, number][][]): [number, number] {
  const outer = polygon[0] as [number, number][];
  const count = Math.max(1, outer.length);
  const sums = outer.reduce(
    (acc, [lng, lat]) => ({ lng: acc.lng + lng, lat: acc.lat + lat }),
    { lng: 0, lat: 0 }
  );
  return [sums.lng / count, sums.lat / count];
}

function getWardSamplePoint(wardNumber: number, reportId: string, boundaries: WardFeatureCollection): [number, number] | null {
  const feature = boundaries.features.find((item) => Number(item.properties?.ward_number) === wardNumber);
  if (!feature) return null;
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  if (!polygons.length) return null;

  const rng = mulberry32(hashString(`${reportId}:${wardNumber}`));
  const polygon = polygons[Math.floor(rng() * polygons.length)] as [number, number][][];
  const bounds = getPolygonBbox(polygon);

  for (let attempts = 0; attempts < 80; attempts += 1) {
    const lng = bounds.minLng + (bounds.maxLng - bounds.minLng) * rng();
    const lat = bounds.minLat + (bounds.maxLat - bounds.minLat) * rng();
    const point: [number, number] = [lng, lat];
    if (isPointInPolygon(point, polygon)) return point;
  }
  return getPolygonCentroid(polygon);
}

const outsideCityAddressPattern = new RegExp(
  OUTSIDE_CITY_LOCALITY_PATTERNS.map((pattern) => pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
  "i"
);

function shouldRewriteAddress(address: string, outsideCity: boolean) {
  if (outsideCity) return true;
  return outsideCityAddressPattern.test(address);
}

function normalizeToBhubaneswar(
  report: GarbageReport,
  wards: Ward[],
  boundaries: WardFeatureCollection,
  cityBoundary: CityBoundaryFeatureCollection
): GarbageReport {
  const latitude = Number(report.latitude);
  const longitude = Number(report.longitude);
  const outsideCity = !isInsideBoundary(latitude, longitude, cityBoundary);
  const wardFromPoint = findWardInGeoJson(latitude, longitude, wards, boundaries);
  const ward =
    wardFromPoint ??
    getFallbackWard(Number(report.ward_number), wards) ??
    findNearestWard(latitude, longitude, wards) ??
    wards[0];

  if (!ward) return report;

  const insideWard = Boolean(wardFromPoint) && !outsideCity;
  const wardPoint = getWardSamplePoint(ward.ward_number, report.id, boundaries);
  const nextAddress = shouldRewriteAddress(report.address || "", outsideCity) ? getBhubaneswarAddress(ward) : report.address;

  return {
    ...report,
    ward_number: ward.ward_number,
    latitude: insideWard ? latitude : Number(wardPoint?.[1] ?? ward.center_lat),
    longitude: insideWard ? longitude : Number(wardPoint?.[0] ?? ward.center_lng),
    address: nextAddress
  };
}

export function normalizeReportsForBhubaneswar(
  reports: GarbageReport[],
  wards: Ward[],
  boundaries: WardFeatureCollection,
  cityBoundary: CityBoundaryFeatureCollection
) {
  return reports.map((report) => normalizeToBhubaneswar(report, wards, boundaries, cityBoundary));
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

function readLocalReports(): GarbageReport[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_REPORTS_KEY) || "[]") as GarbageReport[];
  } catch {
    return [];
  }
}

function mergeLocalReports(seed: GarbageReport[]) {
  const local = readLocalReports();
  const byId = new Map<string, GarbageReport>();
  seed.map(normalizeReport).forEach((report) => byId.set(report.id, report));
  local.map(normalizeReport).forEach((report) => byId.set(report.id, report));
  return Array.from(byId.values()).sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
}

let warnedLocalSaveFailure = false;

function saveLocalReports(reports: GarbageReport[]) {
  try {
    localStorage.setItem(LOCAL_REPORTS_KEY, JSON.stringify(reports));
  } catch (error) {
    // localStorage may be unavailable (quota exceeded, private browsing).
    if (!warnedLocalSaveFailure) {
      warnedLocalSaveFailure = true;
      console.warn("[Amma Odisha] Could not persist local reports:", error);
    }
  }
}

function upsertLocalReports(nextReports: GarbageReport[]) {
  if (!nextReports.length) return;
  const byId = new Map<string, GarbageReport>();
  readLocalReports().map(normalizeReport).forEach((report) => byId.set(report.id, report));
  nextReports.map(normalizeReport).forEach((report) => byId.set(report.id, report));
  saveLocalReports(Array.from(byId.values()).sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)));
}

// ─── Image utilities ──────────────────────────────────────────────────────────

function reportUploadProgress(options: UploadReportPhotoOptions | undefined, value: number) {
  options?.onProgress?.(Math.max(0, Math.min(100, Math.round(value))));
}

const REPORT_IMAGE_MAX_DIMENSION = 960;
const REPORT_IMAGE_QUALITY = 0.72;
const REPORT_THUMBNAIL_MAX_DIMENSION = 220;
const REPORT_THUMBNAIL_QUALITY = 0.62;

async function fileToDataUrl(file: File, options?: UploadReportPhotoOptions): Promise<string> {
  reportUploadProgress(options, 0);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (!event.lengthComputable) return;
      reportUploadProgress(options, (event.loaded / event.total) * 100);
    };
    reader.onload = () => {
      reportUploadProgress(options, 100);
      resolve(String(reader.result));
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.readAsDataURL(file);
  });
}

async function fileToUploadResult(file: File, options?: UploadReportPhotoOptions): Promise<UploadReportPhotoResult> {
  reportUploadProgress(options, 0);
  const full = await compressImage(file, {
    maxDimension: REPORT_IMAGE_MAX_DIMENSION,
    quality: REPORT_IMAGE_QUALITY
  });
  reportUploadProgress(options, 35);
  const thumbnail = await compressImage(file, {
    maxDimension: REPORT_THUMBNAIL_MAX_DIMENSION,
    quality: REPORT_THUMBNAIL_QUALITY
  });
  reportUploadProgress(options, 55);
  const url = await fileToDataUrl(full);
  reportUploadProgress(options, 80);
  const thumbUrl = thumbnail.size < full.size ? await fileToDataUrl(thumbnail) : url;
  reportUploadProgress(options, 100);
  return { url, thumbUrl };
}

function getStorageExtension(file: File) {
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/heic") return "heic";
  if (file.type === "image/heif") return "heif";
  return "jpg";
}

async function compressImage(
  file: File,
  {
    maxDimension,
    quality
  }: {
    maxDimension: number;
    quality: number;
  }
): Promise<File> {
  if (!file.type.startsWith("image/") || file.type.includes("heic") || file.type.includes("heif")) return file;

  return new Promise((resolve) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = image;
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round(height * (maxDimension / width));
          width = maxDimension;
        } else {
          width = Math.round(width * (maxDimension / height));
          height = maxDimension;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(file); return; }
      // Flatten PNG transparency onto white so it doesn't turn black as JPEG.
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg", lastModified: Date.now() }));
        },
        "image/jpeg",
        quality
      );
    };
    image.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    image.src = url;
  });
}

function uploadStorageObjectWithProgress({
  bucket,
  contentType,
  file,
  options,
  path,
  progressEnd = 99,
  progressStart = 5
}: {
  bucket: string;
  contentType: string;
  file: File;
  options?: UploadReportPhotoOptions;
  path: string;
  progressEnd?: number;
  progressStart?: number;
}) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const url = `${supabaseUrl}/storage/v1/object/${bucket}/${encodedPath}`;

  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.setRequestHeader("Authorization", `Bearer ${supabaseAnonKey}`);
    request.setRequestHeader("apikey", supabaseAnonKey!);
    request.setRequestHeader("Cache-Control", "public, max-age=31536000, immutable");
    request.setRequestHeader("Content-Type", contentType);
    request.setRequestHeader("x-upsert", "false");

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      reportUploadProgress(options, progressStart + (event.loaded / event.total) * (progressEnd - progressStart));
    };

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        reportUploadProgress(options, progressEnd);
        resolve();
        return;
      }
      let message = request.statusText || `Upload failed with status ${request.status}`;
      try {
        const body = JSON.parse(request.responseText) as { message?: string; error?: string };
        message = body.message || body.error || message;
      } catch {
        if (request.responseText) message = request.responseText;
      }
      reject(new Error(message));
    };
    request.onerror = () => reject(new Error("Photo upload failed. Check your connection and try again."));
    request.onabort = () => reject(new Error("Photo upload was cancelled."));

    reportUploadProgress(options, progressStart);
    request.send(file);
  });
}

// ─── LocalBackend ─────────────────────────────────────────────────────────────

class LocalBackend implements Backend {
  private data?: CivicData;

  private async loadCivicData() {
    if (!this.data) {
      const [wardSeed, wardBoundaries, cityBoundary, representativeSeed, reports, politicalMapping, replacementImages] = await Promise.all([
        fetchJson<Ward[]>("/wards.json"),
        fetchJson<WardFeatureCollection>("/ward-boundaries.json"),
        fetchJson<CityBoundaryFeatureCollection>("/bmc-boundary.json"),
        fetchJson<Representative[]>("/representatives.json").catch(() => [] as Representative[]),
        fetchJson<GarbageReport[]>("/reports.json"),
        fetchJson<PoliticalMappingData>("/bbsr-political-mapping.json").catch(() => null),
        fetchReportImageReplacements()
      ]);

      const wards = applyWardConstituencyMapping(wardSeed, politicalMapping);
      const representatives = mergeRepresentativesWithPoliticalMapping(representativeSeed, politicalMapping);

      this.data = {
        wards,
        cityBoundary,
        wardBoundaries,
        representatives,
        reports: applyReportImageReplacements(
          normalizeReportsForBhubaneswar(mergeLocalReports(reports), wards, wardBoundaries, cityBoundary),
          replacementImages
        )
      };
    }
    return this.data;
  }

  async fetchCivicData() {
    const data = await this.loadCivicData();
    return {
      ...data,
      reports: data.reports.filter(isPublicReport)
    };
  }

  async fetchReports() {
    const data = await this.loadCivicData();
    // Re-merge from localStorage so in-session submissions are always reflected.
    const replacementImages = await fetchReportImageReplacements();
    const reports = normalizeReportsForBhubaneswar(mergeLocalReports(data.reports), data.wards, data.wardBoundaries, data.cityBoundary);
    return applyReportImageReplacements(reports, replacementImages).filter(isPublicReport);
  }

  async fetchReportById(id: string) {
    return (await this.fetchReports()).find((report) => report.id === id) ?? null;
  }

  async fetchReportsByWard(wardNumber: number) {
    return (await this.fetchReports()).filter((report) => report.ward_number === wardNumber);
  }

  async fetchReportsByConstituency(constituency: string, type: "mla" | "mp") {
    const data = await this.fetchCivicData();
    // Use fetchReports() (which re-merges localStorage) rather than data.reports
    // so that in-session submissions appear in constituency/MLA/MP profile views.
    const allReports = await this.fetchReports();
    const wardNumbers = new Set(
      data.wards
        .filter((ward) =>
          type === "mla" ? ward.assembly_constituency === constituency : ward.parliamentary_constituency === constituency
        )
        .map((ward) => ward.ward_number)
    );
    return allReports.filter((report) => wardNumbers.has(report.ward_number));
  }

  async submitReport(input: NewReportInput) {
    const limit = canSubmitReport();
    if (!limit.allowed) throw new Error(`Daily limit of ${MAX_REPORTS_PER_DAY} reports reached. Try again tomorrow.`);

    const report: GarbageReport = {
      ...input,
      id: crypto.randomUUID(),
      status: "unresolved",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      upvote_count: 1,
      is_test: IS_STAGING,
      moderation_status: "flagged",
      moderation_metadata: {
        flag_reason: "pending_review",
        text_check: { flags: [], passed: true, severity: "clean" },
        duplicate_check: { is_duplicate: false },
        moderated_at: new Date().toISOString()
      },
      flag_count: 0
    };

    // Persist to localStorage first, then bust the in-memory cache so
    // subsequent fetchReports calls pick up the new report.
    upsertLocalReports([report]);
    this.data = undefined;

    recordSubmission();
    return report;
  }

  async resolveReport(reportId: string, input: ResolveReportInput) {
    const existing = (await this.fetchCivicData()).reports.find((report) => report.id === reportId);
    if (!existing) throw new Error("Report not found");

    const found: GarbageReport = {
      ...existing,
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_photo_url: input.photoUrl ?? null,
      resolved_photo_thumb_url: input.photoThumbUrl ?? null,
      resolved_lat: input.lat,
      resolved_lng: input.lng,
      resolved_by_name: input.name || "Anonymous Citizen",
      updated_at: new Date().toISOString()
    };

    upsertLocalReports([found]);
    this.data = undefined;
    return found;
  }

  async upvoteReport(reportId: string) {
    if (hasUpvoted(reportId)) return { alreadyVoted: true };

    const existing = (await this.fetchCivicData()).reports.find((report) => report.id === reportId);
    if (!existing) throw new Error("Report not found");

    const newCount = (existing.upvote_count || 1) + 1;
    upsertLocalReports([{ ...existing, upvote_count: newCount, updated_at: new Date().toISOString() }]);

    markUpvoted(reportId);
    this.data = undefined;
    return { alreadyVoted: false, newCount };
  }

  async uploadReportPhoto(file: File, options?: UploadReportPhotoOptions) {
    return fileToUploadResult(file, options);
  }

  async adminStats(adminKey: string) {
    this.assertAdmin(adminKey);
    const reports = (await this.loadCivicData()).reports;
    return {
      total: reports.length,
      flagged: reports.filter((r) => r.moderation_status === "flagged").length,
      rejected: reports.filter((r) => r.moderation_status === "rejected").length,
      approved: reports.filter((r) => r.moderation_status === "approved").length
    };
  }

  async adminQueue(adminKey: string, offset = 0): Promise<AdminQueuePage> {
    this.assertAdmin(adminKey);
    const queueSource = (await this.loadCivicData())
      .reports
      .filter((report) => report.moderation_status !== "approved")
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    const reports = queueSource.slice(offset, offset + ADMIN_QUEUE_PAGE_SIZE);
    return { reports, hasMore: reports.length === ADMIN_QUEUE_PAGE_SIZE };
  }

  async moderateReport(adminKey: string, reportId: string, status: ModerationStatus, options?: ModerateReportOptions) {
    this.assertAdmin(adminKey);
    const report = (await this.loadCivicData()).reports.find((item) => item.id === reportId);
    if (!report) throw new Error("Report not found");
    upsertLocalReports([
      {
        ...report,
        moderation_status: status,
        moderation_metadata: {
          ...(report.moderation_metadata ?? {}),
          ...(options?.rejectionReason ? { rejection_reason: options.rejectionReason } : {}),
          moderated_at: new Date().toISOString()
        }
      }
    ]);
    this.data = undefined;
  }

  async bulkModerate(adminKey: string, reportIds: string[], decision: ModerationStatus) {
    // Single read-modify-write pass for efficiency.
    this.assertAdmin(adminKey);
    const idSet = new Set(reportIds);
    const reports = (await this.loadCivicData()).reports;
    const now = new Date().toISOString();
    const updated = reports
      .filter((r) => idSet.has(r.id))
      .map((r) => ({ ...r, moderation_status: decision, moderation_metadata: { ...(r.moderation_metadata ?? {}), moderated_at: now } }));
    upsertLocalReports(updated);
    this.data = undefined;
  }

  async swapDuplicate(adminKey: string, reportId: string, existingId: string) {
    // Approve incoming, reject original — single pass.
    this.assertAdmin(adminKey);
    const decisions = new Map<string, ModerationStatus>([[reportId, "approved"], [existingId, "rejected"]]);
    const reports = (await this.loadCivicData()).reports;
    const now = new Date().toISOString();
    const updated = reports.flatMap((r) => {
      const decision = decisions.get(r.id);
      if (!decision) return [];
      return [{ ...r, moderation_status: decision, moderation_metadata: { ...(r.moderation_metadata ?? {}), moderated_at: now } }];
    });
    upsertLocalReports(updated);
    this.data = undefined;
  }

  async rejectBoth(adminKey: string, reportId: string, existingId: string) {
    await this.bulkModerate(adminKey, [reportId, existingId], "rejected");
  }

  subscribeToChanges(callback: () => void, onStatus?: (status: RealtimeConnectionStatus) => void): () => void {
    void callback;
    onStatus?.("live");
    return () => {};
  }

  subscribeToAdminChanges(callback: () => void, onStatus?: (status: RealtimeConnectionStatus) => void): () => void {
    void callback;
    onStatus?.("live");
    return () => {};
  }

  private assertAdmin(adminKey: string) {
    if (!adminKey || !localAdminKey || adminKey !== localAdminKey) throw new Error("Invalid admin key");
  }
}

// ─── SupabaseBackend ──────────────────────────────────────────────────────────

const EMPTY_CITY_BOUNDARY: CityBoundaryFeatureCollection = { type: "FeatureCollection", features: [] };

class SupabaseBackend extends LocalBackend {
  private client: SupabaseClient;
  private fallback = new LocalBackend();

  constructor() {
    super();
    this.client = createClient(supabaseUrl!, supabaseAnonKey!);
  }

  private async fetchWardBoundaries() {
    const { data, error } = await this.client.rpc("get_all_ward_boundaries");
    if (!error && data) return data as WardFeatureCollection;
    return fetchJson<WardFeatureCollection>("/ward-boundaries.json");
  }

  private async mergeDerivedUpvoteCounts(reports: GarbageReport[]) {
    if (!reports.length) return reports;

    const reportIds = reports.map((report) => report.id);
    const chunkSize = 100;
    const chunks: string[][] = [];
    for (let index = 0; index < reportIds.length; index += chunkSize) {
      chunks.push(reportIds.slice(index, index + chunkSize));
    }
    const upvoteResults = await Promise.all(
      chunks.map((chunk) =>
        this.client
          .from("report_upvotes")
          .select("report_id")
          .in("report_id", chunk)
      )
    );
    const upvoteRows: { report_id: string }[] = [];
    for (const { data, error } of upvoteResults) {
      if (error) throw error;
      upvoteRows.push(...((data ?? []) as { report_id: string }[]));
    }

    const voteRowsByReportId = new Map<string, number>();
    upvoteRows.forEach((vote) => {
      const reportId = vote.report_id as string;
      voteRowsByReportId.set(reportId, (voteRowsByReportId.get(reportId) ?? 0) + 1);
    });

    return reports.map((report) => {
      const persistedCount = Number(report.upvote_count ?? 1);
      const derivedCount = (voteRowsByReportId.get(report.id) ?? 0) + 1;
      return {
        ...report,
        upvote_count: Math.max(Number.isFinite(persistedCount) ? persistedCount : 1, derivedCount)
      };
    });
  }

  private async getReliableUpvoteCount(reportId: string) {
    const [reportResult, upvoteCountResult] = await Promise.all([
      this.client.from(PUBLIC_REPORTS_VIEW).select("upvote_count").eq("id", reportId).maybeSingle(),
      this.client.from("report_upvotes").select("report_id", { count: "exact", head: true }).eq("report_id", reportId)
    ]);

    if (reportResult.error) throw reportResult.error;
    if (upvoteCountResult.error) throw upvoteCountResult.error;

    const persistedCount = Number(reportResult.data?.upvote_count ?? 1);
    const derivedCount = (upvoteCountResult.count ?? 0) + 1;
    return Math.max(Number.isFinite(persistedCount) ? persistedCount : 1, derivedCount);
  }

  override async fetchCivicData(): Promise<CivicData> {
    const [wards, representatives, reports, wardBoundaries, cityBoundaryResult, politicalMapping] = await Promise.all([
      this.client
        .from("wards")
        .select("ward_number, ward_name, zone, assembly_constituency, parliamentary_constituency, center_lat, center_lng, locality_name")
        .order("ward_number"),
      this.client.from("representatives").select("*").eq("active", true),
      this.fetchReports(),
      this.fetchWardBoundaries(),
      fetchJson<CityBoundaryFeatureCollection>("/bmc-boundary.json").catch(() => null),
      fetchJson<PoliticalMappingData>("/bbsr-political-mapping.json").catch(() => null)
    ]);
    if (wards.error) throw wards.error;
    if (representatives.error) throw representatives.error;
    const safeWards = applyWardConstituencyMapping(wards.data ?? [], politicalMapping);
    const safeRepresentatives = mergeRepresentativesWithPoliticalMapping(representatives.data ?? [], politicalMapping);

    return {
      wards: safeWards,
      cityBoundary: cityBoundaryResult ?? EMPTY_CITY_BOUNDARY,
      representatives: safeRepresentatives,
      // Live Supabase coordinates are authoritative — no relocation pass.
      reports,
      wardBoundaries
    };
  }

  override async fetchReports() {
    let query = this.client
      .from(PUBLIC_REPORTS_VIEW)
      .select(PUBLIC_REPORT_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(500);
    if (!IS_STAGING) query = query.eq("is_test", false);
    const supabaseResult = await query;
    const supabaseReports = (supabaseResult.data ?? []) as unknown as GarbageReport[];
    if (supabaseResult.error && !isMissingPublicReportSurface(supabaseResult.error)) {
      console.warn("Supabase report fetch error, using local data:", supabaseResult.error);
    }

    // Only merge upvote counts for Supabase reports (local seed data already has counts).
    // A flaky count read degrades to the persisted upvote_count instead of failing the load.
    let withCounts = supabaseReports;
    if (supabaseReports.length) {
      try {
        withCounts = await this.mergeDerivedUpvoteCounts(supabaseReports);
      } catch (countError) {
        console.warn("Supabase upvote count fetch error, using persisted report counts:", countError);
      }
    }

    // Use Supabase reports as source of truth if the query succeeded without error.
    // Otherwise, fallback to merging local seed data.
    let merged: GarbageReport[];
    if (!supabaseResult.error) {
      merged = withCounts
        .map(normalizeReport)
        .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    } else {
      const localReports = await fetchJson<GarbageReport[]>("/reports.json").catch(() => [] as GarbageReport[]);
      const byId = new Map<string, GarbageReport>();
      for (const report of localReports) byId.set(report.id, report);
      for (const report of withCounts) byId.set(report.id, report); // overwrite locals
      merged = [...byId.values()]
        .map(normalizeReport)
        .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    }

    const replacementImages = await fetchReportImageReplacements();
    return applyReportImageReplacements(merged, replacementImages).filter(isPublicReport);
  }

  override async fetchReportById(id: string) {
    const { data, error } = await this.client
      .from(PUBLIC_REPORTS_VIEW)
      .select(PUBLIC_REPORT_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error) {
      if (isMissingPublicReportSurface(error)) return this.fallback.fetchReportById(id);
      console.warn("Supabase report detail fetch error, using local data:", error);
      return this.fallback.fetchReportById(id);
    }
    if (!data) {
      return null;
    }
    try {
      const [reportWithCount] = await this.mergeDerivedUpvoteCounts([data as unknown as GarbageReport]);
      const replacementImages = await fetchReportImageReplacements();
      return applyReportImageReplacements([normalizeReport(reportWithCount)], replacementImages)[0] ?? null;
    } catch (countError) {
      console.warn("Supabase upvote count fetch error, using persisted report count:", countError);
      const replacementImages = await fetchReportImageReplacements();
      return applyReportImageReplacements([normalizeReport(data as unknown as GarbageReport)], replacementImages)[0] ?? null;
    }
  }

  override async fetchReportsByWard(wardNumber: number) {
    return (await this.fetchReports()).filter((report) => report.ward_number === wardNumber);
  }

  override async fetchReportsByConstituency(constituency: string, type: "mla" | "mp") {
    const column = type === "mla" ? "assembly_constituency" : "parliamentary_constituency";
    const { data: wards, error } = await this.client.from("wards").select("ward_number").eq(column, constituency);
    if (error) {
      console.warn("Supabase constituency ward fetch error, using local data:", error);
      return this.fallback.fetchReportsByConstituency(constituency, type);
    }
    if (!wards?.length) return [];
    const wardNumbers = new Set(wards.map((ward) => Number(ward.ward_number)));
    return (await this.fetchReports()).filter((report) => wardNumbers.has(report.ward_number));
  }

  override async submitReport(input: NewReportInput) {
    const limit = canSubmitReport();
    if (!limit.allowed) throw new Error(`Daily limit of ${MAX_REPORTS_PER_DAY} reports reached. Try again tomorrow.`);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const payload = { ...input, id, is_test: IS_STAGING };
    let submittedInput = input;
    let { error } = await this.client.from("garbage_reports").insert(payload);
    if (error && isMissingSchemaColumn(error, "photo_thumb_url")) {
      const legacyInput = { ...input };
      delete legacyInput.photo_thumb_url;
      const legacyPayload = { ...legacyInput, id, is_test: IS_STAGING };
      ({ error } = await this.client.from("garbage_reports").insert(legacyPayload));
      submittedInput = legacyInput;
    }
    if (error) throw error;
    recordSubmission();
    return normalizeReport({
      ...submittedInput,
      id,
      status: "unresolved",
      created_at: now,
      updated_at: now,
      upvote_count: 1,
      is_test: IS_STAGING,
      moderation_status: "flagged",
      moderation_metadata: {
        flag_reason: "pending_review",
        moderated_at: now
      },
      flag_count: 0
    });
  }

  override async resolveReport(reportId: string, input: ResolveReportInput): Promise<GarbageReport> {
    const { data, error } = await this.client.rpc("submit_cleanup_proof", {
      p_report_id: reportId,
      p_photo_url: input.photoUrl ?? null,
      p_photo_thumb_url: input.photoThumbUrl ?? null,
      p_lat: input.lat,
      p_lng: input.lng
    });
    if (error) throw error;

    // Return ONLY the fields the RPC actually changed — the caller spreads this
    // delta over the live report, so placeholder values would corrupt it.
    const result = (data ?? {}) as Record<string, unknown>;
    const delta: Record<string, unknown> = { id: reportId };
    for (const key of [
      "status",
      "moderation_status",
      "resolved_photo_url",
      "resolved_photo_thumb_url",
      "resolved_lat",
      "resolved_lng",
      "resolved_at",
      "resolved_by_name",
      "updated_at",
      "moderation_metadata"
    ]) {
      const value = result[key];
      if (value !== undefined && value !== null) delta[key] = value;
    }
    if (!delta.moderation_metadata) {
      // The RPC doesn't return metadata; mirror exactly what it writes server-side
      // so callers see the re-flagged cleanup-pending state without refetching.
      delta.moderation_metadata = {
        flag_reason: "cleanup_submitted",
        cleanup_pending: true,
        cleanup_submitted_at: new Date().toISOString()
      };
    }
    return delta as unknown as GarbageReport;
  }

  override async upvoteReport(reportId: string) {
    const voter = getFingerprint();
    const { error } = await this.client
      .from("report_upvotes")
      .insert({ report_id: reportId, voter_fingerprint: voter });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") {
        markUpvoted(reportId);
        return { alreadyVoted: true };
      }
      throw error;
    }

    const newCount = await this.getReliableUpvoteCount(reportId);

    markUpvoted(reportId);
    return { alreadyVoted: false, newCount };
  }

  override async uploadReportPhoto(file: File, options?: UploadReportPhotoOptions) {
    reportUploadProgress(options, 0);
    const compressed = await compressImage(file, {
      maxDimension: REPORT_IMAGE_MAX_DIMENSION,
      quality: REPORT_IMAGE_QUALITY
    });
    reportUploadProgress(options, 6);
    const thumbnail = await compressImage(file, {
      maxDimension: REPORT_THUMBNAIL_MAX_DIMENSION,
      quality: REPORT_THUMBNAIL_QUALITY
    });
    reportUploadProgress(options, 10);
    const id = crypto.randomUUID();
    const path = `reports/${id}.${getStorageExtension(compressed)}`;
    await uploadStorageObjectWithProgress({
      bucket: "garbage-photos",
      contentType: compressed.type || "image/jpeg",
      file: compressed,
      options,
      path,
      progressEnd: 82,
      progressStart: 10
    });
    const url = this.client.storage.from("garbage-photos").getPublicUrl(path).data.publicUrl;
    let thumbUrl: string | null = null;

    if (thumbnail.size < compressed.size) {
      const thumbnailPath = `reports/thumbs/${id}.${getStorageExtension(thumbnail)}`;
      try {
        await uploadStorageObjectWithProgress({
          bucket: "garbage-photos",
          contentType: thumbnail.type || "image/jpeg",
          file: thumbnail,
          options,
          path: thumbnailPath,
          progressEnd: 99,
          progressStart: 82
        });
        thumbUrl = this.client.storage.from("garbage-photos").getPublicUrl(thumbnailPath).data.publicUrl;
      } catch (thumbnailError) {
        // Don't orphan the already-uploaded full photo — ship it without a thumb.
        console.warn("Thumbnail upload failed; keeping full-size photo only:", thumbnailError);
      }
    }

    reportUploadProgress(options, 100);
    return { url, thumbUrl };
  }

  override async adminStats(adminKey: string) {
    return this.callAdmin<AdminStats>(adminKey, "stats");
  }

  override async adminQueue(adminKey: string, offset = 0): Promise<AdminQueuePage> {
    const response = await this.callAdmin<unknown>(adminKey, "queue", {
      action: "queue",
      limit: ADMIN_QUEUE_PAGE_SIZE,
      offset
    });
    const rawReports = Array.isArray(response)
      ? (response as GarbageReport[])
      : Array.isArray((response as { reports?: unknown } | null)?.reports)
        ? ((response as { reports: GarbageReport[] }).reports)
        : [];
    const reports = rawReports.map(normalizeReport);
    return { reports, hasMore: reports.length === ADMIN_QUEUE_PAGE_SIZE };
  }

  override async moderateReport(
    adminKey: string,
    reportId: string,
    status: ModerationStatus,
    options?: ModerateReportOptions
  ) {
    const body: Record<string, unknown> = { reportId, decision: status };
    if (options?.rejectionReason) body.rejection_reason = options.rejectionReason;
    await this.callAdmin(adminKey, "moderate", body);
  }

  override async bulkModerate(adminKey: string, reportIds: string[], decision: ModerationStatus) {
    await this.callAdmin(adminKey, "bulk", { reportIds, decision });
  }

  override async swapDuplicate(adminKey: string, reportId: string, existingId: string) {
    await this.callAdmin(adminKey, "swap_duplicate", { reportId, existingId });
  }

  override async rejectBoth(adminKey: string, reportId: string, existingId: string) {
    await this.callAdmin(adminKey, "reject_both", { reportId, existingId });
  }

  override subscribeToChanges(callback: () => void, onStatus?: (status: RealtimeConnectionStatus) => void): () => void {
    return this.subscribeWithReconnect("garbage-report-changes", PUBLIC_REPORT_EVENTS_TABLE, callback, onStatus);
  }

  override subscribeToAdminChanges(callback: () => void, onStatus?: (status: RealtimeConnectionStatus) => void): () => void {
    return this.subscribeWithReconnect("admin-queue-changes", ADMIN_QUEUE_EVENTS_TABLE, callback, onStatus);
  }

  private subscribeWithReconnect(
    channelName: string,
    table: string,
    callback: () => void,
    onStatus?: (status: RealtimeConnectionStatus) => void
  ): () => void {
    let attempt = 0;
    let connection = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let channel: RealtimeChannel | null = null;

    const dropChannel = (target: RealtimeChannel) => {
      channel = null;
      void this.client.removeChannel(target);
    };

    const connect = () => {
      if (disposed) return;
      connection += 1;
      channel = this.client
        .channel(`${channelName}:${connection}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table },
          () => void callback()
        )
        .subscribe((status) => {
          if (disposed) return;
          if (status === "SUBSCRIBED") {
            attempt = 0;
            onStatus?.("live");
            return;
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            onStatus?.("reconnecting");
            if (timer || disposed) return;
            const delay = Math.min(30000, 1000 * 2 ** attempt);
            attempt += 1;
            timer = setTimeout(() => {
              timer = null;
              if (disposed) return;
              const stale = channel;
              if (stale) dropChannel(stale);
              connect();
            }, delay);
          }
        });
    };

    const handleOnline = () => {
      if (disposed) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      attempt = 0;
      const stale = channel;
      if (stale) dropChannel(stale);
      connect();
    };

    const handleOffline = () => {
      if (!disposed) onStatus?.("offline");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    connect();

    return () => {
      disposed = true;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (timer) clearTimeout(timer);
      timer = null;
      const stale = channel;
      if (stale) dropChannel(stale);
    };
  }

  private async callAdmin<T = unknown>(adminKey: string, action: string, body?: unknown): Promise<T> {
    const base = adminFunctionUrl || `${supabaseUrl}/functions/v1/admin-moderation`;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ADMIN_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${base}?action=${action}`, {
        method: body ? "POST" : "GET",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      if (!response.ok) throw new Error(await adminResponseMessage(response));
      return (await response.json()) as T;
    } catch (error) {
      if (timedOut) throw new Error("Request timed out");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

if (!hasSupabaseConfig() && import.meta.env.PROD) {
  console.error(
    "[AmmaOdisha] Supabase not configured — running with LOCAL DEMO DATA. Reports will NOT be saved."
  );
}

export const backend: Backend = hasSupabaseConfig() ? new SupabaseBackend() : new LocalBackend();
