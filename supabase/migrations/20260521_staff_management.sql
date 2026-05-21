-- Run this in Supabase Dashboard → SQL Editor

create table if not exists staff (
  id         uuid        primary key,  -- mirrors auth.users.id
  full_name  text        not null,
  email      text        unique,
  role       text        not null default 'staff',  -- staff | manager | admin
  active     boolean     not null default true,
  created_at timestamptz default now()
);

-- Add email column to existing installations that created the table without it
alter table staff add column if not exists email text;

alter table staff enable row level security;

do $$ begin
  create policy "allow_all" on staff for all using (true) with check (true);
exception when duplicate_object then null;
end $$;
