-- Confirmed voice commands survive lost responses, reload and service restart.
begin;
create table companion_local.pending_activity_commands (
  participant_id uuid not null references companion_local.participant_profiles(id),
  actor_id uuid not null references companion_local.accounts(id),
  command_id uuid not null,
  grant_revision text not null,
  command jsonb not null check(jsonb_typeof(command)='object'),
  confirmed_at timestamptz not null default now(),
  primary key(participant_id,actor_id),
  unique(participant_id,command_id)
);
revoke all on companion_local.pending_activity_commands from public;
commit;
