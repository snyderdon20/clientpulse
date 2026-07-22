-- Run in Supabase Dashboard → SQL Editor
--
-- Event-level idempotency for Vagaro webhooks. The webhook envelope carries a
-- unique `id`; Vagaro retries a failed delivery up to 5 times over 15 minutes.
-- Storing that id and enforcing uniqueness lets the handler detect a retry and
-- skip reprocessing (which otherwise double-counts no_shows and duplicates
-- history rows).

alter table webhook_log add column if not exists event_id text;

-- Partial unique index: only enforced when event_id is set, so older log rows
-- (event_id NULL) are unaffected.
create unique index if not exists webhook_log_event_id_idx
  on webhook_log (event_id)
  where event_id is not null;
