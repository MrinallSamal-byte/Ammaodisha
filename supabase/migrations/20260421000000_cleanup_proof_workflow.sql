-- Allow citizens to submit cleanup proof for approved reports.
-- This RPC runs as the service role (SECURITY DEFINER) so it can bypass
-- the locked-down RLS that prevents anon/authenticated UPDATE access.
-- After submission, the report is re-queued for admin review (moderation_status
-- flipped back to 'flagged' with cleanup_pending metadata). The admin's
-- "Approve" action will then detect cleanup_pending and set status='resolved'.

create or replace function public.submit_cleanup_proof(
  p_report_id  uuid,
  p_photo_url  text,
  p_lat        numeric,
  p_lng        numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.garbage_reports;
begin
  -- Only allow cleanup on currently approved, unresolved reports
  select * into v_report
  from public.garbage_reports
  where id = p_report_id
    and moderation_status = 'approved'
    and status = 'unresolved';

  if not found then
    raise exception 'Report not found or not eligible for cleanup submission';
  end if;

  -- Store cleanup evidence and re-queue for admin review
  update public.garbage_reports
  set
    resolved_photo_url  = p_photo_url,
    resolved_lat        = p_lat,
    resolved_lng        = p_lng,
    moderation_status   = 'flagged',
    moderation_metadata = jsonb_build_object(
      'flag_reason',          'cleanup_submitted',
      'cleanup_pending',      true,
      'cleanup_submitted_at', now()::text
    ),
    updated_at = now()
  where id = p_report_id
  returning * into v_report;

  return jsonb_build_object(
    'id',                 v_report.id,
    'status',             v_report.status,
    'moderation_status',  v_report.moderation_status,
    'resolved_photo_url', v_report.resolved_photo_url,
    'resolved_lat',       v_report.resolved_lat,
    'resolved_lng',       v_report.resolved_lng,
    'updated_at',         v_report.updated_at
  );
end;
$$;

-- Allow anonymous citizens to call this function
grant execute on function public.submit_cleanup_proof(uuid, text, numeric, numeric)
  to anon, authenticated;
