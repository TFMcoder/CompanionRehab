-- S01. Apply as the database owner through a private migration channel.
-- Runtime callers use only the authenticated public RPCs below.
create schema if not exists private;

create table private.participant_profiles (
  id uuid primary key,
  display_name text not null,
  time_zone text not null,
  preferences text not null default '',
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table private.role_grants (
  participant_id uuid not null references private.participant_profiles(id),
  actor_id uuid not null,
  role text not null check (role in ('participant', 'caregiver')),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (participant_id, actor_id, role)
);
create table private.task_definitions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references private.participant_profiles(id),
  title text not null,
  time_hint text,
  active boolean not null default true,
  setup_revision integer not null,
  source text not null default 'authorized_setup',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index task_definitions_owner_active on private.task_definitions(participant_id, active);
create table private.meal_options (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references private.participant_profiles(id),
  name text not null,
  slots text[] not null,
  active boolean not null default true,
  setup_revision integer not null,
  source text not null default 'authorized_setup',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index meal_options_owner_active on private.meal_options(participant_id, active);
create table private.daily_checkins (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references private.participant_profiles(id),
  local_date date not null,
  revision integer not null default 0 check (revision >= 0),
  current_proposal_id uuid,
  accepted_version integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(participant_id, local_date)
);
create table private.day_plan_proposals (
  id uuid primary key default gen_random_uuid(),
  checkin_id uuid not null references private.daily_checkins(id),
  participant_id uuid not null references private.participant_profiles(id),
  setup_revision integer not null,
  checkin_revision integer not null,
  plan jsonb not null,
  created_at timestamptz not null default now()
);
create index proposals_checkin_created on private.day_plan_proposals(checkin_id, created_at);
create table private.accepted_day_plan_versions (
  id uuid primary key default gen_random_uuid(),
  checkin_id uuid not null references private.daily_checkins(id),
  participant_id uuid not null references private.participant_profiles(id),
  version integer not null check(version > 0),
  proposal_id uuid not null unique references private.day_plan_proposals(id),
  plan jsonb not null,
  accepted_at timestamptz not null default now(),
  unique(checkin_id, version)
);
alter table private.daily_checkins add constraint daily_checkin_current_proposal_fk
  foreign key(current_proposal_id) references private.day_plan_proposals(id) deferrable initially deferred;
alter table private.daily_checkins add constraint daily_checkin_accepted_version_fk
  foreign key(id, accepted_version) references private.accepted_day_plan_versions(checkin_id, version) deferrable initially deferred;
create table private.command_receipts (
  participant_id uuid not null references private.participant_profiles(id),
  command_id uuid not null,
  command jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(participant_id, command_id)
);
create table private.domain_events (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references private.participant_profiles(id),
  checkin_id uuid,
  actor_id uuid not null,
  command_id uuid,
  event_type text not null,
  source text not null default 'shared_care_command',
  local_date date,
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index domain_events_owner_created on private.domain_events(participant_id, created_at);

create function private.reject_audit_mutation() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Audit history is append only' using errcode='42501'; end $$;
create trigger accepted_versions_append_only before update or delete on private.accepted_day_plan_versions
  for each row execute function private.reject_audit_mutation();
create trigger domain_events_append_only before update or delete on private.domain_events
  for each row execute function private.reject_audit_mutation();
create trigger command_receipts_append_only before update or delete on private.command_receipts
  for each row execute function private.reject_audit_mutation();

-- No runtime role receives table privileges, including through future default grants.
revoke all on schema private from public;
revoke all on all tables in schema private from public, anon, authenticated;
alter default privileges in schema private revoke all on tables from public, anon, authenticated;
alter table private.participant_profiles enable row level security;
alter table private.role_grants enable row level security;
alter table private.task_definitions enable row level security;
alter table private.meal_options enable row level security;
alter table private.daily_checkins enable row level security;
alter table private.day_plan_proposals enable row level security;
alter table private.accepted_day_plan_versions enable row level security;
alter table private.command_receipts enable row level security;
alter table private.domain_events enable row level security;

create function private.require_uid() returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Authentication required' using errcode='28000'; end if;
  return v_uid;
end $$;
create function private.require_active_self_grant(p_uid uuid, p_allow_new boolean default false) returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if exists(select 1 from private.role_grants where actor_id=p_uid and participant_id=p_uid and role='participant' and revoked_at is null) then return; end if;
  if p_allow_new and not exists(select 1 from private.participant_profiles where id=p_uid)
    and not exists(select 1 from private.role_grants where actor_id=p_uid) then return; end if;
  raise exception 'Participant access revoked or missing' using errcode='42501';
end $$;
create function private.require_object(p jsonb) returns void language plpgsql immutable security definer set search_path = '' as $$
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Expected JSON object'; end if;
end $$;
create function private.require_keys(p jsonb, p_keys text[]) returns void language plpgsql immutable security definer set search_path = '' as $$
declare k text;
begin
  perform private.require_object(p);
  for k in select jsonb_object_keys(p) loop
    if not k = any(p_keys) then raise exception 'Unknown field: %', k; end if;
  end loop;
  if (select count(*) from jsonb_object_keys(p)) <> cardinality(p_keys) then raise exception 'Missing field'; end if;
end $$;
create function private.require_uuid(p jsonb) returns uuid language plpgsql immutable security definer set search_path = '' as $$
begin
  if jsonb_typeof(p) <> 'string' or length(p #>> '{}') > 36 or (p #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Invalid UUID';
  end if;
  return (p #>> '{}')::uuid;
end $$;
create function private.require_revision(p jsonb) returns integer language plpgsql immutable security definer set search_path = '' as $$
begin
  if jsonb_typeof(p) <> 'number' or (p #>> '{}') !~ '^(0|[1-9][0-9]{0,8})$' then raise exception 'Invalid revision'; end if;
  return (p #>> '{}')::integer;
end $$;
create function private.require_text(p jsonb, min_len integer, max_len integer) returns text language plpgsql immutable security definer set search_path = '' as $$
declare v text;
begin
  if jsonb_typeof(p) <> 'string' then raise exception 'Expected text'; end if;
  v := p #>> '{}';
  if char_length(btrim(v)) < min_len or char_length(v) > max_len then raise exception 'Invalid text length'; end if;
  return v;
end $$;
create function private.local_day(p_zone text) returns date language sql stable security definer set search_path = '' as $$
  select (now() at time zone p_zone)::date
$$;
create function private.today_for(p_uid uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p private.participant_profiles%rowtype; c private.daily_checkins%rowtype; v_proposal jsonb; v_accepted jsonb;
begin
  select * into p from private.participant_profiles where id=p_uid;
  if not found then
    return jsonb_build_object('profile',null,'local_date',private.local_day('America/Toronto')::text,'tasks','[]'::jsonb,'meal_options','[]'::jsonb,'checkin',null);
  end if;
  select * into c from private.daily_checkins where participant_id=p_uid and local_date=private.local_day(p.time_zone);
  if c.id is not null then
    select plan into v_proposal from private.day_plan_proposals where id=c.current_proposal_id;
    select plan into v_accepted from private.accepted_day_plan_versions where checkin_id=c.id and version=c.accepted_version;
  end if;
  return jsonb_build_object(
    'profile',jsonb_build_object('id',p.id,'display_name',p.display_name,'time_zone',p.time_zone,'preferences',p.preferences,'revision',p.revision),
    'local_date',private.local_day(p.time_zone)::text,
    'tasks',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'time_hint',t.time_hint) order by t.created_at,t.id) from private.task_definitions t where t.participant_id=p_uid and t.active),'[]'::jsonb),
    'meal_options',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'slots',to_jsonb(m.slots)) order by m.created_at,m.id) from private.meal_options m where m.participant_id=p_uid and m.active),'[]'::jsonb),
    'checkin',case when c.id is null then null else jsonb_build_object('id',c.id,'local_date',c.local_date::text,'revision',c.revision,'proposal',v_proposal,'accepted',v_accepted) end
  );
end $$;
create function private.nancy_today_impl() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid;
begin
  uid := private.require_uid();
  perform private.require_active_self_grant(uid,true);
  return private.today_for(uid);
end $$;

create function private.nancy_setup_impl(p_input jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid; p private.participant_profiles%rowtype; rev integer; zone text; item jsonb; item_id uuid; ids uuid[] := '{}'; v_slots text[]; slot text; v_hint text;
begin
  uid := private.require_uid();
  perform private.require_active_self_grant(uid,true);
  if pg_column_size(p_input)>30000 then raise exception 'Setup too large'; end if;
  perform private.require_keys(p_input,array['display_name','time_zone','expected_revision','preferences','tasks','meal_options']);
  perform private.require_text(p_input->'display_name',1,60);
  zone := private.require_text(p_input->'time_zone',1,80);
  if not exists(select 1 from pg_timezone_names where name=zone) then raise exception 'Unknown time zone'; end if;
  perform private.require_text(p_input->'preferences',0,1000);
  rev := private.require_revision(p_input->'expected_revision');
  if jsonb_typeof(p_input->'tasks') <> 'array' or jsonb_array_length(p_input->'tasks') not between 1 and 20 then raise exception 'Invalid task list'; end if;
  if jsonb_typeof(p_input->'meal_options') <> 'array' or jsonb_array_length(p_input->'meal_options') not between 3 and 30 then raise exception 'Invalid meal list'; end if;
  for item in select value from jsonb_array_elements(p_input->'tasks') loop
    perform private.require_object(item);
    if item ? 'id' then
      perform private.require_keys(item,array['id','title','time_hint']);
      item_id := private.require_uuid(item->'id');
      if item_id=any(ids) then raise exception 'Duplicate task ID'; end if;
      ids := array_append(ids,item_id);
    else perform private.require_keys(item,array['title','time_hint']); end if;
    perform private.require_text(item->'title',1,160);
    if item->'time_hint' <> 'null'::jsonb then perform private.require_text(item->'time_hint',0,40); end if;
  end loop;
  ids := '{}';
  for item in select value from jsonb_array_elements(p_input->'meal_options') loop
    perform private.require_object(item);
    if item ? 'id' then
      perform private.require_keys(item,array['id','name','slots']);
      item_id := private.require_uuid(item->'id');
      if item_id=any(ids) then raise exception 'Duplicate meal ID'; end if;
      ids := array_append(ids,item_id);
    else perform private.require_keys(item,array['name','slots']); end if;
    perform private.require_text(item->'name',1,160);
    if jsonb_typeof(item->'slots') <> 'array' or jsonb_array_length(item->'slots') not between 1 and 3 then raise exception 'Invalid slots'; end if;
    v_slots := '{}';
    for slot in select jsonb_array_elements_text(item->'slots') loop
      if slot not in ('breakfast','lunch','dinner') or slot=any(v_slots) then raise exception 'Invalid or duplicate slot'; end if;
      v_slots := array_append(v_slots,slot);
    end loop;
  end loop;
  insert into private.participant_profiles(id,display_name,time_zone,preferences,revision)
    values(uid,'',zone,'',0) on conflict(id) do nothing;
  select * into p from private.participant_profiles where id=uid for update;
  if p.revision<>rev then raise exception 'Stale setup revision'; end if;
  -- Existing IDs must be owned by this participant; retired records may be reactivated.
  for item in select value from jsonb_array_elements(p_input->'tasks') where value ? 'id' loop
    if not exists(select 1 from private.task_definitions where id=private.require_uuid(item->'id') and participant_id=uid) then raise exception 'Unknown task ID'; end if;
  end loop;
  for item in select value from jsonb_array_elements(p_input->'meal_options') where value ? 'id' loop
    if not exists(select 1 from private.meal_options where id=private.require_uuid(item->'id') and participant_id=uid) then raise exception 'Unknown meal ID'; end if;
  end loop;
  update private.participant_profiles set display_name=btrim(p_input->>'display_name'),time_zone=zone,preferences=btrim(p_input->>'preferences'),revision=rev+1,updated_at=now() where id=uid;
  insert into private.role_grants(participant_id,actor_id,role) values(uid,uid,'participant') on conflict do nothing;
  update private.task_definitions set active=false,updated_at=now() where participant_id=uid;
  update private.meal_options set active=false,updated_at=now() where participant_id=uid;
  for item in select value from jsonb_array_elements(p_input->'tasks') loop
    v_hint := case when item->'time_hint'='null'::jsonb then null else item->>'time_hint' end;
    if item ? 'id' then
      update private.task_definitions set title=btrim(item->>'title'),time_hint=v_hint,active=true,setup_revision=rev+1,updated_at=now() where id=private.require_uuid(item->'id') and participant_id=uid;
    else
      insert into private.task_definitions(participant_id,title,time_hint,setup_revision) values(uid,btrim(item->>'title'),v_hint,rev+1);
    end if;
  end loop;
  for item in select value from jsonb_array_elements(p_input->'meal_options') loop
    select array_agg(value) into v_slots from jsonb_array_elements_text(item->'slots');
    if item ? 'id' then
      update private.meal_options set name=btrim(item->>'name'),slots=v_slots,active=true,setup_revision=rev+1,updated_at=now() where id=private.require_uuid(item->'id') and participant_id=uid;
    else
      insert into private.meal_options(participant_id,name,slots,setup_revision) values(uid,btrim(item->>'name'),v_slots,rev+1);
    end if;
  end loop;
  insert into private.domain_events(participant_id,actor_id,event_type,data) values(uid,uid,'ParticipantSetupVersioned',jsonb_build_object('revision',rev+1));
  return private.today_for(uid);
end $$;

create function private.nancy_command_impl(p_command jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid; profile private.participant_profiles%rowtype; c private.daily_checkins%rowtype;
  old private.command_receipts%rowtype; proposal private.day_plan_proposals%rowtype;
  key uuid; expected integer; day date; command_type text; payload jsonb; item jsonb;
  task_id uuid; option_id uuid; proposal_id uuid; selected_ids uuid[] := '{}';
  selected_slots text[] := '{}'; slot text; task_list jsonb := '[]'::jsonb;
  meal_list jsonb := '[]'::jsonb; plan jsonb; result jsonb; version integer;
  task_row private.task_definitions%rowtype; meal_row private.meal_options%rowtype;
begin
  uid := private.require_uid();
  if pg_column_size(p_command)>16000 then raise exception 'Command too large'; end if;
  perform private.require_keys(p_command,array['type','idempotency_key','local_date','expected_revision','payload']);
  command_type := private.require_text(p_command->'type',1,40);
  if command_type not in ('start_or_resume_checkin','propose_day_plan','revise_day_plan','accept_day_plan') then raise exception 'Unknown command'; end if;
  key := private.require_uuid(p_command->'idempotency_key');
  expected := private.require_revision(p_command->'expected_revision');
  if jsonb_typeof(p_command->'local_date') <> 'string' or (p_command->>'local_date') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid local date'; end if;
  begin
    day := (p_command->>'local_date')::date;
  exception when others then raise exception 'Invalid local date'; end;
  if day::text <> p_command->>'local_date' then raise exception 'Invalid local date'; end if;
  payload := p_command->'payload';
  if command_type='start_or_resume_checkin' then
    perform private.require_keys(payload,array[]::text[]);
    if expected<>0 then raise exception 'Start expects revision zero'; end if;
  elsif command_type='accept_day_plan' then
    perform private.require_keys(payload,array['proposal_id']);
    proposal_id := private.require_uuid(payload->'proposal_id');
  else
    perform private.require_keys(payload,array['task_ids','meals']);
    if jsonb_typeof(payload->'task_ids') <> 'array' or jsonb_array_length(payload->'task_ids')>20 then raise exception 'Invalid task selection'; end if;
    if jsonb_typeof(payload->'meals') <> 'array' or jsonb_array_length(payload->'meals')<>3 then raise exception 'Invalid meal selection'; end if;
    for item in select value from jsonb_array_elements(payload->'task_ids') loop
      task_id := private.require_uuid(item);
      if task_id=any(selected_ids) then raise exception 'Duplicate task selection'; end if;
      selected_ids := array_append(selected_ids,task_id);
    end loop;
    for item in select value from jsonb_array_elements(payload->'meals') loop
      perform private.require_keys(item,array['slot','option_id']);
      slot := private.require_text(item->'slot',1,9);
      if slot not in ('breakfast','lunch','dinner') or slot=any(selected_slots) then raise exception 'Invalid or duplicate meal slot'; end if;
      selected_slots := array_append(selected_slots,slot);
      perform private.require_uuid(item->'option_id');
    end loop;
  end if;
  -- Lock the participant first, including initial check-in creation and idempotency replay.
  select * into profile from private.participant_profiles where id=uid for update;
  if profile.id is null then raise exception 'Participant setup required'; end if;
  perform private.require_active_self_grant(uid);
  select * into old from private.command_receipts where participant_id=uid and command_id=key;
  if old.command_id is not null then
    if old.command<>p_command then raise exception 'Idempotency key reused with changed command'; end if;
    return old.result || jsonb_build_object('replayed',true);
  end if;
  if day<>private.local_day(profile.time_zone) then raise exception 'Command local date is not current'; end if;
  if command_type='start_or_resume_checkin' then
    select * into c from private.daily_checkins where participant_id=uid and local_date=day for update;
    if c.id is null then
      insert into private.daily_checkins(participant_id,local_date) values(uid,day) returning * into c;
      insert into private.domain_events(participant_id,checkin_id,actor_id,command_id,event_type,local_date,data)
        values(uid,c.id,uid,key,'DailyCheckInStarted',day,jsonb_build_object('revision',c.revision));
    else
      insert into private.domain_events(participant_id,checkin_id,actor_id,command_id,event_type,local_date,data)
        values(uid,c.id,uid,key,'DailyCheckInResumed',day,jsonb_build_object('revision',c.revision));
    end if;
    result := jsonb_build_object('command_id',key,'checkin_id',c.id,'revision',c.revision,'result','resumed','plan',null,'replayed',false);
  else
    select * into c from private.daily_checkins where participant_id=uid and local_date=day for update;
    if c.id is null then raise exception 'Start check-in first'; end if;
    if c.revision<>expected then raise exception 'Stale check-in revision'; end if;
    if command_type='accept_day_plan' then
      select * into proposal from private.day_plan_proposals where id=proposal_id and participant_id=uid and checkin_id=c.id;
      if proposal.id is null or c.current_proposal_id is distinct from proposal.id then raise exception 'Stale or unknown proposal'; end if;
      if proposal.setup_revision<>profile.revision then raise exception 'Proposal predates setup changes'; end if;
      if exists(select 1 from private.accepted_day_plan_versions accepted where accepted.proposal_id=proposal.id) then raise exception 'Proposal already accepted'; end if;
      version := coalesce(c.accepted_version,0)+1;
      plan := proposal.plan || jsonb_build_object('version',version,'accepted_at',now());
      insert into private.accepted_day_plan_versions(checkin_id,participant_id,version,proposal_id,plan) values(c.id,uid,version,proposal.id,plan);
      update private.daily_checkins set revision=revision+1,accepted_version=version,updated_at=now() where id=c.id returning * into c;
      insert into private.domain_events(participant_id,checkin_id,actor_id,command_id,event_type,local_date,data)
        values(uid,c.id,uid,key,'DayPlanAccepted',day,jsonb_build_object('proposal_id',proposal.id,'version',version,'revision',c.revision));
      result := jsonb_build_object('command_id',key,'checkin_id',c.id,'revision',c.revision,'result','accepted','plan',plan,'replayed',false);
    else
      for item in select value from jsonb_array_elements(payload->'task_ids') loop
        task_id := private.require_uuid(item);
        select * into task_row from private.task_definitions where id=task_id and participant_id=uid and active;
        if task_row.id is null then raise exception 'Unknown or inactive task'; end if;
        task_list := task_list || jsonb_build_array(jsonb_build_object('id',task_row.id,'title',task_row.title,'time_hint',task_row.time_hint));
      end loop;
      for item in select value from jsonb_array_elements(payload->'meals') loop
        slot := item->>'slot'; option_id := private.require_uuid(item->'option_id');
        select * into meal_row from private.meal_options where id=option_id and participant_id=uid and active;
        if meal_row.id is null or not slot=any(meal_row.slots) then raise exception 'Unknown or unsuitable meal'; end if;
        meal_list := meal_list || jsonb_build_array(jsonb_build_object('slot',slot,'option_id',meal_row.id,'name',meal_row.name));
      end loop;
      proposal_id := gen_random_uuid();
      plan := jsonb_build_object('id',proposal_id,'task_ids',to_jsonb(selected_ids),'meals',meal_list,'tasks',task_list,'created_at',now());
      insert into private.day_plan_proposals(id,checkin_id,participant_id,setup_revision,checkin_revision,plan)
        values(proposal_id,c.id,uid,profile.revision,c.revision+1,plan);
      update private.daily_checkins set revision=revision+1,current_proposal_id=proposal_id,updated_at=now() where id=c.id returning * into c;
      insert into private.domain_events(participant_id,checkin_id,actor_id,command_id,event_type,local_date,data)
        values(uid,c.id,uid,key,case when command_type='revise_day_plan' then 'DayPlanRevised' else 'DayPlanProposed' end,day,jsonb_build_object('proposal_id',proposal_id,'revision',c.revision,'setup_revision',profile.revision));
      result := jsonb_build_object('command_id',key,'checkin_id',c.id,'revision',c.revision,'result','proposed','plan',plan,'replayed',false);
    end if;
  end if;
  insert into private.command_receipts(participant_id,command_id,command,result) values(uid,key,p_command,result);
  return result;
end $$;
create function private.nancy_receipt_impl(p_key uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform private.require_active_self_grant(private.require_uid());
  select result into r from private.command_receipts where participant_id=private.require_uid() and command_id=p_key;
  return r;
end $$;

-- SECURITY INVOKER wrappers expose only authenticated, typed RPC access.
create function public.nancy_today() returns jsonb language sql stable security invoker set search_path = '' as $$ select private.nancy_today_impl() $$;
create function public.nancy_setup(p_input jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.nancy_setup_impl(p_input) $$;
create function public.nancy_command(p_command jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.nancy_command_impl(p_command) $$;
create function public.nancy_receipt(p_key uuid) returns jsonb language sql stable security invoker set search_path = '' as $$ select private.nancy_receipt_impl(p_key) $$;

revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.nancy_today(),public.nancy_setup(jsonb),public.nancy_command(jsonb),public.nancy_receipt(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.nancy_today_impl(),private.nancy_setup_impl(jsonb),private.nancy_command_impl(jsonb),private.nancy_receipt_impl(uuid) to authenticated;
grant execute on function public.nancy_today(),public.nancy_setup(jsonb),public.nancy_command(jsonb),public.nancy_receipt(uuid) to authenticated;
