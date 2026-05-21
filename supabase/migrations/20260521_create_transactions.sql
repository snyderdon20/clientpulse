-- Run this in Supabase Dashboard → SQL Editor

create table if not exists transactions (
  id                        uuid           primary key default gen_random_uuid(),
  vagaro_user_payment_id    text           unique,
  vagaro_user_payment_mst_id text,
  vagaro_transaction_id     text,
  vagaro_customer_id        text,
  vagaro_appointment_id     text,
  vagaro_service_provider_id text,
  client_id                 uuid           references clients(id) on delete set null,
  transaction_date          timestamptz,
  item_sold                 text,
  purchase_type             text,
  service_category          text,
  brand_name                text,
  quantity                  integer        default 1,
  cc_amount                 numeric(10,2)  default 0,
  cash_amount               numeric(10,2)  default 0,
  check_amount              numeric(10,2)  default 0,
  ach_amount                numeric(10,2)  default 0,
  package_redemption        numeric(10,2)  default 0,
  gc_redemption             numeric(10,2)  default 0,
  bank_account_amount       numeric(10,2)  default 0,
  vagaro_pay_later_amount   numeric(10,2)  default 0,
  other_amount              numeric(10,2)  default 0,
  tax                       numeric(10,2)  default 0,
  tip                       numeric(10,2)  default 0,
  discount                  numeric(10,2)  default 0,
  membership_amount         numeric(10,2)  default 0,
  cc_type                   text,
  cc_mode                   text,
  amount_due                numeric(10,2)  default 0,
  business_id               text,
  created_by                text,
  created_at                timestamptz    default now()
);

alter table transactions enable row level security;
create policy "allow_all" on transactions for all using (true) with check (true);

-- Index for fast monthly lookups on the Sales page
create index if not exists transactions_date_idx on transactions (transaction_date);
create index if not exists transactions_client_idx on transactions (client_id);
create index if not exists transactions_provider_idx on transactions (vagaro_service_provider_id);
