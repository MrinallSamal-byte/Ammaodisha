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
  upvote_count,
  resolved_at,
  resolved_photo_url,
  created_at,
  updated_at,
  is_test,
  moderation_status
) on public.garbage_reports to anon, authenticated;
