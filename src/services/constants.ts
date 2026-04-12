import type { SeverityKey, WasteCategory } from "../types/domain";

export const BANGALORE_CENTER = { latitude: 12.9716, longitude: 77.5946 };
export const BANGALORE_ZOOM = 11.5;
export const MAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
export const BBMP_WHATSAPP = "919448197197";

export const PROD_HOSTNAMES = ["nammakasa.vercel.app", "nammakasa.in", "www.nammakasa.in"];
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

export const BANGALORE_BOUNDARY: [number, number][] = [
  [77.4717064, 12.9514133],
  [77.4744831, 12.9729396],
  [77.490584, 13.0458456],
  [77.5401172, 13.0905894],
  [77.579864, 13.1432172],
  [77.6309189, 13.1264537],
  [77.6501609, 13.0815362],
  [77.7253762, 13.0326913],
  [77.7794191, 12.9772567],
  [77.7463167, 12.9193407],
  [77.6745457, 12.8931302],
  [77.6094125, 12.8454974],
  [77.5451648, 12.8470138],
  [77.488247, 12.885312],
  [77.4717064, 12.9514133]
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
      { type: "new", text: "Map with 243 BBMP ward boundaries" },
      { type: "new", text: "GPS-based ward detection with PostGIS" },
      { type: "new", text: "Photo capture, compression, and upload" },
      { type: "new", text: "Report submission with severity and category" },
      { type: "new", text: "Report detail with MLA/MP accountability" },
      { type: "new", text: "28 MLAs + 4 MPs with photos and party data" },
      { type: "new", text: "Upvote system with fingerprint dedup" },
      { type: "new", text: "Resolve flow with before/after photos" },
      { type: "new", text: "Leaderboard: worst wards ranked" },
      { type: "new", text: "Realtime updates via Supabase subscriptions" }
    ]
  }
] as const;
