-- Run as admin after the Stage 5A migration. All fixtures roll back.
-- This verifies trigger enforcement, not browser Auth/RLS connectivity.
begin;
do $$
declare
  home uuid := gen_random_uuid();
  event_id uuid := gen_random_uuid();
  row_before public.diary_events;
  row_after public.diary_events;
begin
  insert into public.households(id,name) values(home,'Stage 5A disposable verification');
  insert into public.diary_events(id,household_id,type,datetime,location,note,demo,
    client_created_at,client_updated_at,mutation_id,server_version,server_updated_at)
  values(event_id,home,'wee','2026-10-07T08:30','outside','Stage 5A verification',true,
    now(),now(),gen_random_uuid()::text,999,'2000-01-01T00:00:00Z') returning * into row_before;
  if row_before.server_version <> 1 or row_before.server_updated_at = '2000-01-01T00:00:00Z' then
    raise exception 'FAIL: insert server values not controlled';
  end if;
  update public.diary_events set note='updated', server_version=999,
    server_updated_at='2000-01-01T00:00:00Z',client_updated_at=clock_timestamp(),mutation_id=gen_random_uuid()::text
    where id=event_id returning * into row_after;
  if row_after.server_version <> 2 or row_after.server_updated_at <= row_before.server_updated_at then
    raise exception 'FAIL: update server values not advanced';
  end if;
  row_before := row_after;
  update public.diary_events set deleted_at=now(),client_updated_at=clock_timestamp(),
    mutation_id=gen_random_uuid()::text,server_version=999
    where id=event_id returning * into row_after;
  if row_after.server_version <> 3 or row_after.deleted_at is null or row_after.server_updated_at <= row_before.server_updated_at then
    raise exception 'FAIL: tombstone server values not advanced';
  end if;
  begin
    update public.diary_events set id=gen_random_uuid() where id=event_id;
    raise exception 'FAIL: id changed';
  exception when invalid_parameter_value then null; end;
  begin
    update public.diary_events set household_id=gen_random_uuid() where id=event_id;
    raise exception 'FAIL: household changed';
  exception when invalid_parameter_value then null; end;
  begin
    update public.diary_events set client_created_at=client_created_at-interval '1 second' where id=event_id;
    raise exception 'FAIL: creation time changed';
  exception when invalid_parameter_value then null; end;
  if (select server_version from public.diary_events where id=event_id) <> 3 then
    raise exception 'FAIL: rejected identity updates changed the record';
  end if;
  raise notice 'PASS: versions 1 -> 2 -> 3, server timestamps and immutable identity fields';
end;
$$;
rollback;
