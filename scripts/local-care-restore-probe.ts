import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { Pool, Client } from 'pg';
import { LocalCare, bootstrapLocalUser } from '../src/server/local-care.js';
import { decryptSnapshot, databaseIdentity, encryptSnapshot, exportSnapshot, restoreSnapshot } from '../src/server/backup.js';
import type { Snapshot } from '../src/server/backup.js';

process.loadEnvFile('.local/runtime/local-care.env');
const configured = process.env.DATABASE_URL;
if (!configured) throw new Error('Local PostgreSQL is not configured.');
const base = new URL(configured);
if (!['127.0.0.1', 'localhost', '::1'].includes(base.hostname) || base.port !== '55432') throw new Error('Restore probe only uses loopback PostgreSQL.');
const sourceUrl = new URL(base); sourceUrl.pathname = '/nancy_myday_probe';
const ownerUrl = new URL(base); ownerUrl.pathname = '/postgres';
const suffix = randomUUID().replaceAll('-', '');
const targetName = `nancy_restore_probe_${suffix}`;
const targetUrl = new URL(base); targetUrl.pathname = `/${targetName}`;
const source = new Client({ connectionString: sourceUrl.toString(), connectionTimeoutMillis: 5000 });
const admin = new Client({ connectionString: ownerUrl.toString(), connectionTimeoutMillis: 5000 });
const started = Date.now();
const now = () => new Date().toISOString();
const checks: Record<string, boolean> = {};
let postgresVersion = 'unknown';
let tableCounts: Record<string, number> = {};
let snapshot: Snapshot | undefined;
try {
  await source.connect();
  postgresVersion = (await source.query('show server_version')).rows[0].server_version as string;
  const pool = new Pool({ connectionString: sourceUrl.toString(), max: 1 });
  try {
    const care = new LocalCare({ pool });
    const testId = randomUUID();
    const testEmail = `restore-${testId}@example.invalid`;
    const testPassword = `restore-${randomBytes(24).toString('base64url')}`;
    const owner = await bootstrapLocalUser(pool, { email: testEmail, password: testPassword, role: 'client', display_name: 'Disposable restore probe', time_zone: 'America/Toronto' });
    const session = await care.login(testEmail, testPassword);
    const initial = await care.today(session);
    const setup = await care.setup(session, { display_name: 'Disposable restore probe', time_zone: 'America/Toronto', preferences: 'Synthetic recovery test only.', expected_revision: initial.profile!.revision,
      tasks: [{ title: 'Synthetic restore task', time_hint: 'test', urgency: 'medium', scheduled_time: '09:30', category: 'task', duration_minutes: 5 }],
      meal_options: [{ name: 'Synthetic breakfast', slots: ['breakfast'] }, { name: 'Synthetic lunch', slots: ['lunch'] }, { name: 'Synthetic dinner', slots: ['dinner'] }] });
    const start = await care.command(session, { type: 'start_or_resume_checkin', idempotency_key: randomUUID(), local_date: initial.local_date, expected_revision: 0, payload: {} });
    const proposal = await care.command(session, { type: 'propose_day_plan', idempotency_key: randomUUID(), local_date: initial.local_date, expected_revision: start.revision,
      payload: { task_ids: [setup.tasks[0].id], meals: [
        { slot: 'breakfast', option_id: setup.meal_options.find(item => item.slots.includes('breakfast'))!.id },
        { slot: 'lunch', option_id: setup.meal_options.find(item => item.slots.includes('lunch'))!.id },
        { slot: 'dinner', option_id: setup.meal_options.find(item => item.slots.includes('dinner'))!.id },
      ] } });
    await care.command(session, { type: 'accept_day_plan', idempotency_key: randomUUID(), local_date: initial.local_date, expected_revision: proposal.revision, payload: { proposal_id: proposal.plan!.id } });
    const exported = await exportSnapshot(source as any, databaseIdentity(sourceUrl.toString()), 'companion_local');
    const key = randomBytes(32);
    snapshot = decryptSnapshot(encryptSnapshot(exported, key), key);
    checks.encrypted_round_trip = snapshot.scope === 'care-and-local-access' && !JSON.stringify(exported).includes(testPassword);
    checks.live_sessions_excluded = !Object.hasOwn(snapshot.tables, 'sessions');
    checks.synthetic_account_exported = snapshot.tables.accounts.some(row => row.id === owner.user_id);
    tableCounts = Object.fromEntries(Object.entries(snapshot.tables).map(([name, rows]) => [name, rows.length]));
    await care.logout(session);
    await pool.end();
  } finally { /* Pool ownership ended with the care workflow above. */ }

  await admin.connect();
  const exists = await admin.query('select 1 from pg_database where datname=$1', [targetName]);
  if (exists.rowCount) throw new Error('The generated restore target unexpectedly already exists.');
  await admin.query(`create database "${targetName}"`);
  await admin.end();
  const target = new Client({ connectionString: targetUrl.toString(), connectionTimeoutMillis: 5000 });
  try {
    await target.connect();
    const migrationUrl = new URL(targetUrl);
    const migrationPool = new Pool({ connectionString: migrationUrl.toString(), max: 1 });
    try { for (const file of ['db/002_local_care.sql','db/003_activity_ledger.sql','db/004_client_readiness.sql','db/005_runtime_observability.sql']) await migrationPool.query(await (await import('node:fs/promises')).readFile(file, 'utf8')); }
    finally { await migrationPool.end(); }
    await restoreSnapshot(target as any, snapshot!, databaseIdentity(targetUrl.toString()));
    const counts = await target.query(`select
      (select count(*)::int from companion_local.accounts) as accounts,
      (select count(*)::int from companion_local.sessions) as sessions,
      (select count(*)::int from companion_local.daily_checkins) as checkins,
      (select count(*)::int from companion_local.accepted_day_plan_versions) as accepted_versions,
      (select count(*)::int from companion_local.command_receipts) as receipts`);
    checks.restore_has_synthetic_accounts = counts.rows[0].accounts > 0;
    checks.restore_copied_no_sessions = counts.rows[0].sessions === 0;
    checks.restore_has_disposable_checkin = counts.rows[0].checkins > 0;
    checks.restore_has_accepted_version = counts.rows[0].accepted_versions > 0;
    checks.restore_has_receipts = counts.rows[0].receipts > 0;
  } finally { await target.end(); }
  const receipt = { created_at: now(), database: 'actual local PostgreSQL loopback', server_version: postgresVersion,
    source: 'nancy_myday_probe', target_database: targetName, snapshot_format: snapshot!.format,
    scope: snapshot!.scope, encryption: 'AES-256-GCM in memory; random key not persisted', live_session_tokens_in_snapshot: false,
    synthetic_records_only: true, checks, table_counts: tableCounts, elapsed_ms: Date.now() - started };
  await mkdir('.local/probes', { recursive: true });
  await writeFile('.local/probes/local-care-live.json', `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'w' });
  if (Object.values(checks).some(value => !value)) throw new Error('A local restore qualification assertion failed.');
  process.stdout.write(JSON.stringify({ status: 'completed', server_version: postgresVersion, checks_passed: Object.values(checks).filter(Boolean).length, checks_total: Object.keys(checks).length, elapsed_ms: receipt.elapsed_ms }) + '\n');
} catch {
  const receipt = { created_at: now(), database: 'actual local PostgreSQL loopback', server_version: postgresVersion,
    source: 'nancy_myday_probe', target_database: targetName, status: 'failed', synthetic_records_only: true,
    checks, table_counts: tableCounts, elapsed_ms: Date.now() - started, safe_errors: ['Local encrypted backup/restore assertion failed.'] };
  await mkdir('.local/probes', { recursive: true });
  await writeFile('.local/probes/local-care-live.json', `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'w' });
  process.stderr.write('Local encrypted backup/restore probe failed; see the sanitized private receipt.\n');
  process.exitCode = 1;
} finally {
  await source.end().catch(() => {});
  await admin.end().catch(() => {});
}
