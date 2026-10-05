import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

process.loadEnvFile('.local/runtime/local-care.env');
const configured = process.env.DATABASE_URL;
if (!configured) throw new Error('Local PostgreSQL connection is not configured.');
const base = new URL(configured);
if (!['127.0.0.1', 'localhost', '::1'].includes(base.hostname) || base.port !== '55432') throw new Error('Local-care migration only runs against the configured loopback PostgreSQL instance.');
const schema = (await Promise.all(['db/002_local_care.sql','db/003_activity_ledger.sql'].map(path=>readFile(path,'utf8')))).join('\n');
for (const dbName of ['nancy_myday_probe', 'nancy_myday']) {
  const adminUrl = new URL(base); adminUrl.pathname = '/postgres';
  const admin = new Pool({ connectionString: adminUrl.toString(), max: 1, connectionTimeoutMillis: 5000 });
  try {
    const exists = await admin.query('select 1 from pg_database where datname=$1', [dbName]);
    if (!exists.rowCount) await admin.query(`create database "${dbName}"`);
  } finally { await admin.end(); }
  const targetUrl = new URL(base); targetUrl.pathname = `/${dbName}`;
  const target = new Pool({ connectionString: targetUrl.toString(), max: 1, connectionTimeoutMillis: 5000 });
  try { await target.query(schema); }
  finally { await target.end(); }
  process.stdout.write(`Applied local care schema to ${dbName}.\n`);
}
