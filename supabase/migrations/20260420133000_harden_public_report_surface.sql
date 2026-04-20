-- Public readers should only see moderator-approved reports through a safe
-- projection. Raw GPS, reporter fields, notes, and moderation metadata stay on
-- the base table for service-role/admin use.
drop view if exists public.public_garbage_reports;

create view public.public_garbage_reports
with (security_barrier = true)
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
  report.upvote_count,
  report.resolved_at,
  report.resolved_photo_url,
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

drop policy if exists "reports are public readable" on public.garbage_reports;
create policy "reports are public readable" on public.garbage_reports
for select to anon, authenticated
using (
  moderation_status = 'approved'
  and status in ('unresolved', 'resolved')
);

drop policy if exists "anonymous citizens can resolve reports" on public.garbage_reports;
revoke update on public.garbage_reports from public, anon, authenticated;

revoke select on public.garbage_reports from public, anon, authenticated;
grant select (
  id,
  ward_number,
  status,
  moderation_status,
  is_test,
  upvote_count
) on public.garbage_reports to anon, authenticated;

drop policy if exists "anonymous citizens can upvote" on public.report_upvotes;
create policy "anonymous citizens can upvote" on public.report_upvotes
for insert to anon, authenticated
with check (
  length(voter_fingerprint) between 8 and 256
  and exists (
    select 1
    from public.garbage_reports report
    where report.id = report_id
      and report.moderation_status = 'approved'
      and report.status in ('unresolved', 'resolved')
  )
);

drop policy if exists "upvotes are public readable" on public.report_upvotes;
create policy "upvotes are public readable" on public.report_upvotes
for select to anon, authenticated
using (
  exists (
    select 1
    from public.garbage_reports report
    where report.id = report_id
      and report.moderation_status = 'approved'
      and report.status in ('unresolved', 'resolved')
  )
);

revoke select on public.report_upvotes from public, anon, authenticated;
grant select (report_id) on public.report_upvotes to anon, authenticated;

drop policy if exists "public can upload garbage photos" on storage.objects;
create policy "public can upload garbage photos" on storage.objects
for insert to anon, authenticated
with check (
  bucket_id = 'garbage-photos'
  and (
    name like 'reports/%'
    or name like 'cleanup/%'
  )
);
