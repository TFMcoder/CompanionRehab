-- A separately authorized calendar-only account. Existing primary rows and their
-- single-account constraints remain unchanged so earlier releases stay compatible.
create table if not exists companion_local.microsoft_calendar_connections (
 id uuid primary key,
 participant_id uuid not null references companion_local.participant_profiles(id),
 actor_id uuid not null references companion_local.accounts(id),
 grant_fingerprint text not null,
 configuration_fingerprint text not null,
 tenant_id uuid not null, object_id uuid not null,
 state text not null check(state in ('connected','disconnected','reconnect_required')),
 token_ciphertext text,
 selected_calendar_ids text[] not null default '{}',
 selected_mail_folder_ids text[] not null default '{}' check(cardinality(selected_mail_folder_ids)=0),
 revision integer not null default 1 check(revision > 0),
 connected_at timestamptz, updated_at timestamptz not null,
 last_read_at timestamptz, last_error text,
 prepared_context_ciphertext text, prepared_at timestamptz, prepared_revision integer,
 preparation_attempt_at timestamptz,
 unique(participant_id,actor_id),
 check((state='connected')=(token_ciphertext is not null))
);
create table if not exists companion_local.microsoft_calendar_oauth_pending (
 id uuid primary key,
 state_hash text not null unique,
 browser_hash text not null,
 actor_id uuid not null references companion_local.accounts(id),
 participant_id uuid not null references companion_local.participant_profiles(id),
 login_session_id uuid not null references companion_local.sessions(id),
 grant_fingerprint text not null,
 configuration_fingerprint text not null,
 pending_ciphertext text not null,
 stage text not null check(stage in ('authorizing','returned','exchanging')),
 created_at timestamptz not null, expires_at timestamptz not null,
 unique(login_session_id)
);
create index if not exists microsoft_calendar_oauth_expiry on companion_local.microsoft_calendar_oauth_pending(expires_at);
revoke all on companion_local.microsoft_calendar_connections,companion_local.microsoft_calendar_oauth_pending from public;
