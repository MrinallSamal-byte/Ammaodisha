-- Hardens submit_cleanup_proof against anonymous abuse:
--   * Row-level lock (FOR UPDATE) closes the TOCTOU window where a proof could
--     resurrect a report an admin rejected concurrently.
--   * Input validation: coordinate bounds, photo URLs must reference this
--     project's garbage-photos storage bucket (blocks javascript:/data:/external
--     content injection), name length capped.
--   * moderation_metadata is MERGED instead of replaced so the audit trail
--     written by admins survives cleanup submissions.
--   * search_path pinned to '' (pg_temp-first hijack hardening).
--   * Adds bounds CHECK constraints on resolved_lat/resolved_lng.
-- The new p_name argument carries the optional "cleaned by" display name that
-- SupabaseBackend previously dropped; its default keeps older bundles working.

drop function if exists public.submit_cleanup_proof(uuid, text, text, numeric, numeric);
drop function if exists public.submit_cleanup_proof(uuid, text, text, numeric, numeric, text);

create or replace function public.submit_cleanup_proof(
  p_report_id        uuid,
  p_photo_url        text,
  p_photo_thumb_url  text,
  p_lat              numeric,
  p_lng              numeric,
  p_name             text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.garbage_reports;
begin
  if p_lat is null or p_lng is null
     or p_lat not between -90 and 90
     or p_lng not between -180 and 180 then
    raise exception 'Invalid coordinates';
  end if;

  if p_photo_url is not null and (
      p_photo_url !~ '^(/|https?://[^/]+/)storage/v1/object/public/garbage-photos/(reports|cleanup)/[A-Za-z0-9][A-Za-z0-9._/-]*$'
      or p_photo_url like '%..%'
  ) then
    raise exception 'Photo URL must reference the garbage-photos storage bucket';
  end if;

  if p_photo_thumb_url is not null and (
      p_photo_thumb_url !~ '^(/|https?://[^/]+/)storage/v1/object/public/garbage-photos/(reports|cleanup)/[A-Za-z0-9][A-Za-z0-9._/-]*$'
      or p_photo_thumb_url like '%..%'
  ) then
    raise exception 'Thumbnail URL must reference the garbage-photos storage bucket';
  end if;

  select * into v_report
  from public.garbage_reports
  where id = p_report_id
    and moderation_status = 'approved'
    and status = 'unresolved'
  for update;

  if not found then
    raise exception 'Report not found or not eligible for cleanup submission';
  end if;

  update public.garbage_reports
  set
    resolved_photo_url       = p_photo_url,
    resolved_photo_thumb_url = p_photo_thumb_url,
    resolved_by_name         = nullif(left(trim(coalesce(p_name, '')), 80), ''),
    resolved_lat             = p_lat,
    resolved_lng             = p_lng,
    moderation_status        = 'flagged',
    moderation_metadata      = coalesce(moderation_metadata, '{}'::jsonb) || jsonb_build_object(
      'flag_reason',          'cleanup_submitted',
      'cleanup_pending',      true,
      'cleanup_submitted_at', now()::text
    ),
    updated_at = now()
  where id = p_report_id
  returning * into v_report;

  return jsonb_build_object(
    'id',                       v_report.id,
    'status',                   v_report.status,
    'moderation_status',        v_report.moderation_status,
    'resolved_photo_url',       v_report.resolved_photo_url,
    'resolved_photo_thumb_url', v_report.resolved_photo_thumb_url,
    'resolved_by_name',         v_report.resolved_by_name,
    'resolved_lat',             v_report.resolved_lat,
    'resolved_lng',             v_report.resolved_lng,
    'updated_at',               v_report.updated_at
  );
end;
$$;

revoke all on function public.submit_cleanup_proof(uuid, text, text, numeric, numeric, text) from public;
grant execute on function public.submit_cleanup_proof(uuid, text, text, numeric, numeric, text)
  to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'garbage_reports_resolved_coords_bounds'
  ) then
    alter table public.garbage_reports
      add constraint garbage_reports_resolved_coords_bounds
      check (
        (resolved_lat is null or resolved_lat between -90 and 90)
        and (resolved_lng is null or resolved_lng between -180 and 180)
      );
  end if;
end
$$;
