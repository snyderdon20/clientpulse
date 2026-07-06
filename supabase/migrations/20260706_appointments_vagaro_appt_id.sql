-- Run in Supabase Dashboard → SQL Editor
--
-- The vagaro-webhook and reprocess-webhooks functions upsert appointments
-- with onConflict: "vagaro_appt_id", but the column and its unique
-- constraint were never created — so every webhook appointment write has
-- been failing silently. This adds both.

alter table appointments add column if not exists vagaro_appt_id text;

-- Full unique index (NULLs are allowed to repeat, so manual appointments
-- created in the app — which have no vagaro_appt_id — are unaffected).
create unique index if not exists appointments_vagaro_appt_id_idx
  on appointments (vagaro_appt_id);
