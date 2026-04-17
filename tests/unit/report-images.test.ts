import fs from "node:fs";
import path from "node:path";

import type { GarbageReport } from "../../src/types/domain";

interface ReportImageSource {
  photo_url?: string | null;
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
  it("uses one unique image URL per seeded report", () => {
    const reports = readPublicJson<GarbageReport[]>("reports.json");
    const photoUrls = reports.map((report) => report.photo_url).filter((url): url is string => Boolean(url));

    expect(photoUrls).toHaveLength(reports.length);
    expect(findDuplicates(photoUrls)).toEqual([]);
  });

  it("keeps enough unique replacement images for report normalization", () => {
    const reports = readPublicJson<GarbageReport[]>("reports.json");
    const sources = readPublicJson<ReportImageSource[]>("report-image-sources.json");
    const sourceUrls = sources.map((source) => source.photo_url).filter((url): url is string => Boolean(url));

    expect(findDuplicates(sourceUrls)).toEqual([]);
    expect(sourceUrls.length).toBeGreaterThanOrEqual(reports.length);
  });
});
