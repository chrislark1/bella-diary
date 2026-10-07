-- Run manually as postgres/admin AFTER both users exist in auth.users.
-- Replace both placeholders with their exact Supabase Auth user IDs.
-- Run once: this intentionally creates a new household each time.
begin;

with household as (
  insert into public.households (name)
  values ('Bella')
  returning id
)
insert into public.household_members (household_id, user_id, role)
select household.id, member.user_id, member.role
from household
cross join (values
  ('<CHRIS_USER_UUID>'::uuid, 'owner'),
  ('<LOUISE_USER_UUID>'::uuid, 'member')
) as member(user_id, role)
returning household_id, user_id, role;

commit;
