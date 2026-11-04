-- Cleanup proofs previously REPLACED moderation_metadata with only
-- { flag_reason, cleanup_pending, cleanup_submitted_at }, wiping the audit
-- trail gathered before approval (text_check, claude_check, safesearch).
-- Merge instead: existing keys are preserved, the cleanup keys are overwritten.

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
    'resolved_lat',             v_report.resolved_lat,
    'resolved_lng',             v_report.resolved_lng,
    'updated_at',               v_report.updated_at
  );
end;
$$;

grant execute on function public.submit_cleanup_proof(uuid, text, text, numeric, numeric)
  to anon, authenticated;
