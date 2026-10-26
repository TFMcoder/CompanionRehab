import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {pglitePool} from './helpers/pglite-pool';
import {OwnerAsana,normalizeAsanaTask,asanaTaskVersion,sealAsana,openAsana,validateOwnerAsana,asanaReadScopes,type OwnerAsanaConfig} from '../src/server/owner-asana';
import type {CareAuthority} from '../src/server/care-access';
import type {Session} from '../src/server/session';
import {ApiError} from '../src/server/errors';
import {createApp} from '../src/server/app';
import {sealSession} from '../src/server/session';

const actor=randomUUID(),participant=randomUUID(),key=randomBytes(32),session={user_id:actor,session_id:randomUUID(),access_token:'local-access',refresh_token:'local-refresh',issued_at:Date.now()/1000,expires_at:Date.now()/1000+3600} as Session;
const config:OwnerAsanaConfig={schema_version:1,owner_actor_id:actor,participant_id:participant,origin:'https://owner.example.invalid:10000',workspace_id:'100',project_id:'200',account_email:'owner@example.invalid',client_id:'300',client_secret:'synthetic-secret-only'};
const authority:CareAuthority={actor_id:actor,client_id:participant,login_session_id:session.session_id,active_role:'client',grant_revision:'g1'};
const task=(id='1',extra:Record<string,unknown>={})=>({gid:id,name:'[TEST] Same title',completed:false,due_on:'2026-10-26',due_at:null,modified_at:'2026-10-24T12:00:00.000Z',memberships:[{project:{gid:'200'},section:{name:'Inbox'}}],...extra});
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
describe('owner-only Asana read/import checkpoint',()=>{
 let db:PGlite,pool:any,scope:CareAuthority,items:unknown[],second:unknown[],next:boolean,expires:number,providerEmail:string,providerWorkspace:string,tokenScope:string,fetcher:ReturnType<typeof vi.fn>,service:OwnerAsana;
 beforeAll(async()=>{db=new PGlite();await db.exec(await readFile('db/002_local_care.sql','utf8'));await db.exec(await readFile('db/owner_asana_test.sql','utf8'));pool=pglitePool(db);
  await db.query('insert into companion_local.accounts(id,email,password_salt,password_hash) values($1,$2,$3,$4)',[actor,'owner@example.invalid',new Uint8Array(16),new Uint8Array(32)]);
  await db.query(`insert into companion_local.participant_profiles(id,display_name,time_zone) values($1,'Synthetic','America/Toronto')`,[participant]);
 });
 afterAll(async()=>db.close());
 beforeEach(async()=>{await db.exec('delete from companion_local.owner_asana_receipts;delete from companion_local.owner_asana_tasks;delete from companion_local.owner_asana_connection;truncate companion_local.domain_events;delete from companion_local.task_definitions;');
  scope={...authority};items=[task(),task('2',{due_on:null}),task('3',{completed:true})];second=[];next=false;expires=3600;providerEmail=config.account_email;providerWorkspace='100';tokenScope=asanaReadScopes.join(' ');
  fetcher=vi.fn(async(input:string,init:RequestInit)=>{const u=new URL(input);
   if(u.pathname==='/-/oauth_token')return response({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:expires,token_type:'bearer',scope:tokenScope});
   expect(init.method??'GET').toBe('GET');expect(u.origin).toBe('https://app.asana.com');
   if(u.pathname==='/api/1.0/users/me')return response({data:{gid:'400',email:providerEmail}});
   if(u.pathname==='/api/1.0/projects/200'){expect(u.searchParams.get('opt_fields')).toBe('gid,archived');return response({data:{gid:'200',archived:false}});}
   if(u.pathname==='/api/1.0/workspaces/100/projects')return response({data:providerWorkspace==='100'?[{gid:'200'}]:[],next_page:null});
   if(u.pathname==='/api/1.0/projects/200/tasks')return response({data:u.searchParams.has('offset')?second:items,next_page:next&&!u.searchParams.has('offset')?{offset:'page2',uri:'https://evil.invalid/steal'}:null});
   throw Error('Unexpected provider route');
  });service=new OwnerAsana(config,pool,async()=>scope,key,fetcher as typeof fetch);
 });
 async function connect(){const b=await service.begin(session),state=new URL(b.authorization_url).searchParams.get('state')!;await service.callback({state,code:'synthetic-code'},b.browser);await service.finish(session,state,b.browser);return{...b,state};}
 it('pins the exact private owner/database/origin configuration',()=>{const s={owner_actor_id:actor,participant_id:participant,origin:config.origin,database_name:'nancy_owner_test'} as any;expect(validateOwnerAsana(s,config)).toEqual(config);
  for(const change of [{owner_actor_id:randomUUID()},{participant_id:randomUUID()},{origin:'https://other.invalid:10000'}])expect(()=>validateOwnerAsana(s,{...config,...change})).toThrow();expect(()=>validateOwnerAsana({...s,database_name:'live'},config)).toThrow();
 });
 it('encrypts credentials with key and connection binding',()=>{const text=sealAsana({access_token:'secret'},key,'binding');expect(text).not.toContain('secret');expect(openAsana(text,key,'binding')).toEqual({access_token:'secret'});expect(()=>openAsana(text,key,'other')).toThrow();expect(()=>openAsana(text,randomBytes(32),'binding')).toThrow();});
 it('preserves date-only/undated/duplicate titles and rejects unlabelled or wrong-project data',()=>{expect(normalizeAsanaTask(task('2',{due_on:null}),config.project_id).due_on).toBeNull();expect(normalizeAsanaTask(task(),config.project_id).due_on).toBe('2026-10-26');
  expect(asanaTaskVersion(normalizeAsanaTask(task(),config.project_id))).not.toBe(asanaTaskVersion(normalizeAsanaTask(task('2'),config.project_id)));
  for(const bad of [task('1',{name:'Real task'}),task('1',{memberships:[]}),task('1',{due_on:'2026-02-30'})])expect(()=>normalizeAsanaTask(bad,config.project_id)).toThrow();
 });
 it('requests only read scopes, PKCE and a single-use browser-bound callback',async()=>{const b=await service.begin(session),url=new URL(b.authorization_url),state=url.searchParams.get('state')!;expect(url.searchParams.get('scope')).toBe(asanaReadScopes.join(' '));expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  await expect(service.callback({state,code:'code'},'wrong-browser')).rejects.toMatchObject({code:'asana_callback'});expect(fetcher).not.toHaveBeenCalled();await expect(service.callback({state,code:'code'},b.browser)).rejects.toThrow();
 });
 it('requires finish in the same current login and keeps tokens out of status',async()=>{const b=await connect(),s=await service.status(session);expect(s.connected).toBe(true);expect(JSON.stringify(s)).not.toContain('synthetic-access');await expect(service.finish(session,b.state,b.browser)).rejects.toThrow();
  const row=(await db.query('select credential from companion_local.owner_asana_connection')).rows[0] as any;expect(row.credential).not.toContain('synthetic-access');
 });
 it.each(['account','workspace','scope'] as const)('rejects a substituted provider %s',async kind=>{if(kind==='account')providerEmail='other@example.invalid';if(kind==='workspace')providerWorkspace='999';if(kind==='scope')tokenScope+=' tasks:write';await expect(connect()).rejects.toThrow();expect((await service.status(session)).connected).toBe(false);});
 it('rejects another actor, client, login, or role before any provider lookup',async()=>{for(const change of [{actor_id:randomUUID()},{client_id:randomUUID()},{login_session_id:randomUUID()},{active_role:'administrator' as const}]){scope={...authority,...change};await expect(service.begin(session)).rejects.toMatchObject({code:'asana_scope'});}expect(fetcher).not.toHaveBeenCalled();});
 it('exposes only the local read-only capability, even while disconnected, without provider or saved-source reads',async()=>{
  const query=vi.spyOn(pool,'query');try{expect(await service.conversationBoundary(session)).toEqual({read_only:true});expect(query).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();}finally{query.mockRestore();}
 });
 it('checks fresh exact owner scope before exposing the local capability',async()=>{
  for(const change of [{actor_id:randomUUID()},{client_id:randomUUID()},{login_session_id:randomUUID()},{active_role:'administrator' as const}]){scope={...authority,...change};await expect(service.conversationBoundary(session)).rejects.toMatchObject({code:'asana_scope'});}
  expect(fetcher).not.toHaveBeenCalled();
 });
 it('rejects changed grants and clears access on disconnect',async()=>{await connect();scope={...authority,grant_revision:'g2'};expect((await service.status(session)).connected).toBe(false);await expect(service.sync(session)).rejects.toMatchObject({code:'asana_scope'});scope={...authority};await service.disconnect(session);expect((await service.status(session)).connected).toBe(false);});
 it('imports paginated tasks once by remote identity and never follows provider next-page URLs',async()=>{await connect();next=true;second=[task('4')];expect(await service.sync(session)).toMatchObject({received:4,added:4,changed:0});expect(await service.sync(session)).toMatchObject({received:4,added:0,changed:0});const s=await service.status(session);expect(s.tasks).toHaveLength(4);expect(s.tasks.filter((t:any)=>t.source.title==='[TEST] Same title')).toHaveLength(4);
  expect((await db.query('select count(*)::int n from companion_local.task_definitions')).rows[0]).toEqual({n:0});expect(fetcher.mock.calls.every(([u])=>new URL(u).hostname==='app.asana.com')).toBe(true);
  const fields=fetcher.mock.calls.filter(([u])=>u.includes('/projects/')).map(([u])=>new URL(u).searchParams.get('opt_fields'));
  expect(fields.every(f=>!f?.includes('.gid'))).toBe(true);
 });
 it('retains a previous complete snapshot when a later page fails',async()=>{await connect();await service.sync(session);next=true;second=[task('4',{memberships:[]})];await expect(service.sync(session)).rejects.toThrow();expect((await service.status(session)).tasks).toHaveLength(3);});
 it('rejects repeated IDs and pagination loops atomically',async()=>{await connect();next=true;second=[task()];await expect(service.sync(session)).rejects.toMatchObject({code:'asana_pagination'});expect((await service.status(session)).tasks).toHaveLength(0);});
 it('records removal, reopening and reschedule without changing an accepted/local task',async()=>{await connect();await service.sync(session);let s=await service.status(session),t=s.tasks.find((x:any)=>x.remote_id==='1');await service.accept(session,{command_id:randomUUID(),remote_id:'1',version:t.version});
  items=[task('1',{due_on:'2026-10-28',modified_at:'2026-10-24T13:00:00.000Z'}),task('3',{completed:false})];expect(await service.sync(session)).toMatchObject({added:0,changed:2});s=await service.status(session);expect(s.tasks.find((x:any)=>x.remote_id==='2')?.missing).toBe(true);expect(s.tasks.find((x:any)=>x.remote_id==='3')?.source.completed).toBe(false);
  const local=(await db.query('select scheduled_date::text from companion_local.task_definitions')).rows[0] as any;expect(local.scheduled_date).toBe('2026-10-26');
 });
 it('adds a reviewed task once with a durable same-command receipt and no accepted plan/activity',async()=>{await connect();await service.sync(session);const t=(await service.status(session)).tasks[0],command={command_id:randomUUID(),remote_id:t.remote_id,version:t.version};const r=await service.accept(session,command);expect(r.result).toBe('available_for_planning');expect(await service.accept(session,command)).toMatchObject({...r,replayed:true});
  await expect(service.accept(session,{...command,remote_id:'2'})).rejects.toMatchObject({code:'asana_conflict'});await expect(service.accept(session,{...command,command_id:randomUUID()})).rejects.toMatchObject({code:'asana_already_added'});
  expect((await db.query('select count(*)::int n from companion_local.task_definitions')).rows[0]).toEqual({n:1});expect((await db.query('select count(*)::int n from companion_local.accepted_day_plan_versions')).rows[0]).toEqual({n:0});
 });
 it('rejects stale versions, completed, missing and old snapshots',async()=>{await connect();await service.sync(session);const rows=(await service.status(session)).tasks;
  const add=(t:any,version=t.version)=>service.accept(session,{command_id:randomUUID(),remote_id:t.remote_id,version});await expect(add(rows[0],'0'.repeat(64))).rejects.toMatchObject({code:'asana_stale'});await expect(add(rows.find((t:any)=>t.source.completed))).rejects.toMatchObject({code:'asana_stale'});
  await db.query(`update companion_local.owner_asana_tasks set observed_at=now()-interval '6 minutes'`);await expect(add(rows[0])).rejects.toMatchObject({code:'asana_stale'});
 });
 it('keeps an undated task undated and converts instants with the participant timezone',async()=>{await connect();items=[task('1',{due_on:null}),task('2',{due_at:'2026-10-27T01:30:00.000Z'})];await service.sync(session);for(const t of (await service.status(session)).tasks)await service.accept(session,{command_id:randomUUID(),remote_id:t.remote_id,version:t.version});
  const rows=(await db.query('select scheduled_date::text,scheduled_time from companion_local.task_definitions order by scheduled_date nulls first')).rows as any[];expect(rows[0]).toMatchObject({scheduled_date:null,scheduled_time:null});expect(rows[1].scheduled_date).toBe('2026-10-26');expect(rows[1].scheduled_time).toBe('21:30:00');
 });
 it('serializes expired credential refresh and retains prior source state on provider denial',async()=>{expires=1;await connect();expires=3600;await Promise.all([service.sync(session),service.sync(session)]);expect(fetcher.mock.calls.filter(([u])=>u.endsWith('/oauth_token'))).toHaveLength(2);
  fetcher.mockImplementationOnce(async()=>response({},401));await expect(service.sync(session)).rejects.toMatchObject({status:503});expect((await service.status(session)).tasks).toHaveLength(3);
 });
 it('retains the bound refresh token when a renewal omits a replacement',async()=>{expires=1;await connect();fetcher.mockImplementationOnce(async(_u,init)=>{expect(String(init.body)).toContain('grant_type=refresh_token');return response({access_token:'renewed-synthetic-access',expires_in:3600,token_type:'bearer'});});
  expect(await service.sync(session)).toMatchObject({received:3,added:3});expect((await service.status(session)).connected).toBe(true);
 });
 it('hides source rows when the connection binding changes',async()=>{await connect();await service.sync(session);await db.query(`update companion_local.owner_asana_tasks set binding='another-source'`);expect((await service.status(session)).tasks).toHaveLength(0);});
 it('does not restore a disconnected flow from a delayed callback',async()=>{const b=await service.begin(session),state=new URL(b.authorization_url).searchParams.get('state')!;await service.disconnect(session);await expect(service.callback({state,code:'code'},b.browser)).rejects.toThrow();});
 it('checks authority again before committing a fetched snapshot',async()=>{await connect();const original=fetcher.getMockImplementation()! as (u:string,init:RequestInit)=>Promise<Response>;fetcher.mockImplementation(async(u,init)=>{const r=await original(u,init);if(u.includes('/tasks?'))scope={...authority,grant_revision:'g2'};return r;});
  // A new grant is not the authority that consented this source read.
  await expect(service.sync(session)).rejects.toMatchObject({code:'asana_scope'});expect((await db.query('select count(*)::int n from companion_local.owner_asana_tasks')).rows[0]).toEqual({n:0});
 });
 it('enforces authenticated HTTP, origin/host checks, callback handoff and source-only rate limits',async()=>{
  const app=await createApp({origin:config.origin,port:8788,databaseUrl:'postgres://synthetic',sessionKey:key,voiceModel:'unused',voiceMinutes:10,voiceDailyMinutes:20,sessionCookieName:'nancy_test_session',synthetic:true},
   {care:{authorize:async(s:Session)=>s,authority:async()=>scope,close:async()=>{}} as any,microsoft:null,ownerAsana:service});
  try{const headers={host:new URL(config.origin).host,origin:config.origin},cookies={nancy_test_session:sealSession(session,key)};
   expect((await app.inject({method:'GET',url:'/api/asana-test',headers})).statusCode).toBe(401);
   expect((await app.inject({method:'POST',url:'/api/asana-test/sync',headers:{...headers,origin:'https://wrong.invalid'},cookies,payload:{}})).statusCode).toBe(403);
   expect((await app.inject({method:'GET',url:'/api/asana-test',headers:{host:'wrong.invalid'},cookies})).statusCode).toBe(403);
   const b=await app.inject({method:'POST',url:'/api/asana-test/connect',headers,cookies,payload:{}});expect(b.statusCode).toBe(200);const browser=b.cookies.find(c=>c.name==='nancy_asana_binding')!;expect(browser.path).toBe('/');expect(browser.sameSite).toBe('Lax');
   const state=new URL(b.json().authorization_url).searchParams.get('state')!,callback=await app.inject({method:'GET',url:'/asana/callback?state='+state+'&code=synthetic-code',headers:{host:headers.host},cookies:{nancy_asana_binding:browser.value}});
   expect(callback.statusCode).toBe(303);expect(callback.headers.location).toBe('/asana-test.html?finish=1');const finish=callback.cookies.find(c=>c.name==='nancy_asana_finish')!;
   const result=await app.inject({method:'POST',url:'/api/asana-test/finish',headers,cookies:{...cookies,nancy_asana_binding:browser.value,nancy_asana_finish:finish.value},payload:{}});expect(result.statusCode).toBe(200);
   expect((await app.inject({method:'POST',url:'/api/asana-test/sync',headers,cookies,payload:{}})).json()).toMatchObject({received:3,added:3});
  }finally{await app.close();}
 });
 it('refuses to register the sandbox adapter on the live cookie/runtime',async()=>{
  await expect(createApp({origin:config.origin,port:8787,databaseUrl:'postgres://synthetic',sessionKey:key,voiceModel:'unused',voiceMinutes:10,voiceDailyMinutes:20},
   {care:{authorize:async(s:Session)=>s} as any,microsoft:null,ownerAsana:service})).rejects.toThrow('isolated owner');
 });
});
