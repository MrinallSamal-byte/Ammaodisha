import { pointInRing } from "../../src/services/geo";
import type {
  isPublicReport as IsPublicReport,
  normalizeReportsForBhubaneswar as NormalizeReports
} from "../../src/services/backend";
import type {
  CityBoundaryFeatureCollection,
  GarbageReport,
  Ward,
  WardFeatureCollection
} from "../../src/types/domain";

let isPublicReport: typeof IsPublicReport;
let normalizeReportsForBhubaneswar: typeof NormalizeReports;

beforeAll(async () => {
  vi.stubEnv("VITE_LOCAL_ADMIN_KEY", "test-admin-key");
  ({ isPublicReport, normalizeReportsForBhubaneswar } = await import("../../src/services/backend"));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

function ring(minLng: number, minLat: number, maxLng: number, maxLat: number): [number, number][] {
  return [
    [minLng, minLat],
    [maxLng, minLat],
    [maxLng, maxLat],
    [minLng, maxLat],
    [minLng, minLat]
  ];
}

function report(overrides: Partial<GarbageReport> = {}): GarbageReport {
  return {
    id: "report-1",
    latitude: 20.25,
    longitude: 85.75,
    ward_number: 1,
    address: "Near market",
    severity: "medium",
    category: "mixed",
    status: "unresolved",
    upvote_count: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

const wards: Ward[] = [
  {
    ward_number: 1,
    ward_name: "Unit 4",
    zone: "A",
    assembly_constituency: "A",
    parliamentary_constituency: "P",
    center_lat: 20.25,
    center_lng: 85.75,
    locality_name: "Saheed Nagar"
  },
  {
    ward_number: 2,
    ward_name: "Patia",
    zone: "B",
    assembly_constituency: "B",
    parliamentary_constituency: "P",
    center_lat: 20.35,
    center_lng: 85.85,
    locality_name: null
  }
];

const wardBoundaries: WardFeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { ward_number: 1, ward_name: "Unit 4", assembly_constituency: "A", parliamentary_constituency: "P" },
      geometry: { type: "Polygon", coordinates: [ring(85.7, 20.2, 85.8, 20.3)] }
    },
    {
      type: "Feature",
      properties: { ward_number: 2, ward_name: "Patia", assembly_constituency: "B", parliamentary_constituency: "P" },
      geometry: { type: "Polygon", coordinates: [ring(85.8, 20.3, 85.9, 20.4)] }
    }
  ]
};

const cityBoundary: CityBoundaryFeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { Name: "BMC" },
      geometry: { type: "Polygon", coordinates: [ring(85.7, 20.2, 85.9, 20.4)] }
    }
  ]
};

function normalize(report: GarbageReport) {
  return normalizeReportsForBhubaneswar([report], wards, wardBoundaries, cityBoundary)[0];
}

describe("public report surface", () => {
  it("only exposes approved reports publicly", () => {
    expect(isPublicReport({ moderation_status: "approved" })).toBe(true);
    expect(isPublicReport({ moderation_status: undefined })).toBe(true);
    expect(isPublicReport({ moderation_status: "flagged" })).toBe(false);
    expect(isPublicReport({ moderation_status: "rejected" })).toBe(false);
  });
});

describe("normalizeReportsForBhubaneswar", () => {
  it("keeps an in-city report at its coordinates and matching ward", () => {
    const input = report();
    const result = normalize(input);

    expect(result.latitude).toBe(20.25);
    expect(result.longitude).toBe(85.75);
    expect(result.ward_number).toBe(1);
    expect(result.address).toBe("Near market");
  });

  it("moves an outside-city report into its fallback ward and rewrites the address", () => {
    const input = report({
      id: "bengaluru-report",
      latitude: 12.9716,
      longitude: 77.5946,
      ward_number: 2,
      address: "HSR Layout, Bengaluru",
      severity: "large",
      category: "construction",
      upvote_count: 4
    });

    const result = normalize(input);

    expect(result.ward_number).toBe(2);
    expect(result.latitude).not.toBe(input.latitude);
    expect(result.longitude).not.toBe(input.longitude);
    expect(pointInRing([result.longitude, result.latitude], ring(85.8, 20.3, 85.9, 20.4))).toBe(true);
    expect(result.address).toBe("Patia, Ward 2, Bhubaneswar");
    expect(result).toMatchObject({
      severity: "large",
      category: "construction",
      status: "unresolved",
      upvote_count: 4,
      created_at: "2026-01-01T00:00:00.000Z"
    });
  });

  it("rewrites out-of-city addresses even when the coordinates are inside Bhubaneswar", () => {
    const input = report({ address: "HSR Layout, Bengaluru" });
    const result = normalize(input);

    expect(result.latitude).toBe(20.25);
    expect(result.longitude).toBe(85.75);
    expect(result.address).toBe("Saheed Nagar, Ward 1, Bhubaneswar");
  });

  it("repositions an in-city report that falls outside every ward polygon", () => {
    const input = report({ latitude: 20.21, longitude: 85.89, ward_number: 2, address: "Near market" });
    const result = normalize(input);

    expect(result.ward_number).toBe(2);
    expect(result.latitude).not.toBe(input.latitude);
    expect(result.longitude).not.toBe(input.longitude);
    expect(pointInRing([result.longitude, result.latitude], ring(85.8, 20.3, 85.9, 20.4))).toBe(true);
    // The point is still inside the city, so a valid free-text landmark is kept.
    expect(result.address).toBe("Near market");
  });

  it("returns reports untouched when no wards are available", () => {
    const input = report();
    const [result] = normalizeReportsForBhubaneswar([input], [], wardBoundaries, cityBoundary);
    expect(result).toBe(input);
  });
});
