-- Scoped Support Team visibility and in-app activity alerts.
create table if not exists companion_local.support_shares (
  participant_id uuid not null references companion_local.participant_profiles(id),
  actor_id uuid not null references companion_local.accounts(id),
  role text not null check(role in ('family_friend','administrator','clinician')),
  share_tasks boolean not null default false,
  share_meals boolean not null default false,
  share_progress boolean not null default false,
  revision integer not null default 1 check(revision>0),
  updated_at timestamptz not null default now(),
  primary key(participant_id,actor_id,role),
  foreign key(participant_id,actor_id,role) references companion_local.role_grants(participant_id,actor_id,role)
);
create table if not exists companion_local.support_notification_preferences (
  participant_id uuid not null references companion_local.participant_profiles(id),
  actor_id uuid not null references companion_local.accounts(id),
  role text not null check(role in ('family_friend','administrator','clinician')),
  task_completion boolean not null default false,
  meal_completion boolean not null default false,
  task_reschedule boolean not null default false,
  meal_reschedule boolean not null default false,
  quiet_start time,
  quiet_end time,
  time_zone text not null,
  revision integer not null default 1 check(revision>0),
  updated_at timestamptz not null default now(),
  primary key(participant_id,actor_id,role),
  foreign key(participant_id,actor_id,role) references companion_local.role_grants(participant_id,actor_id,role),
  check((quiet_start is null)=(quiet_end is null))
);
create table if not exists companion_local.support_notifications (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references companion_local.participant_profiles(id),
  recipient_id uuid not null references companion_local.accounts(id),
  recipient_role text not null check(recipient_role in ('family_friend','administrator','clinician')),
  event_id uuid not null references companion_local.domain_events(id),
  activity_id uuid not null,
  activity_kind text not null check(activity_kind in ('task','meal')),
  event_type text not null check(event_type in ('ActivityReported','ActivityRescheduled')),
  activity_revision integer not null check(activity_revision>0),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique(event_id,recipient_id,recipient_role)
);
create index if not exists support_notifications_recipient on companion_local.support_notifications(participant_id,recipient_id,recipient_role,created_at,id);
create table if not exists companion_local.support_notification_scanned (
  event_id uuid primary key references companion_local.domain_events(id),
  scanned_at timestamptz not null default now()
);
create table if not exists companion_local.support_notification_scan_cursor (
 id boolean primary key default true check(id), last_participant_id uuid references companion_local.participant_profiles(id)
);
create index if not exists support_activity_events on companion_local.domain_events(created_at,id)
  where event_type in ('ActivityReported','ActivityRescheduled');
create index if not exists support_activity_participant_events on companion_local.domain_events(participant_id,created_at,id)
  where event_type in ('ActivityReported','ActivityRescheduled');
revoke all on companion_local.support_shares,companion_local.support_notification_preferences,companion_local.support_notifications,
  companion_local.support_notification_scanned,companion_local.support_notification_scan_cursor from public;
