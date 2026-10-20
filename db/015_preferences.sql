begin;
create table companion_local.client_preferences (
  id uuid primary key,
  participant_id uuid not null references companion_local.participant_profiles(id),
  category text not null check(category in ('meals','routine','task_support','conversation')),
  text text not null check(length(text) between 1 and 240),
  duration text not null check(duration in ('lasting','today')),
  local_date date,
  active boolean not null default true,
  revision integer not null check(revision>0),
  actor_id uuid not null references companion_local.accounts(id),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check((duration='today')=(local_date is not null))
);
create index client_preferences_current on companion_local.client_preferences(participant_id,active,duration,local_date);
create table companion_local.pending_preference_commands (
  participant_id uuid not null references companion_local.participant_profiles(id),
  actor_id uuid not null references companion_local.accounts(id),
  command_id uuid not null,
  grant_revision text not null,
  command jsonb not null check(jsonb_typeof(command)='object'),
  confirmed_at timestamptz not null,
  primary key(participant_id,actor_id),
  unique(participant_id,command_id)
);
revoke all on companion_local.client_preferences,companion_local.pending_preference_commands from public;
commit;
