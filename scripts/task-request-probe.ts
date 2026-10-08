import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { schemaHash } from '../src/server/backup.js';

// Only the loopback server's connection settings are reused. Every test and
// restore target is created here under a new name; no active care DB is opened.
const run = randomUUID().replaceAll('-', '').slice(0, 12);
const prefix = `nancy_requests_${Date.now().toString(36)}_${run}`;
const names = [`${prefix}_care`, `${prefix}_source`, `${prefix}_restore`];
const created: string[] = [];
const evidencePath = '.local/probes/task-request-postgres.json';
const detailsPath = `.local/probes/task-request-vitest-${run}.json`;
let admin: Client | undefined, version = 'unknown', stage = 'configuration';
let results: { success?: boolean; numPassedTests?: number; numTotalTests?: number; numFailedTests?: number; numPendingTests?: number } = {};
let succeeded = false;
let failureCode: string | null = null;
const cleanup: Record<string, boolean> = {};
try {
  process.loadEnvFile('.local/runtime/local-care.env');
  const configured = process.env.DATABASE_URL;
  if (!configured) throw new Error('Missing local database configuration.');
  const base = new URL(configured);
  if (!['127.0.0.1','localhost'].includes(base.hostname) || base.port !== '55432') throw new Error('Use the qualified loopback server.');
  const url = (name: string) => { const target = new URL(base); target.pathname = '/'+name; target.search = ''; target.hash = ''; return target.toString(); };
  admin = new Client({ connectionString: url('postgres'), connectionTimeoutMillis: 5000 });
  stage = 'database_creation';
  await admin.connect();
  version = String((await admin.query('show server_version')).rows[0].server_version);
  for (const name of names) {
    if (!/^nancy_requests_[a-z0-9_]{1,47}$/.test(name)) throw new Error('Invalid disposable database name.');
    if ((await admin.query('select 1 from pg_database where datname=$1', [name])).rowCount) throw new Error('Disposable target already exists.');
    await admin.query(`create database "${name}"`); created.push(name);
  }
  await mkdir('.local/probes', { recursive: true });
  stage = 'actual_postgresql_tests';
  await promisify(execFile)(process.execPath, ['node_modules/vitest/vitest.mjs','run','tests/task-requests.test.ts','tests/request-backup.test.ts',
    '--configLoader','runner','--reporter=json',`--outputFile=${detailsPath}`], {
    cwd: process.cwd(), env: { ...process.env, TASK_REQUEST_TEST_URL: url(names[0]),
      REQUEST_BACKUP_SOURCE_URL: url(names[1]), REQUEST_BACKUP_TARGET_URL: url(names[2]) },
    windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024,
  });
  results = JSON.parse(await readFile(detailsPath, 'utf8'));
  succeeded = results.success === true && (results.numTotalTests ?? 0) > 0 && results.numFailedTests === 0;
  stage = 'complete';
} catch (error) {
  // Error objects can include connection details. Only bounded status and the
  // private test report reference are published by this runner.
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  failureCode = ['ECONNREFUSED','ETIMEDOUT','28P01','3D000','42501','42P04','ENOENT'].includes(code) ? code : 'probe_failed';
  try { results = JSON.parse(await readFile(detailsPath, 'utf8')); } catch { /* no test report was produced */ }
} finally {
  if (admin) {
    for (const name of created) {
      if (!names.includes(name) || !/^nancy_requests_[a-z0-9_]{1,47}$/.test(name)) continue;
      try { await admin.query(`drop database "${name}"`); cleanup[name] = true; }
      catch { cleanup[name] = false; }
    }
    await admin.end().catch(() => {});
  }
  const evidence = { observed_at: new Date().toISOString(), data_origin: 'synthetic', environment: 'actual isolated loopback PostgreSQL',
    server_version: version, status: succeeded ? 'passed' : 'failed', stage, failure_code: failureCode, passed: results.numPassedTests ?? 0,
    total: results.numTotalTests ?? 0, failed: results.numFailedTests ?? null, skipped: results.numPendingTests ?? null, schema_hash: schemaHash('companion_local'),
    test_files: ['tests/task-requests.test.ts','tests/request-backup.test.ts'], active_client_database_opened: false,
    disposable_databases_created: created.length, disposable_databases_removed: Object.values(cleanup).filter(Boolean).length,
    private_details_ref: detailsPath, retained_disposable_databases: Object.entries(cleanup).filter(([,removed]) => !removed).map(([name]) => name) };
  await mkdir('.local/probes', { recursive: true });
  await writeFile(`.local/probes/task-request-postgres-${run}.json`, JSON.stringify(evidence, null, 2)+'\n');
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2)+'\n');
  console.log(JSON.stringify(evidence));
  if (!succeeded || Object.values(cleanup).some(removed => !removed)) process.exitCode = 1;
}
