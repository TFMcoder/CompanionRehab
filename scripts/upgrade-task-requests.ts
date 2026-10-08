import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { parseEnv, promisify } from 'node:util';
import { Client } from 'pg';
import { localCareMigrations } from '../src/server/local-migrations.js';
import { databaseIdentity, type Snapshot } from '../src/server/backup.js';

// Explicit upgrade only; default inspection reads table presence and counts.
// Never emit care rows, account credentials, encryption keys or driver errors.
const apply = process.argv.includes('--apply');
const run = randomUUID().replaceAll('-', '');
const directory = `.local/upgrades/task-requests-${run}`;
const backupPath = `.local/backups/pre-task-requests-${run}.nancy`;
const keyPath = `.local/backup-keys/pre-task-requests-${run}.key`;
const evidencePath = `${directory}/evidence.json`;
const targetName = `nancy_upgrade_${run}`;
const historicalRevision = '575c8d6';
const oldTables = ['accounts','participant_profiles','role_grants','task_definitions','meal_options','daily_checkins','day_plan_proposals',
  'accepted_day_plan_versions','command_receipts','domain_events','grocery_items','appointments','append_only_mutations',
  'activity_records','actuation_targets','external_resource_links','actuation_intents','runtime_events'];
const requestTables = ['request_access','request_day_capacity','request_constraints','task_requests','request_help','request_flags','request_receipts'];
const careTables = oldTables.filter(table => table !== 'runtime_events');
const checks: Record<string, boolean> = {};
const evidence: Record<string, unknown> = { observed_at: new Date().toISOString(), operation: apply ? 'upgrade' : 'inspect',
  source_database: null, private_care_rows_logged: false, real_data_seeded: false, historical_backup_revision: historicalRevision,
  checks, status: 'failed' };
let source: Client | undefined, admin: Client | undefined, target: Client | undefined;
let created = false, committed = false, stage = 'configuration';
const check = (name: string, condition: unknown) => { checks[name] = Boolean(condition); if (!condition) throw new Error('Upgrade verification failed.'); };
const digest = (rows: unknown) => createHash('sha256').update(JSON.stringify(rows, (_key, value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)));
  return value;
})).digest('hex');
const tableDigest = (rows: Record<string, unknown>[]) => digest(rows.map(row => JSON.stringify(row, (_key, value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b))) : value)).sort());
async function counts(client: Client, tables: readonly string[]) {
  const result: Record<string, number> = {};
  for (const table of tables) result[table] = Number((await client.query(`select count(*)::int as n from companion_local.${table}`)).rows[0].n);
  return result;
}
async function verifyRows(client: Client, snapshot: Snapshot, tables: readonly string[]) {
  for (const table of tables) {
    // Match backup binary normalization without printing rows or their digests.
    const rows = (await client.query(`select * from companion_local.${table}`)).rows.map(row => Object.fromEntries(Object.entries(row).map(([key,value]) =>
      [key, Buffer.isBuffer(value) || value instanceof Uint8Array ? `\\x${Buffer.from(value as Uint8Array).toString('hex')}` : value])));
    if (tableDigest(rows) !== tableDigest(snapshot.tables[table])) return false;
  }
  return true;
}
try {
  const readEnvironment = async (file: string) => existsSync(file) ? parseEnv(await readFile(file, 'utf8')) : {};
  const environment = { ...await readEnvironment('.local/runtime/local-care.env'), ...await readEnvironment('.env.local'), ...process.env };
  const base = new URL(environment.DATABASE_URL || '');
  if (!['localhost','127.0.0.1'].includes(base.hostname) || base.port !== '55432' || !['/nancy_client_trial','/nancy_myday'].includes(base.pathname))
    throw new Error('Select the established local care database.');
  const connection = (name: string) => { const url = new URL(base); url.pathname = '/'+name; url.search = ''; url.hash = ''; return url.toString(); };
  evidence.source_database = base.pathname.slice(1);
  source = new Client({ connectionString: base.toString(), connectionTimeoutMillis: 5000, query_timeout: 30000 });
  await source.connect();
  evidence.server_version = String((await source.query('show server_version')).rows[0].server_version);
  stage = 'schema_inspection';
  const present = (await source.query("select table_name from information_schema.tables where table_schema='companion_local' and table_name=any($1::text[])", [requestTables])).rows;
  evidence.request_tables_present = present.length;
  evidence.before_counts = await counts(source, oldTables);
  if (present.length === requestTables.length) {
    const constraint = await source.query("select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='companion_local.activity_records'::regclass and conname='activity_records_last_action_check'");
    check('request_schema_present', constraint.rows.some(row => String(row.definition).includes("'accepted'")));
    evidence.request_counts = await counts(source, requestTables);
    evidence.status = 'already_current';
  } else {
    check('no_partial_request_schema', present.length === 0);
    if (!apply) evidence.status = 'upgrade_needed';
    else {
      await mkdir(directory, { recursive: true }); await mkdir('.local/backups', { recursive: true }); await mkdir('.local/backup-keys', { recursive: true });
      stage = 'historical_backup_adapter';
      // Pin the pre006 backup implementation. Rewrite only its module-relative
      // schema base so an ignored private copy reads the original db files.
      const historical = (await promisify(execFile)('git', ['show',`${historicalRevision}:src/server/backup.ts`], { windowsHide: true })).stdout;
      const legacyPath = `${directory}/backup-v005.ts`;
      await writeFile(legacyPath, historical.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(resolve('src/server/backup.ts')).href)), { flag: 'wx', mode: 0o600 });
      const legacy = await import(pathToFileURL(resolve(legacyPath)).href) as typeof import('../src/server/backup.js');
      check('legacy_table_scope_matches', JSON.stringify(legacy.localBackupTables) === JSON.stringify(oldTables));
      evidence.historical_backup_source_sha256 = createHash('sha256').update(historical).digest('hex');
      stage = 'encrypted_backup';
      const snapshot = await legacy.exportSnapshot(source, databaseIdentity(base.toString()), 'companion_local');
      const key = randomBytes(32);
      await writeFile(keyPath, key.toString('base64'), { flag: 'wx', mode: 0o600 });
      await writeFile(backupPath, legacy.encryptSnapshot(snapshot, key), { flag: 'wx', mode: 0o600 });
      const decoded = legacy.decryptSnapshot(await readFile(backupPath), Buffer.from(await readFile(keyPath, 'utf8'), 'base64'));
      check('encrypted_file_authenticated', tableDigest(decoded.tables.accounts) === tableDigest(snapshot.tables.accounts));
      check('session_and_provider_credentials_excluded', !Object.hasOwn(decoded.tables, 'sessions'));
      evidence.backup_ref = backupPath; evidence.key_ref = keyPath; evidence.legacy_adapter_ref = legacyPath;
      evidence.backup_schema_hash = snapshot.schema_hash;
      stage = 'isolated_restore';
      admin = new Client({ connectionString: connection('postgres'), connectionTimeoutMillis: 5000 }); await admin.connect();
      check('verified_disposable_target', /^nancy_upgrade_[a-f0-9]{32}$/.test(targetName) && base.pathname !== '/'+targetName &&
        (await admin.query('select 1 from pg_database where datname=$1', [targetName])).rowCount === 0);
      await admin.query(`create database "${targetName}"`); created = true;
      target = new Client({ connectionString: connection(targetName), connectionTimeoutMillis: 5000, query_timeout: 30000 }); await target.connect();
      for (const file of localCareMigrations.filter(file => file !== '006_family_task_requests.sql')) await target.query(await readFile('db/'+file, 'utf8'));
      await legacy.restoreSnapshot(target, decoded, databaseIdentity(connection(targetName)));
      check('actual_postgres_restore_matches_all_tables', await verifyRows(target, snapshot, oldTables));
      check('restore_contains_no_live_sessions', Number((await target.query('select count(*)::int as n from companion_local.sessions')).rows[0].n) === 0);
      evidence.restored_counts = await counts(target, oldTables);
      const migration = await readFile('db/006_family_task_requests.sql', 'utf8');
      check('migration_has_no_transaction_override', !/^\s*(?:begin|commit|rollback)\s*;/im.test(migration));
      evidence.migration_sha256 = createHash('sha256').update(migration).digest('hex');
      stage = 'isolated_upgrade_rehearsal';
      await target.query('begin');
      try {
        await target.query(migration);
        check('rehearsal_preserves_all_backup_rows', await verifyRows(target, snapshot, oldTables));
        check('rehearsal_request_tables_empty', Object.values(await counts(target, requestTables)).every(value => value === 0));
        await target.query('commit');
      } catch (error) { await target.query('rollback'); throw error; }
      stage = 'active_atomic_upgrade';
      await source.query('begin');
      try {
        await source.query("set local lock_timeout='10s'");
        // Prevent a new care write after freshness validation. Expiring metadata
        // may continue; migration never modifies runtime_events or sessions.
        for (const table of careTables) await source.query(`lock table companion_local.${table} in share row exclusive mode`);
        check('care_unchanged_since_verified_backup', await verifyRows(source, snapshot, careTables));
        await source.query(migration);
        check('active_upgrade_preserves_care_rows', await verifyRows(source, snapshot, careTables));
        const requestCounts = await counts(source, requestTables);
        check('no_requests_accounts_or_grants_seeded', Object.values(requestCounts).every(value => value === 0));
        evidence.request_counts = requestCounts; evidence.after_counts = await counts(source, oldTables);
        await source.query('commit'); committed = true;
      } catch (error) { await source.query('rollback'); throw error; }
      evidence.status = 'upgraded';
    }
  }
  stage = 'complete';
} catch (error) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  evidence.failure_code = ['ECONNREFUSED','ETIMEDOUT','28P01','42501','55P03','23514','23503','42P04'].includes(code) ? code : 'upgrade_verification_failed';
  process.exitCode = 1;
} finally {
  await target?.end().catch(() => {});
  if (created && admin && /^nancy_upgrade_[a-f0-9]{32}$/.test(targetName)) {
    try { await admin.query(`drop database "${targetName}"`); checks.disposable_restore_removed = true; }
    catch { checks.disposable_restore_removed = false; evidence.retained_disposable_database = targetName; process.exitCode = 1; }
  }
  await admin?.end().catch(() => {}); await source?.end().catch(() => {});
  evidence.stage = stage; evidence.migration_committed = committed;
  await mkdir(directory, { recursive: true });
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2)+'\n', { mode: 0o600 });
  console.log(JSON.stringify({ ...evidence, evidence_ref: evidencePath }));
}
