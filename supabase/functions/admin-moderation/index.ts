import { createClient } from "https://esm.sh/@supabase/supabase-js@2.87.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const adminKey = Deno.env.get("ADMIN_KEY") ?? "";
const supabase = createClient(supabaseUrl, serviceRoleKey);
const MODERATION_STATUSES = new Set(["flagged", "approved", "rejected"]);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const providedKey = request.headers.get("x-admin-key");
  if (!adminKey || providedKey !== adminKey) {
    return json({ error: "Unauthorized" }, 401);
  }

  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "stats";

  try {
    if (action === "stats") return json(await stats());
    if (action === "queue") return json({ reports: await queue(url.searchParams.get("status") ?? "flagged") });

    const body = request.method === "POST" ? await request.json() : {};
    if (action === "moderate") return json(await moderate(body.reportId, body.decision));
    if (action === "bulk") return json(await bulk(body.reportIds ?? [], body.decision));
    if (action === "swap_duplicate") return json(await swapDuplicate(body.reportId, body.existingId));
    if (action === "reject_both") return json(await rejectBoth(body.reportId, body.existingId));

    return json({ error: "Unknown action" }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});

async function stats() {
  const { count: total, error: totalError } = await supabase.from("garbage_reports").select("id", { count: "exact", head: true });
  if (totalError) throw totalError;

  const { count: flagged, error: flaggedError } = await supabase
    .from("garbage_reports")
    .select("id", { count: "exact", head: true })
    .eq("moderation_status", "flagged");
  if (flaggedError) throw flaggedError;

  const { count: rejected, error: rejectedError } = await supabase
    .from("garbage_reports")
    .select("id", { count: "exact", head: true })
    .eq("moderation_status", "rejected");
  if (rejectedError) throw rejectedError;

  const { count: approved, error: approvedError } = await supabase
    .from("garbage_reports")
    .select("id", { count: "exact", head: true })
    .eq("moderation_status", "approved");
  if (approvedError) throw approvedError;

  return { total: total ?? 0, flagged: flagged ?? 0, rejected: rejected ?? 0, approved: approved ?? 0 };
}

async function queue(status: string) {
  assertModerationStatus(status);
  const { data, error } = await supabase
    .from("garbage_reports")
    .select("*")
    .eq("moderation_status", status)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

async function moderate(reportId: string, decision: string) {
  assertModerationStatus(decision);
  const { error } = await supabase
    .from("garbage_reports")
    .update({
      moderation_status: decision,
      moderation_metadata: { moderated_at: new Date().toISOString(), decision_source: "admin" }
    })
    .eq("id", reportId);
  if (error) throw error;
  return { success: true };
}

async function bulk(reportIds: string[], decision: string) {
  assertModerationStatus(decision);
  const { error } = await supabase
    .from("garbage_reports")
    .update({
      moderation_status: decision,
      moderation_metadata: { moderated_at: new Date().toISOString(), decision_source: "admin_bulk" }
    })
    .in("id", reportIds);
  if (error) throw error;
  return { success: true };
}

async function swapDuplicate(reportId: string, existingId: string) {
  await moderate(reportId, "approved");
  await moderate(existingId, "rejected");
  return { success: true };
}

async function rejectBoth(reportId: string, existingId: string) {
  await bulk([reportId, existingId], "rejected");
  return { success: true };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function assertModerationStatus(value: string): asserts value is "flagged" | "approved" | "rejected" {
  if (!MODERATION_STATUSES.has(value)) {
    throw new Error("Invalid moderation status");
  }
}
