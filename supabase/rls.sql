-- ─── Row Level Security ────────────────────────────────────────────────────
-- Run this in the Supabase SQL Editor.
--
-- Phase 1 (current): Enable RLS on all tables with open policies.
-- This doesn't restrict access yet, but marks tables as RLS-aware so
-- adding auth-based policies later requires only policy changes, not
-- schema changes.
--
-- Phase 2 (after auth is wired up): Replace the open policies below with
-- user/role-based policies, e.g.:
--   CREATE POLICY "staff_only" ON clients
--     FOR ALL USING (auth.uid() IN (SELECT user_id FROM staff WHERE active = true));
-- ──────────────────────────────────────────────────────────────────────────────

-- Enable RLS
ALTER TABLE clients      ENABLE ROW LEVEL SECURITY;
ALTER TABLE history      ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Phase 1 open policies (replace when auth is added)
CREATE POLICY "open_clients"      ON clients      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_history"      ON history      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_appointments" ON appointments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_tasks"        ON tasks        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_transactions" ON transactions FOR ALL USING (true) WITH CHECK (true);

-- ─── New columns added in Feature: Rich Profile + Referral Tracking ──────────
-- Run this migration if upgrading an existing database:
--
-- ALTER TABLE clients
--   ADD COLUMN IF NOT EXISTS preferred_name          TEXT,
--   ADD COLUMN IF NOT EXISTS contraindications        TEXT,
--   ADD COLUMN IF NOT EXISTS acquisition_source       TEXT,
--   ADD COLUMN IF NOT EXISTS referral_reward_redeemed BOOLEAN DEFAULT false,
--   ADD COLUMN IF NOT EXISTS referral_reward_date     DATE;
--
-- These columns are optional — the app handles NULL gracefully for all of them.
-- preferred_name:          Client's preferred name or nickname (displayed in profile header)
-- contraindications:       Clinical notes shown as a prominent alert on the profile
-- acquisition_source:      How they found the business (referral/google/instagram/etc.)
-- referral_reward_redeemed: Whether the referral milestone reward has been sent
-- referral_reward_date:    Date the reward was redeemed
