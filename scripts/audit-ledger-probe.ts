import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from 'pg';

// Run the same identity regressions against actual PostgreSQL in a newly
// created disposable database. Never select, truncate, or migrate client data.
process.loadEnvFile('.local/runtime/local-care.env');
const base = new URL(process.env.DATABASE_URL!);
if (!['127.0.0.1','localhost'].includes(base.hostname) || base.port !== '55432') throw new Error('Use the qualified loopback test server.');
const name=`nancy_audit_${Date.now().toString(36)}_${randomUUID().replaceAll('-','').slice(0,8)}`;
const adminUrl=new URL(base);adminUrl.pathname='/postgres';
const target=new URL(base);target.pathname=`/${name}`;
const admin=new Client({connectionString:adminUrl.toString(),connectionTimeoutMillis:5000});
const output='.local/probes/audit-ledger-regression-vitest.json';
await mkdir('.local/probes',{recursive:true});
let version='unknown';
try {
  await admin.connect();
  version=String((await admin.query('show server_version')).rows[0].server_version);
  await admin.query(`create database "${name}"`);
} finally { await admin.end(); }
let testError=false;
try {
  await promisify(execFile)(process.execPath,['node_modules/vitest/vitest.mjs','run','tests/activity-identity.test.ts','--configLoader','runner','--reporter=json',`--outputFile=${output}`],{
    cwd:process.cwd(),env:{...process.env,NANCY_REGRESSION_DATABASE_URL:target.toString()},windowsHide:true,timeout:120000,maxBuffer:1024*1024,
  });
} catch { testError=true; }
const results=JSON.parse(await readFile(output,'utf8'));
const evidence={observed_at:new Date().toISOString(),server_version:version,database:name,data_policy:'disposable_live',
  status:!testError&&results.success?'passed':'failed',passed:results.numPassedTests,total:results.numTotalTests,failed:results.numFailedTests,
  test_file:'tests/activity-identity.test.ts',private_details_ref:output};
await writeFile('.local/probes/audit-ledger-regression.json',JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence));
if(evidence.status!=='passed')process.exitCode=1;
