create schema if not exists extensions;
drop function if exists public.find_ward_by_location(numeric, numeric);
drop function if exists public.find_nearest_ward(numeric, numeric);
drop function if exists public.ward_geom(jsonb);
drop extension if exists postgis;
create extension postgis with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

alter table public.garbage_reports
  add column if not exists gps_latitude numeric(10, 7),
  add column if not exists gps_longitude numeric(10, 7),
  add column if not exists gps_accuracy_meters numeric(10, 2),
  add column if not exists gps_recorded_at timestamptz,
  add column if not exists location_source text not null default 'ward_center';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'garbage_reports_latitude_bounds_check'
  ) then
    alter table public.garbage_reports
      add constraint garbage_reports_latitude_bounds_check
      check (latitude between -90 and 90);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'garbage_reports_longitude_bounds_check'
  ) then
    alter table public.garbage_reports
      add constraint garbage_reports_longitude_bounds_check
      check (longitude between -180 and 180);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'garbage_reports_gps_bounds_check'
  ) then
    alter table public.garbage_reports
      add constraint garbage_reports_gps_bounds_check
      check (
        (gps_latitude is null or gps_latitude between -90 and 90)
        and (gps_longitude is null or gps_longitude between -180 and 180)
        and (gps_accuracy_meters is null or gps_accuracy_meters >= 0)
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'garbage_reports_location_source_check'
  ) then
    alter table public.garbage_reports
      add constraint garbage_reports_location_source_check
      check (
        location_source in ('gps', 'ward_center')
        and (
          location_source = 'ward_center'
          or (gps_latitude is not null and gps_longitude is not null)
        )
      );
  end if;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.ward_geom(geo jsonb)
returns extensions.geometry
language sql
immutable
set search_path = public, extensions
as $$
  select extensions.st_setsrid(extensions.st_geomfromgeojson((geo->'geometry')::text), 4326);
$$;

create or replace function public.find_ward_by_location(p_lat numeric, p_lng numeric)
returns table (
  ward_number integer,
  ward_name text,
  zone text,
  assembly_constituency text,
  parliamentary_constituency text,
  center_lat numeric,
  center_lng numeric
)
language sql
stable
set search_path = public, extensions
as $$
  select w.ward_number, w.ward_name, w.zone, w.assembly_constituency, w.parliamentary_constituency, w.center_lat, w.center_lng
  from public.wards w
  where w.boundary_geojson is not null
    and extensions.st_contains(
      public.ward_geom(w.boundary_geojson),
      extensions.st_setsrid(extensions.st_makepoint(p_lng::float8, p_lat::float8), 4326)
    )
  limit 1;
$$;

create or replace function public.find_nearest_ward(p_lat numeric, p_lng numeric)
returns table (
  ward_number integer,
  ward_name text,
  zone text,
  assembly_constituency text,
  parliamentary_constituency text,
  center_lat numeric,
  center_lng numeric
)
language sql
stable
set search_path = public, extensions
as $$
  select w.ward_number, w.ward_name, w.zone, w.assembly_constituency, w.parliamentary_constituency, w.center_lat, w.center_lng
  from public.wards w
  order by extensions.st_distance(
    extensions.st_setsrid(extensions.st_makepoint(w.center_lng::float8, w.center_lat::float8), 4326)::extensions.geography,
    extensions.st_setsrid(extensions.st_makepoint(p_lng::float8, p_lat::float8), 4326)::extensions.geography
  )
  limit 1;
$$;

create or replace function public.get_all_ward_boundaries()
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'type', 'FeatureCollection',
    'features', coalesce(jsonb_agg(boundary_geojson order by ward_number), '[]'::jsonb)
  )
  from public.wards
  where boundary_geojson is not null;
$$;

drop policy if exists "wards are public" on public.wards;
create policy "wards are public" on public.wards
for select to anon, authenticated
using (ward_number > 0);

drop policy if exists "reports are public readable" on public.garbage_reports;
create policy "reports are public readable" on public.garbage_reports
for select to anon, authenticated
using (
  moderation_status in ('flagged', 'approved')
  and status in ('unresolved', 'resolved')
);

drop policy if exists "anonymous citizens can report" on public.garbage_reports;
create policy "anonymous citizens can report" on public.garbage_reports
for insert to anon, authenticated
with check (
  status = 'unresolved'
  and moderation_status = 'flagged'
  and upvote_count = 1
  and latitude between -90 and 90
  and longitude between -180 and 180
  and (gps_latitude is null or gps_latitude between -90 and 90)
  and (gps_longitude is null or gps_longitude between -180 and 180)
  and (gps_accuracy_meters is null or gps_accuracy_meters >= 0)
  and location_source in ('gps', 'ward_center')
  and (
    location_source = 'ward_center'
    or (gps_latitude is not null and gps_longitude is not null)
  )
);

drop policy if exists "anonymous citizens can resolve reports" on public.garbage_reports;
create policy "anonymous citizens can resolve reports" on public.garbage_reports
for update to anon, authenticated
using (
  moderation_status in ('flagged', 'approved')
  and status in ('unresolved', 'resolved')
)
with check (
  moderation_status in ('flagged', 'approved')
  and status in ('unresolved', 'resolved')
  and upvote_count >= 1
  and (resolved_lat is null or resolved_lat between -90 and 90)
  and (resolved_lng is null or resolved_lng between -180 and 180)
);

drop policy if exists "anonymous citizens can upvote" on public.report_upvotes;
create policy "anonymous citizens can upvote" on public.report_upvotes
for insert to anon, authenticated
with check (
  length(voter_fingerprint) between 8 and 256
  and exists (
    select 1
    from public.garbage_reports report
    where report.id = report_id
      and report.moderation_status in ('flagged', 'approved')
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
      and report.moderation_status in ('flagged', 'approved')
      and report.status in ('unresolved', 'resolved')
  )
);

drop policy if exists "escalations are public readable" on public.ward_escalations;
create policy "escalations are public readable" on public.ward_escalations
for select to anon, authenticated
using (threshold > 0 and report_count >= 0);

grant select on public.wards, public.representatives, public.garbage_reports, public.report_upvotes, public.ward_escalations to anon, authenticated;
grant insert on public.garbage_reports, public.report_upvotes to anon, authenticated;
revoke update on public.garbage_reports from public, anon, authenticated;
grant update (
  status,
  upvote_count,
  resolved_at,
  resolved_photo_url,
  resolved_by_name,
  resolved_lat,
  resolved_lng
) on public.garbage_reports to anon, authenticated;
