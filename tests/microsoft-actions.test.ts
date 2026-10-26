import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {randomUUID,randomBytes} from 'node:crypto';
import {createApp} from '../src/server/app.js';
import {configFromEnv} from '../src/server/config.js';
import {sealSession} from '../src/server/session.js';
import {SessionRevocations} from '../src/server/revocations.js';
import {MicrosoftService} from '../src/server/microsoft/service.js';
import {MicrosoftGraphError} from '../src/server/microsoft/graph.js';
import type {MicrosoftAction} from '../src/shared/microsoft-contracts.js';
import {createMicrosoftFixture,microsoftTestDatabase} from './helpers/microsoft-fixture.js';

describe('reviewed Outlook actions and conversation disclosure',()=>{
 let database:Awaited<ReturnType<typeof microsoftTestDatabase>>;
 let now=new Date('2026-10-19T16:00:00Z');
 beforeAll(async()=>{database=await microsoftTestDatabase();});afterAll(async()=>database.close());
 const email:MicrosoftAction={kind:'send_mail',to:['test@example.invalid'],subject:'Synthetic exact subject',body:'Synthetic exact body; never a care transcript.'};
 const event:MicrosoftAction={kind:'create_event',subject:'Synthetic event',start:'2026-10-19T18:00:00-04:00',end:'2026-10-19T18:15:00-04:00',attendees:['test@example.invalid']};
 async function fixture(){
  const f=await createMicrosoftFixture(database.pool,()=>now);await f.connect();
  await f.service.select(f.session,{expected_revision:(await f.service.status(f.session)).revision,calendar_ids:['calendar-approved'],mail_folder_ids:['folder-approved']});
  let draft:Extract<MicrosoftAction,{kind:'send_mail'}>|undefined,created:Extract<MicrosoftAction,{kind:'create_event'}>|undefined,transaction:string|undefined,sent=false;
  const graph={...f.graph,
   createMailDraft:vi.fn(async(action:Extract<MicrosoftAction,{kind:'send_mail'}>)=>{draft=action;return {id:'created-draft'};}),
   sendCreatedDraft:vi.fn(async()=>{sent=true;}),
   inspectCreatedMessage:vi.fn(async()=>({id:'created-draft',subject:draft!.subject,to:draft!.to,is_draft:!sent,sent_at:sent?now.toISOString():null})),
   createCalendarEvent:vi.fn(async(action:Extract<MicrosoftAction,{kind:'create_event'}>,id:string)=>{created=action;transaction=id;return {id:'created-event'};}),
   getCalendarEvent:vi.fn(async()=>({...((await f.graph.calendarView()).items[0]),id:'created-event',subject:created!.subject,start:created!.start,end:created!.end,transactionId:transaction!,attendees:created!.attendees.map(address=>({address,name:null,type:'required'}))})),
   getMessage:vi.fn(async()=>({...((await f.graph.listMessages()).items[0]),bodyText:'Synthetic lower-trust body'}))
  };
  const settings={...f.settings,modelUseApproved:true,reviewedWritesApproved:true};
  const service=new MicrosoftService(database.pool,settings,f.oauth,{clock:()=>now,graph:()=>graph});
  return {...f,graph,settings,service,restart:()=>new MicrosoftService(database.pool,settings,f.oauth,{clock:()=>now,graph:()=>graph})};
 }
 it('keeps existing consent connected while disclosure and reviewed writes are separately opted in',async()=>{
  const f=await fixture();expect(await f.service.status(f.session)).toMatchObject({state:'connected',model_disclosure_enabled:true,reviewed_writes_enabled:true});
  const disabled=new MicrosoftService(database.pool,{...f.settings,modelUseApproved:false,reviewedWritesApproved:false},f.oauth,{clock:()=>now,graph:()=>f.graph});
  expect(await disabled.status(f.session)).toMatchObject({state:'connected',model_disclosure_enabled:false});
  expect(await disabled.conversationContext(f.session,{start:'2026-10-19T00:00:00Z',end:'2026-10-20T00:00:00Z'})).toMatchObject({state:'not_authorized'});
  await expect(disabled.prepareAction(f.session,{idempotency_key:randomUUID(),action:email})).rejects.toMatchObject({status:403});
  expect(await disabled.authorityRevision(f.session)).not.toBe(await f.service.authorityRevision(f.session));
 });
 it('prepares exact details encrypted at rest without any provider mutation or care acceptance',async()=>{
  const f=await fixture(),id=randomUUID();const review=await f.service.prepareAction(f.session,{idempotency_key:id,action:email});
  expect(review).toMatchObject({action_id:id,action:email,account:'synthetic@example.invalid',time_zone:'America/Toronto'});
  expect(f.graph.createMailDraft).not.toHaveBeenCalled();expect(f.graph.sendCreatedDraft).not.toHaveBeenCalled();
  const records=await database.pool.query('select command,result from companion_local.append_only_mutations where participant_id=$1',[f.settings.participantId]);
  expect(JSON.stringify(records.rows)).not.toContain(email.subject);expect(JSON.stringify(records.rows)).not.toContain('test@example.invalid');expect(JSON.stringify(records.rows)).not.toContain(email.body);
  expect((await f.care.today(f.session)).checkin).toBeNull();
  expect(await f.service.prepareAction(f.session,{idempotency_key:id,action:email})).toEqual(review);
  await expect(f.service.prepareAction(f.session,{idempotency_key:id,action:{...email,subject:'Changed'}})).rejects.toMatchObject({status:409});
 });
 it('sends once after exact confirmation, verifies the sent item and replays only the receipt across restart',async()=>{
  const f=await fixture(),review=await f.service.prepareAction(f.session,{idempotency_key:randomUUID(),action:email});
  const command={action_id:review.action_id,review_token:review.review_token};
  expect(await f.service.confirmAction(f.session,command)).toMatchObject({state:'verified',kind:'send_mail'});
  expect(f.graph.sendCreatedDraft).toHaveBeenCalledWith('created-draft');
  expect(await f.restart().confirmAction(f.session,command)).toMatchObject({state:'verified',replayed:true});
  expect(f.graph.createMailDraft).toHaveBeenCalledTimes(1);expect(f.graph.sendCreatedDraft).toHaveBeenCalledTimes(1);
  expect(await f.service.recentActions(f.session)).toHaveLength(1);
 });
 it('serializes concurrent confirmations into one remote send and durable receipt',async()=>{
  const f=await fixture(),review=await f.service.prepareAction(f.session,{idempotency_key:randomUUID(),action:email}),command={action_id:review.action_id,review_token:review.review_token};
  await Promise.all([f.service.confirmAction(f.session,command),f.service.confirmAction(f.session,command)]);
  expect(f.graph.createMailDraft).toHaveBeenCalledTimes(1);expect(f.graph.sendCreatedDraft).toHaveBeenCalledTimes(1);expect(await f.service.actionReceipt(f.session,review.action_id,true)).toMatchObject({state:'verified'});
 });
 it('creates the exact 15-minute invitation with a stable provider transaction id',async()=>{
  const f=await fixture(),review=await f.service.prepareAction(f.session,{idempotency_key:randomUUID(),action:event});
  expect(review.action).toMatchObject({calendar_id:'calendar-approved',start:'2026-10-19T22:00:00.000Z',end:'2026-10-19T22:15:00.000Z'});
  expect(await f.service.confirmAction(f.session,{action_id:review.action_id,review_token:review.review_token})).toMatchObject({state:'verified',kind:'create_event'});
  expect(f.graph.createCalendarEvent).toHaveBeenCalledWith(review.action,review.action_id);
 });
 it('rejects a forged review token and other roles without provider writes',async()=>{
  const f=await fixture(),review=await f.service.prepareAction(f.session,{idempotency_key:randomUUID(),action:email});
  await expect(f.service.confirmAction(f.session,{action_id:review.action_id,review_token:'0'.repeat(64)})).rejects.toMatchObject({status:409});
  for(const method of ['actionReview','actionReceipt'] as const)await expect(f.service[method](f.admin,review.action_id)).rejects.toMatchObject({status:403});
  await expect(f.service.confirmAction(f.admin,{action_id:review.action_id,review_token:review.review_token})).rejects.toMatchObject({status:403});
  expect(f.graph.createMailDraft).not.toHaveBeenCalled();
 });
 it('invalidates reviews after resource changes without reconnecting or writing',async()=>{
  const f=await fixture(),review=await f.service.prepareAction(f.session,{idempotency_key:randomUUID(),action:event});const before=await f.service.authorityRevision(f.session);
  await f.service.select(f.session,{expected_revision:(await f.service.status(f.session)).revision,calendar_ids:[],mail_folder_ids:['folder-approved']});
  expect(await f.service.authorityRevision(f.session)).not.toBe(before);
  await expect(f.service.confirmAction(f.session,{action_id:review.action_id,review_token:review.review_token})).rejects.toMatchObject({code:'microsoft_review_expired'});
  expect(f.graph.createCalendarEvent).not.toHaveBeenCalled();
 });
 it('expires a review instead of silently accepting its old details',async()=>{
  const f=await fixture(),review=await f.service.prepareAction(f.session,{idempotency_key:randomUUID(),action:email});now=new Date(now.getTime()+16*60000);
  await expect(f.service.confirmAction(f.session,{action_id:review.action_id,review_token:review.review_token})).rejects.toMatchObject({code:'microsoft_review_expired'});expect(f.graph.createMailDraft).not.toHaveBeenCalled();
 });
 it('does not replay an uncertain email send after restart; a later read may reconcile it',async()=>{
  const f=await fixture(),review=await f.service.prepareAction(f.session,{idempotency_key:randomUUID(),action:email}),command={action_id:review.action_id,review_token:review.review_token};
  f.graph.sendCreatedDraft.mockRejectedValueOnce(new MicrosoftGraphError('timeout'));
  expect(await f.service.confirmAction(f.session,command)).toMatchObject({state:'unknown'});
  expect(await f.restart().confirmAction(f.session,command)).toMatchObject({state:'unknown',replayed:true});
  expect(f.graph.sendCreatedDraft).toHaveBeenCalledTimes(1);expect(f.graph.createMailDraft).toHaveBeenCalledTimes(1);
  f.graph.inspectCreatedMessage.mockResolvedValueOnce({id:'created-draft',subject:email.subject,to:email.to,is_draft:false,sent_at:now.toISOString()});
  expect(await f.service.actionReceipt(f.session,review.action_id,true)).toMatchObject({state:'verified'});
 });
 it('never recreates an event when its creation response is lost',async()=>{
  const f=await fixture(),review=await f.service.prepareAction(f.session,{idempotency_key:randomUUID(),action:event}),command={action_id:review.action_id,review_token:review.review_token};
  f.graph.createCalendarEvent.mockRejectedValueOnce(new MicrosoftGraphError('network_error'));
  expect(await f.service.confirmAction(f.session,command)).toMatchObject({state:'unknown'});
  expect(await f.restart().confirmAction(f.session,command)).toMatchObject({state:'unknown',replayed:true});expect(f.graph.createCalendarEvent).toHaveBeenCalledTimes(1);
 });
 it('keeps accepted distinct from verified and never claims recipient delivery',async()=>{
  const f=await fixture(),review=await f.service.prepareAction(f.session,{idempotency_key:randomUUID(),action:email});f.graph.inspectCreatedMessage.mockRejectedValue(new MicrosoftGraphError('provider_error',404));
  const receipt=await f.service.confirmAction(f.session,{action_id:review.action_id,review_token:review.review_token});expect(receipt.state).toBe('accepted');expect(receipt.message).toContain('not yet verified');
 });
 it('uses fresh bounded lower-trust context and reports provider failure without claiming empty results',async()=>{
  const f=await fixture(),range={start:'2026-10-19T00:00:00Z',end:'2026-10-20T00:00:00Z'};
  expect(await f.service.conversationContext(f.session,range)).toMatchObject({state:'fresh',source:'microsoft',calendars:[{complete:true}],mail_folders:[{complete:true}]});
  f.graph.listMessages=async()=>{throw new MicrosoftGraphError('network_error');};
  expect(await f.service.conversationContext(f.session,range)).toMatchObject({state:'unavailable',fetched_at:null});
 });
 it('provides selected calendar context for the home timeline without retrieving Inbox messages',async()=>{
  const f=await fixture(),range={start:'2026-10-19T00:00:00Z',end:'2026-10-20T00:00:00Z'},beforeMail=f.calls.mail;
  expect((await f.service.calendarContext(f.session,range)).calendars).toHaveLength(1);expect(f.calls.mail).toBe(beforeMail);await expect(f.service.calendarContext(f.admin,range)).rejects.toMatchObject({status:403});
 });
 it('rechecks selected folders before disclosing message bodies',async()=>{
  const f=await fixture();expect(await f.service.conversationMessage(f.session,'folder-approved','mail-one')).toMatchObject({body_text:'Synthetic lower-trust body'});
  await expect(f.service.conversationMessage(f.session,'other-folder','mail-one')).rejects.toMatchObject({status:403});expect(f.graph.getMessage).toHaveBeenCalledTimes(1);
 });
 it('rejects unselected calendars, header injection, empty recipients and invalid event ranges',async()=>{
  const f=await fixture();
  for(const action of [{...event,calendar_id:'other-calendar'},{...email,subject:'x\r\nBcc: other@example.invalid'},{...email,to:[]},{...event,end:event.start}])await expect(f.service.prepareAction(f.session,{idempotency_key:randomUUID(),action})).rejects.toThrow();
  expect(f.graph.createMailDraft).not.toHaveBeenCalled();expect(f.graph.createCalendarEvent).not.toHaveBeenCalled();
 });
 it('enforces HTTP authentication, origin and strict typed review/confirm before writing',async()=>{
  // Cookie age and the injected care/provider clocks must describe the same
  // synthetic day; otherwise this fixture expires seven real days after Oct19.
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);
  const f=await fixture(),config=configFromEnv({PUBLIC_ORIGIN:'http://localhost:8787',DATABASE_URL:'postgresql://localhost/synthetic',SESSION_KEY:randomBytes(32).toString('base64')});
  const app=await createApp(config,{care:f.care,microsoft:f.service,revocations:new SessionRevocations()});
  const headers={host:'localhost:8787',origin:'http://localhost:8787',cookie:'nancy_session='+sealSession(f.session,config.sessionKey!)};
  try{
   expect((await app.inject({url:'/api/microsoft/actions',headers:{host:headers.host}})).statusCode).toBe(401);
   expect((await app.inject({method:'POST',url:'/api/microsoft/actions/prepare',headers:{...headers,origin:'https://other.invalid'},payload:{idempotency_key:randomUUID(),action:email}})).statusCode).toBe(403);
   expect((await app.inject({method:'POST',url:'/api/microsoft/actions/prepare',headers,payload:{idempotency_key:randomUUID(),action:{...email,from:'other@example.invalid'}}})).statusCode).toBe(400);
   const prepared=await app.inject({method:'POST',url:'/api/microsoft/actions/prepare',headers,payload:{idempotency_key:randomUUID(),action:email}});expect(prepared.statusCode,prepared.body).toBe(200);const review=prepared.json();
   expect(f.graph.createMailDraft).not.toHaveBeenCalled();
   const confirmed=await app.inject({method:'POST',url:'/api/microsoft/actions/confirm',headers,payload:{action_id:review.action_id,review_token:review.review_token}});expect(confirmed.statusCode,confirmed.body).toBe(200);expect(confirmed.json().state).toBe('verified');
   const receipt=await app.inject({url:'/api/microsoft/actions/'+review.action_id,headers});expect(receipt.statusCode).toBe(200);expect(receipt.json().state).toBe('verified');expect(receipt.body).not.toMatch(/ciphertext|synthetic-access-token|Exact body/);
  }finally{await app.close();vi.useRealTimers();}
 });
});
