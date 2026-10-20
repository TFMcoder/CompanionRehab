/** Actual disposable PostgreSQL and listening HTTP checks; never opens live care. */
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { Client } from 'pg';
import { configFromEnv, loadEnvironment } from '../src/server/config.js';

if (!process.argv.includes('--run-local')) throw new Error('Use --run-local for isolated synthetic daily-loop checks.');
loadEnvironment();const base = new URL(configFromEnv().databaseUrl ?? '');
if (!['127.0.0.1', 'localhost'].includes(base.hostname) || base.port !== '55432' || base.search || base.hash) throw new Error('Expected configured loopback PostgreSQL.');
base.pathname = '/postgres';const admin = new Client({ connectionString: base.href });
const report = '.local/probes/daily-loop-postgres-tests.json', evidence = '.local/probes/daily-loop-postgres.json';
await mkdir('.local/probes', { recursive: true });await admin.connect();
const names = async () => new Set((await admin.query("select datname from pg_database where datname like 'nancy_loop_test_%'")).rows.map(row => row.datname as string));
const before = await names();let code: number | null = null;
try {
  code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--configLoader', 'runner', 'tests/daily-loop-gaps.test.ts', '--reporter=json', '--outputFile=' + report],
      { env: { ...process.env, DAILY_LOOP_TEST_ADMIN_URL: base.href }, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);child.once('exit', resolve);
  });
  const result = JSON.parse(await readFile(report, 'utf8')), after = await names(), left = [...after].filter(name => !before.has(name));
  const summary = { observed_at: new Date().toISOString(), status: code === 0 && result.success && !left.length ? 'passed' : 'failed',
    actual_postgresql: true, actual_listening_http: true, data_origin: 'synthetic', physical_device: false, model_provider_called: false, established_care_database_opened: false,
    tests_passed: result.numPassedTests, tests_failed: result.numFailedTests, disposable_databases_remaining: left.length, test_report_ref: report };
  await writeFile(evidence, JSON.stringify(summary, null, 2) + '\n');console.log(JSON.stringify(summary));
  if (summary.status !== 'passed') process.exitCode = 1;
} finally { await admin.end(); }
