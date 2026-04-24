-- Store lightweight thumbnails beside full report photos so report lists can
-- load small images without waiting on camera-sized uploads.

alter table public.garbage_reports
  add column if not exists photo_thumb_url text,
  add column if not exists resolved_photo_thumb_url text;

drop view if exists public.public_garbage_reports;

create view public.public_garbage_reports
with (security_barrier = true, security_invoker = true)
as
select
  report.id,
  case
    when report.location_source = 'gps' then ward.center_lat
    else report.latitude
  end::numeric(10, 7) as latitude,
  case
    when report.location_source = 'gps' then ward.center_lng
    else report.longitude
  end::numeric(10, 7) as longitude,
  'ward_center'::text as location_source,
  report.ward_number,
  report.address,
  report.severity,
  report.category,
  report.status,
  report.photo_url,
  report.photo_thumb_url,
  report.upvote_count,
  report.resolved_at,
  report.resolved_photo_url,
  report.resolved_photo_thumb_url,
  null::numeric(10, 7) as resolved_lat,
  null::numeric(10, 7) as resolved_lng,
  report.created_at,
  report.updated_at,
  report.is_test,
  report.moderation_status
from public.garbage_reports report
join public.wards ward on ward.ward_number = report.ward_number
where report.moderation_status = 'approved'
  and report.status in ('unresolved', 'resolved');

comment on view public.public_garbage_reports is
  'Approved public report projection without raw GPS, reporter, note, or moderation metadata columns.';

revoke all on public.public_garbage_reports from public;
grant select on public.public_garbage_reports to anon, authenticated;

revoke select on public.garbage_reports from public, anon, authenticated;
grant select (
  id,
  latitude,
  longitude,
  location_source,
  ward_number,
  address,
  severity,
  category,
  status,
  photo_url,
  photo_thumb_url,
  upvote_count,
  resolved_at,
  resolved_photo_url,
  resolved_photo_thumb_url,
  created_at,
  updated_at,
  is_test,
  moderation_status
) on public.garbage_reports to anon, authenticated;

create or replace function public.submit_cleanup_proof(
  p_report_id        uuid,
  p_photo_url        text,
  p_photo_thumb_url  text,
  p_lat              numeric,
  p_lng              numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.garbage_reports;
begin
  select * into v_report
  from public.garbage_reports
  where id = p_report_id
    and moderation_status = 'approved'
    and status = 'unresolved';

  if not found then
    raise exception 'Report not found or not eligible for cleanup submission';
  end if;

  update public.garbage_reports
  set
    resolved_photo_url       = p_photo_url,
    resolved_photo_thumb_url = p_photo_thumb_url,
    resolved_lat             = p_lat,
    resolved_lng             = p_lng,
    moderation_status        = 'flagged',
    moderation_metadata      = jsonb_build_object(
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
    'resolved_lat',             v_report.resolved_lat,
    'resolved_lng',             v_report.resolved_lng,
    'updated_at',               v_report.updated_at
  );
end;
$$;

grant execute on function public.submit_cleanup_proof(uuid, text, text, numeric, numeric)
  to anon, authenticated;
