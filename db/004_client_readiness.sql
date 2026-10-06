-- Client pilot ledger readiness. Apply after 002 and 003.
-- External targets, links and intents are storage only: there is no sender or worker.
begin;

alter table companion_local.activity_records
  add column if not exists last_actor_id uuid,
  add column if not exists last_command_id uuid;

-- Existing activity writes already have immutable events and mutation receipts.
-- Recover their latest provenance without rewriting the historical records.
with latest as (
  select distinct on (participant_id, data->>'activity_id')
    participant_id, data->>'activity_id' as activity_id, actor_id, command_id
  from companion_local.domain_events
  where event_type in ('ActivityReported','ActivityCorrected','ActivityRescheduled')
    and command_id is not null and data ? 'activity_id'
  order by participant_id, data->>'activity_id',
    (data->'after'->>'revision')::integer desc, created_at desc, id desc
)
update companion_local.activity_records a
set last_actor_id=latest.actor_id, last_command_id=latest.command_id
from latest
where a.participant_id=latest.participant_id and a.id::text=latest.activity_id
  and a.last_command_id is null;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='activity_last_provenance_pair') then
    alter table companion_local.activity_records add constraint activity_last_provenance_pair
      check ((last_actor_id is null) = (last_command_id is null));
  end if;
  if not exists(select 1 from pg_constraint where conname='activity_last_actor_fk') then
    alter table companion_local.activity_records add constraint activity_last_actor_fk
      foreign key(last_actor_id) references companion_local.accounts(id);
  end if;
  if not exists(select 1 from pg_constraint where conname='activity_last_receipt_fk') then
    alter table companion_local.activity_records add constraint activity_last_receipt_fk
      foreign key(participant_id,last_command_id)
      references companion_local.append_only_mutations(participant_id,command_id)
      deferrable initially deferred;
  end if;
end $$;

-- One command produces at most one event within a participant's ledger.
create unique index if not exists domain_events_participant_command_unique
  on companion_local.domain_events(participant_id,command_id) where command_id is not null;
create unique index if not exists domain_events_participant_id_unique
  on companion_local.domain_events(participant_id,id);

-- A target identifies a future authorized delivery endpoint without storing credentials.
create table if not exists companion_local.actuation_targets (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references companion_local.participant_profiles(id),
  system text not null check(system in ('email','calendar','pm')),
  provider text not null check(length(btrim(provider)) between 1 and 80),
  destination_ref text not null check(length(btrim(destination_ref)) between 1 and 500),
  created_by uuid not null references companion_local.accounts(id),
  created_at timestamptz not null default now(),
  unique(participant_id,id),
  unique(participant_id,system,provider,destination_ref)
);

-- Local IDs stay stable when a future connector assigns its own remote IDs.
create table if not exists companion_local.external_resource_links (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references companion_local.participant_profiles(id),
  target_id uuid not null,
  local_kind text not null check(local_kind in ('task_definition','meal_option','appointment','activity_record')),
  local_id uuid not null,
  remote_id text not null check(length(btrim(remote_id)) between 1 and 500),
  remote_version text check(remote_version is null or length(remote_version) <= 500),
  linked_by uuid not null references companion_local.accounts(id),
  linked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(participant_id,target_id) references companion_local.actuation_targets(participant_id,id),
  unique(participant_id,target_id,local_kind,local_id),
  unique(participant_id,target_id,remote_id)
);

-- Held intent records support later review and idempotent actuation. This revision
-- deliberately permits no dispatch state and creates no intents automatically.
create table if not exists companion_local.actuation_intents (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references companion_local.participant_profiles(id),
  event_id uuid not null,
  target_id uuid not null,
  operation text not null check(operation in ('notify','create','update','cancel')),
  request jsonb not null check(jsonb_typeof(request)='object'),
  state text not null default 'held' check(state='held'),
  requested_by uuid not null references companion_local.accounts(id),
  created_at timestamptz not null default now(),
  foreign key(participant_id,event_id) references companion_local.domain_events(participant_id,id),
  foreign key(participant_id,target_id) references companion_local.actuation_targets(participant_id,id),
  unique(participant_id,event_id,target_id,operation)
);

-- Evaluate the recorded action time so encrypted restore can reconstruct rows
-- made before a grant/account was revoked. Future command handlers must stamp
-- server time and recheck current authorization before accepting a new action.
create or replace function companion_local.require_actuation_scope() returns trigger language plpgsql as $$
declare actor uuid; action_at timestamptz;
begin
  if tg_table_name='actuation_targets' then
    actor := new.created_by;
    action_at := new.created_at;
  elsif tg_table_name='external_resource_links' then
    actor := new.linked_by;
    action_at := new.linked_at;
  elsif tg_table_name='actuation_intents' then
    actor := new.requested_by;
    action_at := new.created_at;
  end if;
  if not exists(select 1 from companion_local.role_grants
    where participant_id=new.participant_id and actor_id=actor
      and granted_at<=action_at and (revoked_at is null or action_at<revoked_at))
    or not exists(select 1 from companion_local.accounts
      where id=actor and created_at<=action_at and (disabled_at is null or action_at<disabled_at)) then
    raise exception 'Actor had no participant grant at the recorded time' using errcode='42501';
  end if;
  return new;
end $$;

create or replace function companion_local.require_external_local_resource() returns trigger language plpgsql as $$
declare found boolean;
begin
  if new.local_kind='task_definition' then
    select exists(select 1 from companion_local.task_definitions where id=new.local_id and participant_id=new.participant_id) into found;
  elsif new.local_kind='meal_option' then
    select exists(select 1 from companion_local.meal_options where id=new.local_id and participant_id=new.participant_id) into found;
  elsif new.local_kind='appointment' then
    select exists(select 1 from companion_local.appointments where id=new.local_id and participant_id=new.participant_id) into found;
  elsif new.local_kind='activity_record' then
    select exists(select 1 from companion_local.activity_records where id=new.local_id and participant_id=new.participant_id) into found;
  end if;
  if not coalesce(found,false) then
    raise exception 'Unknown participant resource for external link' using errcode='23503';
  end if;
  return new;
end $$;

drop trigger if exists actuation_targets_scope on companion_local.actuation_targets;
create trigger actuation_targets_scope before insert on companion_local.actuation_targets
  for each row execute function companion_local.require_actuation_scope();
drop trigger if exists external_resource_links_scope on companion_local.external_resource_links;
create trigger external_resource_links_scope before insert on companion_local.external_resource_links
  for each row execute function companion_local.require_actuation_scope();
drop trigger if exists external_resource_links_local_scope on companion_local.external_resource_links;
create trigger external_resource_links_local_scope before insert or update on companion_local.external_resource_links
  for each row execute function companion_local.require_external_local_resource();
drop trigger if exists actuation_intents_scope on companion_local.actuation_intents;
create trigger actuation_intents_scope before insert on companion_local.actuation_intents
  for each row execute function companion_local.require_actuation_scope();

create index if not exists actuation_intents_owner_created
  on companion_local.actuation_intents(participant_id,created_at);
revoke all on companion_local.actuation_targets, companion_local.external_resource_links,
  companion_local.actuation_intents from public;

-- Link and intent history must be reviewed via a later explicit connector workflow.
drop trigger if exists actuation_intents_append_only on companion_local.actuation_intents;
create trigger actuation_intents_append_only before update or delete on companion_local.actuation_intents
  for each row execute function companion_local.reject_audit_mutation();
commit;
