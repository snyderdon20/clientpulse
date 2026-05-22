-- Sales automation migration
-- Adds per-staff sales goal fields, weekly rebook tracking, and monthly package challenge table.

-- 1. Sales goal columns on staff
alter table staff
  add column if not exists vagaro_provider_id    text,
  add column if not exists sales_display_role    text,
  add column if not exists sales_session_low     int     not null default 10,
  add column if not exists sales_session_high    int     not null default 15,
  add column if not exists sales_rebook_goal     int,
  add column if not exists sales_red_light_goal  int,
  add column if not exists sales_color           text    not null default '#a0785a',
  add column if not exists show_on_sales         boolean not null default true;

create index if not exists staff_vagaro_provider_idx on staff (vagaro_provider_id);

-- 2. Weekly rebook + red-light tracking (manual entry, one row per staff per week)
create table if not exists weekly_goals (
  id          uuid    primary key default gen_random_uuid(),
  staff_id    uuid    references staff(id) on delete cascade,
  week_start  date    not null,
  sessions    int     not null default 0,
  rebooked    int     not null default 0,
  red_light   int     not null default 0,
  unique (staff_id, week_start)
);
alter table weekly_goals enable row level security;
do $$ begin
  create policy "allow_all" on weekly_goals for all using (true) with check (true);
exception when duplicate_object then null;
end $$;

-- 3. Monthly package challenge (owner vs team buckets)
create table if not exists package_challenge (
  id           uuid          primary key default gen_random_uuid(),
  month_start  date          not null unique,
  owner_sales  numeric(10,2) not null default 0,
  team_sales   numeric(10,2) not null default 0,
  updated_at   timestamptz   default now()
);
alter table package_challenge enable row level security;
do $$ begin
  create policy "allow_all" on package_challenge for all using (true) with check (true);
exception when duplicate_object then null;
end $$;
