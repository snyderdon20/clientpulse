-- Run in Supabase Dashboard → SQL Editor

-- 1. Add dedup key column to history
alter table history add column if not exists vagaro_event_id text;

-- Partial unique index: only enforces uniqueness when vagaro_event_id is set
-- (manual/app entries have NULL and are never deduplicated)
create unique index if not exists history_vagaro_event_id_idx
  on history (vagaro_event_id)
  where vagaro_event_id is not null;

-- 2. Clean up existing duplicate appointment-rescheduled entries
--    Keeps the earliest row for each (client_id, type, detail) group from Vagaro
delete from history
where id in (
  select id from (
    select id,
           row_number() over (
             partition by client_id, type, detail
             order by ts asc
           ) as rn
    from history
    where source = 'vagaro'
  ) ranked
  where rn > 1
);
