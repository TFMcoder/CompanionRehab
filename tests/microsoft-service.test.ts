import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {MicrosoftService} from '../src/server/microsoft/service.js';
import {MicrosoftGraphError} from '../src/server/microsoft/graph.js';
import {MicrosoftOAuthError} from '../src/server/microsoft/oauth.js';
import {openMicrosoftSecret} from '../src/server/microsoft/credential-storage.js';
import {exportSnapshot,schemaHash,encryptSnapshot,decryptSnapshot} from '../src/server/backup.js';
import {createMicrosoftFixture,microsoftTestDatabase} from './helpers/microsoft-fixture.js';

describe('Microsoft connection lifecycle with durable care authorization',()=>{
 let database:Awaited<ReturnType<typeof microsoftTestDatabase>>;
 let now=new Date('2026-10-17T16:00:00Z');
 beforeAll(async()=>{database=await microsoftTestDatabase();});
 afterAll(async()=>database.close());
 const fixture=()=>createMicrosoftFixture(database.pool,()=>now);
 const range={start:'2026-10-17T00:00:00Z',end:'2026-10-18T00:00:00Z'};
 it.each(['oauth','graph','unknown','reporter_failure'])('reports safe connection-stage diagnostics and consumes a failed exchange: %s',async kind=>{
  const f=await fixture(),pending=await f.service.begin(f.session);
  await f.service.callback({state:f.latest().state,code:'private-single-use-code'},pending.browserBinding);
  const reported:unknown[]=[];
  let exchanges=0;
  const service=new MicrosoftService(database.pool,f.settings,{...f.oauth,async exchangeCode(){
   exchanges++;
   if(kind==='oauth'||kind==='reporter_failure')throw new MicrosoftOAuthError('provider_unavailable',{httpStatus:400,providerCodes:[700027]});
   if(kind==='unknown')throw new Error('private credential, code and transcript');
   return f.getTokens();
  }},{clock:()=>now,reportConnectionFailure:failure=>{reported.push(failure);if(kind==='reporter_failure')throw new Error('private diagnostic error');},graph:()=>({...f.graph,async verifyIdentity(){throw new MicrosoftGraphError('provider_error',403);}})});
  await expect(service.finish(f.session,pending.browserBinding)).rejects.toMatchObject({code:'microsoft_connection_failed'});
  expect(exchanges).toBe(1);
  expect(reported).toEqual([{stage:kind==='graph'?'graph_identity':'token_exchange',code:kind==='graph'?'graph_provider_error':kind==='unknown'?'unexpected_failure':'oauth_provider_unavailable',http_status:kind==='graph'?403:kind==='unknown'?null:400,provider_codes:kind==='graph'||kind==='unknown'?[]:[700027],scope_check:null}]);
  expect(JSON.stringify(reported)).not.toMatch(/private|credential|transcript|single-use/);
  expect((await database.pool.query('select id from companion_local.microsoft_oauth_pending where actor_id=$1',[f.session.user_id])).rows).toHaveLength(0);
  expect((await service.status(f.session)).state).toBe('disconnected');
  await expect(service.finish(f.session,pending.browserBinding)).rejects.toMatchObject({code:'microsoft_authorization_expired'});
  expect(exchanges).toBe(1);
 });
 it('connects only approved client and stores encrypted bound credentials, never care facts',async()=>{
  const f=await fixture();await expect(f.service.begin(f.admin)).rejects.toMatchObject({status:403});
  expect((await f.service.status(f.admin)).eligible).toBe(false);
  const begun=await f.service.begin(f.session),pending=(await database.pool.query('select * from companion_local.microsoft_oauth_pending where actor_id=$1',[f.session.user_id])).rows[0];
  expect(pending.pending_ciphertext).not.toContain(f.latest().codeVerifier);
  await f.service.callback({state:f.latest().state,code:'synthetic-private-code'},begun.browserBinding);
  await f.service.finish(f.session,begun.browserBinding);
  const row=(await database.pool.query('select * from companion_local.microsoft_connections where actor_id=$1',[f.session.user_id])).rows[0];
  expect(row.token_ciphertext).not.toContain('synthetic-access-token');expect(row.token_ciphertext).not.toContain('synthetic-refresh-token');
  expect((await f.service.status(f.session))).toMatchObject({state:'connected',model_disclosure_enabled:false,selected_calendar_ids:[]});
  expect((await f.care.today(f.session)).checkin).toBeNull();
 });
 it('rejects wrong browser, replay, substituted login and expired authorization',async()=>{
  const f=await fixture(),begun=await f.service.begin(f.session),state=f.latest().state;
  await expect(f.service.callback({state,code:'code'},'wrong-browser')).rejects.toMatchObject({status:400});
  await f.service.callback({state,code:'code'},begun.browserBinding);
  await expect(f.service.callback({state,code:'code'},begun.browserBinding)).rejects.toMatchObject({status:400});
  const another=await f.care.login(f.email,f.password);
  await expect(f.service.finish(another,begun.browserBinding)).rejects.toMatchObject({status:400});
  expect(f.calls.exchange).toBe(0);await f.service.finish(f.session,begun.browserBinding);
  await expect(f.service.finish(f.session,begun.browserBinding)).rejects.toMatchObject({status:400});
  const expired=await f.service.begin(f.session);now=new Date(now.getTime()+600001);
  await expect(f.service.callback({state:f.latest().state,code:'code'},expired.browserBinding)).rejects.toMatchObject({status:400});
 });
 it('denied consent consumes pending authorization without provider text',async()=>{
  const f=await fixture(),begun=await f.service.begin(f.session);
  await expect(f.service.callback({state:f.latest().state,error:'access_denied'},begun.browserBinding)).rejects.toMatchObject({code:'microsoft_connection_cancelled'});
  expect((await database.pool.query('select * from companion_local.microsoft_oauth_pending where actor_id=$1',[f.session.user_id])).rows).toHaveLength(0);
  expect(f.calls.exchange).toBe(0);
 });
 it('callback rechecks original login, account, role and grant; revoked state is erased',async()=>{
  const f=await fixture(),begun=await f.service.begin(f.session);
  await database.pool.query('update companion_local.role_grants set revoked_at=$2 where actor_id=$1',[f.session.user_id,now]);
  await expect(f.service.callback({state:f.latest().state,code:'code'},begun.browserBinding)).rejects.toMatchObject({code:'microsoft_connection_cancelled'});
  expect((await database.pool.query('select * from companion_local.microsoft_oauth_pending where actor_id=$1',[f.session.user_id])).rows).toHaveLength(0);
  expect(f.calls.exchange).toBe(0);
 });
 it('wrong provider tenant or account never stores tokens',async()=>{
  const f=await fixture();f.setTokens({...f.getTokens(),identity:{...f.getTokens().identity,objectId:randomUUID()}});
  await expect(f.connect()).rejects.toMatchObject({status:403});
  expect((await f.service.status(f.session)).state).toBe('disconnected');
 });
 it('persists explicit selected resources, checks revisions and bounds date ranges',async()=>{
  const f=await fixture();await f.connect();
  expect((await f.service.read(f.session,range)).calendars).toHaveLength(0);expect(f.calls.calendar).toBe(0);
  const status=await f.service.status(f.session);
  await expect(f.service.select(f.session,{expected_revision:status.revision,calendar_ids:['other-calendar'],mail_folder_ids:[]})).rejects.toMatchObject({code:'microsoft_resource_unavailable'});
  await f.service.select(f.session,{expected_revision:status.revision,calendar_ids:['calendar-approved'],mail_folder_ids:['folder-approved']});
  await expect(f.service.select(f.session,{expected_revision:status.revision,calendar_ids:[],mail_folder_ids:[]})).rejects.toMatchObject({status:409});
  const restarted=new MicrosoftService(database.pool,f.settings,f.oauth,{clock:()=>now,graph:()=>f.graph});
  const context=await restarted.read(f.session,range);expect(context.calendars[0].result.items[0].subject).toBe('Synthetic appointment');expect(context.mail_folders).toHaveLength(1);
  expect(context.model_disclosure_enabled).toBe(false);expect(context.source).toBe('microsoft');
  await expect(restarted.read(f.session,{...range,end:'2026-11-01T00:00:00Z'})).rejects.toThrow();
 });
 it('refreshes once across concurrent reads and preserves rotated tokens on provider outage',async()=>{
  const f=await fixture();f.setTokens({...f.getTokens(),expiresAt:new Date(now.getTime()+1000).toISOString()});await f.connect();
  await Promise.all([f.service.resources(f.session),f.service.resources(f.session)]);expect(f.calls.refresh).toBe(1);
  now=new Date(now.getTime()+3600000);
  const failing=new MicrosoftService(database.pool,f.settings,f.oauth,{clock:()=>now,graph:()=>({...f.graph,async listCalendars(){throw new MicrosoftGraphError('provider_error',503);}})});
  await expect(failing.resources(f.session)).rejects.toMatchObject({status:502});expect(f.calls.refresh).toBe(2);
  await f.service.resources(f.session);expect(f.calls.refresh).toBe(2);
 });
 it('revocation erases tokens and selected context before another provider read',async()=>{
  const f=await fixture();await f.connect();
  await database.pool.query('update companion_local.role_grants set revoked_at=$2 where actor_id=$1',[f.session.user_id,now]);
  await expect(f.service.read(f.session,range)).rejects.toMatchObject({status:401});
  const row=(await database.pool.query('select * from companion_local.microsoft_connections where actor_id=$1',[f.session.user_id])).rows[0];
  expect(row.token_ciphertext).toBeNull();expect(row.state).toBe('reconnect_required');expect(row.selected_calendar_ids).toEqual([]);
 });
 it('provider revocation requires reconnect and erases encrypted tokens',async()=>{
  const f=await fixture();await f.connect();
  const denied=new MicrosoftService(database.pool,f.settings,f.oauth,{clock:()=>now,graph:()=>({...f.graph,async listCalendars(){throw new MicrosoftGraphError('provider_error',401);}})});
  await expect(denied.resources(f.session)).rejects.toMatchObject({code:'microsoft_reconnect_required'});
  expect((await denied.status(f.session)).state).toBe('reconnect_required');
 });
 it('changed configuration and corrupted ciphertext fail closed',async()=>{
  const f=await fixture();await f.connect();
  const changed=new MicrosoftService(database.pool,{...f.settings,expectedObjectId:randomUUID()},f.oauth,{clock:()=>now,graph:()=>f.graph});
  expect((await changed.status(f.session)).state).toBe('reconnect_required');
  await f.connect();await database.pool.query("update companion_local.microsoft_connections set token_ciphertext='damaged' where actor_id=$1",[f.session.user_id]);
  await expect(f.service.resources(f.session)).rejects.toMatchObject({status:403});
  expect((await f.service.status(f.session)).state).toBe('reconnect_required');
 });
 it('disconnect removes pending and stored credentials; interrupted exchange cannot reconnect',async()=>{
  const f=await fixture();await f.connect();const pending=await f.service.begin(f.session);
  await f.service.callback({state:f.latest().state,code:'code'},pending.browserBinding);
  let release!:()=>void,started!:()=>void;const startedPromise=new Promise<void>(resolve=>{started=resolve;});const paused=new Promise<void>(resolve=>{release=resolve;});
  const slow=new MicrosoftService(database.pool,f.settings,{...f.oauth,async exchangeCode(){started();await paused;return f.getTokens();}},{clock:()=>now,graph:()=>f.graph});
  const finishing=slow.finish(f.session,pending.browserBinding);await startedPromise;await f.service.disconnect(f.session);release();
  await expect(finishing).rejects.toMatchObject({code:'microsoft_connection_cancelled'});
  expect((await f.service.status(f.session)).state).toBe('disconnected');
 });
 it('one abort deadline bounds all Graph reads',async()=>{
  const f=await fixture();await f.connect();
  const bounded=new MicrosoftService(database.pool,f.settings,f.oauth,{clock:()=>now,operationTimeoutMs:25,graph:(_token,_calendars,_folders,signal)=>({...f.graph,listCalendars:()=>new Promise((_resolve,reject)=>{signal!.addEventListener('abort',()=>reject(new MicrosoftGraphError('timeout')),{once:true});})})});
  const start=Date.now();await expect(bounded.resources(f.session)).rejects.toMatchObject({status:502});expect(Date.now()-start).toBeLessThan(2000);
 });
 it('revoking care authorization during code exchange prevents even the identity read',async()=>{
  const f=await fixture(),pending=await f.service.begin(f.session);await f.service.callback({state:f.latest().state,code:'code'},pending.browserBinding);
  let identityReads=0;
  const scoped=new MicrosoftService(database.pool,f.settings,{...f.oauth,async exchangeCode(){await database.pool.query('update companion_local.role_grants set revoked_at=$2 where actor_id=$1',[f.session.user_id,now]);return f.getTokens();}},{clock:()=>now,graph:()=>({...f.graph,async verifyIdentity(){identityReads++;return f.graph.verifyIdentity();}})});
  await expect(scoped.finish(f.session,pending.browserBinding)).rejects.toMatchObject({status:401});expect(identityReads).toBe(0);
  expect((await database.pool.query('select * from companion_local.microsoft_oauth_pending where actor_id=$1',[f.session.user_id])).rows).toHaveLength(0);
 });
 it('backup accepts pre-connector schemas and excludes restorable provider credentials',async()=>{
  const f=await fixture();await f.connect();
  const snapshot=await exportSnapshot(database.pool,'synthetic-source','companion_local');
  expect(snapshot.tables).not.toHaveProperty('microsoft_connections');expect(snapshot.tables).not.toHaveProperty('microsoft_oauth_pending');
  expect(JSON.stringify(snapshot)).not.toContain('synthetic-access-token');
  const prior={...snapshot,schema_hash:schemaHash('companion_local',false,'017_food_focus.sql')};
  expect(decryptSnapshot(encryptSnapshot(prior,f.settings.encryptionKey),f.settings.encryptionKey).schema_hash).toBe(prior.schema_hash);
 });
});
