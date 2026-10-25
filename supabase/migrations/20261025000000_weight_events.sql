begin;

-- Add weight as an ordinary diary event. Existing rows stay valid with NULL.
alter table public.diary_events
  add column weight_kg numeric;

alter table public.diary_events
  drop constraint if exists diary_events_type_check;
alter table public.diary_events
  add constraint diary_events_type_check
  check (type in ('wee', 'poo', 'meal', 'weight'));

alter table public.diary_events
  add constraint diary_events_weight_fields check (
    (type = 'weight'
      and weight_kg is not null and weight_kg > 0 and weight_kg <= 100
      and location is null
      and poo_consistency is null
      and meal_food is null
      and meal_amount is null)
    or (type <> 'weight' and weight_kg is null)
  );

commit;

