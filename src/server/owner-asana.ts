/** Read-only Asana checkpoint, instantiated solely by the isolated owner runtime. */
import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID} from 'node:crypto';
import {z,ZodError} from 'zod';
import type {Pool,PoolClient} from 'pg';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Session} from './session.js';
import type {CareAuthority} from './care-access.js';
import type {OwnerTestSettings} from './owner-test-config.js';
import {ApiError} from './errors.js';

const gid=z.string().regex(/^\d{1,32}$/);
export const asanaReadScopes=['projects:read','tasks:read','users:read'] as const;
export const ownerAsanaConfigSchema=z.object({schema_version:z.literal(1),owner_actor_id:z.uuid(),participant_id:z.uuid(),origin:z.url(),
 workspace_id:gid,project_id:gid,account_email:z.email(),client_id:gid,client_secret:z.string().min(10).max(4096)}).strict();
export type OwnerAsanaConfig=z.infer<typeof ownerAsanaConfigSchema>;
const tokensSchema=z.object({access_token:z.string().min(1).max(8192),refresh_token:z.string().min(1).max(8192),expires_at:z.number()});
type Tokens=z.infer<typeof tokensSchema>;
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(x=>{const d=new Date(x+'T12:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===x;});
const instant=z.iso.datetime({offset:true});
const providerTask=z.object({gid,name:z.string().trim().min(1).max(160),completed:z.boolean(),due_on:date.nullable(),due_at:instant.nullable(),modified_at:instant,
 memberships:z.array(z.object({project:z.object({gid}),section:z.object({name:z.string().max(160).optional()}).nullable().optional()})).max(50)});
export type AsanaImportedTask={remote_id:string;title:string;completed:boolean;due_on:string|null;due_at:string|null;section:string|null;modified_at:string};
export function normalizeAsanaTask(raw:unknown,project:string):AsanaImportedTask{
 const t=providerTask.parse(raw),membership=t.memberships.find(m=>m.project.gid===project);
 if(!membership||!t.name.startsWith('[TEST]'))throw new ApiError(409,'asana_source','Only labelled tasks in the selected sandbox may be imported.');
 return {remote_id:t.gid,title:t.name,completed:t.completed,due_on:t.due_on,due_at:t.due_at,section:membership.section?.name??null,modified_at:t.modified_at};
}
export function asanaTaskVersion(t:AsanaImportedTask){return createHash('sha256').update(JSON.stringify(t)).digest('hex');}
export function sealAsana(value:unknown,key:Buffer,aad:string){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(aad));
 const bytes=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64url');
}
export function openAsana(value:string,key:Buffer,aad:string):unknown{
 const b=Buffer.from(value,'base64url'),d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAAD(Buffer.from(aad));d.setAuthTag(b.subarray(12,28));
 return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString());
}
export function validateOwnerAsana(settings:OwnerTestSettings,input:unknown){
 const c=ownerAsanaConfigSchema.parse(input);
 if(c.owner_actor_id!==settings.owner_actor_id||c.participant_id!==settings.participant_id||c.origin!==settings.origin||settings.database_name!=='nancy_owner_test')throw Error('Asana configuration must match the isolated owner copy.');
 return c;
}
type Authority=(session:Session,client?:PoolClient)=>Promise<CareAuthority>;
function fail(code:string,message:string,status=409):never{throw new ApiError(status,code,message);}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class OwnerAsana {
 private pending=new Map<string,{session:Session;authority:CareAuthority;browser:string;verifier:string;expires:number;tokens?:Tokens}>();
 private queue:Promise<unknown>=Promise.resolve();
 private generation=0;
 private connectionIssue:{stage:string;kind:string;fields?:string[]}|null=null;
 private binding:string;
 constructor(readonly config:OwnerAsanaConfig,private pool:Pool,private authority:Authority,private key:Buffer,private fetcher:typeof fetch=fetch){
  this.binding=hash([config.owner_actor_id,config.participant_id,config.origin,config.workspace_id,config.project_id,config.client_id,hash(config.client_secret)]);
 }
 private serial<T>(fn:()=>Promise<T>):Promise<T>{const next=this.queue.then(fn,fn);this.queue=next.catch(()=>{});return next;}
 private async scope(session:Session,client?:PoolClient){const a=await this.authority(session,client);
  if(a.actor_id!==this.config.owner_actor_id||a.client_id!==this.config.participant_id||a.active_role!=='client'||a.login_session_id!==session.session_id)fail('asana_scope','This connection belongs only to the owner practice account.',403);
  return a;
 }
 private async response(url:string,init:RequestInit,signal?:AbortSignal){
  const controller=AbortSignal.any([AbortSignal.timeout(12000),...(signal?[signal]:[])]);
  const route=url.includes('/users/me')?'identity':url.includes('/tasks?')?'tasks':url.includes('/projects/')?'project':'oauth';
  let response:Response;try{response=await this.fetcher(url,{...init,redirect:'error',signal:controller});}catch{throw new ApiError(503,`asana_${route}_transport`,'Asana did not respond. Your previous import is unchanged.');}
  if(!response.ok){await response.body?.cancel();throw new ApiError(503,`asana_${route}_http_${response.status}`,'Asana access is unavailable. Reconnect or try the read again.');}
  const reader=response.body?.getReader();if(!reader)fail('asana_response','Asana returned no data.');
  let length=0;const chunks:Uint8Array[]=[];
  try{for(;;){const r=await reader!.read();if(r.done)break;length+=r.value.length;if(length>1024*1024)fail('asana_response','The sandbox response is too large.');chunks.push(r.value);}}
  finally{await reader!.cancel().catch(()=>{});}
  try{return JSON.parse(Buffer.concat(chunks).toString()) as Record<string,unknown>;}catch{throw new ApiError(503,'asana_response','Asana returned unreadable data.');}
 }
 private api(path:string,token:string,signal?:AbortSignal){return this.response('https://app.asana.com/api/1.0/'+path,{headers:{Authorization:'Bearer '+token}},signal);}
 private async token(form:Record<string,string>){
  const raw=await this.response('https://app.asana.com/-/oauth_token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...form,client_id:this.config.client_id,client_secret:this.config.client_secret})});
  const p=z.object({access_token:z.string().min(1),refresh_token:z.string().min(1).optional(),expires_in:z.number().positive().max(86400),token_type:z.string(),scope:z.string().optional()}).parse(raw);
  if(p.token_type.toLowerCase()!=='bearer'||p.scope&&p.scope.split(/\s+/).sort().join(' ')!==[...asanaReadScopes].sort().join(' '))fail('asana_scopes','Asana did not return the requested read-only permissions.');
  const refresh=p.refresh_token??(form.grant_type==='refresh_token'?form.refresh_token:undefined);
  if(!refresh)fail('asana_tokens','Asana did not supply a renewable connection.');
  return tokensSchema.parse({access_token:p.access_token,refresh_token:refresh,expires_at:Date.now()+p.expires_in*1000});
 }
 private async validateProvider(tokens:Tokens,signal?:AbortSignal){
  const me=z.object({data:z.object({gid,email:z.email()})}).parse(await this.api('users/me?opt_fields=gid,email',tokens.access_token,signal)).data;
  if(me.email.toLowerCase()!==this.config.account_email.toLowerCase())fail('asana_account','Use the selected sandbox owner account.',403);
  const project=z.object({data:z.object({gid,archived:z.boolean()})}).parse(await this.api('projects/'+this.config.project_id+'?opt_fields=gid,archived',tokens.access_token,signal)).data;
  if(project.gid!==this.config.project_id||project.archived)fail('asana_project','The selected sandbox project is unavailable.',403);
  // Validate the workspace through its scoped project collection. Requesting
  // workspace object fields on a project may require an additional OAuth scope.
  // Only IDs are read; task content always comes from the one pinned project.
  let found=false,offset:string|undefined;const offsets=new Set<string>();
  for(let page=0;page<10;page++){
   const query=new URLSearchParams({limit:'50',archived:'false',opt_fields:'gid',...(offset?{offset}:{})});
   const list=z.object({data:z.array(z.object({gid})).max(50),next_page:z.object({offset:z.string().min(1).max(2048)}).nullable().optional()}).parse(await this.api('workspaces/'+this.config.workspace_id+'/projects?'+query,tokens.access_token,signal));
   if(list.data.some(p=>p.gid===this.config.project_id)){found=true;break;}
   offset=list.next_page?.offset;if(!offset)break;if(offsets.has(offset)||page===9)fail('asana_pagination','The sandbox project could not be validated within its read limit.');offsets.add(offset);
  }
  if(!found)fail('asana_project','The selected project is not available in the sandbox workspace.',403);
  return me.gid;
 }
 async begin(session:Session){const a=await this.scope(session);for(const[k,p]of this.pending)if(p.expires<Date.now()||p.session.session_id===session.session_id)this.pending.delete(k);
  if(this.pending.size>=8)fail('asana_busy','Finish the current connection first.');
  const state=randomBytes(32).toString('base64url'),browser=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
  this.pending.set(state,{session,authority:a,browser,verifier,expires:Date.now()+600000});
  const url=new URL('https://app.asana.com/-/oauth_authorize');url.search=new URLSearchParams({client_id:this.config.client_id,redirect_uri:this.config.origin+'/asana/callback',response_type:'code',state,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),scope:asanaReadScopes.join(' ')}).toString();
  return {authorization_url:url.toString(),browser};
 }
 async callback(query:{state:string;code?:string;error?:string},browser?:string){
  let stage='callback_binding';try{
  const p=this.pending.get(query.state);this.pending.delete(query.state);
  if(!p||p.tokens||!browser||p.browser!==browser||p.expires<Date.now()||query.error||!query.code)fail('asana_callback','The connection expired or was declined.');
  const generation=this.generation;
  stage='local_authority';const a=await this.scope(p.session);if(hash(a)!==hash(p.authority))fail('asana_scope','Your account scope changed.',403);
  stage='token_exchange';
  const tokens=await this.token({grant_type:'authorization_code',code:query.code,redirect_uri:this.config.origin+'/asana/callback',code_verifier:p.verifier});
  stage='provider_identity_project';await this.validateProvider(tokens);stage='final_authority';await this.scope(p.session);if(generation!==this.generation)fail('asana_callback','The connection was cancelled.');
  // Browser handoff carries no provider token. Finish must use the original authenticated Nancy login.
  this.pending.set(query.state,{...p,tokens});
  this.connectionIssue=null;return query.state;
  }catch(error){this.connectionIssue={stage,kind:error instanceof ZodError?'invalid_provider_shape':error instanceof ApiError?error.code:'unexpected',
   ...(error instanceof ZodError?{fields:error.issues.map(i=>i.path.map(p=>typeof p==='number'?'[]':String(p)).join('.')).filter(p=>/^[a-z_.\[\]]{0,64}$/.test(p)).slice(0,8)}:{})};throw error;}
 }
 async finish(session:Session,state:string,browser?:string){return this.serial(async()=>{const p=this.pending.get(state);this.pending.delete(state);const a=await this.scope(session);
  if(!p?.tokens||p.expires<Date.now()||p.browser!==browser||hash(a)!==hash(p.authority))fail('asana_callback','Reconnect from the same signed-in Nancy page.');
  await this.pool.query(`insert into companion_local.owner_asana_connection(singleton,binding,credential) values(true,$1,$2)
   on conflict(singleton) do update set binding=excluded.binding,credential=excluded.credential,updated_at=now()`,[this.binding,sealAsana({tokens:p.tokens,grant:a.grant_revision},this.key,this.binding)]);
  return {connected:true};});
 }
 private async connection(a:CareAuthority){const row=(await this.pool.query('select binding,credential from companion_local.owner_asana_connection where singleton')).rows[0];
  if(!row||row.binding!==this.binding)fail('asana_disconnected','Connect the sandbox first.');
  let saved:{tokens:Tokens;grant:string};try{saved=z.object({tokens:tokensSchema,grant:z.string()}).parse(openAsana(row.credential,this.key,this.binding));}catch{throw new ApiError(409,'asana_disconnected','Reconnect the sandbox; its saved credential cannot be used.');}
  if(saved.grant!==a.grant_revision)fail('asana_scope','Sandbox access changed. Reconnect after reviewing access.',403);
  return saved;
 }
 async status(session:Session){const a=await this.scope(session);let connected=false;try{await this.connection(a);connected=true;}catch(error){if(!(error instanceof ApiError)||!['asana_disconnected','asana_scope'].includes(error.code))throw error;}
  if(!connected)return{connected:false,tasks:[],connection_issue:this.connectionIssue};
  const rows=(await this.pool.query('select remote_id,version,source,missing,observed_at,local_task_id,imported_version from companion_local.owner_asana_tasks where binding=$1 order by remote_id',[this.binding])).rows;
  if(hash(a)!==hash(await this.scope(session)))fail('asana_scope','Your practice account access changed.',403);
  return {connected:true,project:'Daily Life - Sandbox',read_only:true,tasks:rows};
 }
 async sync(session:Session){return this.serial(async()=>{
  const a=await this.scope(session),saved=await this.connection(a);let tokens=saved.tokens;
  if(tokens.expires_at<Date.now()+60000){tokens=await this.token({grant_type:'refresh_token',refresh_token:tokens.refresh_token});await this.scope(session);
   await this.pool.query('update companion_local.owner_asana_connection set credential=$2,updated_at=now() where singleton and binding=$1',[this.binding,sealAsana({tokens,grant:saved.grant},this.key,this.binding)]);}
  const signal=AbortSignal.timeout(30000);await this.validateProvider(tokens,signal);
  const all:AsanaImportedTask[]=[],seen=new Set<string>();let offset:string|undefined;const offsets=new Set<string>();
  for(let page=0;page<10;page++){
   const query=new URLSearchParams({limit:'50',completed_since:'1970-01-01T00:00:00.000Z',opt_fields:'gid,name,completed,due_on,due_at,modified_at,memberships.project,memberships.section',...(offset?{offset}:{})});
   const raw=await this.api('projects/'+this.config.project_id+'/tasks?'+query,tokens.access_token,signal);
   const parsed=z.object({data:z.array(z.unknown()).max(50),next_page:z.object({offset:z.string().min(1).max(2048)}).nullable().optional()}).parse(raw);
   for(const item of parsed.data){const t=normalizeAsanaTask(item,this.config.project_id);if(seen.has(t.remote_id))fail('asana_pagination','Asana returned a repeated task. Previous import retained.');seen.add(t.remote_id);all.push(t);}
   offset=parsed.next_page?.offset;if(!offset)break;if(offsets.has(offset)||page===9)fail('asana_pagination','The sandbox import exceeded its page limit.');offsets.add(offset);
  }
  await this.scope(session);const client=await this.pool.connect();
  try{await client.query('begin');await client.query("set local lock_timeout='3s'");await client.query("set local statement_timeout='5s'");const current=await this.scope(session,client);if(hash(a)!==hash(current))fail('asana_scope','Access changed during import.',403);
   const observed=new Date().toISOString();let added=0,changed=0;
   for(const t of all){const v=asanaTaskVersion(t),prior=(await client.query('select version,missing from companion_local.owner_asana_tasks where remote_id=$1 and binding=$2',[t.remote_id,this.binding])).rows[0];if(!prior)added++;else if(prior.version!==v||prior.missing)changed++;
    await client.query(`insert into companion_local.owner_asana_tasks(remote_id,binding,version,source,observed_at) values($1,$2,$3,$4,$5)
     on conflict(remote_id) do update set binding=excluded.binding,version=excluded.version,source=excluded.source,observed_at=excluded.observed_at,missing=false`,[t.remote_id,this.binding,v,t,observed]);}
   await client.query('update companion_local.owner_asana_tasks set missing=true,observed_at=$2 where binding=$3 and not(remote_id=any($1::text[]))',[all.map(t=>t.remote_id),observed,this.binding]);
   await client.query('commit');return {received:all.length,added,changed,observed_at:observed};
  }catch(error){await client.query('rollback');throw error;}finally{client.release();}
 });}
 async accept(session:Session,input:unknown){const body=z.object({command_id:z.uuid(),remote_id:gid,version:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(input);
  return this.serial(async()=>{const a=await this.scope(session);await this.connection(a);const c=await this.pool.connect();try{await c.query('begin');await c.query("set local lock_timeout='3s'");await c.query("set local statement_timeout='5s'");const locked=await this.scope(session,c);if(hash(a)!==hash(locked))fail('asana_scope','Access changed.',403);
   const payload=hash(body),old=(await c.query('select * from companion_local.owner_asana_receipts where command_id=$1',[body.command_id])).rows[0];
   if(old){if(old.payload_hash!==payload||old.actor_id!==a.actor_id||old.participant_id!==a.client_id||old.grant_revision!==a.grant_revision)fail('asana_conflict','This receipt belongs to a different command.');await c.query('commit');return {...old.result,replayed:true};}
   const row=(await c.query('select * from companion_local.owner_asana_tasks where remote_id=$1 and binding=$2 for update',[body.remote_id,this.binding])).rows[0];
   if(!row||row.missing||row.version!==body.version||row.source.completed||Date.now()-new Date(row.observed_at).getTime()>300000)fail('asana_stale','Import again and review this task’s current state.');
   if(row.local_task_id)fail('asana_already_added','This task is already available in Nancy. Source changes need separate review.');
   const t=row.source as AsanaImportedTask,profile=(await c.query('select revision,time_zone from companion_local.participant_profiles where id=$1 for update',[a.client_id])).rows[0];
   let scheduled=t.due_on,time:string|null=null;
   if(t.due_at){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:profile.time_zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(t.due_at)),part=(type:string)=>parts.find(p=>p.type===type)!.value;scheduled=`${part('year')}-${part('month')}-${part('day')}`;time=`${part('hour')}:${part('minute')}`;}
   const id=randomUUID();await c.query(`insert into companion_local.task_definitions(id,participant_id,title,time_hint,urgency,scheduled_date,scheduled_time,category,setup_revision) values($1,$2,$3,'Asana sandbox','medium',$4,$5,'task',$6)`,[id,a.client_id,t.title,scheduled,time,profile.revision]);
   await c.query('update companion_local.owner_asana_tasks set local_task_id=$2,imported_version=$3 where remote_id=$1',[t.remote_id,id,row.version]);
   const result={local_task_id:id,remote_id:t.remote_id,result:'available_for_planning',replayed:false};
   await c.query(`insert into companion_local.owner_asana_receipts(command_id,payload_hash,actor_id,participant_id,grant_revision,result) values($1,$2,$3,$4,$5,$6)`,[body.command_id,payload,a.actor_id,a.client_id,a.grant_revision,result]);
   await c.query(`insert into companion_local.domain_events(participant_id,actor_id,command_id,event_type,data) values($1,$2,$3,'AsanaSandboxTaskAdded',$4)`,[a.client_id,a.actor_id,body.command_id,{task_id:id,source_version:row.version}]);
   await c.query('commit');return result;
  }catch(error){await c.query('rollback');throw error;}finally{c.release();}});
 }
 async disconnect(session:Session){return this.serial(async()=>{await this.scope(session);this.generation++;this.pending.clear();await this.pool.query('delete from companion_local.owner_asana_connection');return{connected:false};});}
}
export function registerOwnerAsana(app:FastifyInstance,service:OwnerAsana,sessions:WeakMap<FastifyRequest,Session>,limit:(request:FastifyRequest,key:string,maximum:number)=>void){
  const resolveSession=(request:FastifyRequest)=>sessions.get(request)!;
  const cookie={httpOnly:true,secure:true,sameSite:'lax' as const,path:'/',maxAge:600};
  const empty=z.object({}).strict();
  app.addHook('preHandler',async request=>{if(request.routeOptions.url?.startsWith('/api/asana-test'))limit(request,`asana:${resolveSession(request).user_id}`,30);
   if(request.routeOptions.url==='/asana/callback')limit(request,`asana-callback:${request.ip}`,30);});
  app.get('/api/asana-test',async request=>service.status(await resolveSession(request)));
  app.post('/api/asana-test/connect',async(request,reply)=>{empty.parse(request.body);const result=await service.begin(await resolveSession(request));reply.setCookie('nancy_asana_binding',result.browser,cookie);return{authorization_url:result.authorization_url};});
  app.get('/asana/callback',async(request,reply)=>{try{const q=z.object({state:z.string().max(512),code:z.string().max(16000).optional(),error:z.string().max(200).optional(),error_description:z.string().max(4096).optional()}).strict().parse(request.query);
   const state=await service.callback(q,request.cookies.nancy_asana_binding);reply.setCookie('nancy_asana_finish',state,{...cookie,path:'/api/asana-test',maxAge:600});return reply.code(303).redirect('/asana-test.html?finish=1');
  }catch{return reply.clearCookie('nancy_asana_binding',cookie).code(303).redirect('/asana-test.html?failed=1');}});
  app.post('/api/asana-test/finish',async(request,reply)=>{empty.parse(request.body);try{return await service.finish(await resolveSession(request),request.cookies.nancy_asana_finish??'',request.cookies.nancy_asana_binding);}finally{reply.clearCookie('nancy_asana_finish',{...cookie,path:'/api/asana-test'});reply.clearCookie('nancy_asana_binding',cookie);}});
  app.post('/api/asana-test/sync',async request=>{empty.parse(request.body);return service.sync(await resolveSession(request));});
  app.post('/api/asana-test/accept',async request=>service.accept(await resolveSession(request),request.body));
  app.post('/api/asana-test/disconnect',async request=>{empty.parse(request.body);return service.disconnect(await resolveSession(request));});
}
