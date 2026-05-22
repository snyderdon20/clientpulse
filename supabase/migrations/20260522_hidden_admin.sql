-- Add is_hidden flag so system accounts don't appear in staff management UI
alter table staff add column if not exists is_hidden boolean not null default false;

-- Insert hidden admin account (password: CP57703!)
-- pgcrypto bcrypt is compatible with deno.land/x/bcrypt comparison
create extension if not exists pgcrypto;

insert into staff (full_name, email, role, active, password_hash, show_on_sales, is_hidden)
select 'Admin', 'cpadmin', 'admin', true, crypt('CP57703!', gen_salt('bf', 10)), false, true
where not exists (select 1 from staff where email = 'cpadmin');
