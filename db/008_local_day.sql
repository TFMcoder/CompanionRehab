-- Reviewed repeat-day decisions and consented local prompts. No external dispatch.
create table if not exists companion_local.carryover_decisions (
 id uuid primary key, participant_id uuid not null references companion_local.participant_profiles(id),
 source_date date not null, source_activity_id uuid not null, source_task_id uuid not null references companion_local.task_definitions(id),
 source_plan_id uuid references companion_local.day_plan_proposals(id),
 target_date date not null, decision text not null check(decision in ('keep','reschedule','cancel','help','unresolved')),
 source_revision integer not null, proposal_id uuid references companion_local.day_plan_proposals(id),
 note text not null default '', actor_id uuid not null references companion_local.accounts(id),
 command_id uuid not null, created_at timestamptz not null default now(), unique(participant_id,command_id)
);
alter table companion_local.carryover_decisions add column if not exists source_plan_id uuid references companion_local.day_plan_proposals(id);
create index if not exists carryover_source on companion_local.carryover_decisions(participant_id,source_activity_id,created_at);
create index if not exists carryover_source_plan on companion_local.carryover_decisions(participant_id,source_activity_id,source_plan_id,created_at);
create table if not exists companion_local.routine_choices (
 participant_id uuid primary key references companion_local.participant_profiles(id), revision integer not null,
 selections jsonb not null, updated_by uuid not null references companion_local.accounts(id), updated_at timestamptz not null default now()
);
create table if not exists companion_local.prompt_preferences (
 participant_id uuid primary key references companion_local.participant_profiles(id), revision integer not null,
 enabled boolean not null default false, meal_times jsonb not null default '{}', appointment_lead_minutes integer not null default 30,
 quiet_start time not null default '21:00', quiet_end time not null default '08:00',
 foreground_speech boolean not null default false, browser_notifications boolean not null default false,
 consent_actor uuid not null references companion_local.accounts(id), updated_at timestamptz not null default now()
);
create table if not exists companion_local.prompt_jobs (
 id uuid primary key, participant_id uuid not null references companion_local.participant_profiles(id),
 source_key text not null, source_version text not null, preference_revision integer not null,
 due_at timestamptz not null, expires_at timestamptz not null, message text not null,
 state text not null check(state in ('pending','claimed','delivered','missed','cancelled')),
 claimed_by uuid references companion_local.accounts(id), claim_token uuid, claimed_at timestamptz,
 delivery_uncertain boolean not null default false,
 delivered_at timestamptz, channel text check(channel in ('in_app','speech','notification')),
 created_at timestamptz not null default now(), unique(participant_id,source_key,source_version,preference_revision)
);
alter table companion_local.prompt_jobs add column if not exists delivery_uncertain boolean not null default false;
create index if not exists prompt_jobs_due on companion_local.prompt_jobs(state,due_at);
create index if not exists prompt_jobs_participant_due on companion_local.prompt_jobs(participant_id,state,due_at,id);
create index if not exists prompt_preferences_enabled on companion_local.prompt_preferences(participant_id) where enabled;
create table if not exists companion_local.prompt_scheduler_cursor (
 id boolean primary key default true check(id), last_participant_id uuid references companion_local.participant_profiles(id)
);
create table if not exists companion_local.prompt_delivery_events (
 id uuid primary key, participant_id uuid not null references companion_local.participant_profiles(id),
 prompt_id uuid not null references companion_local.prompt_jobs(id), event_type text not null,
 actor_id uuid references companion_local.accounts(id), data jsonb not null default '{}', created_at timestamptz not null default now()
);
drop trigger if exists carryover_append_only on companion_local.carryover_decisions;
create trigger carryover_append_only before update or delete on companion_local.carryover_decisions for each row execute function companion_local.reject_audit_mutation();
drop trigger if exists prompt_events_append_only on companion_local.prompt_delivery_events;
create trigger prompt_events_append_only before update or delete on companion_local.prompt_delivery_events for each row execute function companion_local.reject_audit_mutation();
revoke all on companion_local.carryover_decisions, companion_local.routine_choices, companion_local.prompt_preferences, companion_local.prompt_jobs, companion_local.prompt_delivery_events, companion_local.prompt_scheduler_cursor from public;
