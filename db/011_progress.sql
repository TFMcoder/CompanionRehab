-- S09/S12: versioned, explicitly approved progress rules and scoped exports.
-- No rule row or clinical threshold is installed by this migration.
create table if not exists companion_local.progress_rule_sets (
  id uuid primary key,
  participant_id uuid not null references companion_local.participant_profiles(id),
  version integer not null check(version > 0),
  rules jsonb not null check(jsonb_typeof(rules)='object'),
  approved_by uuid not null references companion_local.accounts(id),
  approval_ref text not null check(length(btrim(approval_ref)) between 1 and 200),
  approved_at timestamptz not null,
  unique(participant_id,version)
);
create index if not exists progress_rules_latest on companion_local.progress_rule_sets(participant_id,version desc);
create table if not exists companion_local.progress_access (
  participant_id uuid not null references companion_local.participant_profiles(id),
  actor_id uuid not null references companion_local.accounts(id),
  role text not null check(role in ('administrator','clinician')),
  can_read boolean not null default false,
  can_export boolean not null default false,
  can_approve_rules boolean not null default false,
  allowed_fields text[] not null default '{}',
  max_days integer not null default 31 check(max_days between 1 and 90),
  revision integer not null check(revision > 0),
  granted_by uuid not null references companion_local.accounts(id),
  updated_at timestamptz not null,
  primary key(participant_id,actor_id,role),
  foreign key(participant_id,actor_id,role) references companion_local.role_grants(participant_id,actor_id,role),
  check(not (can_export or can_approve_rules) or can_read)
);
create table if not exists companion_local.progress_clinical_configs (
  id uuid primary key,
  participant_id uuid not null references companion_local.participant_profiles(id),
  archetype text not null check(archetype in ('diabetes','neurorehab','psychology_psychiatry','family_doctor','ot_psw_dsw')),
  version integer not null check(version > 0),
  title text not null check(length(btrim(title)) between 1 and 100),
  fields text[] not null,
  approval_ref text not null check(length(btrim(approval_ref)) between 1 and 200),
  approved_by uuid not null references companion_local.accounts(id),
  approved_at timestamptz not null,
  unique(participant_id,archetype,version)
);
create table if not exists companion_local.progress_snapshots (
  id uuid primary key,
  participant_id uuid not null references companion_local.participant_profiles(id),
  local_date date not null,
  generation integer not null check(generation > 0),
  rule_set_id uuid not null references companion_local.progress_rule_sets(id),
  rule_version integer not null check(rule_version > 0),
  plan_id uuid not null references companion_local.accepted_day_plan_versions(id),
  plan_version integer not null check(plan_version > 0),
  time_zone text not null,
  source_digest text not null check(length(source_digest)=64),
  result jsonb not null check(jsonb_typeof(result)='object'),
  calculated_by uuid not null references companion_local.accounts(id),
  calculated_at timestamptz not null,
  unique(participant_id,local_date,generation),
  unique(participant_id,local_date,rule_set_id,plan_id,source_digest)
);
create index if not exists progress_snapshots_latest on companion_local.progress_snapshots(participant_id,local_date,generation desc);
create table if not exists companion_local.progress_awards (
  id uuid primary key,
  participant_id uuid not null references companion_local.participant_profiles(id),
  local_date date not null,
  rule_set_id uuid not null references companion_local.progress_rule_sets(id),
  achievement_key text not null,
  label text not null,
  active boolean not null,
  first_snapshot_id uuid not null references companion_local.progress_snapshots(id),
  last_snapshot_id uuid not null references companion_local.progress_snapshots(id),
  awarded_at timestamptz not null,
  updated_at timestamptz not null,
  unique(participant_id,local_date,rule_set_id,achievement_key)
);
create table if not exists companion_local.progress_receipts (
  participant_id uuid not null references companion_local.participant_profiles(id),
  command_id uuid not null,
  actor_id uuid not null references companion_local.accounts(id),
  command jsonb not null,
  result jsonb not null,
  created_at timestamptz not null,
  primary key(participant_id,command_id)
);
create table if not exists companion_local.progress_exports (
  id uuid primary key,
  participant_id uuid not null references companion_local.participant_profiles(id),
  actor_id uuid not null references companion_local.accounts(id),
  actor_role text not null,
  command_id uuid not null unique,
  from_date date not null,
  to_date date not null,
  time_zone text not null,
  format text not null check(format in ('json','csv')),
  fields text[] not null,
  archetype text,
  config_version integer,
  source_digest text not null check(length(source_digest)=64),
  content_sha256 text not null check(length(content_sha256)=64),
  row_count integer not null check(row_count >= 0),
  created_at timestamptz not null,
  check(to_date >= from_date)
);
create index if not exists progress_exports_actor on companion_local.progress_exports(participant_id,actor_id,created_at desc);
drop trigger if exists progress_rules_append_only on companion_local.progress_rule_sets;
create trigger progress_rules_append_only before update or delete on companion_local.progress_rule_sets for each row execute function companion_local.reject_audit_mutation();
drop trigger if exists progress_snapshots_append_only on companion_local.progress_snapshots;
create trigger progress_snapshots_append_only before update or delete on companion_local.progress_snapshots for each row execute function companion_local.reject_audit_mutation();
drop trigger if exists progress_receipts_append_only on companion_local.progress_receipts;
create trigger progress_receipts_append_only before update or delete on companion_local.progress_receipts for each row execute function companion_local.reject_audit_mutation();
drop trigger if exists progress_exports_append_only on companion_local.progress_exports;
create trigger progress_exports_append_only before update or delete on companion_local.progress_exports for each row execute function companion_local.reject_audit_mutation();
revoke all on companion_local.progress_rule_sets,companion_local.progress_access,companion_local.progress_clinical_configs,
  companion_local.progress_snapshots,companion_local.progress_awards,companion_local.progress_receipts,companion_local.progress_exports from public;
