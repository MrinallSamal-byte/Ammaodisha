import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { IS_STAGING, LOCAL_REPORTS_KEY } from "./constants";
import { findNearestWard, findWardInGeoJson, isInsideCity, pointInRing } from "./geo";
import { canSubmitReport, getFingerprint, hasUpvoted, markUpvoted, recordSubmission } from "./limits";
import type {
  AdminStats,
  Backend,
  CivicData,
  GarbageReport,
  ModerationStatus,
  NewReportInput,
  Representative,
  ResolveReportInput,
  Ward,
  WardFeatureCollection
} from "../types/domain";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const adminFunctionUrl = import.meta.env.VITE_ADMIN_FUNCTION_URL as string | undefined;
const adminKeyFallback = import.meta.env.VITE_ADMIN_KEY || "demo";

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

function hasSupabaseConfig() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}`);
  return response.json() as Promise<T>;
}

function normalizeReport(report: GarbageReport): GarbageReport {
  return {
    ...report,
    latitude: Number(report.latitude),
    longitude: Number(report.longitude),
    ward_number: Number(report.ward_number),
    upvote_count: report.upvote_count ?? 1,
    severity: report.severity ?? "medium",
    category: report.category ?? "mixed",
    status: report.status ?? "unresolved",
    moderation_status: report.moderation_status ?? "approved"
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
  const locality = ward.locality_name?.trim() || ward.ward_name;
  return `${locality}, Ward ${ward.ward_number}, Bhubaneswar`;
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

  const polygonSeed = `${reportId}:${wardNumber}`;
  const rng = mulberry32(hashString(polygonSeed));
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

function shouldRewriteAddress(address: string, outsideCity: boolean) {
  if (outsideCity) return true;
  return /bengaluru|bangalore|karnataka|hsr|koramangala|marathahalli|mahadevapura|banashankari/i.test(address);
}

function normalizeToBhubaneswar(report: GarbageReport, wards: Ward[], boundaries: WardFeatureCollection): GarbageReport {
  const latitude = Number(report.latitude);
  const longitude = Number(report.longitude);
  const outsideCity = !isInsideCity(latitude, longitude);
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

function normalizeReportsForBhubaneswar(reports: GarbageReport[], wards: Ward[], boundaries: WardFeatureCollection) {
  return reports.map((report) => normalizeToBhubaneswar(report, wards, boundaries));
}

function mergeLocalReports(seed: GarbageReport[]) {
  const local = JSON.parse(localStorage.getItem(LOCAL_REPORTS_KEY) || "[]") as GarbageReport[];
  const byId = new Map<string, GarbageReport>();
  seed.map(normalizeReport).forEach((report) => byId.set(report.id, report));
  local.map(normalizeReport).forEach((report) => byId.set(report.id, report));
  return Array.from(byId.values()).sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
}

function saveLocalReports(reports: GarbageReport[]) {
  localStorage.setItem(LOCAL_REPORTS_KEY, JSON.stringify(reports));
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
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
        if (width > height) {
          height = Math.round(height * (max / width));
          width = max;
        } else {
          width = Math.round(width * (max / height));
          height = max;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")?.drawImage(image, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg", lastModified: Date.now() }));
        },
        "image/jpeg",
        0.75
      );
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    image.src = url;
  });
}

class LocalBackend implements Backend {
  private data?: CivicData;

  async fetchCivicData() {
    if (!this.data) {
      const [wardSeed, wardBoundaries, representativeSeed, reports, politicalMapping] = await Promise.all([
        fetchJson<Ward[]>("/wards.json"),
        fetchJson<WardFeatureCollection>("/ward-boundaries.json"),
        fetchJson<Representative[]>("/representatives.json").catch(() => []),
        fetchJson<GarbageReport[]>("/reports.json"),
        fetchJson<PoliticalMappingData>("/bbsr-political-mapping.json").catch(() => null)
      ]);

      const wards = applyWardConstituencyMapping(wardSeed, politicalMapping);
      const representatives = mergeRepresentativesWithPoliticalMapping(representativeSeed, politicalMapping);

      this.data = {
        wards,
        wardBoundaries,
        representatives,
        reports: normalizeReportsForBhubaneswar(mergeLocalReports(reports), wards, wardBoundaries)
      };
    }
    return this.data;
  }

  async fetchReports() {
    const data = await this.fetchCivicData();
    data.reports = normalizeReportsForBhubaneswar(mergeLocalReports(data.reports), data.wards, data.wardBoundaries);
    return data.reports;
  }

  async fetchReportById(id: string) {
    return (await this.fetchReports()).find((report) => report.id === id) ?? null;
  }

  async fetchReportsByWard(wardNumber: number) {
    return (await this.fetchReports()).filter((report) => report.ward_number === wardNumber);
  }

  async fetchReportsByConstituency(constituency: string, type: "mla" | "mp") {
    const data = await this.fetchCivicData();
    const wardNumbers = new Set(
      data.wards
        .filter((ward) =>
          type === "mla" ? ward.assembly_constituency === constituency : ward.parliamentary_constituency === constituency
        )
        .map((ward) => ward.ward_number)
    );
    return data.reports.filter((report) => wardNumbers.has(report.ward_number));
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
    const reports = mergeLocalReports((await this.fetchCivicData()).reports);
    const next = [report, ...reports];
    saveLocalReports(next);
    this.data = { ...(await this.fetchCivicData()), reports: next };
    recordSubmission();
    return report;
  }

  async resolveReport(reportId: string, input: ResolveReportInput) {
    const reports = (await this.fetchReports()).map((report) =>
      report.id === reportId
        ? {
            ...report,
            status: "resolved" as const,
            resolved_at: new Date().toISOString(),
            resolved_photo_url: input.photoUrl ?? null,
            resolved_lat: input.lat,
            resolved_lng: input.lng,
            resolved_by_name: input.name || "Anonymous Citizen",
            updated_at: new Date().toISOString()
          }
        : report
    );
    saveLocalReports(reports);
    this.data = { ...(await this.fetchCivicData()), reports };
    const report = reports.find((item) => item.id === reportId);
    if (!report) throw new Error("Report not found");
    return report;
  }

  async upvoteReport(reportId: string) {
    if (hasUpvoted(reportId)) return { alreadyVoted: true };
    const reports = (await this.fetchReports()).map((report) =>
      report.id === reportId ? { ...report, upvote_count: (report.upvote_count || 1) + 1 } : report
    );
    markUpvoted(reportId);
    saveLocalReports(reports);
    this.data = { ...(await this.fetchCivicData()), reports };
    return { alreadyVoted: false, newCount: reports.find((report) => report.id === reportId)?.upvote_count };
  }

  async uploadReportPhoto(file: File) {
    return fileToDataUrl(file);
  }

  async adminStats(adminKey: string) {
    this.assertAdmin(adminKey);
    const reports = await this.fetchReports();
    return {
      total: reports.length,
      flagged: reports.filter((report) => report.moderation_status === "flagged").length,
      rejected: reports.filter((report) => report.moderation_status === "rejected").length,
      approved: reports.filter((report) => report.moderation_status === "approved").length
    };
  }

  async adminQueue(adminKey: string, status: ModerationStatus) {
    this.assertAdmin(adminKey);
    return (await this.fetchReports()).filter((report) => report.moderation_status === status);
  }

  async moderateReport(adminKey: string, reportId: string, decision: ModerationStatus) {
    this.assertAdmin(adminKey);
    const reports = (await this.fetchReports()).map((report) =>
      report.id === reportId
        ? {
            ...report,
            moderation_status: decision,
            moderation_metadata: { ...(report.moderation_metadata ?? {}), moderated_at: new Date().toISOString() }
          }
        : report
    );
    saveLocalReports(reports);
    this.data = { ...(await this.fetchCivicData()), reports };
  }

  async bulkModerate(adminKey: string, reportIds: string[], decision: ModerationStatus) {
    await Promise.all(reportIds.map((id) => this.moderateReport(adminKey, id, decision)));
  }

  async swapDuplicate(adminKey: string, reportId: string, existingId: string) {
    await this.moderateReport(adminKey, reportId, "approved");
    await this.moderateReport(adminKey, existingId, "rejected");
  }

  async rejectBoth(adminKey: string, reportId: string, existingId: string) {
    await this.bulkModerate(adminKey, [reportId, existingId], "rejected");
  }

  private assertAdmin(adminKey: string) {
    if (!adminKey || (adminKeyFallback && adminKey !== adminKeyFallback)) throw new Error("Invalid admin key");
  }
}

class SupabaseBackend extends LocalBackend {
  private client: SupabaseClient;

  constructor() {
    super();
    this.client = createClient(supabaseUrl!, supabaseAnonKey!);
  }

  override async fetchCivicData(): Promise<CivicData> {
    const [wards, representatives, reports, wardBoundaries, politicalMapping] = await Promise.all([
      this.client
        .from("wards")
        .select("ward_number, ward_name, zone, assembly_constituency, parliamentary_constituency, center_lat, center_lng, locality_name")
        .order("ward_number"),
      this.client.from("representatives").select("*").eq("active", true),
      this.fetchReports(),
      fetchJson<WardFeatureCollection>("/ward-boundaries.json"),
      fetchJson<PoliticalMappingData>("/bbsr-political-mapping.json").catch(() => null)
    ]);
    if (wards.error) throw wards.error;
    if (representatives.error) throw representatives.error;
    const safeWards = applyWardConstituencyMapping(wards.data ?? [], politicalMapping);
    const safeRepresentatives = mergeRepresentativesWithPoliticalMapping(representatives.data ?? [], politicalMapping);

    return {
      wards: safeWards,
      representatives: safeRepresentatives,
      reports: normalizeReportsForBhubaneswar(reports, safeWards, wardBoundaries),
      wardBoundaries
    };
  }

  override async fetchReports() {
    let query = this.client.from("garbage_reports").select("*").order("created_at", { ascending: false });
    if (!IS_STAGING) query = query.eq("is_test", false);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map(normalizeReport);
  }

  override async fetchReportById(id: string) {
    const { data, error } = await this.client.from("garbage_reports").select("*").eq("id", id).single();
    if (error) return null;
    return normalizeReport(data);
  }

  override async fetchReportsByWard(wardNumber: number) {
    const { data, error } = await this.client
      .from("garbage_reports")
      .select("*")
      .eq("ward_number", wardNumber)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(normalizeReport);
  }

  override async fetchReportsByConstituency(constituency: string, type: "mla" | "mp") {
    const column = type === "mla" ? "assembly_constituency" : "parliamentary_constituency";
    const { data: wards, error } = await this.client.from("wards").select("ward_number").eq(column, constituency);
    if (error) throw error;
    if (!wards?.length) return [];
    const { data, error: reportError } = await this.client
      .from("garbage_reports")
      .select("*")
      .in(
        "ward_number",
        wards.map((ward) => ward.ward_number)
      )
      .order("created_at", { ascending: false });
    if (reportError) throw reportError;
    return (data ?? []).map(normalizeReport);
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
        resolved_photo_url: input.photoUrl,
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
    const { data: existing } = await this.client
      .from("report_upvotes")
      .select("id")
      .eq("report_id", reportId)
      .eq("voter_fingerprint", voter)
      .maybeSingle();
    if (existing) return { alreadyVoted: true };
    const { error } = await this.client.from("report_upvotes").insert({ report_id: reportId, voter_fingerprint: voter });
    if (error) throw error;
    const report = await this.fetchReportById(reportId);
    const newCount = (report?.upvote_count ?? 1) + 1;
    const { error: updateError } = await this.client.from("garbage_reports").update({ upvote_count: newCount }).eq("id", reportId);
    if (updateError) throw updateError;
    markUpvoted(reportId);
    return { alreadyVoted: false, newCount };
  }

  override async uploadReportPhoto(file: File) {
    const compressed = await compressImage(file);
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const path = `reports/${name}`;
    const { error } = await this.client.storage.from("garbage-photos").upload(path, compressed, {
      cacheControl: "3600",
      upsert: false,
      contentType: "image/jpeg"
    });
    if (error) throw error;
    return this.client.storage.from("garbage-photos").getPublicUrl(path).data.publicUrl;
  }

  override async adminStats(adminKey: string) {
    return this.callAdmin<AdminStats>(adminKey, "stats");
  }

  override async adminQueue(adminKey: string, status: ModerationStatus) {
    const response = await this.callAdmin<{ reports: GarbageReport[] }>(adminKey, `queue&status=${status}`);
    return response.reports.map(normalizeReport);
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
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<T>;
  }
}

export const backend: Backend = hasSupabaseConfig() ? new SupabaseBackend() : new LocalBackend();
