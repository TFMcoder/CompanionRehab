-- S07/S08: approved, versioned guidance and factual step results.
create table if not exists companion_local.program_access (
  participant_id uuid not null references companion_local.participant_profiles(id),
  actor_id uuid not null references companion_local.accounts(id),
  role text not null check(role in ('administrator','family_friend','clinician')),
  capabilities text[] not null default '{}',
  revision integer not null default 1 check(revision > 0),
  granted_by uuid not null references companion_local.accounts(id),
  updated_at timestamptz not null default now(),
  primary key(participant_id,actor_id,role),
  check(capabilities <@ array['read_routine','edit_routine','read_rehab','edit_rehab','approve_rehab']::text[])
);
create table if not exists companion_local.program_definitions (
  id uuid primary key,
  participant_id uuid not null references companion_local.participant_profiles(id),
  kind text not null check(kind in ('routine','rehab')),
  title text not null check(length(title) between 1 and 160),
  current_version integer,
  latest_version integer not null default 1 check(latest_version > 0),
  created_by uuid not null references companion_local.accounts(id),
  created_at timestamptz not null default now(),
  unique(participant_id,id)
);
create table if not exists companion_local.program_versions (
  id uuid primary key,
  definition_id uuid not null references companion_local.program_definitions(id),
  participant_id uuid not null references companion_local.participant_profiles(id),
  version integer not null check(version > 0),
  title text not null check(length(title) between 1 and 160),
  steps jsonb not null check(jsonb_typeof(steps)='array'),
  protected_start time,
  protected_end time,
  rest_minutes integer not null default 0 check(rest_minutes between 0 and 240),
  created_by uuid not null references companion_local.accounts(id),
  created_at timestamptz not null default now(),
  approved_by uuid references companion_local.accounts(id),
  approval_ref text,
  approved_at timestamptz,
  unique(definition_id,version),
  unique(participant_id,id),
  check((protected_start is null and protected_end is null) or
        (protected_start is not null and protected_end is not null and protected_start < protected_end)),
  check((approved_at is null and approved_by is null and approval_ref is null) or
        (approved_at is not null and approved_by is not null and approval_ref is not null))
);
create or replace function companion_local.guard_program_version() returns trigger language plpgsql as $$
begin
  if old.approved_at is not null or
     (new.definition_id,new.participant_id,new.version,new.title,new.steps,new.protected_start,new.protected_end,new.rest_minutes,new.created_by)
     is distinct from
     (old.definition_id,old.participant_id,old.version,old.title,old.steps,old.protected_start,old.protected_end,old.rest_minutes,old.created_by) then
    raise exception 'Program version content is immutable' using errcode='42501';
  end if;
  return new;
end $$;
drop trigger if exists program_version_immutable on companion_local.program_versions;
create trigger program_version_immutable before update on companion_local.program_versions
  for each row execute function companion_local.guard_program_version();
alter table companion_local.program_definitions drop constraint if exists program_current_version_fk;
alter table companion_local.program_definitions add constraint program_current_version_fk
  foreign key(id,current_version) references companion_local.program_versions(definition_id,version) deferrable initially deferred;
create table if not exists companion_local.program_runs (
  id uuid primary key,
  participant_id uuid not null references companion_local.participant_profiles(id),
  definition_id uuid not null references companion_local.program_definitions(id),
  version_id uuid not null references companion_local.program_versions(id),
  local_date date not null,
  status text not null check(status in ('active','paused','completed','ended')),
  revision integer not null default 1 check(revision > 0),
  started_by uuid not null references companion_local.accounts(id),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  pause_reason text,
  paused_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  unique(participant_id,id)
);
create index if not exists program_runs_owner_day on companion_local.program_runs(participant_id,local_date,started_at);
create table if not exists companion_local.program_step_results (
  id uuid primary key,
  participant_id uuid not null references companion_local.participant_profiles(id),
  run_id uuid not null references companion_local.program_runs(id),
  step_id text not null,
  outcome text not null check(outcome in ('completed','skipped')),
  reason text not null default '',
  difficulty text not null default '',
  assistance text not null default '',
  notes text not null default '',
  revision integer not null default 1 check(revision > 0),
  reported_by uuid not null references companion_local.accounts(id),
  reported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(run_id,step_id)
);
create table if not exists companion_local.program_receipts (
  participant_id uuid not null references companion_local.participant_profiles(id),
  command_id uuid not null,
  actor_id uuid not null references companion_local.accounts(id),
  command jsonb not null,
  result jsonb not null,
  event_type text not null,
  created_at timestamptz not null default now(),
  primary key(participant_id,command_id)
);
drop trigger if exists program_receipts_append_only on companion_local.program_receipts;
create trigger program_receipts_append_only before update or delete on companion_local.program_receipts for each row execute function companion_local.reject_audit_mutation();
revoke all on companion_local.program_access,companion_local.program_definitions,companion_local.program_versions,
  companion_local.program_runs,companion_local.program_step_results,companion_local.program_receipts from public;
