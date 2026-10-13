-- Meal review and S05 grocery expansion. Existing grocery IDs and receipts remain valid.
alter table companion_local.grocery_items add column if not exists normalized_name text;
alter table companion_local.grocery_items add column if not exists amount numeric(12,3);
alter table companion_local.grocery_items add column if not exists unit text;
alter table companion_local.grocery_items add column if not exists acquired_at timestamptz;
alter table companion_local.grocery_items add column if not exists acquired_by uuid references companion_local.accounts(id);
alter table companion_local.grocery_items add column if not exists revision integer not null default 1;
alter table companion_local.grocery_items add column if not exists meal_proposal_id uuid;
alter table companion_local.grocery_items add column if not exists updated_at timestamptz not null default now();
update companion_local.grocery_items set normalized_name=lower(regexp_replace(btrim(name),'\s+',' ','g')) where normalized_name is null;
alter table companion_local.grocery_items alter column normalized_name set not null;
create or replace function companion_local.normalize_grocery_name() returns trigger language plpgsql as $$
begin
  new.normalized_name := lower(regexp_replace(btrim(new.name),'\s+',' ','g'));
  return new;
end $$;
create trigger grocery_name_normalized before insert or update of name on companion_local.grocery_items
  for each row execute function companion_local.normalize_grocery_name();
create index if not exists grocery_items_lookup on companion_local.grocery_items(participant_id,normalized_name,unit) where acquired_at is null;

create table if not exists companion_local.pantry_items (
  id uuid primary key default gen_random_uuid(), participant_id uuid not null references companion_local.participant_profiles(id),
  name text not null, normalized_name text not null, amount numeric(12,3), unit text,
  revision integer not null default 1 check(revision>0), created_by uuid not null references companion_local.accounts(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists pantry_items_owner on companion_local.pantry_items(participant_id,normalized_name);

create table if not exists companion_local.meal_proposals (
  id uuid primary key default gen_random_uuid(), participant_id uuid not null references companion_local.participant_profiles(id),
  actor_id uuid not null references companion_local.accounts(id), proposal jsonb not null,
  profile_revision integer not null, revision integer not null default 1 check(revision>0),
  accepted_option_id uuid references companion_local.meal_options(id), created_at timestamptz not null default now(),
  accepted_at timestamptz
);
create table if not exists companion_local.meal_option_details (
  option_id uuid primary key references companion_local.meal_options(id), participant_id uuid not null references companion_local.participant_profiles(id),
  proposal_id uuid not null unique references companion_local.meal_proposals(id),
  portion text not null, ingredients jsonb not null, source_refs jsonb not null, preference_notes text not null,
  accepted_at timestamptz not null default now()
);
create or replace function companion_local.protect_accepted_meal_option() returns trigger language plpgsql as $$
begin
  if (new.name is distinct from old.name or new.slots is distinct from old.slots)
    and exists(select 1 from companion_local.meal_option_details where option_id=old.id) then
    raise exception 'Accepted meal identity cannot be renamed; create a new option' using errcode='23514';
  end if;
  return new;
end $$;
create trigger protect_accepted_meal_option before update on companion_local.meal_options
  for each row execute function companion_local.protect_accepted_meal_option();
alter table companion_local.grocery_items add constraint grocery_items_meal_proposal_fk foreign key(meal_proposal_id) references companion_local.meal_proposals(id);

create table if not exists companion_local.grocery_shares (
  participant_id uuid not null references companion_local.participant_profiles(id), actor_id uuid not null references companion_local.accounts(id),
  role text not null check(role in ('administrator','family_friend')), can_read boolean not null default false,
  can_edit boolean not null default false, revision integer not null default 1 check(revision>0),
  updated_at timestamptz not null default now(), primary key(participant_id,actor_id,role),
  foreign key(participant_id,actor_id,role) references companion_local.role_grants(participant_id,actor_id,role)
);
create table if not exists companion_local.meal_grocery_receipts (
  participant_id uuid not null references companion_local.participant_profiles(id), command_id uuid not null,
  actor_id uuid not null references companion_local.accounts(id), command jsonb not null, result jsonb not null,
  created_at timestamptz not null default now(), primary key(participant_id,command_id)
);
create trigger meal_grocery_receipts_append_only before update or delete on companion_local.meal_grocery_receipts
  for each row execute function companion_local.reject_audit_mutation();
revoke all on companion_local.pantry_items,companion_local.meal_proposals,companion_local.meal_option_details,
  companion_local.grocery_shares,companion_local.meal_grocery_receipts from public;
