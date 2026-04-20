/* eslint-env node */

import fs from "node:fs";

const TARGET_COUNT = 340;

function readJson(path) {
  if (!fs.existsSync(path)) return [];
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function textOf(source) {
  return [
    source.title,
    source.source_page,
    source.query,
    source.credit,
    source.photo_url,
    source.original_url
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

const indiaPattern = /\bindia\b|indian|odisha|orissa|bhubaneswar|cuttack|puri|delhi|new delhi|mumbai|kolkata|chennai|hyderabad|bengaluru|bangalore|pune|jaipur|kanpur|lucknow|patna|surat|ahmedabad|varanasi|mathura|guwahati|assam|kerala|karnataka|tamil nadu|maharashtra|uttar pradesh|telangana|andhra|punjab|rajasthan|jharkhand|bihar|madhya pradesh|west bengal|goa|dhenkanal/;
const garbagePattern = /garbage|trash|litter|rubbish|refuse|dump(?:ing|ed)?|landfill|sewage|waste/;
const strongGarbagePattern = /garbage|trash|rubbish|dump(?:ing|ed)?|landfill|sewage|waste\s*(?:dump|heap|pile|garbage|trash|rubbish|disposal|collection|site|ground|burning|plastic)|plastic\s*waste|solid\s*waste|municipal\s*solid\s*waste/;
const noisePattern = /bird|deer|quail|babbler|flower|festival|palanquin|portrait|selfie|aeromedical|exercise tiger|military|museum|painting|drawing|logo|poster|map|brochure|utsav/;

function score(source) {
  const text = textOf(source);
  const year = Number(source.year || 0);
  let points = 0;

  if (source.__origin === "category") points += 100;
  else if (source.__origin === "search") points += 80;
  if (indiaPattern.test(text)) points += 30;
  if (strongGarbagePattern.test(text)) points += 25;
  else if (garbagePattern.test(text)) points += 10;

  if (year >= 2023) points += 20;
  else if (year >= 2020) points += 12;
  else if (year >= 2017) points += 6;

  if (/garbage|trash|rubbish|landfill|dump/.test(text)) points += 10;
  if (/bhubaneswar|odisha|delhi|hyderabad|mumbai|kolkata|chennai/.test(text)) points += 6;
  if (noisePattern.test(text)) points -= 45;

  return points;
}

function isStrict(source) {
  const text = textOf(source);
  return indiaPattern.test(text) && strongGarbagePattern.test(text) && !noisePattern.test(text);
}

function isRelaxed(source) {
  const text = textOf(source);
  return indiaPattern.test(text) && garbagePattern.test(text);
}

function normalizeSource(source, index) {
  return {
    id: index + 1,
    title: source.title || `India garbage source ${index + 1}`,
    photo_url: source.photo_url,
    original_url: source.original_url || source.photo_url,
    source_page: source.source_page || null,
    license: source.license || null,
    credit: source.credit || "Wikimedia Commons",
    width: source.width ?? null,
    height: source.height ?? null,
    query: source.query || null,
    year: Number(source.year || 0) || null
  };
}

const existing = readJson("public/report-image-sources.json");
const freshCategory = readJson("tmp/india-recent-garbage-images-category.json");
const freshSearch = readJson("tmp/india-recent-garbage-images-search.json");

const merged = [];
const seen = new Set();

for (const source of [
  ...freshCategory.map((item) => ({ ...item, __origin: "category" })),
  ...freshSearch.map((item) => ({ ...item, __origin: "search" })),
  ...existing.map((item) => ({ ...item, __origin: "existing" }))
]) {
  const url = source?.photo_url;
  if (!url || seen.has(url)) continue;
  seen.add(url);
  merged.push(source);
}

const internetPool = merged
  .filter((source) => source.__origin !== "existing")
  .map((source) => ({ ...source, __score: score(source) }))
  .sort((left, right) => right.__score - left.__score);

const strict = merged
  .filter((source) => source.__origin === "existing" && isStrict(source))
  .map((source) => ({ ...source, __score: score(source) }))
  .sort((left, right) => right.__score - left.__score);

const relaxed = merged
  .filter((source) => source.__origin === "existing" && !isStrict(source) && isRelaxed(source))
  .map((source) => ({ ...source, __score: score(source) }))
  .sort((left, right) => right.__score - left.__score);

const selected = [];
const selectedUrls = new Set();

for (const source of [...internetPool, ...strict, ...relaxed]) {
  if (selected.length >= TARGET_COUNT) break;
  if (selectedUrls.has(source.photo_url)) continue;
  selectedUrls.add(source.photo_url);
  selected.push(source);
}

const normalized = selected.map((source, index) => normalizeSource(source, index));

fs.writeFileSync("tmp/curated-india-report-image-sources.json", JSON.stringify(normalized, null, 2));

console.log(
  JSON.stringify(
    {
      existing: existing.length,
      freshCategory: freshCategory.length,
      freshSearch: freshSearch.length,
      merged: merged.length,
      internetPool: internetPool.length,
      strict: strict.length,
      relaxed: relaxed.length,
      selected: normalized.length
    },
    null,
    2
  )
);
