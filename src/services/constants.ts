import type { SeverityKey, WasteCategory } from "../types/domain";

export const CITY_CENTER = { latitude: 20.2961, longitude: 85.8245 };
export const CITY_ZOOM = 12;
export const CITY_MIN_ZOOM = 10;
export const CITY_MAX_BOUNDS: [[number, number], [number, number]] = [
  [85.65, 20.1],
  [86, 20.45]
];
export const MAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
export const BMC_WHATSAPP = "916742432100";

export const BMC_CONTACTS = {
  name: "Bhubaneswar Municipal Corporation",
  short_name: "BMC",
  main_contact_number: "8280282000",
  helpline_number: "1929",
  email: "info@bmc.gov.in",
  grievance_email: "grievance@bmc.gov.in",
  address: "BMC - ICOMC Tower, Unit-IX, In front of Satya Nagar Kali Temple on Janpath, Bhubaneswar-751022, Odisha, India",
  zone_contacts: {
    north_zone: "0674-2301002",
    south_west_zone: "0674-2552715",
    south_east_zone: "0674-2431343"
  },
  total_wards: 67,
  ward_numbers: [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
    31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
    41, 42, 43, 44, 45, 46, 47, 48, 49, 50,
    51, 52, 53, 54, 55, 56, 57, 58, 59, 60,
    61, 62, 63, 64, 65, 66, 67
  ]
} as const;

export const BMC_NUMBER = BMC_CONTACTS.main_contact_number;
export const BMC_HELPLINE = BMC_CONTACTS.helpline_number;

export const PROD_HOSTNAMES = ["ammaodisha.vercel.app", "ammaodisha.me", "www.ammaodisha.me"];
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

// BJD (Biju Janata Dal) added — dominant party in Odisha and present across
// most Bhubaneswar wards. Without it, BJD reps fell through with no color.
export const PARTY_COLORS: Record<string, string> = {
  BJP: "#FF6B00",
  BJD: "#00a859",
  INC: "#00BFFF",
  JDS: "#00C853",
  AAP: "#5C6BC0"
};

export const ESCALATION_THRESHOLDS = [3, 5, 10, 20, 50];
export const MAX_REPORTS_PER_DAY = 5;
export const SPAM_KEY = "nk_report_times";
export const UPVOTE_KEY = "nk_upvotes";
export const FINGERPRINT_KEY = "nk_fp";
export const LOCAL_REPORTS_KEY = "nk_local_reports";
export const OUTSIDE_CITY_LOCALITY_PATTERNS = [
  "bengaluru",
  "bangalore",
  "karnataka",
  "hsr",
  "koramangala",
  "marathahalli",
  "mahadevapura",
  "banashankari"
] as const;

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
