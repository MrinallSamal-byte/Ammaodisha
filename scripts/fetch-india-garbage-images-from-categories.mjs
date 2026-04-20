/* eslint-env node */

import fs from "node:fs";

const API = "https://commons.wikimedia.org/w/api.php";

const rootCategories = [
  "Waste in India",
  "Litter in India",
  "Landfills in India",
  "Burning waste in India",
  "Electronic waste in India",
  "Beach litter in India",
  "Waste in India by state or territory",
  "Waste in Odisha",
  "Waste in Delhi",
  "Waste in Telangana",
  "Waste in Maharashtra",
  "Deonar dumping ground",
  "Ghazipur landfill"
];

const maxDepth = 4;
const maxCategories = 500;
const outputTarget = 500;

const indiaPattern = /\bindia\b|indian|odisha|orissa|bhubaneswar|cuttack|puri|delhi|mumbai|kolkata|chennai|hyderabad|bengaluru|bangalore|pune|jaipur|kanpur|lucknow|patna|surat|ahmedabad|varanasi|mathura|guwahati|assam|kerala|karnataka|tamil nadu|maharashtra|uttar pradesh|telangana|andhra|punjab|rajasthan|jharkhand|bihar|madhya pradesh|west bengal|goa|dhenkanal/;
const garbagePattern = /garbage|trash|litter|rubbish|refuse|dump(?:ing|ed)?|landfill|sewage|waste\s*(?:dump|heap|pile|garbage|trash|rubbish|disposal|collection|site|ground|burning|plastic)|plastic\s*waste|solid\s*waste|municipal\s*solid\s*waste/;
const noisePattern = /bird|deer|flower|festival|palanquin|portrait|selfie|aeromedical|exercise tiger|military|museum|painting|drawing|logo|poster|map|brochure/;

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

function commonsFilePage(title) {
  const encoded = encodeURIComponent(title.replace(/^File:/, "")).replace(/%20/g, "_");
  return `https://commons.wikimedia.org/wiki/${encoded}`;
}

async function apiJson(params) {
  const response = await fetch(`${API}?${new globalThis.URLSearchParams({ ...params, format: "json", origin: "*" })}`);
  if (!response.ok) throw new Error(`API request failed: ${response.status}`);
  return response.json();
}

async function listCategoryMembers(categoryTitle, type) {
  const members = [];
  let cont;

  do {
    const params = {
      action: "query",
      list: "categorymembers",
      cmtitle: `Category:${categoryTitle}`,
      cmtype: type,
      cmlimit: "500"
    };
    if (cont) params.cmcontinue = cont;

    const data = await apiJson(params);
    members.push(...(data?.query?.categorymembers ?? []));
    cont = data?.continue?.cmcontinue;
  } while (cont);

  return members;
}

async function collectCategories() {
  const visited = new Set();
  const queue = rootCategories.map((name) => ({ depth: 0, name }));
  const ordered = [];

  while (queue.length && ordered.length < maxCategories) {
    const current = queue.shift();
    if (!current) break;
    if (visited.has(current.name)) continue;

    visited.add(current.name);
    ordered.push(current.name);

    if (current.depth >= maxDepth) continue;

    const subcats = await listCategoryMembers(current.name, "subcat");
    for (const sub of subcats) {
      const title = String(sub.title || "").replace(/^Category:/, "");
      if (!title || visited.has(title)) continue;
      queue.push({ depth: current.depth + 1, name: title });
    }
  }

  return ordered;
}

function chunk(values, size) {
  const out = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size));
  }
  return out;
}

function isRelevant({ title, categories, description, credit }) {
  const text = `${title} ${categories.join(" ")} ${description} ${credit}`.toLowerCase();
  return indiaPattern.test(text) && garbagePattern.test(text) && !noisePattern.test(text);
}

async function main() {
  const categories = await collectCategories();
  const fileTitles = new Set();

  for (const category of categories) {
    const files = await listCategoryMembers(category, "file");
    for (const file of files) {
      const title = String(file.title || "");
      if (title.startsWith("File:")) fileTitles.add(title);
    }
  }

  const details = [];
  const titleBatches = chunk([...fileTitles], 30);
  for (const titles of titleBatches) {
    const data = await apiJson({
      action: "query",
      prop: "imageinfo|categories",
      titles: titles.join("|"),
      iiprop: "url|size|timestamp|extmetadata",
      cllimit: "max"
    });

    const pages = Object.values(data?.query?.pages || {});
    for (const page of pages) {
      const title = String(page.title || "");
      if (!title.startsWith("File:")) continue;

      const image = page.imageinfo?.[0];
      if (!image?.url) continue;

      const ext = image.extmetadata || {};
      const categoriesList = (page.categories || []).map((category) => String(category.title || "").replace(/^Category:/, ""));
      const description = cleanHtml(ext.ImageDescription?.value || "");
      const credit = cleanHtml(ext.Credit?.value || ext.Artist?.value || "Wikimedia Commons");
      const license = cleanHtml(ext.LicenseShortName?.value || ext.License?.value || "") || null;
      const year =
        parseYear(ext.DateTimeOriginal?.value || "") ||
        parseYear(ext.DateTime?.value || "") ||
        parseYear(image.timestamp || "") ||
        0;

      const record = {
        title: title.replace(/^File:/, ""),
        photo_url: image.url,
        original_url: image.url,
        source_page: commonsFilePage(title),
        license,
        credit,
        width: image.width ?? null,
        height: image.height ?? null,
        year,
        categories: categoriesList
      };

      if (!isRelevant({ title: record.title, categories: categoriesList, description, credit })) continue;
      if ((record.width ?? 0) < 320 || (record.height ?? 0) < 220) continue;
      details.push(record);
    }
  }

  const unique = [];
  const seen = new Set();
  details
    .sort((left, right) => (right.year - left.year) || left.title.localeCompare(right.title))
    .forEach((item) => {
      if (seen.has(item.photo_url)) return;
      seen.add(item.photo_url);
      unique.push(item);
    });

  const limited = unique.slice(0, outputTarget).map((item, index) => ({
    id: index + 1,
    title: item.title,
    photo_url: item.photo_url,
    original_url: item.original_url,
    source_page: item.source_page,
    license: item.license,
    credit: item.credit,
    width: item.width,
    height: item.height,
    query: "wikimedia_category_tree",
    year: item.year
  }));

  fs.mkdirSync("tmp", { recursive: true });
  fs.writeFileSync("tmp/india-recent-garbage-images-category.json", JSON.stringify(limited, null, 2));

  console.log(
    JSON.stringify(
      {
        categoriesScanned: categories.length,
        fileTitlesCollected: fileTitles.size,
        relevant: unique.length,
        written: limited.length
      },
      null,
      2
    )
  );
}

await main();
