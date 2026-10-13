-- S11 local operations review. It cannot dispatch, retry, or mutate held connector intents.
create table if not exists companion_local.operations_access (
  participant_id uuid not null references companion_local.participant_profiles(id),
  actor_id uuid not null references companion_local.accounts(id),
  role text not null default 'administrator' check(role='administrator'),
  can_view boolean not null default false,
  can_manage_local_issues boolean not null default false,
  can_view_audit boolean not null default false,
  revision integer not null default 1 check(revision>0),
  updated_at timestamptz not null default now(),
  primary key(participant_id,actor_id,role),
  foreign key(participant_id,actor_id,role) references companion_local.role_grants(participant_id,actor_id,role)
);
create table if not exists companion_local.operations_issue_reviews (
  participant_id uuid not null references companion_local.participant_profiles(id),
  intent_id uuid not null,
  status text not null check(status in ('open','resolved')),
  note text not null check(length(btrim(note)) between 1 and 500),
  revision integer not null default 1 check(revision>0),
  updated_by uuid not null references companion_local.accounts(id),
  updated_at timestamptz not null default now(),
  primary key(participant_id,intent_id)
);
create unique index if not exists actuation_intents_participant_identity on companion_local.actuation_intents(participant_id,id);
alter table companion_local.operations_issue_reviews add constraint operations_issue_intent_fk
  foreign key(participant_id,intent_id) references companion_local.actuation_intents(participant_id,id);
create index if not exists operations_issue_owner on companion_local.operations_issue_reviews(participant_id,updated_at);
revoke all on companion_local.operations_access,companion_local.operations_issue_reviews from public;
