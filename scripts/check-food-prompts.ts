/** Disposable real PostgreSQL + HTTP evidence. No real care records, inference or audio. */
import { randomBytes,randomUUID } from 'node:crypto';
import { readFile,mkdir,writeFile,access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { Client } from 'pg';
import { createApp } from '../src/server/app.js';
import { configFromEnv,loadEnvironment } from '../src/server/config.js';
import { LocalCare,bootstrapLocalUser } from '../src/server/local-care.js';
import { createLocalFeatures } from '../src/server/local-features.js';
import { LocalDayService } from '../src/server/local-day.js';
import { localCareMigrations } from '../src/server/local-migrations.js';
import { SessionRevocations } from '../src/server/revocations.js';
import { ApiError } from '../src/server/errors.js';

if(!process.argv.includes('--run-local'))throw new Error('Pass --run-local for the isolated synthetic PostgreSQL/HTTP check.');
loadEnvironment();const config=configFromEnv(),base=new URL(config.databaseUrl??'');
if(!['127.0.0.1','localhost','[::1]'].includes(base.hostname)||base.port!=='55432')throw new Error('Expected configured loopback PostgreSQL.');
const name='nancy_food_probe_'+randomUUID().replaceAll('-',''),url=(database:string)=>{const value=new URL(base);value.pathname='/'+database;return value.toString();};
const admin=new Client({connectionString:url('postgres')}),checks:Record<string,boolean>={};
let created=false,care:LocalCare|undefined,app:Awaited<ReturnType<typeof createApp>>|undefined,failed:string|null=null;
const keepAlive=process.argv.includes('--keep-alive'),probeToken=randomBytes(24).toString('base64url');
let fault:'before_activity_commit'|'drop_activity_success'|null=null;
let now=new Date('2026-10-14T15:59:00Z'),cookie='',origin='';const clock=()=>now,key=()=>({idempotency_key:randomUUID(),confirmed:true as const});
function check(label:string,value:unknown){checks[label]=!!value;if(!value)throw new Error(label);}
async function http(path:string,body?:unknown,status=200){
 const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{cookie,...(body===undefined?{}:{origin,'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
 if(response.status!==status)throw new Error(`Unexpected HTTP ${response.status} at ${path}`);
 cookie=response.headers.get('set-cookie')?.split(';')[0]??cookie;return await response.json() as any;
}
async function preferences(food:boolean,enabled=true){const view=await http('/api/local-day');const {revision,...prefs}=view.preferences;return http('/api/local-day/commands',{...key(),type:'set_prompt_preferences',expected_revision:revision,preferences:{...prefs,enabled,food_check_ins:food,quiet_start:'23:00',quiet_end:'06:00'}});}
try{
 await admin.connect();if((await admin.query('select 1 from pg_database where datname=$1',[name])).rows.length)throw new Error('Disposable database already exists.');
 await admin.query(`create database "${name}"`);created=true;care=new LocalCare({connectionString:url(name),clock});
 for(const file of localCareMigrations)await care.pool.query(await readFile('db/'+file,'utf8'));
 // Browser verification may run on a later real date than the synthetic clock.
 // Extend only this disposable fixture's sessions; never alter live credentials.
 if(keepAlive){const login=care.login.bind(care);care.login=async(email,password)=>{const session=await login(email,password);await care!.pool.query("update companion_local.sessions set expires_at='2030-01-01' where id=$1",[session.session_id]);return {...session,expires_at:Date.parse('2030-01-01')/1000};};}
 const password=randomBytes(24).toString('base64url'),email='food-probe@example.invalid';
 const seeded=await bootstrapLocalUser(care.pool,{email,password,role:'client',display_name:'Synthetic Client',time_zone:'America/Toronto'});
 const listener=createServer();await new Promise<void>((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});const address=listener.address();if(!address||typeof address==='string')throw new Error('No port');
 await new Promise<void>(resolve=>listener.close(()=>resolve()));origin=`http://127.0.0.1:${address.port}`;
 const features=createLocalFeatures(care.pool);features.day=new LocalDayService(care.pool,clock);
 app=await createApp({...config,origin,port:address.port,databaseUrl:url(name),sessionKey:randomBytes(32),planUserId:undefined},{care,features,microsoft:null,staticRoot:process.argv.includes('--probe-build')?'.local/probes/daily-loop-build':undefined,revocations:new SessionRevocations()});
 if(keepAlive)app.post('/__probe/clock',async(request,reply)=>{if(request.headers['x-probe-token']!==probeToken)return reply.code(403).send({error:'forbidden'});const instant=new Date((request.body as {now?:string}).now??'');if(!Number.isFinite(+instant)||+instant<Date.parse('2026-10-14')||+instant>Date.parse('2026-10-17'))return reply.code(400).send({error:'Use the disposable fixture date range'});now=instant;await features.day.tick();return {synthetic_now:now.toISOString()};});
 if(keepAlive){
  app.post('/__probe/fault',async(request,reply)=>{if(request.headers['x-probe-token']!==probeToken)return reply.code(403).send({error:'forbidden'});const mode=(request.body as {mode?:string}).mode;if(mode!=='before_activity_commit'&&mode!=='drop_activity_success')return reply.code(400).send({error:'Choose a fixture-only activity fault'});fault=mode;return {armed:mode};});
  app.addHook('onRequest',async request=>{if(request.method==='POST'&&request.url==='/api/activity/commands'&&fault==='before_activity_commit'){fault=null;throw new ApiError(503,'synthetic_interruption','Synthetic interruption before activity commit.');}});
  app.addHook('onSend',async(request,reply,payload)=>{if(request.method==='POST'&&request.url==='/api/activity/commands'&&reply.statusCode===200&&fault==='drop_activity_success'){fault=null;reply.raw.destroy();}return payload;});
 }
 await app.listen({host:'127.0.0.1',port:address.port});await http('/api/auth/login',{email,password});
 await preferences(false);now=new Date('2026-10-14T16:00:00Z');check('legacy_reminders_do_not_opt_in_food',await http('/api/prompts/claim',{})===null);
 await preferences(true);const prompt=await http('/api/prompts/claim',{});check('food_check_delivered_with_uncertainty',prompt?.message.includes('Have you eaten')&&!/not eaten|fasting|awake/i.test(prompt.message));
 check('one_claim_at_a_time',await http('/api/prompts/claim',{})===null);await http(`/api/prompts/${prompt.id}/ack`,{claim_token:prompt.claim_token,channel:'in_app'});
 const snooze={...key(),type:'respond_prompt',prompt_id:prompt.id,expected_revision:0,decision:'snooze',snooze_minutes:15};await http('/api/local-day/commands',snooze);
 check('exact_snooze_retry_receipt',(await http('/api/local-day/commands',snooze)).replayed===true);
 features.day=new LocalDayService(care.pool,clock);check('snooze_survives_service_restart',await http('/api/prompts/claim',{})===null);
 now=new Date('2026-10-14T16:15:00Z');const again=await http('/api/prompts/claim',{});check('snooze_reuses_same_job',again?.id===prompt.id&&again.response_revision===1);
 await http('/api/activity/commands',{type:'record_activity',idempotency_key:randomUUID(),local_date:'2026-10-14',expected_revision:0,payload:{unplanned:{kind:'meal',title:'Synthetic snack'},status:'completed',occurred_at:'2026-10-14T16:10:00Z',notes:'',intake_kind:'snack'}});
 check('new_actual_cancels_claim',!(await features.day.currentPrompt(await care.login(email,password),again.id)));
 await http(`/api/prompts/${again.id}/ack`,{claim_token:again.claim_token,channel:'in_app'},409);
 now=new Date('2026-10-14T22:10:00Z');const later=await http('/api/prompts/claim',{});check('six_hours_from_actual_occurrence',!!later&&later.id!==prompt.id);
 const decline={...key(),type:'respond_prompt',prompt_id:later.id,expected_revision:0,decision:'decline',snooze_minutes:null};await http('/api/local-day/commands',decline);
 features.day=new LocalDayService(care.pool,clock);await preferences(true);check('decline_survives_restart_and_preference_resave',await http('/api/prompts/claim',{})===null);
 now=new Date('2026-10-15T16:00:00Z');const tomorrow=await http('/api/prompts/claim',{});check('new_local_day_can_check_again',!!tomorrow);await http(`/api/prompts/${tomorrow.id}/ack`,{claim_token:tomorrow.claim_token,channel:'in_app'});
 const session=await care.login(email,password);
 const next=await bootstrapLocalUser(care.pool,{email:'second-client@example.invalid',password,role:'client'});
 await care.pool.query("update companion_local.role_grants set participant_id=$1 where actor_id=$2",[seeded.participant_id,next.user_id]);
 const nextSession=await care.login('second-client@example.invalid',password);
 await care.pool.query('update companion_local.role_grants set revoked_at=now() where actor_id=$1',[seeded.user_id]);
 check('revoked_consent_hides_delivered_prompt',!await features.day.currentPrompt(nextSession,tomorrow.id));
 try{await features.day.command(nextSession,{...key(),type:'respond_prompt',prompt_id:tomorrow.id,expected_revision:0,decision:'snooze',snooze_minutes:15});check('revoked_consent_refuses_snooze',false);}catch(error){check('revoked_consent_refuses_snooze',(error as {status?:number}).status===409);}
 check('no_inferred_task_completion',(await care.pool.query("select count(*)::int as count from companion_local.activity_records where participant_id=$1 and kind='task'",[seeded.participant_id])).rows[0].count===0);
 check('no_model_or_audio',true);
 void session;
 if(process.argv.includes('--focus')||keepAlive){
  async function focusFixture(address:string){
   now=new Date('2026-10-14T14:00:00Z');const seeded=await bootstrapLocalUser(care!.pool,{email:address,password,role:'client',display_name:'Synthetic Focus Client',time_zone:'America/Toronto'}),identity=await care!.login(address,password);
   const fresh=await care!.today(identity);await care!.setup(identity,{display_name:'Synthetic Focus Client',time_zone:'America/Toronto',preferences:'',expected_revision:fresh.profile!.revision,tasks:[{title:'Sort synthetic photos',time_hint:null},{title:'Water synthetic plants',time_hint:null}],meal_options:[{name:'Synthetic oats',slots:['breakfast','lunch','dinner']}]});
   await http('/api/auth/login',{email:address,password});await preferences(false);const before=await care!.today(identity);
   const begun=await care!.command(identity,{type:'start_or_resume_checkin',idempotency_key:randomUUID(),local_date:before.local_date,expected_revision:0,payload:{}});
   const proposed=await care!.command(identity,{type:'propose_day_plan',idempotency_key:randomUUID(),local_date:before.local_date,expected_revision:begun.revision,payload:{task_ids:before.tasks.map(task=>task.id),meals:(['breakfast','lunch','dinner'] as const).map(slot=>({slot,option_id:before.meal_options[0].id}))}});
   await care!.command(identity,{type:'accept_day_plan',idempotency_key:randomUUID(),local_date:before.local_date,expected_revision:proposed.revision,payload:{proposal_id:proposed.plan!.id}});
   return {seeded,identity};
  }
  const f=await focusFixture('focus-probe@example.invalid');
  async function startFocus(){const choice=(await http('/api/local-day')).focus_options[0];const command={...key(),type:'start_task_focus',activity_id:choice.activity_id,expected_activity_revision:choice.activity_revision,expected_activity_version:choice.source_version,interval_minutes:15};return {choice,command,receipt:await http('/api/local-day/commands',command)};}
  const started=await startFocus();check('focus_start_exact_retry',(await http('/api/local-day/commands',started.command)).replayed===true);
  now=new Date('2026-10-14T14:15:00Z');const first=await http('/api/prompts/claim',{});check('focus_prompt_asks_about_work',first?.message.includes('Are you still working'));
  await http(`/api/prompts/${first.id}/ack`,{claim_token:first.claim_token,channel:'in_app'});
  await http('/api/local-day/commands',{...key(),type:'respond_prompt',prompt_id:first.id,expected_revision:0,decision:'snooze',snooze_minutes:10});features.day=new LocalDayService(care.pool,clock);
  await preferences(false);now=new Date('2026-10-14T14:25:00Z');const afterSnooze=await http('/api/prompts/claim',{});check('focus_snooze_survives_enabled_preference_edit',afterSnooze.id===first.id);
  await http(`/api/prompts/${afterSnooze.id}/ack`,{claim_token:afterSnooze.claim_token,channel:'in_app'});features.day=new LocalDayService(care.pool,clock);
  const restored=await http('/api/prompts/resume');check('delivered_snooze_reopens_as_text_only',restored?.id===first.id&&restored.response_revision===1&&restored.restored===true&&restored.foreground_speech===false&&restored.browser_notifications===false&&!restored.claim_token);
  await http('/api/local-day/commands',{...key(),type:'pause_task_focus',focus_id:started.receipt.focus_id,expected_revision:1});check('pause_invalidates_prompt',!(await http(`/api/prompts/${first.id}/current`)).current);
  await http('/api/local-day/commands',{...key(),type:'resume_task_focus',focus_id:started.receipt.focus_id,expected_revision:2,interval_minutes:20});check('resume_chosen_interval',(await http('/api/local-day')).focus.check_due_at==='2026-10-14T14:45:00.000Z');
  now=new Date('2026-10-14T14:45:00Z');const resumed=await http('/api/prompts/claim',{});check('resume_new_check',resumed?.id!==first.id&&resumed?.message.includes('Are you still working'));
  await http('/api/local-day/commands',{...key(),type:'respond_prompt',prompt_id:resumed.id,expected_revision:0,decision:'decline',snooze_minutes:null});features.day=new LocalDayService(care.pool,clock);check('focus_decline_restart',await http('/api/prompts/claim',{})===null);
  await http('/api/local-day/commands',{...key(),type:'finish_task_focus',focus_id:started.receipt.focus_id,expected_revision:3});check('finish_does_not_report_completion',(await care.ledger(f.identity)).entries.length===0&&(await http('/api/local-day')).focus===null);
  const second=await startFocus();now=new Date('2026-10-14T15:00:00Z');const due=await http('/api/prompts/claim',{});check('second_focus_check_due',!!due);
  await http('/api/activity/commands',{type:'record_activity',idempotency_key:randomUUID(),local_date:'2026-10-14',expected_revision:0,payload:{activity_id:second.choice.activity_id,status:'completed',occurred_at:now.toISOString(),notes:''}});
  check('actual_completion_cancels_focus',!(await http(`/api/prompts/${due.id}/current`)).current&&(await http('/api/local-day')).focus===null);
  if(keepAlive){
   const email='focus-browser@example.invalid';await focusFixture(email);await mkdir('.local/probes',{recursive:true});
   const stopFile=`.local/probes/focus-browser-${randomUUID()}.stop`;
   await writeFile('.local/probes/focus-browser-private.json',JSON.stringify({origin,email,password,synthetic_now:now.toISOString(),clock_url:origin+'/__probe/clock',fault_url:origin+'/__probe/fault',clock_header:'x-probe-token',clock_token:probeToken,stop_file:stopFile},null,2));
   console.log(JSON.stringify({status:'browser_fixture_ready',checks_passed:Object.values(checks).filter(Boolean).length,private_fixture:'.local/probes/focus-browser-private.json'}));
   await new Promise<void>(resolve=>{const finish=()=>{clearInterval(timer);clearTimeout(timeout);resolve();};const timer=setInterval(()=>{void access(stopFile).then(finish,()=>{});},1000);const timeout=setTimeout(finish,15*60000);process.once('SIGINT',finish);process.once('SIGTERM',finish);});
  }
 }
}catch(error){failed=error instanceof Error?error.message:'Unknown failure';}
finally{
 if(app)await app.close();else await care?.pool.end();if(created&&/^nancy_food_probe_[a-f0-9]{32}$/.test(name)){await admin.query(`drop database "${name}"`);checks.disposable_database_removed=true;}await admin.end();
 await mkdir('.local/probes',{recursive:true});await writeFile('.local/probes/food-prompts-http.json',JSON.stringify({status:failed?'failed':'passed',observed_at:new Date().toISOString(),synthetic_clock:true,real_postgresql:true,real_http:true,physical_device:false,checks,failure:failed},null,2));
 console.log(JSON.stringify({status:failed?'failed':'passed',passed:Object.values(checks).filter(Boolean).length,checks:Object.keys(checks).length,failure:failed}));
}
if(failed)process.exitCode=1;
