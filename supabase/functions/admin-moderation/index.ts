import { createClient } from "https://esm.sh/@supabase/supabase-js@2.87.1";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://ammaodisha.me",
  "https://www.ammaodisha.me",
  "https://ammaodisha.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173"
];
const allowedOrigins = new Set(
  (Deno.env.get("ADMIN_ALLOWED_ORIGINS") ?? DEFAULT_ALLOWED_ORIGINS.join(","))
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);
const baseCorsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Vary": "Origin"
};
const deniedCorsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Origin": "null"
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const adminKey = Deno.env.get("ADMIN_KEY") ?? "";
const supabase = createClient(supabaseUrl, serviceRoleKey);
const MODERATION_STATUSES = new Set(["flagged", "approved", "rejected"]);

Deno.serve(async (request) => {
  const origin = (request.headers.get("Origin") ?? "").trim();
  if (origin && !allowedOrigins.has(origin)) {
    return json({ error: "Origin not allowed" }, 403, deniedCorsHeaders);
  }

  const corsHeaders = getCorsHeaders(origin);
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const providedKey = request.headers.get("x-admin-key");
  if (!adminKey || !providedKey || !constantTimeEquals(providedKey, adminKey)) {
    return json({ error: "Unauthorized" }, 401, corsHeaders);
  }

  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "stats";

  try {
    if (action === "stats") return json(await stats(), 200, corsHeaders);
    if (action === "queue") return json({ reports: await queue(url.searchParams.get("status") ?? "flagged") }, 200, corsHeaders);

    const body = request.method === "POST" ? await request.json() : {};
    if (action === "moderate") return json(await moderate(body.reportId, body.decision), 200, corsHeaders);
    if (action === "bulk") return json(await bulk(body.reportIds ?? [], body.decision), 200, corsHeaders);
    if (action === "swap_duplicate") return json(await swapDuplicate(body.reportId, body.existingId), 200, corsHeaders);
    if (action === "reject_both") return json(await rejectBoth(body.reportId, body.existingId), 200, corsHeaders);

    return json({ error: "Unknown action" }, 404, corsHeaders);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500, corsHeaders);
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

function json(body: unknown, status = 200, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function getCorsHeaders(origin: string) {
  if (!origin) return { ...baseCorsHeaders };
  return {
    ...baseCorsHeaders,
    "Access-Control-Allow-Origin": origin
  };
}

function constantTimeEquals(left: string, right: string) {
  if (!left || !right) return false;
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    diff |= left.charCodeAt(index % left.length) ^ right.charCodeAt(index % right.length);
  }
  return diff === 0;
}

function assertModerationStatus(value: string): asserts value is "flagged" | "approved" | "rejected" {
  if (!MODERATION_STATUSES.has(value)) {
    throw new Error("Invalid moderation status");
  }
}
