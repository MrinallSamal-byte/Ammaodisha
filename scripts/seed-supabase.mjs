import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Set VITE_SUPABASE_URL/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before seeding.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey);
const root = new URL("../public/", import.meta.url);
const [wards, boundaries, representatives, reports] = await Promise.all([
  readJson("wards.json"),
  readJson("ward-boundaries.json"),
  readJson("representatives.json"),
  readJson("reports.json")
]);

const boundaryByWard = new Map(boundaries.features.map((feature) => [feature.properties.ward_number, feature]));

await upsertChunk(
  "wards",
  wards.map((ward) => ({ ...ward, boundary_geojson: boundaryByWard.get(ward.ward_number) ?? null })),
  "ward_number"
);
await upsertChunk("representatives", representatives, "id");
await upsertChunk("garbage_reports", reports, "id");

console.log("Supabase seed complete.");

async function readJson(fileName) {
  return JSON.parse(await readFile(new URL(fileName, root), "utf8"));
}

async function upsertChunk(table, rows, onConflict) {
  for (let index = 0; index < rows.length; index += 100) {
    const chunk = rows.slice(index, index + 100);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) throw error;
    console.log(`upserted ${chunk.length} rows into ${table}`);
  }
}
