import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { bootstrapLocalUser, LocalCare } from '../src/server/local-care.js';
import { localCareMigrations } from '../src/server/local-migrations.js';
import { TaskRequestService } from '../src/server/task-requests.js';
import { createApp } from '../src/server/app.js';

// Disposable, loopback-only synthetic browser check. Never changes runtime env,
// active care records, production accounts or inference configuration.
process.loadEnvFile('.local/runtime/local-care.env');
const base=new URL(process.env.DATABASE_URL!);
if(!['127.0.0.1','localhost'].includes(base.hostname)||base.port!=='55432')throw new Error('Use the qualified loopback server.');
const name='nancy_requests_browser_'+randomUUID().replaceAll('-','').slice(0,12);
const url=(db:string)=>{const u=new URL(base);u.pathname='/'+db;return u.toString();};
const admin=new Pool({connectionString:url('postgres'),max:1});
await admin.query(`create database "${name}"`);
const pool=new Pool({connectionString:url(name),max:4});
const now=()=>new Date('2026-10-07T12:00:00Z');
let app:Awaited<ReturnType<typeof createApp>>|undefined,closed=false;
async function close(){if(closed)return;closed=true;await app?.close();await pool.end();await admin.query(`drop database "${name}"`);await admin.end();}
try {
  for(const file of localCareMigrations)await pool.query(await readFile('db/'+file,'utf8'));
  const care=new LocalCare({pool,clock:now}),requests=new TaskRequestService(pool,{clock:now});
  const password='request-browser-password';
  const client=await bootstrapLocalUser(pool,{email:'client@example.invalid',password,role:'client',display_name:'Sample Client',time_zone:'America/Toronto'});
  const family=await bootstrapLocalUser(pool,{email:'family@example.invalid',password,role:'family_friend',participant_id:client.participant_id});
  const helper=await bootstrapLocalUser(pool,{email:'helper@example.invalid',password,role:'family_friend',participant_id:client.participant_id});
  const administrator=await bootstrapLocalUser(pool,{email:'admin@example.invalid',password,role:'administrator',participant_id:client.participant_id});
  await bootstrapLocalUser(pool,{email:'clinician@example.invalid',password,role:'clinician',participant_id:client.participant_id});
  const session=await care.login('client@example.invalid',password);
  await care.setup(session,{display_name:'Sample Client',time_zone:'America/Toronto',preferences:'Synthetic browser fixture only.',expected_revision:0,tasks:[],meal_options:[{name:'Oats',slots:['breakfast']},{name:'Soup',slots:['lunch']},{name:'Rice',slots:['dinner']}]});
  for(const [actor,role,capabilities] of [[family,'family_friend',['request_tasks','read_requests']],[helper,'family_friend',['help_requests']],[administrator,'administrator',['request_tasks','read_requests','review_request_flags']]] as const)
    await requests.command(session,{type:'set_request_access',actor_id:actor.user_id,role,capabilities:[...capabilities],expected_revision:0,idempotency_key:randomUUID(),confirmed:true});
  await care.logout(session);
  app=await createApp({origin:'http://localhost:8891',port:8891,databaseUrl:url(name),sessionKey:randomBytes(32),voiceModel:'unused',voiceMinutes:10,voiceDailyMinutes:20,voiceTransport:'local'}, {care,taskRequests:requests});
  await app.listen({host:'127.0.0.1',port:8891});
  console.log('Synthetic request browser app ready at http://localhost:8891. No inference is enabled. Test clock: 2026-10-07 08:00 Toronto.');
  for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>void close().then(()=>process.exit(0)));
} catch {await close();throw new Error('Disposable request browser app failed; no active database was changed.');}
