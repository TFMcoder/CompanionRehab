begin;
-- Operational metadata only. Care facts live in domain_events/receipts, not this expiring log.
create table if not exists companion_local.runtime_events (
  id uuid primary key,
  recorded_at timestamptz not null,
  kind text not null check (kind in ('http','conversation','startup')),
  actor_id uuid,
  request_id uuid,
  conversation_id uuid,
  turn_id uuid,
  outcome text not null check (outcome in ('ok','error','interrupted','ready','unavailable')),
  measurements jsonb not null check (jsonb_typeof(measurements)='object' and octet_length(measurements::text)<=4096)
);
create index if not exists runtime_events_recorded_idx on companion_local.runtime_events(recorded_at);
create index if not exists runtime_events_turn_idx on companion_local.runtime_events(conversation_id,turn_id) where turn_id is not null;
revoke all on companion_local.runtime_events from public;
commit;
