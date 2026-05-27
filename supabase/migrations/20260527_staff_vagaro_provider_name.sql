-- Add vagaro_provider_name to staff so both the encoded Vagaro provider ID
-- (stored by webhook transactions) and the display name (stored by CSV imports)
-- can be linked to the same staff member.
--
-- vagaro_provider_id  → encoded Vagaro ID  e.g. "dLUP-DadcDcHENhlcP1rTg=="
-- vagaro_provider_name → display name       e.g. "Don Snyder"
--
-- The Sales page matching logic checks both fields, so session counts and
-- package revenue are correctly attributed regardless of import method.

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS vagaro_provider_name TEXT;
