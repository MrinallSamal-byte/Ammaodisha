import fs from "node:fs";
import path from "node:path";

import type { GarbageReport } from "../../src/types/domain";

interface ReportImageSource {
  credit?: string | null;
  height?: number | null;
  license?: string | null;
  photo_url?: string | null;
  source_page?: string | null;
  title?: string | null;
  width?: number | null;
}

function readPublicJson<T>(fileName: string): T {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), "public", fileName), "utf8")) as T;
}

function findDuplicates(values: string[]) {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()].filter(([, count]) => count > 1);
}

describe("seed report images", () => {
  it("keeps seeded reports within the app and database enum vocabulary", () => {
    const reports = readPublicJson<GarbageReport[]>("reports.json");
    const severities = new Set(["small", "medium", "large", "massive"]);
    const categories = new Set(["household", "construction", "mixed", "e-waste", "biomedical"]);
    const statuses = new Set(["unresolved", "resolved"]);
    const moderationStatuses = new Set(["flagged", "approved", "rejected"]);

    expect(reports.filter((report) => !severities.has(report.severity))).toEqual([]);
    expect(reports.filter((report) => !categories.has(report.category))).toEqual([]);
    expect(reports.filter((report) => !statuses.has(report.status))).toEqual([]);
    expect(reports.filter((report) => !moderationStatuses.has(report.moderation_status ?? "approved"))).toEqual([]);
  });

  it("uses a curated image source for every seeded report photo", () => {
    const reports = readPublicJson<GarbageReport[]>("reports.json");
    const sources = readPublicJson<ReportImageSource[]>("report-image-sources.json");
    const sourceUrls = sources.map((source) => source.photo_url).filter((url): url is string => Boolean(url));
    const sourcesByUrl = new Map(sources.map((source) => [source.photo_url, source]));

    expect(findDuplicates(sourceUrls)).toEqual([]);
    expect(reports.every((report) => Boolean(report.photo_url))).toBe(true);

    reports.forEach((report) => {
      const source = sourcesByUrl.get(report.photo_url);
      expect(source).toBeDefined();
      expect(report.photo_thumb_url).toBe(report.photo_url);
      expect(report.photo_source_url).toBe(source?.source_page ?? null);
      expect(report.photo_source_title).toBe(source?.title ?? null);
      expect(report.photo_license).toBe(source?.license ?? null);
      expect(report.photo_credit).toBe(source?.credit ?? null);
      expect(report.photo_width).toBe(source?.width ?? null);
      expect(report.photo_height).toBe(source?.height ?? null);
    });
  });
});
