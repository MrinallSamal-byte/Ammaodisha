import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type Entries = Record<string, string>;

const i18nSourcePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "services",
  "i18n.ts"
);

const source = readFileSync(i18nSourcePath, "utf8");

function extractDictionarySection(lang: "en" | "or"): string {
  const marker = `const ${lang}: Dictionary = {`;
  const markerIndex = source.indexOf(marker);
  expect(markerIndex, `dictionary "${lang}" section not found in src/services/i18n.ts`).toBeGreaterThanOrEqual(0);
  const bodyStart = markerIndex + marker.length;
  const bodyEnd = source.indexOf("\n};", bodyStart);
  expect(bodyEnd, `closing "};" for dictionary "${lang}" not found`).toBeGreaterThan(bodyStart);
  return source.slice(bodyStart, bodyStart === bodyEnd ? bodyStart : bodyEnd);
}

function parseEntries(section: string): { entries: Entries; duplicates: string[] } {
  const entries: Entries = {};
  const duplicates: string[] = [];
  const entryPattern =
    /^\s*(?:"(?<quoted>[A-Za-z0-9_.-]+)"|(?<bare>[A-Za-z$][A-Za-z0-9_$]*))\s*:\s*"(?<value>(?:[^"\\]|\\.)*)"\s*,?\s*$/gm;
  for (const match of section.matchAll(entryPattern)) {
    const key = match.groups?.quoted ?? match.groups?.bare;
    if (!key) continue;
    if (key in entries) {
      duplicates.push(key);
      continue;
    }
    entries[key] = match.groups?.value ?? "";
  }
  return { entries, duplicates };
}

const enResult = parseEntries(extractDictionarySection("en"));
const orResult = parseEntries(extractDictionarySection("or"));
const en = enResult.entries;
const or = orResult.entries;

describe("i18n dictionary parity", () => {
  it("parses both dictionaries with a healthy number of keys", () => {
    expect(Object.keys(en).length).toBeGreaterThan(50);
    expect(Object.keys(or).length).toBeGreaterThan(50);
  });

  it("has no duplicate keys within either dictionary section", () => {
    expect(enResult.duplicates).toEqual([]);
    expect(orResult.duplicates).toEqual([]);
  });

  it("declares every English key in the Odia dictionary", () => {
    const missingInOdia = Object.keys(en).filter((key) => !(key in or));
    expect(missingInOdia).toEqual([]);
  });

  it("does not declare extra Odia-only keys", () => {
    const missingInEnglish = Object.keys(or).filter((key) => !(key in en));
    expect(missingInEnglish).toEqual([]);
  });

  it("keeps every translation value non-empty", () => {
    for (const [lang, dict] of [["en", en], ["or", or]] as const) {
      const emptyKeys = Object.entries(dict)
        .filter(([, value]) => value.trim().length === 0)
        .map(([key]) => key);
      expect(emptyKeys, `"${lang}" dictionary has empty values`).toEqual([]);
    }
  });

  it("uses identical {placeholder} sets across languages per key", () => {
    const placeholdersOf = (value: string): string[] => (value.match(/\{[^{}]+\}/g) ?? []).sort();
    const mismatches = Object.keys(en)
      .filter((key) => key in or)
      .map((key) => ({ key, en: placeholdersOf(en[key]), or: placeholdersOf(or[key]) }))
      .filter((entry) => JSON.stringify(entry.en) !== JSON.stringify(entry.or));
    expect(mismatches).toEqual([]);
  });
});
