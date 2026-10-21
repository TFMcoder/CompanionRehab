/** Explicit one-time, schema-only duplicate for the existing account owner's own testing. */
import {readFile,writeFile,mkdir,cp,access} from 'node:fs/promises';
import {randomBytes,randomUUID,scrypt,createCipheriv} from 'node:crypto';
import {parseEnv} from 'node:util';
import {join} from 'node:path';
import {Pool} from 'pg';
import {z} from 'zod';
import {localCareMigrations} from '../src/server/local-migrations.js';
import {LocalCare} from '../src/server/local-care.js';
import {PlanStore,defaultPlanPath} from '../src/server/chatgpt-plan/storage.js';
import {ownerTestDirectory,ownerTestSchema,ownerTestIndex} from '../src/server/owner-test-config.js';

if(!process.argv.includes('--apply'))throw Error('Pass --apply only for the owner-authorized isolated test copy.');
const configPath=join(ownerTestDirectory,'config.json');
try{await access(configPath);throw Error('Test configuration already exists. Preserve it; do not reset or provision again.');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
let source:NodeJS.ProcessEnv={};
for(const path of ['.local/runtime/local-care.env','.env.local']){try{source={...source,...parseEnv(await readFile(path,'utf8'))};}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
source={...source,...Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>typeof entry[1]==='string'))};
if(!source.DATABASE_URL)throw Error('Missing existing local database configuration.');
const base=new URL(source.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(base.hostname)||base.port!=='55432'||base.pathname!=='/nancy_client_trial')throw Error('Expected existing local live configuration; do not migrate or write to it.');
const ownerId=z.uuid().parse(source.NANCY_PLAN_USER_ID),liveKey=Buffer.from(source.SESSION_KEY??'','base64');
const bound=(await new PlanStore(defaultPlanPath,liveKey).load()).nancyBinding;
if(bound?.actorId!==ownerId)throw Error('The existing owner connection must already be bound.');
const request=JSON.parse(await readFile('.local/provisioning/microsoft-client-request.json','utf8'));
const host=JSON.parse(await readFile('.local/runtime/demo-host.json','utf8'));
const origin=new URL(host.origin);if(origin.protocol!=='https:'||origin.port!=='8443')throw Error('Unexpected existing live origin.');origin.port='10000';
const databaseName='nancy_owner_test',databaseRole='nancy_owner_test';
const dbPassword=randomBytes(32).toString('hex'),password=randomBytes(18).toString('base64url');
const sessionKey=randomBytes(32),participantId=randomUUID();
const target=new URL(base);target.pathname='/'+databaseName;target.username=databaseRole;target.password=dbPassword;
const settings=ownerTestSchema.parse({schema_version:1,database_name:databaseName,database_role:databaseRole,database_url:target.toString(),origin:origin.origin,port:8788,owner_actor_id:ownerId,participant_id:participantId,excluded_live_participant_id:request.participant_id,session_key:sessionKey.toString('base64'),email:'tester@nancy.local'});
const adminUrl=new URL(base);adminUrl.pathname='/postgres';
const admin=new Pool({connectionString:adminUrl.toString(),max:1,connectionTimeoutMillis:5000});
try{
 if((await admin.query('select 1 from pg_database where datname=$1',[databaseName])).rowCount||(await admin.query('select 1 from pg_roles where rolname=$1',[databaseRole])).rowCount)throw Error('The named test database or role exists; refuse overwrite.');
 await mkdir(join(ownerTestDirectory,'runtime'),{recursive:true});
 await writeFile(join(ownerTestDirectory,'creation.json'),JSON.stringify({created_at:new Date().toISOString(),database:databaseName,role:databaseRole,mode:'fresh_schema_and_synthetic_records',phase:'creating'},null,2),{mode:0o600,flag:'wx'});
 // Identifiers are constants and the generated hex password contains no SQL metacharacters.
 await admin.query(`create role nancy_owner_test login password '${dbPassword}' nosuperuser nocreatedb nocreaterole noinherit noreplication`);
 await admin.query('create database nancy_owner_test owner nancy_owner_test');
}finally{await admin.end();}
const pool=new Pool({connectionString:target.toString(),max:2});
try{
 for(const migration of localCareMigrations)await pool.query(await readFile('db/'+migration,'utf8'));
 const salt=randomBytes(16),digest=await new Promise<Buffer>((resolve,reject)=>scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024},(error,key)=>error?reject(error):resolve(Buffer.from(key))));
 const connection=await pool.connect();
 await connection.query('begin');
 try{
  // This remains the same actual account owner, in a separate database and synthetic profile.
  await connection.query('insert into companion_local.accounts(id,email,password_salt,password_hash) values($1,$2,$3,$4)',[ownerId,settings.email,salt,digest]);
  await connection.query('insert into companion_local.participant_profiles(id,display_name,time_zone,preferences) values($1,$2,$3,$4)',[participantId,'Tester','America/Toronto','Synthetic practice profile for the account owner. No real clinical protocol or external account is connected.']);
  await connection.query("insert into companion_local.role_grants(participant_id,actor_id,role) values($1,$2,'client')",[participantId,ownerId]);
  await connection.query('commit');
 }catch(error){await connection.query('rollback');throw error;}finally{connection.release();}
 const care=new LocalCare({pool}),session=await care.login(settings.email,password);
 await care.setup(session,{expected_revision:0,display_name:'Tester',time_zone:'America/Toronto',preferences:'Synthetic practice profile for the account owner. No real clinical protocol or external account is connected.',tasks:[{title:'Test task — read one page',time_hint:null,category:'task',urgency:'low',duration_minutes:5}],meal_options:[{name:'Practice breakfast',slots:['breakfast']},{name:'Practice lunch',slots:['lunch']},{name:'Practice dinner',slots:['dinner']}]});
 await care.logout(session);
}finally{await pool.end();}
await cp('dist/client',join(ownerTestDirectory,'client'),{recursive:true,errorOnExist:true,force:false});
await writeFile(join(ownerTestDirectory,'client/index.html'),ownerTestIndex(await readFile('dist/client/index.html','utf8')));
await writeFile(join(ownerTestDirectory,'client/owner-test.css'),'.owner-test-notice{padding:.7rem 1rem;text-align:center;background:#fff1bc;color:#183f36;font:700 1rem/1.5 system-ui,sans-serif;border-bottom:2px solid #c5a549}');
const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',sessionKey,iv);cipher.setAAD(Buffer.from('nancy-owner-test-login-v1'));
const encrypted=Buffer.concat([cipher.update(JSON.stringify({email:settings.email,password,origin:settings.origin}),'utf8'),cipher.final()]);
await writeFile(join(ownerTestDirectory,'login.enc'),Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url'),{mode:0o600,flag:'wx'});
await writeFile(configPath,JSON.stringify(settings,null,2),{mode:0o600,flag:'wx'});
await writeFile(join(ownerTestDirectory,'runtime/host.json'),JSON.stringify({origin:settings.origin}));
await writeFile(join(ownerTestDirectory,'Open-Nancy-Test-Login.cmd'),'@echo off\r\ntitle Nancy Test Login - Private\r\ncd /d "%~dp0\\..\\.."\r\nnode --import tsx "scripts/show-owner-test-login.ts"\r\nif errorlevel 1 pause\r\n');
await writeFile(join(ownerTestDirectory,'creation.json'),JSON.stringify({created_at:new Date().toISOString(),database:databaseName,role:databaseRole,mode:'fresh_schema_and_synthetic_records',phase:'ready',real_records_copied:false,provider_credentials_copied:false},null,2),{mode:0o600});
console.log(JSON.stringify({created:true,database:databaseName,restricted_database_role:true,synthetic_profile:true,email:settings.email,origin:settings.origin,provider_credentials_copied:false,live_care_writes:0}));
