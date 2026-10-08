-- In-app requests only. Roles alone do not grant request/reason/help access.
alter table companion_local.activity_records drop constraint if exists activity_records_last_action_check;
alter table companion_local.activity_records add constraint activity_records_last_action_check check(last_action in ('reported','corrected','rescheduled','accepted'));
create table if not exists companion_local.request_access (
  participant_id uuid not null,
  actor_id uuid not null,
  role text not null check(role in ('family_friend','administrator')),
  capabilities text[] not null default '{}' check(capabilities <@ array['request_tasks','read_requests','help_requests','review_request_flags']::text[]),
  revision integer not null check(revision > 0),
  granted_by uuid not null references companion_local.accounts(id),
  updated_at timestamptz not null default now(),
  primary key(participant_id,actor_id,role),
  foreign key(participant_id,actor_id,role) references companion_local.role_grants(participant_id,actor_id,role)
);
create table if not exists companion_local.request_day_capacity (
  participant_id uuid not null references companion_local.participant_profiles(id),
  local_date date not null,
  available_minutes integer not null check(available_minutes between 0 and 960),
  rest_minutes integer not null check(rest_minutes between 0 and 240),
  revision integer not null check(revision > 0),
  stated_by uuid not null references companion_local.accounts(id),
  updated_at timestamptz not null default now(),
  primary key(participant_id,local_date)
);
-- Approved, structured constraints are maintained through private reviewed setup.
-- There is intentionally no model/family/admin HTTP command that edits these.
create table if not exists companion_local.request_constraints (
  participant_id uuid primary key references companion_local.participant_profiles(id),
  revision integer not null check(revision > 0),
  max_task_minutes integer check(max_task_minutes between 1 and 480),
  max_daily_request_minutes integer check(max_daily_request_minutes between 0 and 960),
  blocked_windows jsonb not null default '[]' check(jsonb_typeof(blocked_windows)='array'),
  approval_ref text not null check(length(approval_ref) between 1 and 200),
  updated_at timestamptz not null default now()
);
create table if not exists companion_local.task_requests (
  id uuid primary key,
  participant_id uuid not null references companion_local.participant_profiles(id),
  requester_id uuid not null references companion_local.accounts(id),
  requester_role text not null check(requester_role in ('family_friend','administrator')),
  revision integer not null check(revision > 0),
  draft jsonb not null,
  requested_at timestamptz not null,
  status text not null check(status in ('pending','accepted','rejected','withdrawn')),
  submission_review jsonb not null,
  decision_review jsonb,
  accepted_draft jsonb,
  accepted_at timestamptz,
  decided_by uuid references companion_local.accounts(id),
  task_id uuid unique references companion_local.task_definitions(id),
  activity_id uuid unique,
  accepted_plan_id uuid references companion_local.accepted_day_plan_versions(id),
  reason text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check ((status='accepted')=(task_id is not null)),
  check ((status='rejected')=(reason is not null)),
  check (reason is null or length(btrim(reason)) between 1 and 500)
);
create index if not exists task_requests_participant_status on companion_local.task_requests(participant_id,status,created_at);
create table if not exists companion_local.request_help (
  id uuid primary key,
  participant_id uuid not null references companion_local.participant_profiles(id),
  request_id uuid not null unique references companion_local.task_requests(id),
  revision integer not null check(revision > 0),
  status text not null check(status in ('unassigned','volunteered','resolved')),
  volunteer_id uuid references companion_local.accounts(id),
  resolution text,
  updated_at timestamptz not null,
  check(status<>'volunteered' or volunteer_id is not null),
  check((status='resolved')=(resolution is not null))
);
create table if not exists companion_local.request_flags (
  id uuid primary key,
  participant_id uuid not null references companion_local.participant_profiles(id),
  request_id uuid not null unique references companion_local.task_requests(id),
  help_id uuid not null unique references companion_local.request_help(id),
  revision integer not null check(revision > 0),
  status text not null check(status in ('open','acknowledged','resolved')),
  acknowledged_by uuid references companion_local.accounts(id),
  updated_at timestamptz not null
);
create table if not exists companion_local.request_receipts (
  participant_id uuid not null references companion_local.participant_profiles(id),
  actor_id uuid not null references companion_local.accounts(id),
  command_id uuid not null,
  command jsonb not null,
  result jsonb not null,
  created_at timestamptz not null,
  primary key(participant_id,command_id)
);
drop trigger if exists request_receipts_append_only on companion_local.request_receipts;
create trigger request_receipts_append_only before update or delete on companion_local.request_receipts for each row execute function companion_local.reject_audit_mutation();
revoke all on all tables in schema companion_local from public;
