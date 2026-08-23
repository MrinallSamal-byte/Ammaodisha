import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";

export type SeverityKey = "small" | "medium" | "large" | "massive";
export type WasteCategory = "household" | "construction" | "mixed" | "e-waste" | "biomedical";
export type ReportStatus = "unresolved" | "resolved";
export type ModerationStatus = "flagged" | "approved" | "rejected";
export type RepresentativeRole = "mla" | "mp";
export type ReportLocationSource = "gps" | "ward_center";

export interface Ward {
  ward_number: number;
  ward_name: string;
  zone: string | null;
  assembly_constituency: string;
  parliamentary_constituency: string;
  center_lat: number;
  center_lng: number;
  locality_name?: string | null;
}

export interface Representative {
  id: number | string;
  name: string;
  role: RepresentativeRole;
  party: string;
  constituency: string;
  phone?: string | null;
  email?: string | null;
  photo_url?: string | null;
  profile_url?: string | null;
  twitter_handle?: string | null;
  active: boolean;
  created_at?: string;
}

export interface ModerationMetadata {
  flag_reason?: string;
  rejection_reason?: string;
  rate_limit?: unknown;
  text_check?: {
    flags?: string[];
    passed?: boolean;
    severity?: string;
  };
  duplicate_check?: {
    is_duplicate?: boolean;
    duplicate_of?: string;
    confidence?: number;
  };
  vision_safesearch?: Record<string, string>;
  moderated_at?: string;
  duplicate_of?: string;
  [key: string]: unknown;
}

export interface GarbageReport {
  id: string;
  latitude: number;
  longitude: number;
  gps_latitude?: number | null;
  gps_longitude?: number | null;
  gps_accuracy_meters?: number | null;
  gps_recorded_at?: string | null;
  location_source?: ReportLocationSource;
  ward_number: number;
  address: string;
  severity: SeverityKey;
  category: WasteCategory;
  status: ReportStatus;
  photo_url?: string | null;
  photo_thumb_url?: string | null;
  photo_source_url?: string | null;
  photo_source_title?: string | null;
  photo_license?: string | null;
  photo_credit?: string | null;
  photo_width?: number | null;
  photo_height?: number | null;
  reporter_id?: string | null;
  reporter_name?: string | null;
  upvote_count: number;
  resolved_at?: string | null;
  resolved_photo_url?: string | null;
  resolved_photo_thumb_url?: string | null;
  resolved_by_name?: string | null;
  resolved_lat?: number | null;
  resolved_lng?: number | null;
  notes?: string | null;
  created_at: string;
  updated_at?: string | null;
  is_test?: boolean;
  moderation_status?: ModerationStatus;
  moderation_metadata?: ModerationMetadata | null;
  flag_count?: number;
  _duplicate_original?: GarbageReport | null;
}

export interface NewReportInput {
  latitude: number;
  longitude: number;
  gps_latitude?: number | null;
  gps_longitude?: number | null;
  gps_accuracy_meters?: number | null;
  gps_recorded_at?: string | null;
  location_source?: ReportLocationSource;
  ward_number: number;
  address: string;
  severity: SeverityKey;
  category: WasteCategory;
  photo_url?: string | null;
  photo_thumb_url?: string | null;
}

export interface ResolveReportInput {
  photoUrl?: string | null;
  photoThumbUrl?: string | null;
  lat: number;
  lng: number;
  name?: string;
}

export interface UploadReportPhotoOptions {
  onProgress?: (progress: number) => void;
}

export interface UploadReportPhotoResult {
  url: string;
  thumbUrl?: string | null;
}

export type WardFeatureCollection = FeatureCollection<Polygon | MultiPolygon, WardFeatureProperties>;
export type CityBoundaryFeatureCollection = FeatureCollection<Polygon | MultiPolygon, CityBoundaryProperties>;

export interface CityBoundaryProperties {
  Name?: string;
  [key: string]: unknown;
}

export interface WardFeatureProperties {
  ward_number: number;
  ward_name: string;
  zone?: string | null;
  assembly_constituency: string;
  parliamentary_constituency: string;
}

export interface CivicData {
  wards: Ward[];
  cityBoundary: CityBoundaryFeatureCollection;
  wardBoundaries: WardFeatureCollection;
  representatives: Representative[];
  reports: GarbageReport[];
}

export interface AdminStats {
  total: number;
  flagged: number;
  rejected: number;
  approved: number;
}

export type RealtimeConnectionStatus = "live" | "reconnecting" | "offline";

export interface AdminQueuePage {
  reports: GarbageReport[];
  hasMore: boolean;
}

export interface ModerateReportOptions {
  rejectionReason?: string;
}

export interface Backend {
  fetchCivicData(): Promise<CivicData>;
  fetchReports(): Promise<GarbageReport[]>;
  fetchReportById(id: string): Promise<GarbageReport | null>;
  fetchReportsByWard(wardNumber: number): Promise<GarbageReport[]>;
  fetchReportsByConstituency(constituency: string, type: "mla" | "mp"): Promise<GarbageReport[]>;
  submitReport(input: NewReportInput): Promise<GarbageReport>;
  resolveReport(reportId: string, input: ResolveReportInput): Promise<GarbageReport>;
  upvoteReport(reportId: string): Promise<{ alreadyVoted: boolean; newCount?: number }>;
  uploadReportPhoto(file: File, options?: UploadReportPhotoOptions): Promise<UploadReportPhotoResult>;
  adminStats(adminKey: string): Promise<AdminStats>;
  adminQueue(adminKey: string, offset?: number): Promise<AdminQueuePage>;
  moderateReport(adminKey: string, reportId: string, status: ModerationStatus, options?: ModerateReportOptions): Promise<void>;
  bulkModerate(adminKey: string, reportIds: string[], decision: ModerationStatus): Promise<void>;
  swapDuplicate(adminKey: string, reportId: string, existingId: string): Promise<void>;
  rejectBoth(adminKey: string, reportId: string, existingId: string): Promise<void>;
  subscribeToChanges(callback: () => void, onStatus?: (status: RealtimeConnectionStatus) => void): () => void;
  subscribeToAdminChanges(callback: () => void, onStatus?: (status: RealtimeConnectionStatus) => void): () => void;
}
