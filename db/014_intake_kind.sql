-- Explicit participant-reported intake classification. Never infer from a meal slot.
alter table companion_local.activity_records
  add column if not exists intake_kind text not null default 'unknown'
  check (intake_kind in ('full_meal','snack','unknown'));
