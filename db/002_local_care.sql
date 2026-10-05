-- Local PostgreSQL adapter. Apply as the database owner to an empty database.
-- The application connects with a private database credential; clients never receive DB access.
create schema if not exists companion_local;
revoke all on schema companion_local from public;

create table if not exists companion_local.accounts (
  id uuid primary key,
  email text not null unique,
  password_salt bytea not null,
  password_hash bytea not null,
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);
create table if not exists companion_local.participant_profiles (
  id uuid primary key,
  display_name text not null,
  time_zone text not null,
  preferences text not null default '',
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists companion_local.role_grants (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references companion_local.participant_profiles(id),
  actor_id uuid not null references companion_local.accounts(id),
  role text not null check (role in ('administrator','client','family_friend','clinician')),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique(participant_id, actor_id, role)
);
create index if not exists role_grants_actor_active on companion_local.role_grants(actor_id,role) where revoked_at is null;
create table if not exists companion_local.sessions (
  id uuid primary key,
  actor_id uuid not null references companion_local.accounts(id),
  participant_id uuid not null references companion_local.participant_profiles(id),
  role text not null check (role in ('administrator','client','family_friend','clinician')),
  access_hash bytea not null unique,
  refresh_hash bytea not null unique,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists sessions_actor_active on companion_local.sessions(actor_id) where revoked_at is null;

create table if not exists companion_local.task_definitions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references companion_local.participant_profiles(id),
  title text not null,
  time_hint text,
  urgency text not null default 'medium' check (urgency in ('high','medium','low')),
  scheduled_date date,
  scheduled_time time,
  category text not null default 'task' check (category in ('task','exercise','rehab')),
  duration_minutes integer check (duration_minutes is null or duration_minutes between 1 and 1440),
  active boolean not null default true,
  setup_revision integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists task_definitions_owner_active on companion_local.task_definitions(participant_id,active);
create table if not exists companion_local.meal_options (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references companion_local.participant_profiles(id),
  name text not null,
  slots text[] not null,
  active boolean not null default true,
  setup_revision integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists meal_options_owner_active on companion_local.meal_options(participant_id,active);
create table if not exists companion_local.daily_checkins (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references companion_local.participant_profiles(id),
  local_date date not null,
  revision integer not null default 0 check(revision >= 0),
  current_proposal_id uuid,
  accepted_version integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(participant_id,local_date)
);
create table if not exists companion_local.day_plan_proposals (
  id uuid primary key,
  checkin_id uuid not null references companion_local.daily_checkins(id),
  participant_id uuid not null references companion_local.participant_profiles(id),
  setup_revision integer not null,
  checkin_revision integer not null,
  plan jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists companion_local.accepted_day_plan_versions (
  id uuid primary key default gen_random_uuid(),
  checkin_id uuid not null references companion_local.daily_checkins(id),
  participant_id uuid not null references companion_local.participant_profiles(id),
  version integer not null check(version > 0),
  proposal_id uuid not null unique references companion_local.day_plan_proposals(id),
  plan jsonb not null,
  accepted_at timestamptz not null default now(),
  unique(checkin_id,version)
);
alter table companion_local.daily_checkins drop constraint if exists daily_checkin_current_proposal_fk;
alter table companion_local.daily_checkins add constraint daily_checkin_current_proposal_fk
  foreign key(current_proposal_id) references companion_local.day_plan_proposals(id) deferrable initially deferred;
alter table companion_local.daily_checkins drop constraint if exists daily_checkin_accepted_version_fk;
alter table companion_local.daily_checkins add constraint daily_checkin_accepted_version_fk
  foreign key(id,accepted_version) references companion_local.accepted_day_plan_versions(checkin_id,version) deferrable initially deferred;
create table if not exists companion_local.command_receipts (
  participant_id uuid not null references companion_local.participant_profiles(id),
  command_id uuid not null,
  command jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(participant_id,command_id)
);
create table if not exists companion_local.domain_events (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references companion_local.participant_profiles(id),
  checkin_id uuid,
  actor_id uuid not null references companion_local.accounts(id),
  command_id uuid,
  event_type text not null,
  local_date date,
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists domain_events_owner_created on companion_local.domain_events(participant_id,created_at);
create table if not exists companion_local.grocery_items (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references companion_local.participant_profiles(id),
  name text not null,
  quantity text,
  created_by uuid not null references companion_local.accounts(id),
  created_at timestamptz not null default now()
);
create table if not exists companion_local.appointments (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references companion_local.participant_profiles(id),
  title text not null,
  starts_at timestamptz not null,
  created_by uuid not null references companion_local.accounts(id),
  created_at timestamptz not null default now()
);
create table if not exists companion_local.append_only_mutations (
  participant_id uuid not null references companion_local.participant_profiles(id),
  command_id uuid not null,
  command jsonb not null,
  result jsonb not null,
  event_type text not null,
  actor_id uuid not null references companion_local.accounts(id),
  created_at timestamptz not null default now(),
  primary key(participant_id,command_id)
);
create or replace function companion_local.reject_audit_mutation() returns trigger language plpgsql as $$
begin raise exception 'Audit history is append only' using errcode='42501'; end $$;
drop trigger if exists receipts_append_only on companion_local.command_receipts;
create trigger receipts_append_only before update or delete on companion_local.command_receipts for each row execute function companion_local.reject_audit_mutation();
drop trigger if exists versions_append_only on companion_local.accepted_day_plan_versions;
create trigger versions_append_only before update or delete on companion_local.accepted_day_plan_versions for each row execute function companion_local.reject_audit_mutation();
drop trigger if exists events_append_only on companion_local.domain_events;
create trigger events_append_only before update or delete on companion_local.domain_events for each row execute function companion_local.reject_audit_mutation();
drop trigger if exists mutations_append_only on companion_local.append_only_mutations;
create trigger mutations_append_only before update or delete on companion_local.append_only_mutations for each row execute function companion_local.reject_audit_mutation();

revoke all on all tables in schema companion_local from public;
revoke all on all sequences in schema companion_local from public;
alter default privileges in schema companion_local revoke all on tables from public;
