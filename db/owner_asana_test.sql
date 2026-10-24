-- Owner practice database only. Deliberately excluded from live-care migrations.
create table if not exists companion_local.owner_asana_connection (
 singleton boolean primary key default true check(singleton),
 binding text not null, credential text not null,
 updated_at timestamptz not null default now()
);
create table if not exists companion_local.owner_asana_tasks (
 remote_id text primary key, binding text not null, version text not null, source jsonb not null,
 missing boolean not null default false, observed_at timestamptz not null,
 local_task_id uuid references companion_local.task_definitions(id),
 imported_version text
);
create table if not exists companion_local.owner_asana_receipts (
 command_id uuid primary key, payload_hash text not null,
 actor_id uuid not null, participant_id uuid not null, grant_revision text not null,
 result jsonb not null, created_at timestamptz not null default now()
);
