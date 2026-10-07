-- Stage 4A: schema and authorization only. Run once as postgres/admin.
-- Intentionally fail on existing application tables rather than silently reuse
-- unknown schemas/policies. The transaction rolls back the whole migration.
begin;

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table public.diary_events (
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  type text not null check (type in ('wee', 'poo', 'meal')),
  -- Bella's local wall-clock time, never converted to a timezone/instant.
  -- This checks format/ranges; full calendar validation remains a client concern.
  datetime text not null check (
    datetime ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]$'
  ),
  location text check (location in ('inside', 'outside')),
  note text,
  poo_consistency text check (poo_consistency in ('Firm', 'Normal', 'Soft', 'Diarrhoea')),
  meal_food text,
  meal_amount text,
  demo boolean not null default false,
  client_created_at timestamptz not null check (isfinite(client_created_at)),
  client_updated_at timestamptz not null check (isfinite(client_updated_at)),
  deleted_at timestamptz check (isfinite(deleted_at)),
  mutation_id text collate "C" not null check (mutation_id ~ '^[a-z0-9-]{1,200}$'),
  server_updated_at timestamptz not null default now(),
  constraint diary_events_client_time_order check (client_updated_at >= client_created_at),
  constraint diary_events_deletion_time_order check (deleted_at <= client_updated_at)
);

create index household_members_user_id_idx on public.household_members(user_id);
create index diary_events_household_id_idx on public.diary_events(household_id);
create index diary_events_household_server_updated_at_idx
  on public.diary_events(household_id, server_updated_at);
create index diary_events_household_client_updated_at_idx
  on public.diary_events(household_id, client_updated_at);

-- Keep this schema OUT of Supabase's Data API exposed schemas.
create schema bella_private authorization postgres;
revoke all on schema bella_private from public, anon, authenticated;
grant usage on schema bella_private to authenticated;

-- Run as postgres (BYPASSRLS) to read membership without recursively evaluating
-- household_members' own SELECT policy. The caller's auth.uid() is still used.
-- No user ID parameter: this can only answer membership for the current caller.
create function bella_private.is_household_member(household_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members as membership
    where membership.household_id = household_uuid
      and membership.user_id = (select auth.uid())
  );
$$;
alter function bella_private.is_household_member(uuid) owner to postgres;
revoke all on function bella_private.is_household_member(uuid)
  from public, anon, authenticated;
grant execute on function bella_private.is_household_member(uuid) to authenticated;

-- A normal invoker trigger, without elevated table access. It overwrites supplied
-- timestamps on INSERT and every UPDATE, including a tombstone update.
create function bella_private.stamp_diary_event()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.server_updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;
revoke all on function bella_private.stamp_diary_event()
  from public, anon, authenticated;
create trigger diary_events_server_timestamp
before insert or update on public.diary_events
for each row execute function bella_private.stamp_diary_event();

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.diary_events enable row level security;

-- Remove Supabase default table privileges, then grant only required operations.
-- No client TRUNCATE, REFERENCES or TRIGGER privilege; no anon/PUBLIC access.
revoke all on table public.households, public.household_members, public.diary_events
  from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select on table public.households, public.household_members to authenticated;
grant select, insert, update, delete on table public.diary_events to authenticated;

-- Household and membership mutations are admin-only, even for an owner.
create policy households_select_member on public.households
for select to authenticated
using (bella_private.is_household_member(id));

create policy household_members_select_member on public.household_members
for select to authenticated
using (bella_private.is_household_member(household_id));

-- Include tombstones in SELECT: future sync must propagate deletions.
create policy diary_events_select_member on public.diary_events
for select to authenticated
using (bella_private.is_household_member(household_id));

create policy diary_events_insert_member on public.diary_events
for insert to authenticated
with check (bella_private.is_household_member(household_id));

create policy diary_events_update_member on public.diary_events
for update to authenticated
using (bella_private.is_household_member(household_id))
with check (bella_private.is_household_member(household_id));

create policy diary_events_delete_member on public.diary_events
for delete to authenticated
using (bella_private.is_household_member(household_id));

commit;
