import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { clearTimeout, setTimeout } from "node:timers";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const projectRef = "rynghcbuafynvxvtsuyn";
const defaultSupabaseUrl = `https://${projectRef}.supabase.co`;

const inheritedEnvKeys = new Set(Object.keys(process.env));
await loadEnvFiles([".env", ".env.local"], inheritedEnvKeys);

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || defaultSupabaseUrl;
const supabaseAnonKey =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const adminFunctionUrl =
  process.env.VITE_ADMIN_FUNCTION_URL || `${supabaseUrl.replace(/\/$/, "")}/functions/v1/admin-moderation`;
const adminKey = process.env.SUPABASE_ADMIN_KEY || process.env.CHECK_ADMIN_KEY || process.env.ADMIN_KEY;

const checks = [];

await check("Supabase URL points at the expected project", async () => {
  const url = new URL(supabaseUrl);
  assert(url.hostname === `${projectRef}.supabase.co`, `expected ${projectRef}.supabase.co, got ${url.hostname}`);
});

await check("Anon key is configured", async () => {
  assert(Boolean(supabaseAnonKey), "set VITE_SUPABASE_PUBLISHABLE_KEY in .env.local");
});

if (supabaseAnonKey) {
  const supabase = createSupabaseClient(supabaseAnonKey);

  await checkTable(supabase, "wards", "ward_number");
  await checkTable(supabase, "representatives", "id");
  await checkTable(supabase, "garbage_reports", "id");
  await checkTable(supabase, "public_garbage_reports", "id");
  await checkTable(supabase, "public_report_change_events", "id");
  await checkTable(supabase, "admin_queue_change_events", "id");

  await check("Safe public report projection is readable", async () => {
    const { error } = await supabase
      .from("public_garbage_reports")
      .select("id,latitude,longitude,location_source,ward_number,photo_url,moderation_status")
      .limit(1);
    if (error) throw error;
  });

  await check("Raw report coordinate columns are not publicly readable", async () => {
    const { error } = await supabase
      .from("garbage_reports")
      .select("id,latitude,longitude,gps_latitude,gps_longitude,gps_accuracy_meters,gps_recorded_at,location_source,moderation_metadata")
      .limit(1);
    assert(Boolean(error), "raw coordinate/GPS columns were readable with the public key");
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

  if (supabaseServiceRoleKey) {
    const serviceSupabase = createSupabaseClient(supabaseServiceRoleKey);
    await check("Report submission, approval, realtime signal, upvote, and rejection workflow", async () => {
      return checkReportWorkflow(supabase, serviceSupabase);
    });
  } else {
    checks.push({
      label: "Report write workflow probe skipped",
      ok: true,
      detail: "set SUPABASE_SERVICE_ROLE_KEY to verify insert/approval/rejection cleanup"
    });
  }
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

function createSupabaseClient(key) {
  return createClient(supabaseUrl, key, {
    realtime: {
      transport: WebSocket
    }
  });
}

async function checkReportWorkflow(anonSupabase, serviceSupabase) {
  const reportId = randomUUID();
  let realtimeProbe = null;
  let adminRealtimeProbe = null;

  try {
    const { data: ward, error: wardError } = await anonSupabase
      .from("wards")
      .select("ward_number, center_lat, center_lng")
      .order("ward_number")
      .limit(1)
      .maybeSingle();
    if (wardError) throw wardError;
    assert(ward, "no public ward row available for report probe");

    adminRealtimeProbe = subscribeToAdminQueueChangeEvent(anonSupabase);
    await adminRealtimeProbe.subscribed;
    const adminEventStartedAt = new Date().toISOString();

    const { error: insertError } = await anonSupabase.from("garbage_reports").insert({
      id: reportId,
      latitude: Number(ward.center_lat),
      longitude: Number(ward.center_lng),
      ward_number: Number(ward.ward_number),
      address: `Connectivity probe ${new Date().toISOString()}`,
      severity: "small",
      category: "mixed",
      is_test: true
    });
    if (insertError) throw insertError;

    const adminRealtimePayload = await adminRealtimeProbe.event;
    assert(
      ["insert", "update", "delete"].includes(adminRealtimePayload?.new?.event_type),
      "admin queue event did not arrive over Realtime"
    );

    const { count: adminEventCount, error: adminEventError } = await anonSupabase
      .from("admin_queue_change_events")
      .select("id", { count: "exact", head: true })
      .gte("changed_at", adminEventStartedAt);
    if (adminEventError) throw adminEventError;
    assert((adminEventCount ?? 0) >= 1, "new report submission did not create an admin queue change event");

    const { data: pendingPublic, error: pendingPublicError } = await anonSupabase
      .from("public_garbage_reports")
      .select("id")
      .eq("id", reportId)
      .maybeSingle();
    if (pendingPublicError) throw pendingPublicError;
    assert(!pendingPublic, "flagged report was visible before admin approval");

    const { data: pendingAdmin, error: pendingAdminError } = await serviceSupabase
      .from("garbage_reports")
      .select("moderation_status, status")
      .eq("id", reportId)
      .maybeSingle();
    if (pendingAdminError) throw pendingAdminError;
    assert(pendingAdmin?.moderation_status === "flagged", "new report was not queued as flagged");

    realtimeProbe = subscribeToReportChangeEvent(anonSupabase, reportId);
    await realtimeProbe.subscribed;

    const { error: approveError } = await serviceSupabase
      .from("garbage_reports")
      .update({
        moderation_status: "approved",
        moderation_metadata: {
          moderated_at: new Date().toISOString(),
          decision_source: "connectivity_probe"
        }
      })
      .eq("id", reportId);
    if (approveError) throw approveError;

    const { data: approvedPublic, error: approvedPublicError } = await anonSupabase
      .from("public_garbage_reports")
      .select("id, moderation_status, upvote_count")
      .eq("id", reportId)
      .maybeSingle();
    if (approvedPublicError) throw approvedPublicError;
    assert(approvedPublic?.moderation_status === "approved", "approved report was not visible in the public projection");

    const { count: approvalEventCount, error: approvalEventError } = await anonSupabase
      .from("public_report_change_events")
      .select("id", { count: "exact", head: true })
      .eq("report_id", reportId);
    if (approvalEventError) throw approvalEventError;
    assert((approvalEventCount ?? 0) >= 1, "approval did not create a public realtime change event");

    const realtimePayload = await realtimeProbe.event;
    assert(realtimePayload?.new?.report_id === reportId, "approval event did not arrive over Supabase Realtime");

    const { error: upvoteError } = await anonSupabase
      .from("report_upvotes")
      .insert({ report_id: reportId, voter_fingerprint: `probe-${randomUUID()}` });
    if (upvoteError) throw upvoteError;

    const { data: upvotedPublic, error: upvotedPublicError } = await anonSupabase
      .from("public_garbage_reports")
      .select("upvote_count")
      .eq("id", reportId)
      .maybeSingle();
    if (upvotedPublicError) throw upvotedPublicError;
    assert(Number(upvotedPublic?.upvote_count ?? 0) >= 2, "anonymous upvote did not update the public counter");

    const { error: rejectError } = await serviceSupabase
      .from("garbage_reports")
      .update({
        moderation_status: "rejected",
        moderation_metadata: {
          moderated_at: new Date().toISOString(),
          decision_source: "connectivity_probe",
          rejection_reason: "misleading_or_invalid"
        }
      })
      .eq("id", reportId);
    if (rejectError) throw rejectError;

    const { data: rejectedPublic, error: rejectedPublicError } = await anonSupabase
      .from("public_garbage_reports")
      .select("id")
      .eq("id", reportId)
      .maybeSingle();
    if (rejectedPublicError) throw rejectedPublicError;
    assert(!rejectedPublic, "rejected report remained visible publicly");

    return "probe inserted, admin realtime received, hidden pending, approved live, public realtime received, upvote counted, rejected hidden";
  } finally {
    if (realtimeProbe) await realtimeProbe.cleanup();
    if (adminRealtimeProbe) await adminRealtimeProbe.cleanup();
    await serviceSupabase.from("garbage_reports").delete().eq("id", reportId);
    await serviceSupabase.from("public_report_change_events").delete().eq("report_id", reportId);
  }
}

function subscribeToReportChangeEvent(supabase, reportId) {
  return subscribeToInsertEvent({
    channelName: `report-workflow-probe-${reportId}`,
    filter: `report_id=eq.${reportId}`,
    label: "Realtime report change event",
    supabase,
    table: "public_report_change_events"
  });
}

function subscribeToAdminQueueChangeEvent(supabase) {
  return subscribeToInsertEvent({
    channelName: `admin-queue-probe-${randomUUID()}`,
    label: "Realtime admin queue event",
    supabase,
    table: "admin_queue_change_events"
  });
}

function subscribeToInsertEvent({ channelName, filter, label, supabase, table }) {
  let settleSubscribed = () => {};
  let failSubscribed = () => {};
  let settleEvent = () => {};
  let failEvent = () => {};
  let subscribedSettled = false;
  let eventSettled = false;

  const subscribed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      subscribedSettled = true;
      reject(new Error("Realtime subscription did not become ready within 10 seconds"));
    }, 10_000);
    settleSubscribed = () => {
      if (subscribedSettled) return;
      subscribedSettled = true;
      clearTimeout(timer);
      resolve();
    };
    failSubscribed = (error) => {
      if (subscribedSettled) return;
      subscribedSettled = true;
      clearTimeout(timer);
      reject(error);
    };
  });

  const event = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      eventSettled = true;
      reject(new Error(`${label} was not received within 10 seconds`));
    }, 10_000);
    settleEvent = (payload) => {
      if (eventSettled) return;
      eventSettled = true;
      clearTimeout(timer);
      resolve(payload);
    };
    failEvent = (error) => {
      if (eventSettled) return;
      eventSettled = true;
      clearTimeout(timer);
      reject(error);
    };
  });

  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table,
        ...(filter ? { filter } : {})
      },
      (payload) => settleEvent(payload)
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        settleSubscribed();
        return;
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        const error = new Error(`Realtime subscription failed: ${status}`);
        failSubscribed(error);
        failEvent(error);
      }
    });

  return {
    cleanup: () => supabase.removeChannel(channel),
    event,
    subscribed
  };
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
