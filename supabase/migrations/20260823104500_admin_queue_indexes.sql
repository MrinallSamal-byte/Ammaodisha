create index if not exists idx_garbage_reports_moderation_created_at
  on public.garbage_reports (moderation_status, created_at desc);

create index if not exists idx_garbage_reports_flagged_queue
  on public.garbage_reports (created_at desc)
  where moderation_status = 'flagged'
    and status = 'unresolved';
