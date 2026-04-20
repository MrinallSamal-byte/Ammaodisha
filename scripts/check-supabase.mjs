import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const projectRef = "rynghcbuafynvxvtsuyn";
const defaultSupabaseUrl = `https://${projectRef}.supabase.co`;

const inheritedEnvKeys = new Set(Object.keys(process.env));
await loadEnvFiles([".env", ".env.local"], inheritedEnvKeys);

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || defaultSupabaseUrl;
const supabaseAnonKey =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY;
const adminFunctionUrl =
  process.env.VITE_ADMIN_FUNCTION_URL || `${supabaseUrl.replace(/\/$/, "")}/functions/v1/admin-moderation`;
const adminKey = process.env.SUPABASE_ADMIN_KEY || process.env.ADMIN_KEY;

const checks = [];

await check("Supabase URL points at the expected project", async () => {
  const url = new URL(supabaseUrl);
  assert(url.hostname === `${projectRef}.supabase.co`, `expected ${projectRef}.supabase.co, got ${url.hostname}`);
});

await check("Anon key is configured", async () => {
  assert(Boolean(supabaseAnonKey), "set VITE_SUPABASE_PUBLISHABLE_KEY in .env.local");
});

if (supabaseAnonKey) {
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  await checkTable(supabase, "wards", "ward_number");
  await checkTable(supabase, "representatives", "id");
  await checkTable(supabase, "garbage_reports", "id");
  await checkTable(supabase, "public_garbage_reports", "id");

  await check("Safe public report projection is readable", async () => {
    const { error } = await supabase
      .from("public_garbage_reports")
      .select("id,latitude,longitude,location_source,ward_number,photo_url,moderation_status")
      .limit(1);
    if (error) throw error;
  });

  await check("Raw report GPS datapoint columns are not publicly readable", async () => {
    const { error } = await supabase
      .from("garbage_reports")
      .select("id,gps_latitude,gps_longitude,gps_accuracy_meters,gps_recorded_at,location_source")
      .limit(1);
    assert(Boolean(error), "raw GPS columns were readable with the public key");
  });

  await check("Storage bucket garbage-photos listing endpoint is reachable", async () => {
    const { data, error } = await supabase.storage.from("garbage-photos").list("reports", { limit: 1 });
    if (error) throw error;
    return `${data?.length ?? 0} objects returned`;
  });

  await check("Storage bucket garbage-photos public URL endpoint is reachable", async () => {
    const { data } = supabase.storage.from("garbage-photos").getPublicUrl("reports/__public_probe__.jpg");
    const response = await fetch(data.publicUrl, { method: "GET" });
    const body = await response.text().catch(() => "");
    assert(response.status !== 401 && response.status !== 403, "public object URL requires auth");
    assert(
      response.status === 200 || response.status === 404 || (response.status === 400 && body.includes('"statusCode":"404"')),
      `expected public URL response (200/404 or 400+statusCode:404), got ${response.status}`
    );
  });
}

await check("Admin edge function is deployed and accepts CORS preflight", async () => {
  const response = await fetch(adminFunctionUrl, { method: "OPTIONS" });
  assert(response.status !== 404, "admin-moderation is not deployed to this project");
  assert(response.ok, `expected 2xx preflight, got ${response.status}`);
});

if (adminKey && !["demo", "changeme"].includes(adminKey.toLowerCase())) {
  await check("Admin edge function accepts the configured admin key", async () => {
    const response = await fetch(`${adminFunctionUrl}?action=stats`, {
      headers: { "x-admin-key": adminKey }
    });
    assert(response.ok, `expected 2xx stats response, got ${response.status}: ${await response.text()}`);
  });
}

for (const result of checks) {
  const icon = result.ok ? "OK " : "ERR";
  console.log(`${icon} ${result.label}${result.detail ? ` (${result.detail})` : ""}`);
}

const failures = checks.filter((result) => !result.ok);
if (failures.length) {
  console.error(`Supabase check failed: ${failures.length} issue${failures.length === 1 ? "" : "s"} found.`);
  process.exitCode = 1;
} else {
  console.log("Supabase check passed.");
}

async function checkTable(supabase, tableName, columnName) {
  await check(`Table ${tableName} is readable`, async () => {
    const { count, error } = await supabase.from(tableName).select(columnName, { count: "exact" }).limit(1);
    if (error) throw error;
    return `${count ?? 0} rows visible`;
  });
}

async function check(label, action) {
  try {
    const detail = await action();
    checks.push({ label, ok: true, detail });
  } catch (error) {
    checks.push({ label, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function loadEnvFiles(files, inheritedKeys) {
  for (const file of files) {
    if (!existsSync(file)) continue;
    const contents = await readFile(file, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (!match) continue;

      const key = match[1];
      if (inheritedKeys.has(key)) continue;

      const value = stripEnvValue(match[2] ?? "");
      process.env[key] = value;
    }
  }
}

function stripEnvValue(rawValue) {
  const value = rawValue.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value.replace(/\s+#.*$/, "");
}
