-- Durable actuals and schedule overrides; accepted plans remain immutable intentions.
create table if not exists companion_local.activity_records (
  id uuid primary key,
  participant_id uuid not null references companion_local.participant_profiles(id),
  local_date date not null,
  kind text not null check(kind in ('task','meal','appointment')),
  title text not null check(length(title) between 1 and 160),
  source_id uuid,
  meal_slot text check(meal_slot in ('breakfast','lunch','dinner')),
  plan_id uuid,
  unplanned boolean not null,
  scheduled_at timestamptz,
  status text not null check(status in ('pending','completed','deferred','voided')),
  occurred_at timestamptz,
  notes text not null default '',
  portion text,
  revision integer not null check(revision > 0),
  last_action text not null check(last_action in ('reported','corrected','rescheduled')),
  recorded_at timestamptz not null,
  updated_at timestamptz not null,
  check ((status='completed') = (occurred_at is not null)),
  check (kind='meal' or (meal_slot is null and portion is null)),
  check (not unplanned or (source_id is null and plan_id is null)),
  unique(participant_id,id)
);
create index if not exists activity_records_owner_day on companion_local.activity_records(participant_id,local_date);
create index if not exists activity_records_owner_actual on companion_local.activity_records(participant_id,occurred_at);
create index if not exists activity_records_owner_schedule on companion_local.activity_records(participant_id,scheduled_at);
revoke all on companion_local.activity_records from public;
