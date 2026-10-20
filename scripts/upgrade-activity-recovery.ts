import {Client} from 'pg';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {loadEnvironment,configFromEnv} from '../src/server/config.js';
import {localCareMigrations} from '../src/server/local-migrations.js';
import {localBackupTables,exportSnapshot,encryptSnapshot,decryptSnapshot,restoreSnapshot,databaseIdentity} from '../src/server/backup.js';
import {canonicalJson} from '../src/server/local-authority.js';

// Additive upgrade only. Never seed/reset care data or replay earlier migrations.
loadEnvironment();const config=configFromEnv(),base=new URL(config.databaseUrl??'');
if(!['127.0.0.1','localhost'].includes(base.hostname)||base.port!=='55432'||!['/nancy_client_trial','/nancy_myday'].includes(base.pathname))throw new Error('Require the established local care database.');
const apply=process.argv.includes('--apply'),id=randomUUID().replaceAll('-',''),name='nancy_recovery_upgrade_'+id;
const url=(database:string)=>{const target=new URL(base);target.pathname='/'+database;target.search='';target.hash='';return target.toString();};
const source=new Client({connectionString:base.toString(),connectionTimeoutMillis:5000}),admin=new Client({connectionString:url('postgres'),connectionTimeoutMillis:5000});
let target:Client|undefined,created=false;const checks:Record<string,boolean>={},evidence={status:'failed',applied:false,checks,care_values_logged:false};
const assert=(key:string,ok:boolean)=>{checks[key]=ok;if(!ok)throw new Error(key);};
const digest=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');
const digestTables=(tables:Record<string,unknown[]>)=>digest(Object.fromEntries(Object.entries(tables).map(([table,rows])=>[table,[...rows].sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b)))])));
try{await source.connect();
 const present=(await source.query("select to_regclass('companion_local.pending_activity_commands') as name")).rows[0].name;
 if(present){assert('recovery_table_has_expected_columns',(await source.query("select column_name from information_schema.columns where table_schema='companion_local' and table_name='pending_activity_commands'")).rows.length===6);evidence.status='already_current';}
 else if(!apply)evidence.status='upgrade_needed';
 else{
  const snapshot=await exportSnapshot(source,databaseIdentity(base.toString()),'companion_local',true),key=randomBytes(32),encrypted=encryptSnapshot(snapshot,key);
  assert('encrypted_backup_valid',digest(decryptSnapshot(encrypted,key).tables)===digest(snapshot.tables));
  await mkdir('.local/backups',{recursive:true});await mkdir('.local/backup-keys',{recursive:true});
  await writeFile(`.local/backups/pre-activity-recovery-${id}.nancy`,encrypted,{flag:'wx',mode:0o600});await writeFile(`.local/backup-keys/pre-activity-recovery-${id}.key`,key.toString('base64'),{flag:'wx',mode:0o600});
  await admin.connect();assert('fresh_disposable_restore',/^nancy_recovery_upgrade_[a-f0-9]{32}$/.test(name)&&(await admin.query('select 1 from pg_database where datname=$1',[name])).rowCount===0);
  await admin.query('create database '+name);created=true;target=new Client({connectionString:url(name)});await target.connect();
  for(const file of localCareMigrations)await target.query(await readFile('db/'+file,'utf8'));
  await restoreSnapshot(target,snapshot,databaseIdentity(url(name)));const restored=await exportSnapshot(target,databaseIdentity(url(name)),'companion_local');delete restored.tables.pending_activity_commands;
  for(const table of Object.keys(snapshot.tables))assert('restore_'+table,digestTables({rows:restored.tables[table]})===digestTables({rows:snapshot.tables[table]}));
  assert('isolated_restore_matches',digestTables(restored.tables)===digestTables(snapshot.tables));
  await source.query('begin');try{
   const oldTables=localBackupTables.filter(t=>t!=='pending_activity_commands');
   for(const table of oldTables)await source.query(`lock table companion_local.${table} in share mode`);
   const before:Record<string,unknown>={};for(const table of oldTables)before[table]=(await source.query(`select * from companion_local.${table} order by ctid`)).rows;
   const migration=(await readFile('db/013_activity_recovery.sql','utf8')).replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'');await source.query(migration);
   const after:Record<string,unknown>={};for(const table of oldTables)after[table]=(await source.query(`select * from companion_local.${table} order by ctid`)).rows;
   assert('existing_rows_unchanged',digest(before)===digest(after));assert('new_recovery_table_empty',(await source.query('select 1 from companion_local.pending_activity_commands')).rows.length===0);
   await source.query('commit');evidence.applied=true;evidence.status='passed';
  }catch(error){await source.query('rollback');throw error;}
 }
}catch{process.exitCode=1;}
finally{await target?.end();if(created){await admin.query('drop database '+name);checks.disposable_restore_removed=true;}await admin.end();await source.end();await mkdir('.local/probes',{recursive:true});await writeFile('.local/probes/activity-recovery-upgrade.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));}
