import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { localCareMigrations } from '../src/server/local-migrations.js';
import {assertEmptyInitializationTarget,initializeEmptyLocalSchema} from '../src/server/local-schema-initialize.js';

if(!process.argv.includes('--initialize-empty'))throw Error('Historical initializer only. Use --initialize-empty for fresh databases; established care requires scripts/upgrade-local-schema.ts.');
process.loadEnvFile('.local/runtime/local-care.env');
const configured = process.env.DATABASE_URL;
if (!configured) throw new Error('Local PostgreSQL connection is not configured.');
const base = new URL(configured);
if (!['127.0.0.1', 'localhost', '::1'].includes(base.hostname) || base.port !== '55432') throw new Error('Local-care migration only runs against the configured loopback PostgreSQL instance.');
const activeName = base.pathname.slice(1);
if (!['nancy_myday','nancy_client_trial'].includes(activeName)) throw new Error('Select an allowed local Nancy database for fresh initialization.');
const schema = (await Promise.all(localCareMigrations.map(file=>readFile('db/'+file,'utf8')))).join('\n');
const names=['nancy_myday_probe',activeName];
// Inspect every existing target before the first migration or database creation.
for(const dbName of names){
  const adminUrl=new URL(base);adminUrl.pathname='/postgres';
  const admin=new Pool({connectionString:adminUrl.toString(),max:1,connectionTimeoutMillis:5000});
  let exists=false;
  try{exists=!!(await admin.query('select 1 from pg_database where datname=$1',[dbName])).rowCount;}finally{await admin.end();}
  if(!exists)continue;
  const targetUrl=new URL(base);targetUrl.pathname=`/${dbName}`;
  const target=new Pool({connectionString:targetUrl.toString(),max:1,connectionTimeoutMillis:5000});
  try{await assertEmptyInitializationTarget(target);}finally{await target.end();}
}
for (const dbName of names) {
  const adminUrl = new URL(base); adminUrl.pathname = '/postgres';
  const admin = new Pool({ connectionString: adminUrl.toString(), max: 1, connectionTimeoutMillis: 5000 });
  try {
    const exists = await admin.query('select 1 from pg_database where datname=$1', [dbName]);
    if (!exists.rowCount) await admin.query(`create database "${dbName}"`);
  } finally { await admin.end(); }
  const targetUrl = new URL(base); targetUrl.pathname = `/${dbName}`;
  const target = new Pool({ connectionString: targetUrl.toString(), max: 1, connectionTimeoutMillis: 5000 });
  try { await initializeEmptyLocalSchema(target,schema); }
  finally { await target.end(); }
  process.stdout.write(`Applied local care schema to ${dbName}.\n`);
}
