import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {MicrosoftService,type MicrosoftServiceConfig} from '../src/server/microsoft/service.js';
import {MicrosoftOAuthError,MICROSOFT_CALENDAR_READ_SCOPES,type MicrosoftTokenSet} from '../src/server/microsoft/oauth.js';
import {openMicrosoftSecret} from '../src/server/microsoft/credential-storage.js';
import {canonicalJson} from '../src/server/local-authority.js';
import {exportSnapshot,encryptSnapshot,decryptSnapshot,schemaHash,ownerAsanaSchemaHash} from '../src/server/backup.js';
import {createMicrosoftFixture,microsoftTestDatabase} from './helpers/microsoft-fixture.js';

describe('separately bound read-only Outlook calendar source',()=>{
 let database:Awaited<ReturnType<typeof microsoftTestDatabase>>;
 let now=new Date('2026-11-02T12:00:00Z');
 beforeAll(async()=>{database=await microsoftTestDatabase();});
 afterAll(async()=>database.close());
 const range={start:'2026-11-02T05:00:00Z',end:'2026-11-03T05:00:00Z'};
 async function fixture(){
  const primary=await createMicrosoftFixture(database.pool,()=>now);
  const settings:MicrosoftServiceConfig={...primary.settings,expectedObjectId:randomUUID(),accessMode:'calendar_read',sourceLabel:'Synthetic second account',modelUseApproved:true,preparationApproved:true,reviewedWritesApproved:true};
  let tokens:MicrosoftTokenSet={...primary.getTokens(),accessToken:'secondary-access',refreshToken:'secondary-refresh',scopes:[...MICROSOFT_CALENDAR_READ_SCOPES],identity:{tenantId:settings.tenantId,objectId:settings.expectedObjectId}};
  const denied=vi.fn(async()=>{throw new Error('Calendar-only source must never call mail or write provider methods.');});
  const graph={...primary.graph,listMailFolders:denied,listMessages:denied,searchMessages:denied,getMessage:denied,createMailDraft:denied,sendCreatedDraft:denied,inspectCreatedMessage:denied,createCalendarEvent:denied,
   verifyIdentity:vi.fn(async()=>({...await primary.graph.verifyIdentity(),id:settings.expectedObjectId})),calendarView:vi.fn(primary.graph.calendarView)};
  const oauth={...primary.oauth,exchangeCode:vi.fn(async()=>tokens),refreshTokens:vi.fn(async()=>{tokens={...tokens,accessToken:'secondary-refreshed',expiresAt:new Date(now.getTime()+3600000).toISOString()};return tokens;})};
  const service=new MicrosoftService(database.pool,settings,oauth,{clock:()=>now,graph:()=>graph});
  async function connect(){const begun=await service.begin(primary.session),state=primary.latest().state;await service.callback({state,code:'secondary-code'},begun.browserBinding);await service.finish(primary.session,begun.browserBinding);}
  async function select(){const status=await service.status(primary.session);await service.select(primary.session,{expected_revision:status.revision,calendar_ids:['calendar-approved'],mail_folder_ids:[]});}
  return {primary,settings,service,graph,oauth,denied,connect,select,setTokens:(value:MicrosoftTokenSet)=>{tokens=value;},getTokens:()=>tokens};
 }
 async function primaryRow(actor:string){return (await database.pool.query('select * from companion_local.microsoft_connections where actor_id=$1',[actor])).rows[0];}
 async function secondaryRow(actor:string){return (await database.pool.query('select * from companion_local.microsoft_calendar_connections where actor_id=$1',[actor])).rows[0];}

 it('keeps primary ciphertext, selection, original fingerprint and AAD across secondary lifecycle',async()=>{
  const f=await fixture();await f.primary.connect();
  await f.primary.service.select(f.primary.session,{expected_revision:1,calendar_ids:['calendar-approved'],mail_folder_ids:['folder-approved']});
  const before=await primaryRow(f.primary.session.user_id),c=f.primary.settings;
  expect(before.configuration_fingerprint).toBe(createHash('sha256').update(canonicalJson([c.tenantId,c.clientId,c.expectedObjectId,c.actorId,c.participantId,c.redirectUri])).digest('hex'));
  expect(JSON.parse(openMicrosoftSecret(before.token_ciphertext,c.encryptionKey,{connectionId:before.id,actorId:c.actorId,participantId:c.participantId,tenantId:c.tenantId,objectId:c.expectedObjectId}))).toEqual(f.primary.getTokens());
  await f.connect();await f.select();await f.service.resources(f.primary.session);await f.service.read(f.primary.session,range);
  const secondary=await secondaryRow(c.actorId);
  expect(secondary.id).not.toBe(before.id);expect(secondary.object_id).toBe(f.settings.expectedObjectId);
  expect(()=>openMicrosoftSecret(secondary.token_ciphertext,c.encryptionKey,{connectionId:secondary.id,actorId:c.actorId,participantId:c.participantId,tenantId:c.tenantId,objectId:f.settings.expectedObjectId})).toThrow();
  expect(await primaryRow(c.actorId)).toEqual(before);
  await f.service.disconnect(f.primary.session);
  expect(await primaryRow(c.actorId)).toEqual(before);expect((await f.primary.service.status(f.primary.session)).state).toBe('connected');
 });
 it('keeps pending authorizations isolated and routes only exact unexpired durable state',async()=>{
  const f=await fixture(),p=await f.primary.service.begin(f.primary.session),ps=f.primary.latest().state;
  const s=await f.service.begin(f.primary.session),ss=f.primary.latest().state;
  expect(await f.primary.service.ownsCallbackState(ps)).toBe(true);expect(await f.service.ownsCallbackState(ps)).toBe(false);
  expect(await f.service.ownsCallbackState(ss)).toBe(true);expect(await f.primary.service.ownsCallbackState(ss)).toBe(false);
  expect(await f.service.ownsCallbackState('x'.repeat(513))).toBe(false);
  await expect(f.service.callback({state:ss,code:'code'},p.browserBinding)).rejects.toMatchObject({status:400});
  await expect(f.service.callback({state:ps,code:'code'},p.browserBinding)).rejects.toMatchObject({status:400});
  await f.service.callback({state:ss,code:'code'},s.browserBinding);
  expect(await f.service.ownsCallbackState(ss)).toBe(false);
  await f.service.finish(f.primary.session,s.browserBinding);
  expect(await f.primary.service.ownsCallbackState(ps)).toBe(true);
  await f.primary.service.callback({state:ps,code:'code'},p.browserBinding);await f.primary.service.finish(f.primary.session,p.browserBinding);
  const expiring=await f.service.begin(f.primary.session),expired=f.primary.latest().state;
  await database.pool.query('update companion_local.microsoft_calendar_oauth_pending set expires_at=$2 where actor_id=$1',[f.settings.actorId,new Date(now.getTime()-1)]);
  expect(await f.service.ownsCallbackState(expired)).toBe(false);
  await expect(f.service.callback({state:expired,code:'code'},expiring.browserBinding)).rejects.toMatchObject({status:400});
 });
 it('denied secondary consent and local secondary cleanup leave primary consent intact',async()=>{
  const f=await fixture();await f.primary.connect();const before=await primaryRow(f.settings.actorId);
  const p=await f.primary.service.begin(f.primary.session),ps=f.primary.latest().state;
  const s=await f.service.begin(f.primary.session),ss=f.primary.latest().state;
  await expect(f.service.callback({state:ss,error:'access_denied'},s.browserBinding)).rejects.toMatchObject({code:'microsoft_connection_cancelled'});
  expect(await f.primary.service.ownsCallbackState(ps)).toBe(true);
  await f.service.endLogin(f.primary.session);expect(await f.primary.service.ownsCallbackState(ps)).toBe(true);
  expect(await primaryRow(f.settings.actorId)).toEqual(before);expect(f.oauth.exchangeCode).not.toHaveBeenCalled();expect(p.browserBinding).toBeTruthy();
 });
 it('only discovers and reads selected calendars, including preparation',async()=>{
  const f=await fixture();await f.connect();await f.select();
  expect(await f.service.status(f.primary.session)).toMatchObject({access_mode:'calendar_read',source_label:'Synthetic second account',reviewed_writes_enabled:false});
  expect(await f.service.resources(f.primary.session)).toMatchObject({mail_folders:{items:[],complete:true}});
  expect((await f.service.read(f.primary.session,range)).mail_folders).toEqual([]);
  expect(await f.service.conversationContext(f.primary.session,range)).toMatchObject({source_scope:'calendar',mail_folders:[],state:'fresh'});
  expect(await f.service.preparedContext(f.primary.session,range)).toMatchObject({source_scope:'calendar',state:'prepared'});
  expect(await f.service.prepareMorning()).toMatchObject({state:'prepared',folder_count:0});
  expect(f.denied).not.toHaveBeenCalled();expect(f.graph.calendarView).toHaveBeenCalled();
  expect(await f.service.status(f.primary.admin)).not.toHaveProperty('source_label');
 });
 it('denies all mail and write entry points even when a mistaken writes flag is true',async()=>{
  const f=await fixture();await f.connect();await f.select();const session=f.primary.session;
  const actions=[()=>f.service.conversationMessage(session,'folder-approved','message'),()=>f.service.conversationMailSearch(session,{query:'appointment'}),()=>f.service.conversationContext(session,range,'inbox'),()=>f.service.preparedContext(session,range,'inbox'),()=>f.service.select(session,{expected_revision:2,calendar_ids:[],mail_folder_ids:['folder-approved']}),
   ()=>f.service.prepareAction(session,{}),()=>f.service.confirmAction(session,{}),()=>f.service.actionReceipt(session,randomUUID(),true),()=>f.service.actionReview(session,randomUUID()),()=>f.service.recentActions(session)];
  for(const action of actions)await expect(action()).rejects.toMatchObject({status:403});
  expect(f.denied).not.toHaveBeenCalled();
  await expect(database.pool.query("update companion_local.microsoft_calendar_connections set selected_mail_folder_ids=array['forbidden'] where actor_id=$1",[f.settings.actorId])).rejects.toThrow();
 });
 it('secondary refresh and invalid identity erase only the secondary credential',async()=>{
  const f=await fixture();await f.primary.connect();const before=await primaryRow(f.settings.actorId);
  f.setTokens({...f.getTokens(),expiresAt:new Date(now.getTime()+1000).toISOString()});await f.connect();await f.service.resources(f.primary.session);expect(f.oauth.refreshTokens).toHaveBeenCalledOnce();
  expect(await primaryRow(f.settings.actorId)).toEqual(before);
  const changed=new MicrosoftService(database.pool,{...f.settings,expectedObjectId:randomUUID()},f.oauth,{clock:()=>now,graph:()=>f.graph});
  expect((await changed.status(f.primary.session)).state).toBe('reconnect_required');
  expect((await secondaryRow(f.settings.actorId)).token_ciphertext).toBeNull();expect(await primaryRow(f.settings.actorId)).toEqual(before);
 });
 it.each(['identity','mail_scope','write_scope','missing_read'])('rejects invalid secondary token %s before Graph or persistence',async kind=>{
  const f=await fixture();await f.primary.connect();const before=await primaryRow(f.settings.actorId),tokens=f.getTokens();
  f.setTokens(kind==='identity'?{...tokens,identity:{...tokens.identity,objectId:randomUUID()}}:{...tokens,scopes:kind==='missing_read'?['User.Read']:tokens.scopes.concat(kind==='mail_scope'?'Mail.Read':'Calendars.ReadWrite')});
  await expect(f.connect()).rejects.toMatchObject({status:403});expect(f.graph.verifyIdentity).not.toHaveBeenCalled();
  expect(await secondaryRow(f.settings.actorId)).toBeUndefined();expect(await primaryRow(f.settings.actorId)).toEqual(before);
 });
 it('secondary refresh rejection never corrupts primary and care revocation reconciles both sources independently',async()=>{
  const f=await fixture();await f.primary.connect();const before=await primaryRow(f.settings.actorId);
  f.setTokens({...f.getTokens(),expiresAt:new Date(now.getTime()+1000).toISOString()});await f.connect();
  f.oauth.refreshTokens.mockRejectedValueOnce(new MicrosoftOAuthError('reauthorization_required'));
  await expect(f.service.resources(f.primary.session)).rejects.toMatchObject({code:'microsoft_reconnect_required'});expect(await primaryRow(f.settings.actorId)).toEqual(before);
  await f.connect();await database.pool.query('update companion_local.role_grants set revoked_at=$2 where actor_id=$1',[f.settings.actorId,now]);
  await expect(f.service.read(f.primary.session,range)).rejects.toMatchObject({status:401});
  await expect(f.primary.service.read(f.primary.session,range)).rejects.toMatchObject({status:401});
  expect((await primaryRow(f.settings.actorId)).token_ciphertext).toBeNull();expect((await secondaryRow(f.settings.actorId)).token_ciphertext).toBeNull();
 });
 it('excludes both connection stores from backup and accepts the previous care schema hash',async()=>{
  const f=await fixture();await f.primary.connect();await f.connect();await f.select();
  const snapshot=await exportSnapshot(database.pool,'synthetic-source','companion_local');
  for(const table of ['microsoft_connections','microsoft_oauth_pending','microsoft_calendar_connections','microsoft_calendar_oauth_pending'])expect(snapshot.tables).not.toHaveProperty(table);
  expect(JSON.stringify(snapshot)).not.toContain('secondary-access');
  const prior={...snapshot,schema_hash:schemaHash('companion_local',false,'020_microsoft_preparation.sql')};
  expect(decryptSnapshot(encryptSnapshot(prior,f.settings.encryptionKey),f.settings.encryptionKey)).toEqual(JSON.parse(JSON.stringify(prior)));
  const priorOwner={...prior,format:3 as const,owner_asana:{format:1 as const,schema_hash:ownerAsanaSchemaHash(),tables:{owner_asana_tasks:[],owner_asana_receipts:[]}}};
  expect(decryptSnapshot(encryptSnapshot(priorOwner,f.settings.encryptionKey),f.settings.encryptionKey)).toEqual(JSON.parse(JSON.stringify(priorOwner)));
 });
});
