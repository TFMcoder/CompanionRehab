import {Client} from 'pg';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {loadEnvironment,configFromEnv} from '../src/server/config.js';
import {localCareMigrations} from '../src/server/local-migrations.js';
import {exportSnapshot,encryptSnapshot,decryptSnapshot,restoreSnapshot,databaseIdentity} from '../src/server/backup.js';
import {canonicalJson} from '../src/server/local-authority.js';
import {inspectLocalSchemaUpgrade,applyLocalSchemaUpgrade,preservedRowsHash} from '../src/server/local-schema-upgrade.js';

// Reviewed additive migrations only. This cannot initialize, seed, reset or restore over live care.
loadEnvironment();
const base=new URL(configFromEnv().databaseUrl??'');
if(!['127.0.0.1','localhost'].includes(base.hostname)||base.port!=='55432'||!['/nancy_client_trial','/nancy_myday'].includes(base.pathname))
  throw new Error('Require the established local care database.');
const apply=process.argv.includes('--apply'),suffix=randomUUID().replaceAll('-',''),targetName='nancy_schema_restore_'+suffix;
const url=(name:string)=>{const u=new URL(base);u.pathname='/'+name;u.search='';u.hash='';return u.toString();};
const source=new Client({connectionString:base.toString(),connectionTimeoutMillis:5000});
const admin=new Client({connectionString:url('postgres'),connectionTimeoutMillis:5000});
const checks:Record<string,boolean>={};
const evidence={observed_at:new Date().toISOString(),status:'failed',applied:false,from:'',to:localCareMigrations.at(-1),checks,
  backup_ref:'',care_values_logged:false,provider_called:false};
const assert=(key:string,condition:boolean)=>{checks[key]=condition;if(!condition)throw new Error(key);};
const hash=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');
let target:Client|undefined,created=false,adminConnected=false;
try{
  await source.connect();
  const plan=await inspectLocalSchemaUpgrade(source,assert),{through,pending}=plan;
  evidence.from=through;
  if(!pending.length)evidence.status='already_current';
  else if(!apply)evidence.status='upgrade_needed';
  else{
    const snapshot=await exportSnapshot(source,databaseIdentity(base.toString()),'companion_local',false,through);
    const key=randomBytes(32),encrypted=encryptSnapshot(snapshot,key),decoded=decryptSnapshot(encrypted,key);
    assert('encrypted_backup_valid',hash(decoded.tables)===hash(snapshot.tables));
    await mkdir('.local/backups',{recursive:true});await mkdir('.local/backup-keys',{recursive:true});
    evidence.backup_ref=`.local/backups/pre-daily-companion-${suffix}.nancy`;
    await writeFile(evidence.backup_ref,encrypted,{flag:'wx',mode:0o600});
    await writeFile(`.local/backup-keys/pre-daily-companion-${suffix}.key`,key.toString('base64'),{flag:'wx',mode:0o600});key.fill(0);
    await admin.connect();adminConnected=true;
    assert('fresh_isolated_restore',/^nancy_schema_restore_[a-f0-9]{32}$/.test(targetName)&&(await admin.query('select 1 from pg_database where datname=$1',[targetName])).rows.length===0);
    await admin.query('create database '+targetName);created=true;
    target=new Client({connectionString:url(targetName)});await target.connect();
    for(const file of localCareMigrations)await target.query(await readFile('db/'+file,'utf8'));
    await restoreSnapshot(target,decoded,databaseIdentity(url(targetName)));
    const restored=await exportSnapshot(target,databaseIdentity(url(targetName)),'companion_local');
    for(const [table,rows] of Object.entries(snapshot.tables)){
      const columns=rows.length?Object.keys(rows[0]):[];
      const projected=restored.tables[table].map(row=>Object.fromEntries(columns.map(column=>[column,row[column]])));
      assert('restored_'+table,preservedRowsHash(projected)===preservedRowsHash(rows));
    }
    await applyLocalSchemaUpgrade(source,plan,Object.keys(snapshot.tables),{check:assert});
    evidence.applied=true;evidence.status='passed';
  }
}catch{process.exitCode=1;}
finally{
  await target?.end();
  if(created&&adminConnected){await admin.query('drop database '+targetName);checks.disposable_restore_removed=true;}
  await admin.end();await source.end();
  await mkdir('.local/probes',{recursive:true});await writeFile('.local/probes/local-schema-upgrade.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence));
}
