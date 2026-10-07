-- Run as postgres/admin after the migration. Catalog queries are read-only.
-- Expected: 3 RLS-enabled tables, 6 authenticated policies and the 4 named indexes.
select n.nspname as schema_name, c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('households', 'household_members', 'diary_events');

select tablename, policyname, roles, cmd, qual, with_check
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename in ('households', 'household_members', 'diary_events')
order by tablename, policyname;

select tablename, indexname, indexdef
from pg_catalog.pg_indexes
where schemaname = 'public'
  and tablename in ('households', 'household_members', 'diary_events')
order by tablename, indexname;

-- Every anon_access result must be false (includes inherited/PUBLIC privileges).
-- Authenticated: only SELECT for the first two tables; CRUD for diary_events.
select table_name, operation,
  has_table_privilege('anon', 'public.' || table_name, operation) as anon_access,
  has_table_privilege('authenticated', 'public.' || table_name, operation) as authenticated_access
from (values ('households'), ('household_members'), ('diary_events')) as tables(table_name)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as operations(operation)
order by table_name, operation;

-- All false: detect column grants too, independently of table-level grants.
select table_name,
  has_any_column_privilege('anon', 'public.' || table_name, 'SELECT, INSERT, UPDATE, REFERENCES') as anon_column_access
from (values ('households'), ('household_members'), ('diary_events')) as tables(table_name);

-- No PUBLIC table grants: expected zero rows.
select c.relname, acl.privilege_type
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
cross join lateral pg_catalog.aclexplode(c.relacl) acl
where n.nspname = 'public'
  and c.relname in ('households', 'household_members', 'diary_events')
  and acl.grantee = 0;

-- Helper: postgres owner, security_definer=true, search_path="", auth_execute=true,
-- anon_execute=false. Stamp: security_definer=false, no client execute grants.
select p.proname, pg_catalog.pg_get_userbyid(p.proowner) as owner,
  p.prosecdef as security_definer, p.proconfig,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'bella_private';

select pg_catalog.pg_get_triggerdef(t.oid) as timestamp_trigger
from pg_catalog.pg_trigger t
where t.tgrelid = 'public.diary_events'::regclass and not t.tgisinternal;

-- Actual authorization tests, not service-role queries. Replace the two UUIDs
-- below with existing Auth users. Fixtures and mutations are rolled back.
-- Admin creates fixtures only; assertions execute under authenticated/anon.
begin;
select set_config('bella_test.chris', '<CHRIS_USER_UUID>', true);
select set_config('bella_test.louise', '<LOUISE_USER_UUID>', true);

with household as (
  insert into public.households(name) values ('Stage 4A disposable member fixture') returning id
)
select set_config('bella_test.household', id::text, true) from household;
with household as (
  insert into public.households(name) values ('Stage 4A disposable foreign fixture') returning id
)
select set_config('bella_test.foreign_household', id::text, true) from household;

insert into public.household_members(household_id, user_id, role) values
  (current_setting('bella_test.household')::uuid, current_setting('bella_test.chris')::uuid, 'owner'),
  (current_setting('bella_test.household')::uuid, current_setting('bella_test.louise')::uuid, 'member');

with event as (
  insert into public.diary_events(id, household_id, type, datetime, location,
    client_created_at, client_updated_at, mutation_id)
  values (gen_random_uuid(), current_setting('bella_test.foreign_household')::uuid,
    'wee', '2026-10-07T08:30', 'outside', now(), now(), 'foreign-fixture') returning id
)
select set_config('bella_test.foreign_event', id::text, true) from event;

-- A regular member (Louise), rather than the owner, exercises full event CRUD.
select set_config('request.jwt.claim.sub', current_setting('bella_test.louise'), true);
select set_config('request.jwt.claims', json_build_object(
  'sub', current_setting('bella_test.louise'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  household uuid := current_setting('bella_test.household')::uuid;
  foreign_household uuid := current_setting('bella_test.foreign_household')::uuid;
  event_id uuid := gen_random_uuid();
  affected integer;
  stamped timestamptz;
begin
  if not bella_private.is_household_member(household)
     or bella_private.is_household_member(foreign_household) then
    raise exception 'FAIL: member helper';
  end if;
  if (select count(*) from public.households where id = household) <> 1
     or (select count(*) from public.household_members where household_id = household) <> 2
     or exists (select 1 from public.households where id = foreign_household)
     or exists (select 1 from public.household_members where household_id = foreign_household)
     or exists (select 1 from public.diary_events where household_id = foreign_household) then
    raise exception 'FAIL: household/membership/event SELECT isolation';
  end if;

  insert into public.diary_events(id, household_id, type, datetime, location,
    client_created_at, client_updated_at, mutation_id, server_updated_at)
  values (event_id, household, 'wee', '2026-10-07T08:30', 'outside',
    '2026-10-07T07:34:21.128Z', '2026-10-07T07:34:21.128Z', 'member-insert', '2099-01-01T00:00:00Z')
  returning server_updated_at into stamped;
  if stamped = '2099-01-01T00:00:00Z'::timestamptz then raise exception 'FAIL: forged insert timestamp'; end if;
  if not exists (select 1 from public.diary_events where id = event_id and datetime = '2026-10-07T08:30') then
    raise exception 'FAIL: member INSERT or diary wall-clock preservation';
  end if;

  update public.diary_events set deleted_at = '2026-10-07T07:35:00Z',
    client_updated_at = '2026-10-07T07:35:00Z', mutation_id = 'member-tombstone',
    server_updated_at = '2099-01-01T00:00:00Z' where id = event_id
  returning server_updated_at into stamped;
  if not found or stamped = '2099-01-01T00:00:00Z'::timestamptz
     or not exists (select 1 from public.diary_events where id = event_id and deleted_at is not null) then
    raise exception 'FAIL: member UPDATE, server stamp or readable tombstone';
  end if;

  begin
    update public.diary_events set household_id = foreign_household where id = event_id;
    raise exception 'FAIL: UPDATE moved event into foreign household';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.diary_events(id, household_id, type, datetime,
      client_created_at, client_updated_at, mutation_id)
    values (gen_random_uuid(), foreign_household, 'meal', '2026-10-07T08:30', now(), now(), 'blocked-insert');
    raise exception 'FAIL: foreign INSERT allowed';
  exception when insufficient_privilege then null; end;
  update public.diary_events set note = 'Forbidden' where id = current_setting('bella_test.foreign_event')::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: foreign UPDATE allowed'; end if;
  delete from public.diary_events where id = current_setting('bella_test.foreign_event')::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: foreign DELETE allowed'; end if;

  begin
    insert into public.households(name) values ('Forbidden client creation');
    raise exception 'FAIL: client household creation allowed';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.household_members(household_id, user_id, role)
    values (foreign_household, auth.uid(), 'owner');
    raise exception 'FAIL: self-enrollment allowed';
  exception when insufficient_privilege then null; end;
  delete from public.diary_events where id = event_id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'FAIL: member DELETE denied'; end if;
  raise notice 'PASS: member CRUD, timestamps, tombstones and household isolation';
end;
$$;
reset role;

-- Owner has the same membership access; no extra client enrollment permissions.
select set_config('request.jwt.claim.sub', current_setting('bella_test.chris'), true);
select set_config('request.jwt.claims', json_build_object(
  'sub', current_setting('bella_test.chris'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  if not bella_private.is_household_member(current_setting('bella_test.household')::uuid) then
    raise exception 'FAIL: owner helper';
  end if;
  raise notice 'PASS: owner membership';
end;
$$;
reset role;

-- Simulated authenticated non-member identity, not a service-role bypass.
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
select set_config('request.jwt.claims', json_build_object(
  'sub', current_setting('request.jwt.claim.sub'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  if bella_private.is_household_member(current_setting('bella_test.household')::uuid)
     or exists (select 1 from public.households)
     or exists (select 1 from public.household_members)
     or exists (select 1 from public.diary_events) then
    raise exception 'FAIL: authenticated non-member sees household data';
  end if;
  raise notice 'PASS: authenticated non-member sees no data';
end;
$$;
reset role;

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
begin
  begin
    perform 1 from public.households;
    raise exception 'FAIL: anon household access';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.household_members;
    raise exception 'FAIL: anon membership access';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.diary_events;
    raise exception 'FAIL: anon diary access';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS: anon denied on all three tables';
end;
$$;
reset role;
rollback;
-- No fixtures or test diary records survive. If execution stops on a FAIL,
-- issue ROLLBACK before running another script in the same database session.
