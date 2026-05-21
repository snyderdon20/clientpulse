-- Two-layer client status architecture
-- Adds fields required for the full Lead / Active / Lapsed / Inactive / Restricted
-- classification to the clients table.

-- Tracks how many appointments have been completed or checked-in (real visits).
-- The webhook increments this on each appointment.completed or appointment.checkedin event.
alter table clients add column if not exists completed_appointments_count integer not null default 0;

-- Vagaro package snapshot (updated whenever a package transaction or webhook fires).
-- RemainingNum > 0 and expiration in the future = active package holder.
alter table clients add column if not exists package_credits_remaining integer not null default 0;
alter table clients add column if not exists package_expiration_date date;

-- Gift card lifecycle (for Expired Package / Gift Card sub-status).
-- Expires 1 year after purchase_date when balance > 0 at expiry.
alter table clients add column if not exists gift_card_balance numeric(10,2) not null default 0;
alter table clients add column if not exists gift_card_purchase_date date;

-- Timestamp set when the first outreach note / comm event is logged for a Lead.
-- Used to compute the 14-day Lost Lead rule.
alter table clients add column if not exists contacted_at timestamptz;

-- Manual toggle by staff/coordinator: Active client with no future appointment booked.
-- Only meaningful when the client already satisfies the ACTIVE parent condition.
alter table clients add column if not exists needs_follow_up boolean not null default false;

-- Administrative override for RESTRICTED layer.
-- 'deactivated' — absolute communication blackout, hidden from main search.
-- 'flagged'     — booking intercept with mandatory note; blocks online booking.
alter table clients add column if not exists restricted_status text
  check (restricted_status in ('deactivated', 'flagged'));
alter table clients add column if not exists restricted_note text;

-- Index to support fast dashboard queries filtered by restricted_status.
create index if not exists clients_restricted_idx on clients (restricted_status)
  where restricted_status is not null;

-- Index to speed up "overdue + has package" queries.
create index if not exists clients_package_idx on clients (package_credits_remaining, package_expiration_date)
  where package_credits_remaining > 0;
