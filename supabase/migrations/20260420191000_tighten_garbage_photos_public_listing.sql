-- Public buckets do not require storage.objects SELECT policies for direct object URL access.
-- Removing bucket-wide SELECT policies prevents anonymous clients from listing all object names.
do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and cmd = 'SELECT'
      and (
        coalesce(qual, '') ilike '%bucket_id = ''garbage-photos''%'
        or coalesce(with_check, '') ilike '%bucket_id = ''garbage-photos''%'
      )
  loop
    execute format('drop policy if exists %I on storage.objects', policy_record.policyname);
  end loop;
end
$$;
