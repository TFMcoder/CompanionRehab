import { PGlite } from '@electric-sql/pglite';
import { Client, Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localCareMigrations } from '../../src/server/local-migrations.js';
import { pglitePool } from './pglite-pool.js';

/** Each invocation owns a new fixture. Never opens the established care database. */
export async function dailyLoopDatabase() {
  const external = process.env.DAILY_LOOP_TEST_ADMIN_URL;
  let pool: Pool, close: () => Promise<void>, migrate:(sql:string)=>Promise<unknown>;
  if (external) {
    const url = new URL(external);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '55432' || url.pathname !== '/postgres' || url.search || url.hash)
      throw new Error('Use loopback PostgreSQL admin solely to create disposable daily-loop fixtures.');
    const name = 'nancy_loop_test_' + randomUUID().replaceAll('-', ''), admin = new Client({ connectionString: url.href });
    await admin.connect();let created = false;
    try { await admin.query('create database ' + name);created = true; } catch (error) { await admin.end();throw error; }
    url.pathname = '/' + name;pool = new Pool({ connectionString: url.href, max: 8 });
    migrate=sql=>pool.query(sql);
    close = async () => { await pool.end();try { if (created && /^nancy_loop_test_[a-f0-9]{32}$/.test(name)) await admin.query('drop database ' + name); } finally { await admin.end(); } };
  } else {
    const db = new PGlite();pool = pglitePool(db) as unknown as Pool;close = () => db.close();migrate=sql=>db.exec(sql);
  }
  try { for (const file of localCareMigrations) await migrate(await readFile(new URL('../../db/' + file, import.meta.url), 'utf8')); }
  catch (error) { await close();throw error; }
  return { pool, close };
}
