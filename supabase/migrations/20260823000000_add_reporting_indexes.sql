-- Support the public report feed ordering (created_at desc) and the realtime
-- refresh probes that filter public_report_change_events by changed_at.

create index if not exists idx_garbage_reports_created_at
  on public.garbage_reports (created_at desc);

-- Matches the public_garbage_reports predicate so approved-feed scans stay
-- index-only instead of filtering every row.
create index if not exists idx_garbage_reports_public_feed_created_at
  on public.garbage_reports (created_at desc)
  where moderation_status = 'approved'
    and status in ('unresolved', 'resolved');

create index if not exists idx_public_report_change_events_changed_at
  on public.public_report_change_events (changed_at);
