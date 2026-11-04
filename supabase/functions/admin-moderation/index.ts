import { createClient } from "https://esm.sh/@supabase/supabase-js@2.87.1";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const adminKey = Deno.env.get("ADMIN_KEY") ?? "";
const supabase = createClient(supabaseUrl, serviceRoleKey);
const MODERATION_STATUSES = new Set(["flagged", "approved", "rejected"]);

// Loopback origins are only trusted when the function runs against a local
// Supabase stack; deployed projects must opt in via ADMIN_ALLOWED_ORIGINS.
const isLocalRuntime = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(supabaseUrl);
const DEFAULT_ALLOWED_ORIGINS = [
  "https://ammaodisha.me",
  "https://www.ammaodisha.me",
  "https://ammaodisha.vercel.app",
  ...(isLocalRuntime ? ["http://localhost:5173", "http://127.0.0.1:5173", "http://127.0.0.1:4173"] : [])
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
    if (action === "queue") {
      const queueBody = request.method === "POST" ? await readJsonBody(request) : {};
      const limit = clampLimit(queueBody.limit);
      const pageOffset = clampOffset(queueBody.offset);
      return json(await queue(url.searchParams.get("status") ?? "flagged", limit, pageOffset), 200, corsHeaders);
    }

    const body = request.method === "POST" ? await readJsonBody(request) : {};
    if (action === "moderate") {
      const rejectionReason = typeof body.rejection_reason === "string" && body.rejection_reason.trim()
        ? body.rejection_reason.trim()
        : undefined;
      return json(await moderate(body.reportId, body.decision, rejectionReason), 200, corsHeaders);
    }
    if (action === "bulk") return json(await bulk(body.reportIds ?? [], body.decision), 200, corsHeaders);
    if (action === "swap_duplicate") return json(await swapDuplicate(body.reportId, body.existingId), 200, corsHeaders);
    if (action === "reject_both") return json(await rejectBoth(body.reportId, body.existingId), 200, corsHeaders);

    return json({ error: "Unknown action" }, 404, corsHeaders);
  } catch (error) {
    // Keep the response generic; the detail goes to the function logs only.
    console.error(`[admin-moderation] action=${action} failed:`, error);
    return json({ error: "Request failed. Try again." }, 500, corsHeaders);
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

async function queue(status: string, limit = 50, pageOffset = 0) {
  assertModerationStatus(status);
  const { data, error } = await supabase
    .from("garbage_reports")
    .select("*")
    .eq("moderation_status", status)
    .order("created_at", { ascending: false })
    .range(pageOffset, pageOffset + limit);
  if (error) throw error;
  const rows = data ?? [];
  // Fetch one extra row so hasMore is known without a second round trip.
  return { reports: rows.slice(0, limit), hasMore: rows.length > limit };
}

async function fetchModerationMetadata(reportIds: string[]) {
  const metadataById = new Map<string, Record<string, unknown>>();
  if (!reportIds.length) return metadataById;
  const { data, error } = await supabase
    .from("garbage_reports")
    .select("id, moderation_metadata")
    .in("id", reportIds);
  if (error) throw error;
  (data ?? []).forEach((row: { id: string; moderation_metadata?: Record<string, unknown> | null }) => {
    metadataById.set(row.id, row.moderation_metadata ?? {});
  });
  return metadataById;
}

function mergeModerationMetadata(existing: Record<string, unknown> | undefined, decisionSource: string, rejectionReason?: string) {
  const merged: Record<string, unknown> = {
    ...(existing ?? {}),
    moderated_at: new Date().toISOString(),
    decision_source: decisionSource
  };
  if (rejectionReason !== undefined && rejectionReason !== "") merged.rejection_reason = rejectionReason;
  return merged;
}

/**
 * Builds the update for one moderation decision, applying cleanup-proof rules
 * uniformly so single and bulk actions cannot drift apart.
 */
function buildModerationUpdate(
  existing: Record<string, unknown> | undefined,
  decision: "flagged" | "approved" | "rejected",
  source: "admin" | "admin_bulk",
  now: string,
  rejectionReason?: string
) {
  const metadata = mergeModerationMetadata(existing, source, rejectionReason);
  const fields: Record<string, unknown> = {
    moderation_status: decision,
    moderation_metadata: metadata
  };

  if (metadata.cleanup_pending === true && (decision === "approved" || decision === "rejected")) {
    metadata.cleanup_pending = false;
    if (decision === "approved") {
      fields.status = "resolved";
      fields.resolved_at = now;
      metadata.cleanup_approved_at = now;
    } else {
      // Rejecting the proof must not reject the underlying report: restore it
      // to the public map and record why the cleanup claim was refused.
      fields.moderation_status = "approved";
      metadata.cleanup_rejected_at = now;
    }
  }

  return fields;
}

async function moderate(reportId: string, decision: string, rejectionReason?: string) {
  assertModerationStatus(decision);

  const existingMetadata = await fetchModerationMetadata([reportId]);
  const { error } = await supabase
    .from("garbage_reports")
    .update(buildModerationUpdate(existingMetadata.get(reportId), decision, "admin", new Date().toISOString(), rejectionReason))
    .eq("id", reportId);
  if (error) throw error;
  return { success: true };
}

async function bulk(reportIds: string[], decision: string) {
  assertModerationStatus(decision);

  // Update rows individually so each report keeps its existing audit trail.
  const existingMetadata = await fetchModerationMetadata(reportIds);
  const now = new Date().toISOString();
  const results = await Promise.all(
    [...existingMetadata.keys()].map((reportId) =>
      supabase
        .from("garbage_reports")
        .update(buildModerationUpdate(existingMetadata.get(reportId), decision, "admin_bulk", now))
        .eq("id", reportId)
    )
  );
  const firstError = results.find((result) => result.error)?.error;
  if (firstError) throw firstError;
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

async function readJsonBody(request: Request): Promise<Record<string, any>> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function clampLimit(value: unknown) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(Math.max(parsed, 1), 200);
}

function clampOffset(value: unknown) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
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
