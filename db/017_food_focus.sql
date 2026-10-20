-- Explicit food-check consent and durable responses reuse the existing prompt queue.
alter table companion_local.prompt_preferences add column if not exists food_check_ins boolean not null default false;
alter table companion_local.prompt_jobs add column if not exists response_revision integer not null default 0;
alter table companion_local.prompt_jobs add column if not exists response text check(response in ('snoozed','declined'));
alter table companion_local.prompt_jobs add column if not exists snoozed_until timestamptz;

-- An explicit focus session is not a task-completion report or observed continuous work.
create table if not exists companion_local.task_focus_sessions (
 id uuid primary key,participant_id uuid not null references companion_local.participant_profiles(id),
 activity_id uuid not null,task_id uuid not null references companion_local.task_definitions(id),
 title text not null,local_date date not null,activity_revision integer not null,source_version text not null,
 state text not null check(state in ('active','paused','finished')),revision integer not null check(revision>0),
 interval_minutes integer not null check(interval_minutes between 5 and 240),
 started_at timestamptz not null,last_started_at timestamptz not null,paused_at timestamptz,finished_at timestamptz,
 check_due_at timestamptz not null,end_reason text check(end_reason in ('client_finished','activity_changed')),
 source_actor_id uuid not null references companion_local.accounts(id),updated_by uuid not null references companion_local.accounts(id),updated_at timestamptz not null,
 check((state='finished')=(finished_at is not null))
);
create unique index if not exists one_current_task_focus on companion_local.task_focus_sessions(participant_id) where state in ('active','paused');
revoke all on companion_local.task_focus_sessions from public;
