import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { IS_STAGING, LOCAL_REPORTS_KEY, OUTSIDE_CITY_LOCALITY_PATTERNS } from "./constants";
import { findNearestWard, findWardInGeoJson, isInsideBoundary, pointInRing } from "./geo";
import { canSubmitReport, getFingerprint, hasUpvoted, markUpvoted, recordSubmission } from "./limits";
import { ODISHA_GARBAGE_FALLBACK_IMAGE } from "./report-images";
import type {
  AdminStats,
  Backend,
  CityBoundaryFeatureCollection,
  CivicData,
  GarbageReport,
  ModerationStatus,
  NewReportInput,
  Representative,
  ResolveReportInput,
  UploadReportPhotoOptions,
  Ward,
  WardFeatureCollection
} from "../types/domain";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);
const adminFunctionUrl = import.meta.env.VITE_ADMIN_FUNCTION_URL as string | undefined;
const adminKeyFallback = import.meta.env.VITE_ADMIN_KEY || "";

if (import.meta.env.DEV && !import.meta.env.VITE_ADMIN_KEY) {
  console.warn(
    "[Amma Odisha] VITE_ADMIN_KEY is not set. Admin panel is disabled in local mode. Add it to .env.local to enable."
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

function hasSupabaseConfig() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return response.json() as Promise<T>;
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
    severity: report.severity ?? "medium",
    category: report.category ?? "mixed",
    status: report.status ?? "unresolved",
    moderation_status: report.moderation_status ?? "approved",
    location_source: report.location_source ?? (report.gps_latitude != null && report.gps_longitude != null ? "gps" : "ward_center")
  };
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

let reportImageReplacementCache: Promise<ReportImageReplacement[]> | null = null;

function fetchReportImageReplacements() {
  if (!reportImageReplacementCache) {
    reportImageReplacementCache = fetchJson<ReportImageReplacement[]>("/report-image-sources.json").catch(() => []);
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
    photo_source_url: image.source_page ?? report.photo_source_url ?? null,
    photo_source_title: image.title ?? report.photo_source_title ?? null,
    photo_license: image.license ?? report.photo_license ?? null,
    photo_credit: image.credit ?? report.photo_credit ?? "Wikimedia Commons",
    photo_width: image.width ?? report.photo_width ?? null,
    photo_height: image.height ?? report.photo_height ?? null
  };
}

function pickUnusedReportImage(replacements: ReportImageReplacement[], usedPhotoUrls: Set<string>, seed: string) {
  if (!replacements.length || usedPhotoUrls.size >= replacements.length) return null;

  const startIndex = hashString(seed) % replacements.length;
  for (let offset = 0; offset < replacements.length; offset += 1) {
    const image = replacements[(startIndex + offset) % replacements.length];
    if (!usedPhotoUrls.has(image.photo_url)) return image;
  }

  return null;
}

function applyReportImageReplacements(reports: GarbageReport[], replacements: ReportImageReplacement[]) {
  const uniqueReplacements = [
    ...new Map([...replacements, ODISHA_GARBAGE_FALLBACK_IMAGE].map((image) => [image.photo_url, image])).values()
  ];
  if (!uniqueReplacements.length) return reports;

  const replacementsByUrl = new Map(uniqueReplacements.map((image) => [image.photo_url, image]));
  const usedPhotoUrls = new Set<string>();

  return reports.map((report, index) => {
    const currentPhotoUrl = report.photo_url ?? "";
    const existingReplacement = report.photo_url ? replacementsByUrl.get(report.photo_url) : null;
    if (existingReplacement && !usedPhotoUrls.has(existingReplacement.photo_url)) {
      usedPhotoUrls.add(existingReplacement.photo_url);
      return addReportImageAttribution(report, existingReplacement);
    }

    if (!existingReplacement && currentPhotoUrl && !isLegacyReportPhoto(report) && !usedPhotoUrls.has(currentPhotoUrl)) {
      usedPhotoUrls.add(currentPhotoUrl);
      return report;
    }

    if (!currentPhotoUrl) {
      return addReportImageAttribution(report, ODISHA_GARBAGE_FALLBACK_IMAGE);
    }

    const image = pickUnusedReportImage(uniqueReplacements, usedPhotoUrls, `${report.id}:${index}`);
    if (!image) return addReportImageAttribution(report, ODISHA_GARBAGE_FALLBACK_IMAGE);

    usedPhotoUrls.add(image.photo_url);
    return addReportImageAttribution(report, image);
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

function normalizeReportsForBhubaneswar(
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

function saveLocalReports(reports: GarbageReport[]) {
  try {
    localStorage.setItem(LOCAL_REPORTS_KEY, JSON.stringify(reports));
  } catch {
    // localStorage may be unavailable (quota exceeded, private browsing); fail silently.
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

async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type.includes("heic") || file.type.includes("heif")) return file;

  return new Promise((resolve) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = image;
      const max = 1200;
      if (width > max || height > max) {
        if (width > height) { height = Math.round(height * (max / width)); width = max; }
        else { width = Math.round(width * (max / height)); height = max; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")?.drawImage(image, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg", lastModified: Date.now() }));
        },
        "image/jpeg",
        0.75
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
  path
}: {
  bucket: string;
  contentType: string;
  file: File;
  options?: UploadReportPhotoOptions;
  path: string;
}) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const url = `${supabaseUrl}/storage/v1/object/${bucket}/${encodedPath}`;

  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.setRequestHeader("Authorization", `Bearer ${supabaseAnonKey}`);
    request.setRequestHeader("apikey", supabaseAnonKey!);
    request.setRequestHeader("Cache-Control", "3600");
    request.setRequestHeader("Content-Type", contentType);
    request.setRequestHeader("x-upsert", "false");

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      reportUploadProgress(options, 5 + (event.loaded / event.total) * 94);
    };

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        reportUploadProgress(options, 100);
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

    reportUploadProgress(options, 1);
    request.send(file);
  });
}

// ─── LocalBackend ─────────────────────────────────────────────────────────────

class LocalBackend implements Backend {
  private data?: CivicData;

  async fetchCivicData() {
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

  async fetchReports() {
    const data = await this.fetchCivicData();
    // Re-merge from localStorage so in-session submissions are always reflected.
    const replacementImages = await fetchReportImageReplacements();
    const reports = normalizeReportsForBhubaneswar(mergeLocalReports(data.reports), data.wards, data.wardBoundaries, data.cityBoundary);
    return applyReportImageReplacements(reports, replacementImages).filter((report) => report.moderation_status !== "rejected");
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
    if (!limit.allowed) throw new Error("Daily limit of 5 reports reached. Try again tomorrow.");

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
    return fileToDataUrl(file, options);
  }

  async adminStats(adminKey: string) {
    this.assertAdmin(adminKey);
    const reports = (await this.fetchCivicData()).reports;
    return {
      total: reports.length,
      flagged: reports.filter((r) => r.moderation_status === "flagged").length,
      rejected: reports.filter((r) => r.moderation_status === "rejected").length,
      approved: reports.filter((r) => r.moderation_status === "approved").length
    };
  }

  async adminQueue(adminKey: string, status: ModerationStatus) {
    this.assertAdmin(adminKey);
    return (await this.fetchCivicData()).reports.filter((r) => r.moderation_status === status);
  }

  async moderateReport(adminKey: string, reportId: string, decision: ModerationStatus) {
    this.assertAdmin(adminKey);
    const report = (await this.fetchCivicData()).reports.find((item) => item.id === reportId);
    if (!report) throw new Error("Report not found");
    upsertLocalReports([
      {
        ...report,
        moderation_status: decision,
        moderation_metadata: { ...(report.moderation_metadata ?? {}), moderated_at: new Date().toISOString() }
      }
    ]);
    this.data = undefined;
  }

  async bulkModerate(adminKey: string, reportIds: string[], decision: ModerationStatus) {
    // Single read-modify-write pass for efficiency.
    this.assertAdmin(adminKey);
    const idSet = new Set(reportIds);
    const reports = (await this.fetchCivicData()).reports;
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
    const reports = (await this.fetchCivicData()).reports;
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

  private assertAdmin(adminKey: string) {
    if (!adminKey || !adminKeyFallback || adminKey !== adminKeyFallback) throw new Error("Invalid admin key");
  }
}

// ─── SupabaseBackend ──────────────────────────────────────────────────────────

class SupabaseBackend extends LocalBackend {
  private client: SupabaseClient;

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
    const { data: upvotes, error } = await this.client
      .from("report_upvotes")
      .select("report_id")
      .in("report_id", reportIds);
    if (error) throw error;

    const voteRowsByReportId = new Map<string, number>();
    (upvotes ?? []).forEach((vote) => {
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
      this.client.from("garbage_reports").select("upvote_count").eq("id", reportId).maybeSingle(),
      this.client.from("report_upvotes").select("id", { count: "exact", head: true }).eq("report_id", reportId)
    ]);

    if (reportResult.error) throw reportResult.error;
    if (upvoteCountResult.error) throw upvoteCountResult.error;

    const persistedCount = Number(reportResult.data?.upvote_count ?? 1);
    const derivedCount = (upvoteCountResult.count ?? 0) + 1;
    return Math.max(Number.isFinite(persistedCount) ? persistedCount : 1, derivedCount);
  }

  override async fetchCivicData(): Promise<CivicData> {
    const [wards, representatives, reports, wardBoundaries, cityBoundary, politicalMapping] = await Promise.all([
      this.client
        .from("wards")
        .select("ward_number, ward_name, zone, assembly_constituency, parliamentary_constituency, center_lat, center_lng, locality_name")
        .order("ward_number"),
      this.client.from("representatives").select("*").eq("active", true),
      this.fetchReports(),
      this.fetchWardBoundaries(),
      fetchJson<CityBoundaryFeatureCollection>("/bmc-boundary.json"),
      fetchJson<PoliticalMappingData>("/bbsr-political-mapping.json").catch(() => null)
    ]);
    if (wards.error) throw wards.error;
    if (representatives.error) throw representatives.error;
    const safeWards = applyWardConstituencyMapping(wards.data ?? [], politicalMapping);
    const safeRepresentatives = mergeRepresentativesWithPoliticalMapping(representatives.data ?? [], politicalMapping);

    return {
      wards: safeWards,
      cityBoundary,
      representatives: safeRepresentatives,
      reports: normalizeReportsForBhubaneswar(reports, safeWards, wardBoundaries, cityBoundary),
      wardBoundaries
    };
  }

  override async fetchReports() {
    let query = this.client
      .from("garbage_reports")
      .select("*")
      .neq("moderation_status", "rejected")
      .order("created_at", { ascending: false });
    if (!IS_STAGING) query = query.eq("is_test", false);
    const { data, error } = await query;
    if (error) throw error;
    const withCounts = await this.mergeDerivedUpvoteCounts((data ?? []) as GarbageReport[]);
    const replacementImages = await fetchReportImageReplacements();
    return applyReportImageReplacements(withCounts.map(normalizeReport), replacementImages);
  }

  override async fetchReportById(id: string) {
    const { data, error } = await this.client.from("garbage_reports").select("*").eq("id", id).single();
    if (error) return null;
    const [reportWithCount] = await this.mergeDerivedUpvoteCounts([data as GarbageReport]);
    const replacementImages = await fetchReportImageReplacements();
    return applyReportImageReplacements([normalizeReport(reportWithCount)], replacementImages)[0] ?? null;
  }

  override async fetchReportsByWard(wardNumber: number) {
    const { data, error } = await this.client
      .from("garbage_reports")
      .select("*")
      .eq("ward_number", wardNumber)
      .neq("moderation_status", "rejected")
      .order("created_at", { ascending: false });
    if (error) throw error;
    const withCounts = await this.mergeDerivedUpvoteCounts((data ?? []) as GarbageReport[]);
    const replacementImages = await fetchReportImageReplacements();
    return applyReportImageReplacements(withCounts.map(normalizeReport), replacementImages);
  }

  override async fetchReportsByConstituency(constituency: string, type: "mla" | "mp") {
    const column = type === "mla" ? "assembly_constituency" : "parliamentary_constituency";
    const { data: wards, error } = await this.client.from("wards").select("ward_number").eq(column, constituency);
    if (error) throw error;
    if (!wards?.length) return [];
    const { data, error: reportError } = await this.client
      .from("garbage_reports")
      .select("*")
      .in("ward_number", wards.map((w) => w.ward_number))
      .neq("moderation_status", "rejected")
      .order("created_at", { ascending: false });
    if (reportError) throw reportError;
    const withCounts = await this.mergeDerivedUpvoteCounts((data ?? []) as GarbageReport[]);
    const replacementImages = await fetchReportImageReplacements();
    return applyReportImageReplacements(withCounts.map(normalizeReport), replacementImages);
  }

  override async submitReport(input: NewReportInput) {
    const limit = canSubmitReport();
    if (!limit.allowed) throw new Error("Daily limit of 5 reports reached. Try again tomorrow.");
    const payload = IS_STAGING ? { ...input, is_test: true } : input;
    const { data, error } = await this.client.from("garbage_reports").insert(payload).select().single();
    if (error) throw error;
    recordSubmission();
    return normalizeReport(data);
  }

  override async resolveReport(reportId: string, input: ResolveReportInput) {
    const { data, error } = await this.client
      .from("garbage_reports")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolved_photo_url: input.photoUrl ?? null,
        resolved_lat: input.lat,
        resolved_lng: input.lng,
        resolved_by_name: input.name || "Anonymous Citizen"
      })
      .eq("id", reportId)
      .select()
      .single();
    if (error) throw error;
    return normalizeReport(data);
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
    const compressed = await compressImage(file);
    reportUploadProgress(options, 5);
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const path = `reports/${name}`;
    await uploadStorageObjectWithProgress({
      bucket: "garbage-photos",
      contentType: compressed.type || "image/jpeg",
      file: compressed,
      options,
      path
    });
    return this.client.storage.from("garbage-photos").getPublicUrl(path).data.publicUrl;
  }

  override async adminStats(adminKey: string) {
    return this.callAdmin<AdminStats>(adminKey, "stats");
  }

  override async adminQueue(adminKey: string, status: ModerationStatus) {
    const response = await this.callAdmin<{ reports: GarbageReport[] }>(adminKey, `queue&status=${status}`);
    const replacementImages = await fetchReportImageReplacements();
    return applyReportImageReplacements(response.reports.map(normalizeReport), replacementImages);
  }

  override async moderateReport(adminKey: string, reportId: string, decision: ModerationStatus) {
    await this.callAdmin(adminKey, "moderate", { reportId, decision });
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

  private async callAdmin<T = unknown>(adminKey: string, action: string, body?: unknown): Promise<T> {
    const base = adminFunctionUrl || `${supabaseUrl}/functions/v1/admin-moderation`;
    const response = await fetch(`${base}?action=${action}`, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(text || `Admin API error ${response.status}`);
    }
    return response.json() as Promise<T>;
  }
}

export const backend: Backend = hasSupabaseConfig() ? new SupabaseBackend() : new LocalBackend();
