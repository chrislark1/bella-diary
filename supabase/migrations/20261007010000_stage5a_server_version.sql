-- Stage 5A: additive migration; Stage 4A remains unchanged. Run once as admin.
begin;
alter table public.diary_events
  add column server_version bigint not null default 1;

-- Preserve the existing trigger, ownership, security and grants.
create or replace function bella_private.stamp_diary_event()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.server_version := 1;
  else
    if new.id is distinct from old.id
       or new.household_id is distinct from old.household_id
       or new.client_created_at is distinct from old.client_created_at then
      raise exception 'Event identity, household and creation time are immutable'
        using errcode = '22023';
    end if;
    new.server_version := old.server_version + 1;
  end if;
  new.server_updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;
commit;
