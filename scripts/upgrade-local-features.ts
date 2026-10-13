import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { loadEnvironment,configFromEnv } from '../src/server/config.js';
import { localCareMigrations } from '../src/server/local-migrations.js';
import { localBackupTables,databaseIdentity,type Snapshot } from '../src/server/backup.js';

// Explicit, atomic upgrade from the verified pre-feature revision. No clinical,
// household, scoring, sharing or provider data is seeded. Default is inspection.
const apply=process.argv.includes('--apply'),id=randomUUID().replaceAll('-','');
const directory=`.local/upgrades/local-features-${id}`,evidencePath=`${directory}/evidence.json`;
const backupPath=`.local/backups/pre-local-features-${id}.nancy`,keyPath=`.local/backup-keys/pre-local-features-${id}.key`;
const targetName=`nancy_features_upgrade_${id}`,historicalRevision='dbf7abe';
const oldMigrations=localCareMigrations.filter(file=>Number(file.slice(0,3))<=6),newMigrations=localCareMigrations.filter(file=>Number(file.slice(0,3))>6);
let source:Client|undefined,admin:Client|undefined,target:Client|undefined,created=false,committed=false,stage='configuration';
const checks:Record<string,boolean>={},evidence:Record<string,unknown>={observed_at:new Date().toISOString(),operation:apply?'upgrade':'inspect',historical_revision:historicalRevision,status:'failed',care_values_logged:false,seeded:false,checks};
const check=(name:string,value:unknown)=>{checks[name]=!!value;if(!value)throw new Error('Verification failed.');};
const digest=(rows:unknown[])=>createHash('sha256').update(JSON.stringify(rows.map(row=>JSON.stringify(row,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v)).sort())).digest('hex');
async function verifyRows(db:Client,snapshot:Snapshot,tables:string[]){
 for(const table of tables){
  const previous=snapshot.tables[table];
  const columns=previous.length?Object.keys(previous[0]):null;
  if(columns?.some(c=>!/^[a-z_][a-z0-9_]*$/.test(c)))throw new Error('Invalid saved column.');
  const rows=(await db.query(`select ${columns?columns.join(','):'*'} from companion_local.${table}`)).rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,Buffer.isBuffer(value)||value instanceof Uint8Array?`\\x${Buffer.from(value).toString('hex')}`:value])));
  if(digest(rows)!==digest(previous))return false;
 }return true;
}
async function schemaSignature(db:Client){
 // Compare catalog definitions, not just table names. Exclude database OIDs and
 // statistics so the same schema in an isolated database has the same digest.
 const statements=[
  `select table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default from information_schema.columns where table_schema='companion_local' order by table_name,ordinal_position`,
  `select c.relname as table_name,k.conname,pg_get_constraintdef(k.oid,true) as definition from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='companion_local' order by c.relname,k.conname`,
  `select tablename,indexname,indexdef from pg_indexes where schemaname='companion_local' order by tablename,indexname`,
  `select c.relname as table_name,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true) as definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='companion_local' and not t.tgisinternal order by c.relname,t.tgname`,
  `select p.proname,pg_get_function_identity_arguments(p.oid) as arguments,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='companion_local' order by p.proname,arguments`
 ];
 const definitions=[];for(const sql of statements)definitions.push((await db.query(sql)).rows);
 return digest(definitions);
}
try {
 loadEnvironment();const config=configFromEnv(),base=new URL(config.databaseUrl??'');
 check('established_loopback_source',['localhost','127.0.0.1'].includes(base.hostname)&&base.port==='55432'&&['/nancy_client_trial','/nancy_myday'].includes(base.pathname));
 const connection=(name:string)=>{const u=new URL(base);u.pathname='/'+name;u.search='';u.hash='';return u.toString();};
 source=new Client({connectionString:base.toString(),connectionTimeoutMillis:5000,query_timeout:30000});await source.connect();evidence.server_version=(await source.query('show server_version')).rows[0].server_version;
 const historical=(await promisify(execFile)('git',['show',`${historicalRevision}:src/server/backup.ts`],{windowsHide:true})).stdout;
 const adapter=historical.replace("import { localCareMigrations } from './local-migrations.js';",`const localCareMigrations=${JSON.stringify(oldMigrations)};`).replaceAll('import.meta.url',JSON.stringify(pathToFileURL(resolve('src/server/backup.ts')).href));
 await mkdir(directory,{recursive:true});const adapterPath=`${directory}/backup-v006.ts`;await writeFile(adapterPath,adapter,{flag:'wx',mode:0o600});
 const legacy=await import(pathToFileURL(resolve(adapterPath)).href) as typeof import('../src/server/backup.js');
 const oldTables=[...legacy.localBackupTables] as string[],newTables=localBackupTables.filter(t=>!oldTables.includes(t));
 const present=(await source.query("select table_name from information_schema.tables where table_schema='companion_local' and table_name=any($1::text[])",[newTables])).rows;
 stage='schema_inspection';evidence.new_tables_present=present.length;evidence.new_tables_expected=newTables.length;
 check('old_schema_present',(await source.query("select table_name from information_schema.tables where table_schema='companion_local' and table_name=any($1::text[])",[oldTables])).rows.length===oldTables.length);
 if(present.length===newTables.length){
  stage='current_schema_verification';
  admin=new Client({connectionString:connection('postgres'),connectionTimeoutMillis:5000});await admin.connect();
  check('isolated_schema_reference',/^nancy_features_upgrade_[a-f0-9]{32}$/.test(targetName)&&(await admin.query('select 1 from pg_database where datname=$1',[targetName])).rowCount===0);
  await admin.query(`create database "${targetName}"`);created=true;target=new Client({connectionString:connection(targetName),query_timeout:30000});await target.connect();
  for(const file of localCareMigrations)await target.query(await readFile('db/'+file,'utf8'));
  check('current_schema_matches_full_migrations',await schemaSignature(source)===await schemaSignature(target));
  evidence.status='already_current';
 }
 else {
  check('no_partial_feature_schema',present.length===0);
  if(!apply)evidence.status='upgrade_needed';
  else {
   stage='encrypted_backup';await mkdir('.local/backups',{recursive:true});await mkdir('.local/backup-keys',{recursive:true});
   const snapshot=await legacy.exportSnapshot(source,databaseIdentity(base.toString()),'companion_local'),key=randomBytes(32);
   await writeFile(keyPath,key.toString('base64'),{flag:'wx',mode:0o600});await writeFile(backupPath,legacy.encryptSnapshot(snapshot,key),{flag:'wx',mode:0o600});
   const decoded=legacy.decryptSnapshot(await readFile(backupPath),Buffer.from(await readFile(keyPath,'utf8'),'base64'));
   check('encrypted_backup_verified',digest(decoded.tables.accounts)===digest(snapshot.tables.accounts));check('no_sessions_in_backup',!Object.hasOwn(decoded.tables,'sessions'));
   evidence.backup_ref=backupPath;evidence.key_ref=keyPath;evidence.adapter_ref=adapterPath;
   admin=new Client({connectionString:connection('postgres'),connectionTimeoutMillis:5000});await admin.connect();
   check('isolated_empty_restore_target',/^nancy_features_upgrade_[a-f0-9]{32}$/.test(targetName)&&(await admin.query('select 1 from pg_database where datname=$1',[targetName])).rowCount===0);
   await admin.query(`create database "${targetName}"`);created=true;target=new Client({connectionString:connection(targetName),query_timeout:30000});await target.connect();
   stage='restore';for(const file of oldMigrations)await target.query(await readFile('db/'+file,'utf8'));
   await legacy.restoreSnapshot(target,decoded,databaseIdentity(connection(targetName)));check('restored_all_existing_rows',await verifyRows(target,decoded,oldTables));
   const migration=(await Promise.all(newMigrations.map(file=>readFile('db/'+file,'utf8')))).join('\n');
   check('migration_no_transaction_override',!/^\s*(?:begin|commit|rollback)\s*;/im.test(migration));
   evidence.migrations=newMigrations;evidence.migration_sha256=createHash('sha256').update(migration).digest('hex');
   stage='rehearsal';await target.query('begin');try{await target.query(migration);check('rehearsal_preserved_existing_columns',await verifyRows(target,decoded,oldTables));await target.query('commit');}catch(error){await target.query('rollback');throw error;}
   stage='active_upgrade';const durable=oldTables.filter(t=>t!=='runtime_events');
   await source.query('begin');try{
    await source.query("set local lock_timeout='10s'");for(const table of durable)await source.query(`lock table companion_local.${table} in share row exclusive mode`);
    check('no_care_change_since_backup',await verifyRows(source,decoded,durable));await source.query(migration);
    check('existing_care_preserved',await verifyRows(source,decoded,durable));
    check('upgraded_schema_matches_rehearsal',await schemaSignature(source)===await schemaSignature(target));
    for(const table of newTables)check(`empty_${table}`,(await source.query(`select 1 from companion_local.${table} limit 1`)).rows.length===0);
    await source.query('commit');committed=true;evidence.status='upgraded';
   }catch(error){await source.query('rollback');throw error;}
  }
 }
 stage='complete';
} catch(error) {
 const code=error&&typeof error==='object'&&'code' in error?String(error.code):'';
 evidence.failure_code=['ECONNREFUSED','ETIMEDOUT','28P01','42501','55P03','23514','23503'].includes(code)?code:'verification_failed';process.exitCode=1;
} finally {
 await target?.end().catch(()=>{});
 if(created&&admin&&/^nancy_features_upgrade_[a-f0-9]{32}$/.test(targetName)){try{await admin.query(`drop database "${targetName}"`);checks.disposable_removed=true;}catch{checks.disposable_removed=false;process.exitCode=1;}}
 await admin?.end().catch(()=>{});await source?.end().catch(()=>{});evidence.stage=stage;evidence.committed=committed;
 await mkdir(directory,{recursive:true});await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({status:evidence.status,stage,committed,checks_passed:Object.values(checks).filter(Boolean).length,checks_total:Object.keys(checks).length,evidence_ref:evidencePath}));
}
