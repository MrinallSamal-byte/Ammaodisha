import type { SeverityKey, WasteCategory } from "../types/domain";

export const CITY_CENTER = { latitude: 20.2961, longitude: 85.8245 };
export const CITY_ZOOM = 12;
export const MAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
export const BMC_WHATSAPP = "916742432100";

export const PROD_HOSTNAMES = ["ammaodisha.vercel.app", "ammaodisha.in", "www.ammaodisha.in"];
export const IS_STAGING = typeof window !== "undefined" && !PROD_HOSTNAMES.includes(window.location.hostname);

export const SEVERITY: Record<
  SeverityKey,
  { color: string; label: string; size: number; description: string }
> = {
  small: {
    color: "#F59E0B",
    label: "Minor",
    size: 8,
    description: "A few bags or scattered litter — fits in a small area (under 1m²)"
  },
  medium: {
    color: "#F97316",
    label: "Moderate",
    size: 11,
    description: "Noticeable heap — roughly the size of an auto-rickshaw (1–5m²)"
  },
  large: {
    color: "#EF4444",
    label: "Severe",
    size: 14,
    description: "Covers a significant area — sidewalk blocked or road edge piled up (5–20m²)"
  },
  massive: {
    color: "#DC2626",
    label: "Critical",
    size: 18,
    description: "Major illegal dumpsite — occupies a vacant plot or entire stretch of road (20m²+)"
  }
};

export const CATEGORIES: Record<WasteCategory, string> = {
  household: "Household Waste",
  construction: "Construction Debris",
  mixed: "Mixed Waste",
  "e-waste": "E-Waste",
  biomedical: "Biomedical"
};

export const STATUS_LABELS = {
  unresolved: "Unresolved",
  resolved: "Resolved"
} as const;

export const PARTY_COLORS: Record<string, string> = {
  BJP: "#FF6B00",
  INC: "#00BFFF",
  JDS: "#00C853",
  AAP: "#5C6BC0"
};

export const CITY_BOUNDARY: [number, number][] = [
  [85.70, 20.15],
  [85.70, 20.40],
  [85.95, 20.40],
  [85.95, 20.15],
  [85.70, 20.15]
];

export const ESCALATION_THRESHOLDS = [3, 5, 10, 20, 50];
export const MAX_REPORTS_PER_DAY = 5;
export const SPAM_KEY = "nk_report_times";
export const UPVOTE_KEY = "nk_upvotes";
export const FINGERPRINT_KEY = "nk_fp";
export const LOCAL_REPORTS_KEY = "nk_local_reports";

export const CHANGELOG = [
  {
    version: "0.3.0",
    date: "Apr 2026",
    tag: "Launch",
    changes: [
      { type: "new", text: "Map with official Bhubaneswar ward boundaries" },
      { type: "new", text: "GPS-based ward detection with PostGIS" },
      { type: "new", text: "Photo capture, compression, and upload" },
      { type: "new", text: "Report submission with severity and category" },
      { type: "new", text: "Report detail with MLA/MP accountability" },
      { type: "new", text: "4 MLAs + 1 MP with photos and party data" },
      { type: "new", text: "Upvote system with fingerprint dedup" },
      { type: "new", text: "Resolve flow with before/after photos" },
      { type: "new", text: "Leaderboard: worst wards ranked" },
      { type: "new", text: "Realtime updates via Supabase subscriptions" }
    ]
  }
] as const;
