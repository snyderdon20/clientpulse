alter table staff add column if not exists roles text[] not null default '{}';
-- Copy existing role into the array for existing rows
update staff set roles = array[role] where role is not null and role != '' and (roles is null or array_length(roles, 1) is null or array_length(roles, 1) = 0);
