import{beforeAll,afterAll,describe,it,expect}from'vitest';
import{PGlite}from'@electric-sql/pglite';
import{readFile}from'node:fs/promises';
import{randomBytes,randomUUID}from'node:crypto';
import{localCareMigrations}from'../src/server/local-migrations.js';
import{OwnerAsana,asanaReadScopes,type OwnerAsanaConfig}from'../src/server/owner-asana.js';
import{exportSnapshot,exportOwnerAsanaSnapshot,restoreSnapshot,restoreOwnerAsanaSnapshot,encryptSnapshot,decryptSnapshot,validateOwnerAsanaBackupRoute,type Snapshot}from'../src/server/backup.js';
import{pglitePool}from'./helpers/pglite-pool.js';
import type{CareAuthority}from'../src/server/care-access.js';
import type{Session}from'../src/server/session.js';

const actor=randomUUID(),participant=randomUUID(),key=randomBytes(32);
const session:Session={user_id:actor,session_id:randomUUID(),access_token:'synthetic-local-access',refresh_token:'synthetic-local-refresh',issued_at:Date.now()/1000,expires_at:Date.now()/1000+3600};
const authority:CareAuthority={actor_id:actor,client_id:participant,login_session_id:session.session_id,active_role:'client',grant_revision:'synthetic-g1'};
const config:OwnerAsanaConfig={schema_version:1,owner_actor_id:actor,participant_id:participant,origin:'https://backup.example.invalid:10000',workspace_id:'100',project_id:'200',account_email:'backup-owner@example.invalid',client_id:'300',client_secret:'synthetic-application-secret'};
const providerTask={gid:'1',name:'[TEST] Preserved import',completed:false,due_on:'2026-10-26',due_at:null,modified_at:'2026-10-24T12:00:00.000Z',memberships:[{project:{gid:'200'},section:{name:'Inbox'}}]};
const json=(data:unknown)=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
const fetcher:typeof fetch=async input=>{const path=new URL(String(input)).pathname;
 if(path==='/-/oauth_token')return json({access_token:'synthetic-provider-access',refresh_token:'synthetic-provider-refresh',expires_in:3600,token_type:'bearer',scope:asanaReadScopes.join(' ')});
 if(path==='/api/1.0/users/me')return json({data:{gid:'400',email:config.account_email}});
 if(path==='/api/1.0/projects/200')return json({data:{gid:'200',archived:false}});
 if(path==='/api/1.0/workspaces/100/projects')return json({data:[{gid:'200'}],next_page:null});
 if(path==='/api/1.0/projects/200/tasks')return json({data:[providerTask],next_page:null});
 throw Error('Unexpected synthetic provider route');
};
async function database(){const db=new PGlite();for(const file of localCareMigrations)await db.exec(await readFile('db/'+file,'utf8'));await db.exec(await readFile('db/owner_asana_test.sql','utf8'));return db;}
function service(db:PGlite){return new OwnerAsana(config,pglitePool(db) as any,async()=>({...authority}),key,fetcher);}
async function connect(s:OwnerAsana){const begin=await s.begin(session),state=new URL(begin.authorization_url).searchParams.get('state')!;await s.callback({state,code:'synthetic-code'},begin.browser);await s.finish(session,state,begin.browser);}

describe('explicit owner Asana care/import recovery',()=>{
 let source:PGlite,snapshot:Snapshot,ordinary:Snapshot,command:{command_id:string;remote_id:string;version:string},originalTask:string;
 beforeAll(async()=>{
  source=await database();
  await source.query('insert into companion_local.accounts(id,email,password_salt,password_hash) values($1,$2,$3,$4)',[actor,config.account_email,new Uint8Array(16),new Uint8Array(32)]);
  await source.query("insert into companion_local.participant_profiles(id,display_name,time_zone) values($1,'Synthetic backup','America/Toronto')",[participant]);
  const s=service(source);await connect(s);await s.sync(session);const task=(await s.status(session)).tasks[0];command={command_id:randomUUID(),remote_id:task.remote_id,version:task.version};
  originalTask=(await s.accept(session,command)).local_task_id;
  ordinary=await exportSnapshot(source,'synthetic-owner-source','companion_local');snapshot=decryptSnapshot(encryptSnapshot(await exportOwnerAsanaSnapshot(source,'synthetic-owner-source'),key),key);
 });
 afterAll(async()=>source?.close());
 it('keeps default format-2 snapshots unchanged and excludes provider credentials from the opt-in extension',()=>{
  expect(ordinary.format).toBe(2);expect(ordinary.owner_asana).toBeUndefined();expect(ordinary.tables.owner_asana_tasks).toBeUndefined();
  expect(decryptSnapshot(encryptSnapshot(ordinary,key),key).format).toBe(2);expect(snapshot.format).toBe(3);
  expect(Object.keys(snapshot.owner_asana!.tables)).toEqual(['owner_asana_tasks','owner_asana_receipts']);
  const serialized=JSON.stringify(snapshot);for(const secret of ['synthetic-provider-access','synthetic-provider-refresh',config.client_secret,'owner_asana_connection'])expect(serialized).not.toContain(secret);
  expect(snapshot.owner_asana!.tables.owner_asana_tasks[0].local_task_id).toBe(originalTask);expect(snapshot.owner_asana!.tables.owner_asana_receipts[0].command_id).toBe(command.command_id);
 });
 it('restores exact IDs/receipts, stays disconnected, then rejects duplicate imports after a separate reconnect and sync',async()=>{
  const target=await database();try{
   await expect(restoreSnapshot(target,snapshot,'synthetic-owner-target')).rejects.toThrow('explicit format-3');
   await restoreOwnerAsanaSnapshot(target,snapshot,'synthetic-owner-target');
   expect((await target.query('select count(*)::int n from companion_local.owner_asana_connection')).rows[0]).toEqual({n:0});
   expect((await target.query('select count(*)::int n from companion_local.sessions')).rows[0]).toEqual({n:0});
   const s=service(target);expect((await s.status(session)).connected).toBe(false);await connect(s);expect(await s.sync(session)).toMatchObject({received:1,added:0,changed:0});
   expect(await s.accept(session,command)).toMatchObject({local_task_id:originalTask,replayed:true});
   await expect(s.accept(session,{...command,command_id:randomUUID()})).rejects.toMatchObject({code:'asana_already_added'});
   expect((await target.query('select id from companion_local.task_definitions')).rows).toEqual([{id:originalTask}]);
  }finally{await target.close();}
 });
 it.each(['connection','mapping'] as const)('refuses a target containing a provider %s before restoring care rows',async kind=>{
  const target=await database();try{
   if(kind==='connection')await target.query("insert into companion_local.owner_asana_connection(binding,credential) values('synthetic','excluded-secret')");
   else await target.query("insert into companion_local.owner_asana_tasks(remote_id,binding,version,source,observed_at) values('99','synthetic','version','{}',now())");
   await expect(restoreOwnerAsanaSnapshot(target,snapshot,'synthetic-nonempty-target')).rejects.toThrow('Target contains care data');
   expect((await target.query('select count(*)::int n from companion_local.accounts')).rows[0]).toEqual({n:0});
   const table=kind==='connection'?'owner_asana_connection':'owner_asana_tasks';expect((await target.query('select count(*)::int n from companion_local.'+table)).rows[0]).toEqual({n:1});
  }finally{await target.close();}
 });
 it('rejects missing/changed extension identity and owner restoration of legacy care-only backups',async()=>{
  const incomplete=structuredClone(snapshot);delete incomplete.owner_asana!.tables.owner_asana_tasks;expect(()=>decryptSnapshot(encryptSnapshot(incomplete,key),key)).toThrow('Owner Asana backup extension');
  const changed=structuredClone(snapshot);changed.owner_asana!.schema_hash='0'.repeat(64);expect(()=>decryptSnapshot(encryptSnapshot(changed,key),key)).toThrow('Owner Asana backup extension');
  await expect(restoreOwnerAsanaSnapshot({query:async()=>{throw Error('Must refuse before SQL');}},ordinary,'synthetic-owner-target')).rejects.toThrow('explicit format-3');
 });
 it('rolls back care rows as well as import rows if an extension row cannot restore',async()=>{
  const target=await database();try{
   const invalid=structuredClone(snapshot);invalid.owner_asana!.tables.owner_asana_tasks[0].local_task_id=randomUUID();
   await expect(restoreOwnerAsanaSnapshot(target,invalid,'synthetic-invalid-owner-target')).rejects.toBeTruthy();
   for(const table of ['accounts','task_definitions','owner_asana_tasks','owner_asana_receipts'])expect((await target.query('select count(*)::int n from companion_local.'+table)).rows[0]).toEqual({n:0});
  }finally{await target.close();}
 });
 it('requires explicit owner selection and refuses live or remote owner recovery destinations',()=>{
  const url=(name:string)=>'postgres://synthetic@127.0.0.1:55432/'+name;
  expect(()=>validateOwnerAsanaBackupRoute('export',url('nancy_owner_test'),'companion_local',false)).toThrow('--owner-asana');
  expect(()=>validateOwnerAsanaBackupRoute('restore',url('nancy_owner_restore_disposable'),'companion_local',false)).toThrow('--owner-asana');
  expect(()=>validateOwnerAsanaBackupRoute('export',url('nancy_owner_test'),'companion_local',true)).not.toThrow();
  expect(()=>validateOwnerAsanaBackupRoute('restore',url('nancy_owner_restore_disposable'),'companion_local',true)).not.toThrow();
  for(const invalid of [url('nancy_client_trial'),url('nancy_owner_test'),'postgres://synthetic@remote.invalid:55432/nancy_owner_restore_disposable'])expect(()=>validateOwnerAsanaBackupRoute('restore',invalid,'companion_local',true)).toThrow('isolated');
  expect(()=>validateOwnerAsanaBackupRoute('export',url('nancy_client_trial'),'companion_local',false)).not.toThrow();
 });
});
