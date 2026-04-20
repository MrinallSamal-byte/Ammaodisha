/* eslint-env node */

import fs from "node:fs";

const endpoint = "https://commons.wikimedia.org/w/api.php";
const baseTerms = [
  "garbage dump india",
  "garbage heap india",
  "open garbage india",
  "waste dumping india",
  "landfill india",
  "plastic waste india",
  "municipal solid waste india",
  "rubbish dump india",
  "dumped garbage india"
];
const cities = [
  "bhubaneswar",
  "cuttack",
  "puri",
  "delhi",
  "mumbai",
  "kolkata",
  "chennai",
  "hyderabad",
  "bengaluru",
  "pune",
  "jaipur",
  "lucknow",
  "kanpur",
  "patna",
  "surat",
  "ahmedabad",
  "indore",
  "nagpur",
  "visakhapatnam",
  "coimbatore",
  "kochi",
  "guwahati",
  "varanasi",
  "mathura",
  "amritsar",
  "shimla"
];
const cityPatterns = ["garbage", "waste dump", "trash dump", "landfill", "rubbish dump", "open dump", "waste pile"];
const terms = [...baseTerms, ...cities.flatMap((city) => cityPatterns.map((pattern) => `${pattern} ${city}`))];

const seenTitles = new Set();
const picked = [];

function cleanHtml(value = "") {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseYear(text) {
  const match = String(text || "").match(/(19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

function toCommonsTitleUrl(title) {
  const encoded = encodeURIComponent(title.replace(/^File:/, ""));
  return encoded.replace(/%20/g, "_");
}

function isIndiaHit({ title, categories, description, credit }) {
  const haystack = `${title} ${categories.join(" ")} ${description} ${credit}`.toLowerCase();
  return /\bindia\b|odisha|bhubaneswar|delhi|mumbai|kolkata|chennai|bengaluru|bangalore|hyderabad|pune|jaipur|kanpur|lucknow|patna|surat|ahmedabad|varanasi|mathura|puri|dhenkanal/.test(
    haystack
  );
}

function isWasteHit({ title, categories, description }) {
  const haystack = `${title} ${categories.join(" ")} ${description}`.toLowerCase();
  return /(garbage|trash|rubbish|refuse|dump(?:ed|ing)?|landfill|waste\s*(?:dump|heap|pile|garbage|trash|rubbish|disposal|collection|ground|site|material|plastic|burning)|plastic\s*waste|solid\s*waste|municipal\s*solid\s*waste)/.test(
    haystack
  );
}

function isNonGarbageNoise({ title, categories, description }) {
  const haystack = `${title} ${categories.join(" ")} ${description}`.toLowerCase();
  return /(bird|deer|railway|palanquin|utsav|festival|wildlife|nature|flower|portrait|selfie|exercise tiger|aeromedical|military|museum|painting|drawing|map|logo|poster|exhibition|weir|palace|temple)/.test(
    haystack
  );
}

async function searchTerm(term) {
  let offset;

  for (let page = 0; page < 5; page += 1) {
    const params = new globalThis.URLSearchParams({
      action: "query",
      format: "json",
      generator: "search",
      gsrsearch: `${term} filetype:bitmap`,
      gsrnamespace: "6",
      gsrlimit: "50",
      prop: "imageinfo|categories",
      iiprop: "url|size|timestamp|extmetadata",
      cllimit: "max",
      origin: "*"
    });

    if (offset != null) params.set("gsroffset", String(offset));

    const response = await fetch(`${endpoint}?${params.toString()}`);
    if (!response.ok) break;

    const data = await response.json();
    const pages = Object.values(data?.query?.pages || {});

    for (const pageData of pages) {
      const title = pageData.title || "";
      if (!title.startsWith("File:")) continue;
      if (seenTitles.has(title)) continue;

      const image = pageData.imageinfo?.[0];
      if (!image?.url) continue;

      const categories = (pageData.categories || []).map((category) =>
        String(category.title || "").replace(/^Category:/, "")
      );
      const ext = image.extmetadata || {};
      const description = cleanHtml(ext.ImageDescription?.value || "");
      const credit = cleanHtml(ext.Credit?.value || ext.Artist?.value || "Wikimedia Commons");
      const license = cleanHtml(ext.LicenseShortName?.value || ext.License?.value || "") || null;

      if (!isIndiaHit({ title, categories, description, credit })) continue;
      if (!isWasteHit({ title, categories, description })) continue;
      if (isNonGarbageNoise({ title, categories, description })) continue;

      const capturedYear = parseYear(ext.DateTimeOriginal?.value || "") || parseYear(ext.DateTime?.value || "");
      const uploadedYear = parseYear(image.timestamp || "");
      const year = capturedYear || uploadedYear || 0;
      if (year < 2018) continue;
      if ((image.width ?? 0) < 400 || (image.height ?? 0) < 260) continue;

      seenTitles.add(title);
      picked.push({
        title: title.replace(/^File:/, ""),
        photo_url: image.url,
        original_url: image.url,
        source_page: `https://commons.wikimedia.org/wiki/${toCommonsTitleUrl(title)}`,
        license,
        credit: credit || "Wikimedia Commons",
        width: image.width ?? null,
        height: image.height ?? null,
        query: term,
        year,
        categories
      });
    }

    if (!data?.continue?.gsroffset) break;
    offset = Number(data.continue.gsroffset);
  }
}

for (const term of terms) {
  await searchTerm(term);
}

picked.sort((left, right) => (right.year - left.year) || left.title.localeCompare(right.title));

const uniqueUrlSet = new Set();
const curated = [];
for (const image of picked) {
  if (uniqueUrlSet.has(image.photo_url)) continue;
  uniqueUrlSet.add(image.photo_url);

  curated.push({
    id: curated.length + 1,
    title: image.title,
    photo_url: image.photo_url,
    original_url: image.original_url,
    source_page: image.source_page,
    license: image.license,
    credit: image.credit,
    width: image.width,
    height: image.height,
    query: image.query,
    year: image.year
  });

  if (curated.length >= 450) break;
}

fs.mkdirSync("tmp", { recursive: true });
fs.writeFileSync("tmp/india-recent-garbage-images-search.json", JSON.stringify(curated, null, 2));

console.log(JSON.stringify({ terms: terms.length, picked: picked.length, curated: curated.length }, null, 2));
