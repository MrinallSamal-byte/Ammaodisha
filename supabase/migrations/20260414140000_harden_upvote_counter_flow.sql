create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to postgres, service_role;

create or replace function private.apply_report_upvote_count()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  update public.garbage_reports
  set upvote_count = greatest(coalesce(upvote_count, 1), 1) + 1
  where id = new.report_id;

  return new;
end;
$$;

revoke all on function private.apply_report_upvote_count() from public, anon, authenticated;

drop trigger if exists report_upvotes_increment_count on public.report_upvotes;
create trigger report_upvotes_increment_count
after insert on public.report_upvotes
for each row execute function private.apply_report_upvote_count();

revoke update on public.garbage_reports from public, anon, authenticated;
grant update (
  status,
  resolved_at,
  resolved_photo_url,
  resolved_by_name,
  resolved_lat,
  resolved_lng
) on public.garbage_reports to anon, authenticated;
