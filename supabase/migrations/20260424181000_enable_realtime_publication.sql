-- Enable Supabase Realtime for public report updates that the web app listens to.
-- The app refreshes public data when reports are inserted/updated/deleted or
-- when upvote inserts trigger the report upvote counter.

alter table public.garbage_reports replica identity full;
alter table public.report_upvotes replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'garbage_reports'
  ) then
    alter publication supabase_realtime add table public.garbage_reports;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'report_upvotes'
  ) then
    alter publication supabase_realtime add table public.report_upvotes;
  end if;
end $$;
