import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { Pool } from 'pg';
import { loadEnvironment, configFromEnv } from '../src/server/config.js';
import { localCareMigrations } from '../src/server/local-migrations.js';

// A new database, not a deletion or relabelling of care history. No provider credentials
// or sessions are copied. The existing owner identity remains owner-operated only.
loadEnvironment();
const config = configFromEnv();
const displayName = process.argv[2];
if (!displayName?.trim() || displayName.trim().length > 60) throw new Error('Supply the intended display name as the only argument.');
if (!config.databaseUrl || !config.planUserId) throw new Error('The existing local owner connection is required.');
const sourceUrl = new URL(config.databaseUrl);
if (!['localhost','127.0.0.1'].includes(sourceUrl.hostname) || sourceUrl.port !== '55432' || sourceUrl.pathname !== '/nancy_myday')
  throw new Error('Preparation starts only from the existing local nancy_myday database.');
const targetName = 'nancy_client_trial';
const targetUrl = new URL(sourceUrl); targetUrl.pathname = '/' + targetName;
const adminUrl = new URL(sourceUrl); adminUrl.pathname = '/postgres';
const source = new Pool({connectionString:sourceUrl.toString(),max:1,connectionTimeoutMillis:5000});
const admin = new Pool({connectionString:adminUrl.toString(),max:1,connectionTimeoutMillis:5000});
let target: Pool | undefined;
try {
  const account = (await source.query(`select a.* from companion_local.accounts a
    join companion_local.role_grants g on g.actor_id=a.id and g.participant_id=a.id and g.role='client'
    where a.id=$1 and a.disabled_at is null and g.revoked_at is null`,[config.planUserId])).rows[0];
  if (!account) throw new Error('The owner account and explicit care scope could not be verified.');
  const login=JSON.parse(await readFile('.local/runtime/owner-pilot-login.json','utf8'));
  if (login.user_id !== account.id || login.email !== account.email) throw new Error('The saved owner sign-in does not match.');
  if ((await admin.query('select 1 from pg_database where datname=$1',[targetName])).rowCount)
    throw new Error('The client database already exists. Refusing to replace or reseed it.');
  await admin.query('create database nancy_client_trial');
  target=new Pool({connectionString:targetUrl.toString(),max:1,connectionTimeoutMillis:5000});
  for (const file of localCareMigrations)
    await target.query(await readFile('db/'+file,'utf8'));
  await target.query('begin');
  try {
    await target.query('insert into companion_local.accounts(id,email,password_salt,password_hash) values($1,$2,$3,$4)',[account.id,'owner@nancy.local',account.password_salt,account.password_hash]);
    await target.query('insert into companion_local.participant_profiles(id,display_name,time_zone) values($1,$2,$3)',[account.id,displayName.trim(),'America/Toronto']);
    await target.query("insert into companion_local.role_grants(participant_id,actor_id,role) values($1,$1,'client')",[account.id]);
    await target.query("insert into companion_local.domain_events(participant_id,actor_id,event_type,data) values($1,$1,'ClientTrialWorkspacePrepared',$2)",[account.id,JSON.stringify({version:1,data_seeded:false,account_mode:'existing_owner_supervised',participant_consent:'pending',time_zone_confirmation:'pending'})]);
    await target.query('commit');
  } catch(error) {await target.query('rollback');throw error;}
  await mkdir('.local/runtime',{recursive:true});
  const current=await readFile('.local/runtime/local-care.env','utf8');
  let prepared=current.replace(/^DATABASE_URL=.*$/m,`DATABASE_URL=${targetUrl.toString()}`).replace(/^NANCY_SYNTHETIC=.*$/mg,'NANCY_SYNTHETIC=0');
  if(!/^NANCY_SYNTHETIC=/m.test(prepared))prepared+='\nNANCY_SYNTHETIC=0\n';
  await writeFile('.local/runtime/client-trial.env',prepared,{flag:'wx',mode:0o600});
  await writeFile('.local/runtime/client-trial-login.json',JSON.stringify({...login,email:'owner@nancy.local',purpose:'Existing owner-operated clean client workspace. Participant account eligibility and consent remain required before independent use.'}),{flag:'wx',mode:0o600});
  await writeFile('.local/runtime/client-trial-login.txt',`Nancy client preparation\n\nAddress: ${config.origin}\nEmail: owner@nancy.local\nPassword: ${login.password}\n\nExisting owner-operated sign-in. No sample tasks, meals or activity are included. Confirm participant consent, time zone and intended-user reasoning access before independent use.\n`,{flag:'wx',mode:0o600});
  const counts=(await target.query(`select (select count(*) from companion_local.task_definitions)::int tasks,
    (select count(*) from companion_local.meal_options)::int meals,(select count(*) from companion_local.activity_records)::int activities,
    (select count(*) from companion_local.appointments)::int appointments,(select count(*) from companion_local.sessions)::int sessions`)).rows[0];
  console.log(JSON.stringify({status:'prepared',database:targetName,source_preserved:true,counts,activated:false,account_mode:'owner_supervised'}));
} catch {
  console.error('Client preparation could not finish. No existing database was deleted or overwritten; inspect configuration and target existence privately before retrying.');process.exitCode=1;
} finally {await target?.end();await source.end();await admin.end();}
