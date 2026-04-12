import { writeFile, mkdir } from "node:fs/promises";

const outputDir = new URL("../public/", import.meta.url);
const sourceUrl = process.env.SEED_SOURCE_SUPABASE_URL || "https://tcldazhypyuutdpoksfx.supabase.co";
const sourceKey =
  process.env.SEED_SOURCE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjbGRhemh5cHl1dXRkcG9rc2Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyOTE5MzcsImV4cCI6MjA5MDg2NzkzN30.E6HWvErPgkTomXCuxunwwCBbDXsOZ4dVCQ2Bo7_BgAs";

await mkdir(outputDir, { recursive: true });

await Promise.all([
  pull("https://www.nammakasa.in/ward-boundaries.json", "ward-boundaries.json"),
  pull("https://www.nammakasa.in/Favicon.svg", "Favicon.svg"),
  pull("https://www.nammakasa.in/kasa-moderator-logo.svg", "kasa-moderator-logo.svg"),
  pull("https://www.nammakasa.in/OG.jpg", "OG.jpg", "arrayBuffer"),
  pull("https://www.nammakasa.in/apple-touch-icon.png", "apple-touch-icon.png", "arrayBuffer"),
  pullRest(
    "/rest/v1/wards?select=ward_number,ward_name,zone,assembly_constituency,parliamentary_constituency,center_lat,center_lng,locality_name&order=ward_number.asc",
    "wards.json"
  ),
  pullRest("/rest/v1/representatives?select=*&active=eq.true&order=name.asc", "representatives.json"),
  pullRest("/rest/v1/garbage_reports?select=*&is_test=eq.false&order=created_at.desc", "reports.json")
]);

async function pull(url, fileName, mode = "text") {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed ${url}: ${response.status}`);
  const body = mode === "arrayBuffer" ? Buffer.from(await response.arrayBuffer()) : await response.text();
  await writeFile(new URL(fileName, outputDir), body);
  console.log(`wrote public/${fileName}`);
}

async function pullRest(path, fileName) {
  const response = await fetch(`${sourceUrl}${path}`, {
    headers: { apikey: sourceKey, Authorization: `Bearer ${sourceKey}` }
  });
  if (!response.ok) throw new Error(`Failed ${path}: ${response.status} ${await response.text()}`);
  await writeFile(new URL(fileName, outputDir), JSON.stringify(await response.json(), null, 2));
  console.log(`wrote public/${fileName}`);
}
