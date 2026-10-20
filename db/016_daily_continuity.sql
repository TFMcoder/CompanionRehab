-- Preparation records readiness only; live care facts remain authoritative.
create table if not exists companion_local.daily_preparations (
 participant_id uuid not null references companion_local.participant_profiles(id),
 local_date date not null, prepared_at timestamptz not null,
 context_version text not null, trigger text not null check(trigger in ('scheduler','open','startup')),
 source_revisions jsonb not null, status text not null check(status='prepared'),
 primary key(participant_id,local_date)
);
-- Only client-confirmed significant context, with history in domain_events/receipts.
create table if not exists companion_local.significant_handoffs (
 id uuid primary key, participant_id uuid not null references companion_local.participant_profiles(id),
 summary text not null check(length(summary) between 1 and 300), occurred_at timestamptz not null,
 source text not null default 'client_report' check(source='client_report'),
 source_actor_id uuid not null references companion_local.accounts(id), recorded_at timestamptz not null,
 revision integer not null check(revision>0), status text not null check(status in ('active','resolved')),
 reviewed_at timestamptz, reviewed_by uuid references companion_local.accounts(id),
 resolved_at timestamptz, resolution_note text not null default '',
 updated_at timestamptz not null, updated_by uuid not null references companion_local.accounts(id),
 check((status='resolved')=(resolved_at is not null))
);
create index if not exists significant_handoffs_active on companion_local.significant_handoffs(participant_id,status,occurred_at,id);
-- Retain a client-confirmed voice command until its outcome is acknowledged.
create table if not exists companion_local.pending_handoff_commands (
 participant_id uuid not null references companion_local.participant_profiles(id),
 actor_id uuid not null references companion_local.accounts(id), command_id uuid not null,
 command jsonb not null, grant_fingerprint text not null, confirmed_at timestamptz not null,
 primary key(participant_id,actor_id)
);
revoke all on companion_local.daily_preparations,companion_local.significant_handoffs,companion_local.pending_handoff_commands from public;
