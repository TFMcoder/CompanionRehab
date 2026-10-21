-- Bounded, encrypted snapshots. They never contain instructions or authorize actions.
alter table companion_local.microsoft_connections
 add column if not exists prepared_context_ciphertext text,
 add column if not exists prepared_at timestamptz,
 add column if not exists prepared_revision integer,
 add column if not exists preparation_attempt_at timestamptz;
