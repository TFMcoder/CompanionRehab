-- Explicit per-login choice; existing sessions retain their seven-day lifetime.
alter table companion_local.sessions add column if not exists remember_device boolean not null default false;
