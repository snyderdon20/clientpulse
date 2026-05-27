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
