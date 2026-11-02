import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {MicrosoftGraphClient,type MicrosoftGraphOptions} from '../src/server/microsoft/graph.js';
import {MicrosoftService,type MicrosoftServiceConfig} from '../src/server/microsoft/service.js';
import {MICROSOFT_CALENDAR_READ_SHARED_SCOPES,type MicrosoftTokenSet} from '../src/server/microsoft/oauth.js';
import {openMicrosoftSecret} from '../src/server/microsoft/credential-storage.js';
import {canonicalJson} from '../src/server/local-authority.js';
import {createMicrosoftFixture,microsoftTestDatabase} from './helpers/microsoft-fixture.js';

const signerId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ownerId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const now=new Date('2026-11-01T14:00:00Z'),range={start:'2026-11-01T04:00:00Z',end:'2026-11-08T05:00:00Z'};
const signer={id:signerId,displayName:'Synthetic signer',mail:'signer@example.invalid',userPrincipalName:'signer@example.invalid'};
const calendar={id:'target-default',name:'Synthetic target calendar',owner:{address:'target@example.invalid',name:'Synthetic target'},canEdit:true,isDefaultCalendar:true,changeKey:'v1'};
const event={id:'target-event',subject:'Synthetic target noon visit',start:{dateTime:'2026-11-02T17:00:00',timeZone:'UTC'},end:{dateTime:'2026-11-02T18:00:00',timeZone:'UTC'},isAllDay:false,isCancelled:false,type:'singleInstance'};
const options:MicrosoftGraphOptions={accessToken:'synthetic-shared-access',expectedAccountId:signerId,accessMode:'calendar_read_shared',calendarOwnerId:ownerId,allowedCalendarIds:[calendar.id],allowedMailFolderIds:['folder-never-read'],clock:()=>now};
function route(url:URL,actualSigner=signerId){
 if(url.pathname==='/v1.0/me')return Response.json({...signer,id:actualSigner});
 if(url.pathname===`/v1.0/users/${ownerId}/calendar`||url.pathname===`/v1.0/users/${ownerId}/calendars/${calendar.id}`)return Response.json(calendar);
 if(url.pathname===`/v1.0/users/${ownerId}/calendars/${calendar.id}/calendarView`)return Response.json({value:[event]});
 throw Error('Unexpected synthetic provider path: '+url.pathname);
}
function graph(custom?:(url:URL)=>Response,overrides:Partial<MicrosoftGraphOptions>={}){
 const fetcher=vi.fn<typeof fetch>(async(input,init)=>{expect(init?.method).toBe('GET');return custom?custom(new URL(String(input))):route(new URL(String(input)));});
 return {fetcher,client:new MicrosoftGraphClient({...options,...overrides,fetch:fetcher})};
}

describe('exact shared primary calendar Graph boundary',()=>{
 it('verifies the signer then reads only the configured target default calendar and selected events',async()=>{
  const settings={...options},fetcher=vi.fn<typeof fetch>(async(input,init)=>{expect(init?.method).toBe('GET');return route(new URL(String(input)));});
  const client=new MicrosoftGraphClient({...settings,fetch:fetcher});settings.calendarOwnerId=randomUUID();
  expect((await client.listCalendars()).items.map(item=>item.id)).toEqual([calendar.id]);
  expect((await client.calendarView(calendar.id,range)).items[0].subject).toBe(event.subject);
  expect(fetcher.mock.calls.map(([url])=>new URL(String(url)).pathname)).toEqual([
   '/v1.0/me',`/v1.0/users/${ownerId}/calendar`,`/v1.0/users/${ownerId}/calendars/${calendar.id}`,`/v1.0/users/${ownerId}/calendars/${calendar.id}/calendarView`,
  ]);
  expect(fetcher.mock.calls.every(([url])=>!String(url).includes('/mail')&&!String(url).includes('/users/'+signerId))).toBe(true);
 });
 it.each(['missing','email','same','extra'] as const)('rejects %s target binding before any request',kind=>{
  const value=kind==='missing'?undefined:kind==='email'?'target@example.invalid':kind==='same'?signerId.toUpperCase():ownerId;
  expect(()=>graph(undefined,{calendarOwnerId:value,...(kind==='extra'?{accessMode:undefined}:{})})).toThrow();
 });
 it.each(['signer','default-owner','selected-owner','selected-id'] as const)('rejects an inconsistent %s before event retrieval',async kind=>{
  const {client,fetcher}=graph(url=>{
   if(kind==='signer'&&url.pathname==='/v1.0/me')return Response.json({...signer,id:ownerId});
   if(kind==='default-owner'&&url.pathname.endsWith('/calendar'))return Response.json({...calendar,owner:{address:signer.mail}});
   if(kind.startsWith('selected')&&url.pathname.endsWith('/calendars/'+calendar.id))return Response.json(kind==='selected-owner'?{...calendar,owner:{address:'unexpected@example.invalid'}}:{...calendar,id:'different-calendar'});
   return route(url);
  });
  await expect(client.calendarView(calendar.id,range)).rejects.toMatchObject({code:kind==='signer'?'account_mismatch':'resource_denied'});
  expect(fetcher.mock.calls.some(([url])=>String(url).includes('calendarView'))).toBe(false);
 });
 it('refuses another allowed calendar that is not the target default and unselected IDs',async()=>{
  const {client,fetcher}=graph(undefined,{allowedCalendarIds:[calendar.id,'other-calendar']});
  await expect(client.calendarView('unselected',range)).rejects.toMatchObject({code:'resource_denied'});expect(fetcher).not.toHaveBeenCalled();
  await expect(client.calendarView('other-calendar',range)).rejects.toMatchObject({code:'resource_denied'});
  expect(fetcher.mock.calls.some(([url])=>String(url).includes('calendarView'))).toBe(false);
 });
 it('rejects pagination that changes the target mailbox even when only one page would be shown',async()=>{
  const {client}=graph(url=>{
   if(url.pathname.endsWith('/calendarView')){const next=new URL(url);next.pathname=next.pathname.replace(ownerId,signerId);next.searchParams.set('$skiptoken','synthetic');return Response.json({value:[event],'@odata.nextLink':next.href});}
   return route(url);
  },{limits:{maxPages:1}});
  await expect(client.calendarView(calendar.id,range)).rejects.toMatchObject({code:'unsafe_pagination'});
 });
 it.each(['calendar_read','calendar_read_shared'] as const)('refuses every mail and write method before a request in %s mode',async accessMode=>{
  const {client,fetcher}=graph(undefined,{accessMode,calendarOwnerId:accessMode==='calendar_read_shared'?ownerId:undefined});
  const actions=[()=>client.listMailFolders(),()=>client.listMessages('folder-never-read',range),()=>client.searchMessages('folder-never-read',{query:'appointment'}),()=>client.getMessage('folder-never-read','message'),
   ()=>client.createMailDraft({kind:'send_mail',to:['test@example.invalid'],subject:'No send',body:'Synthetic'}),()=>client.sendCreatedDraft('draft'),()=>client.inspectCreatedMessage('draft'),
   ()=>client.createCalendarEvent({kind:'create_event',calendar_id:calendar.id,subject:'No create',start:range.start,end:range.end,attendees:[]},randomUUID())];
  for(const action of actions)await expect(action()).rejects.toMatchObject({code:'resource_denied'});
  expect(fetcher).not.toHaveBeenCalled();
 });
 it('preserves a target access denial instead of substituting the signer calendar',async()=>{
  const {client,fetcher}=graph(url=>url.pathname==='/v1.0/me'?Response.json(signer):Response.json({error:{code:'ErrorAccessDenied'}},{status:403}));
  await expect(client.listCalendars()).rejects.toMatchObject({code:'provider_error',status:403});
  expect(fetcher.mock.calls.map(([url])=>new URL(String(url)).pathname)).toEqual(['/v1.0/me',`/v1.0/users/${ownerId}/calendar`]);
 });
});

describe('shared calendar service credentials and care authorization',()=>{
 let database:Awaited<ReturnType<typeof microsoftTestDatabase>>;
 beforeAll(async()=>{database=await microsoftTestDatabase();});afterAll(async()=>database.close());afterEach(()=>vi.unstubAllGlobals());
 async function fixture(){
  const primary=await createMicrosoftFixture(database.pool,()=>now);await primary.connect();
  const settings:MicrosoftServiceConfig={...primary.settings,accessMode:'calendar_read_shared',calendarOwnerId:ownerId,modelUseApproved:true,preparationApproved:true,reviewedWritesApproved:true};
  let tokens:MicrosoftTokenSet={...primary.getTokens(),accessToken:'synthetic-shared-access',refreshToken:'synthetic-shared-refresh',scopes:[...MICROSOFT_CALENDAR_READ_SHARED_SCOPES]};
  const oauth={...primary.oauth,exchangeCode:vi.fn(async()=>tokens),refreshTokens:vi.fn(async()=>tokens)};
  const fetcher=vi.fn<typeof fetch>(async(input,init)=>{expect(init?.method).toBe('GET');expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-shared-access');return route(new URL(String(input)),settings.expectedObjectId);});
  vi.stubGlobal('fetch',fetcher);
  const service=new MicrosoftService(database.pool,settings,oauth,{clock:()=>now});
  const connect=async()=>{const started=await service.begin(primary.session);await service.callback({state:primary.latest().state,code:'synthetic-shared-code'},started.browserBinding);await service.finish(primary.session,started.browserBinding);};
  const select=async()=>service.select(primary.session,{expected_revision:(await service.status(primary.session)).revision,calendar_ids:[calendar.id],mail_folder_ids:[]});
  const row=async(table:'microsoft_connections'|'microsoft_calendar_connections')=>(await database.pool.query('select * from companion_local.'+table+' where actor_id=$1',[primary.settings.actorId])).rows[0];
  return {primary,settings,oauth,fetcher,service,connect,select,row,setTokens:(value:MicrosoftTokenSet)=>{tokens=value;},getTokens:()=>tokens};
 }
 it('keeps the existing signer connection intact while shared reads use the separate target-only store',async()=>{
  const f=await fixture(),before=await f.row('microsoft_connections');await f.connect();await f.select();
  expect(await f.service.status(f.primary.session)).toMatchObject({access_mode:'calendar_read_shared',reviewed_writes_enabled:false,selected_mail_folder_ids:[]});
  const context=await f.service.conversationContext(f.primary.session,range,'calendar');
  expect(context).toMatchObject({state:'fresh',source_scope:'calendar',calendars:[{id:calendar.id,events:[{subject:event.subject}]}],mail_folders:[]});
  expect((await f.service.preparedContext(f.primary.session,range,'calendar')).state).toBe('prepared');
  expect(await f.row('microsoft_connections')).toEqual(before);
  expect(f.fetcher.mock.calls.every(([url])=>new URL(String(url)).pathname==='/v1.0/me'||new URL(String(url)).pathname.startsWith(`/v1.0/users/${ownerId}/calendar`))).toBe(true);
  const session=f.primary.session,calls=f.fetcher.mock.calls.length;
  for(const action of [()=>f.service.conversationMessage(session,'folder','message'),()=>f.service.conversationMailSearch(session,{query:'appointment'}),()=>f.service.conversationContext(session,range,'inbox'),()=>f.service.prepareAction(session,{}),()=>f.service.confirmAction(session,{}),()=>f.service.actionReview(session,randomUUID()),()=>f.service.actionReceipt(session,randomUUID(),true),()=>f.service.recentActions(session)])await expect(action()).rejects.toMatchObject({status:403});
  expect(f.fetcher).toHaveBeenCalledTimes(calls);
  await f.service.disconnect(session);expect(await f.row('microsoft_connections')).toEqual(before);
 });
 it('binds ciphertext and configuration to signer, shared mode and exact target, preserving primary bytes on target change',async()=>{
  const f=await fixture(),primaryBefore=await f.row('microsoft_connections');await f.connect();await f.select();
  const stored=await f.row('microsoft_calendar_connections'),c=f.settings,base={actorId:c.actorId,participantId:c.participantId,tenantId:c.tenantId,objectId:c.expectedObjectId};
  expect(stored.configuration_fingerprint).toBe(createHash('sha256').update(canonicalJson([c.tenantId,c.clientId,c.expectedObjectId,c.actorId,c.participantId,c.redirectUri,'calendar_read_shared',ownerId])).digest('hex'));
  expect(JSON.parse(openMicrosoftSecret(stored.token_ciphertext,c.encryptionKey,{...base,connectionId:'calendar_read_shared:'+ownerId+':'+stored.id}))).toEqual(f.getTokens());
  for(const connectionId of [stored.id,'calendar_read:'+stored.id,'calendar_read_shared:'+randomUUID()+':'+stored.id])expect(()=>openMicrosoftSecret(stored.token_ciphertext,c.encryptionKey,{...base,connectionId})).toThrow();
  const changed=new MicrosoftService(database.pool,{...c,calendarOwnerId:randomUUID()},f.oauth,{clock:()=>now});
  expect((await changed.status(f.primary.session)).state).toBe('reconnect_required');expect((await f.row('microsoft_calendar_connections')).token_ciphertext).toBeNull();expect(await f.row('microsoft_connections')).toEqual(primaryBefore);
 });
 it.each(['own-read','write','mail','other-signer'] as const)('rejects incompatible %s token before any Graph access or shared credential persistence',async kind=>{
  const f=await fixture(),tokens=f.getTokens(),before=await f.row('microsoft_connections');
  f.setTokens(kind==='other-signer'?{...tokens,identity:{...tokens.identity,objectId:ownerId}}:{...tokens,scopes:kind==='own-read'?['User.Read','Calendars.Read']:[...tokens.scopes,kind==='write'?'Calendars.ReadWrite.Shared':'Mail.Read']});
  await expect(f.connect()).rejects.toMatchObject({status:403});expect(f.fetcher).not.toHaveBeenCalled();expect(await f.row('microsoft_calendar_connections')).toBeUndefined();expect(await f.row('microsoft_connections')).toEqual(before);
 });
 it('does not route a pending callback to another target with the same signer',async()=>{
  const f=await fixture();await f.service.begin(f.primary.session);const state=f.primary.latest().state;
  const changed=new MicrosoftService(database.pool,{...f.settings,calendarOwnerId:randomUUID()},f.oauth,{clock:()=>now});
  expect(await f.service.ownsCallbackState(state)).toBe(true);expect(await changed.ownsCallbackState(state)).toBe(false);expect(f.fetcher).not.toHaveBeenCalled();
 });
});
