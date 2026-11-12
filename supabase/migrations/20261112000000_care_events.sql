begin;
alter table public.diary_events
  add column care_category text,
  add column care_product text,
  add column next_due date;
alter table public.diary_events drop constraint diary_events_type_check;
alter table public.diary_events add constraint diary_events_type_check check (type in ('wee','poo','meal','weight','care'));
alter table public.diary_events add constraint diary_events_care_fields check (
 (type = 'care' and care_category is not null
  and care_category in ('worming','flea','vaccination','vet','medication','other')
  and (care_product is null or length(care_product)<=200)
  and (next_due is null or next_due between date '1900-01-01' and date '9999-12-31')
  and location is null and poo_consistency is null and meal_food is null and meal_amount is null and weight_kg is null)
 or (type <> 'care' and care_category is null and care_product is null and next_due is null)
);
commit;
