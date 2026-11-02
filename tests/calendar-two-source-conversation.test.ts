import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {ConversationService} from '../src/server/conversation.js';
import {reasoningCandidates} from '../src/server/chatgpt-plan/inference.js';
import type {Reasoner} from '../src/server/plan-reasoner.js';
import {MicrosoftService,type MicrosoftServiceConfig} from '../src/server/microsoft/service.js';
import {MicrosoftCalendarSources} from '../src/server/microsoft/calendar-sources.js';
import {MICROSOFT_CALENDAR_READ_SCOPES,type MicrosoftTokenSet} from '../src/server/microsoft/oauth.js';
import {outlookDateRange} from '../src/server/microsoft/conversation.js';
import type {GraphCalendarEvent,GraphCollection,GraphDateRange} from '../src/server/microsoft/graph.js';
import {createMicrosoftFixture,microsoftTestDatabase} from './helpers/microsoft-fixture.js';

/** Actual care, connection storage, aggregate and conversation; providers and model are synthetic. */
describe('two Outlook calendar accounts through the authenticated conversation',()=>{
 let db:Awaited<ReturnType<typeof microsoftTestDatabase>>;
 const services:ConversationService[]=[];
 const network=vi.fn(async()=>{throw Error('This synthetic test must never access a provider or API.');});
 beforeAll(async()=>{db=await microsoftTestDatabase();});
 afterAll(async()=>db.close());
 beforeEach(()=>{network.mockClear();vi.stubGlobal('fetch',network);});
 afterEach(()=>{services.splice(0).forEach(service=>service.close());vi.unstubAllGlobals();expect(network).not.toHaveBeenCalled();});

 async function fixture(connectSecondary=true){
  const now=new Date('2026-11-01T14:00:00Z'),clock=()=>now;
  const f=await createMicrosoftFixture(db.pool,clock);
  const original=(await f.graph.calendarView()).items[0];
  const events:{primary:GraphCalendarEvent[];secondary:GraphCalendarEvent[]}={primary:[],secondary:[]};
  const denied=vi.fn(async()=>{throw Error('A calendar question must not read mail or write to a provider.');});
  const read=(source:keyof typeof events)=>vi.fn(async(id:string,range:GraphDateRange):Promise<GraphCollection<GraphCalendarEvent>>=>{
   expect(id).toBe('calendar-approved');
   return {items:events[source].filter(event=>Date.parse(event.start)<Date.parse(range.end)&&Date.parse(event.end)>Date.parse(range.start)),
    complete:true,truncation:null,fetchedAt:now.toISOString()};
  });
  const primaryRead=read('primary'),secondaryRead=read('secondary');
  const forbidden={listMessages:denied,searchMessages:denied,getMessage:denied,createMailDraft:denied,sendCreatedDraft:denied,inspectCreatedMessage:denied,createCalendarEvent:denied};
  const primaryGraph={...f.graph,...forbidden,calendarView:primaryRead};
  const primary=new MicrosoftService(db.pool,{...f.settings,modelUseApproved:true,reviewedWritesApproved:true},f.oauth,{clock,graph:()=>primaryGraph});
  const settings:MicrosoftServiceConfig={...f.settings,expectedObjectId:randomUUID(),accessMode:'calendar_read',sourceLabel:'Synthetic second calendar',modelUseApproved:true,reviewedWritesApproved:false};
  const tokens:MicrosoftTokenSet={...f.getTokens(),accessToken:'synthetic-secondary-access',refreshToken:'synthetic-secondary-refresh',scopes:[...MICROSOFT_CALENDAR_READ_SCOPES],identity:{tenantId:settings.tenantId,objectId:settings.expectedObjectId}};
  const secondaryGraph={...f.graph,...forbidden,listMailFolders:denied,calendarView:secondaryRead,
   verifyIdentity:async()=>({...await f.graph.verifyIdentity(),id:settings.expectedObjectId})};
  const secondaryOAuth={...f.oauth,exchangeCode:async()=>tokens,refreshTokens:async()=>tokens};
  const secondary=new MicrosoftService(db.pool,settings,secondaryOAuth,{clock,graph:()=>secondaryGraph});
  const connect=async(service:MicrosoftService)=>{const begun=await service.begin(f.session);await service.callback({state:f.latest().state,code:'synthetic-code'},begun.browserBinding);await service.finish(f.session,begun.browserBinding);};
  await connect(primary);
  await primary.select(f.session,{expected_revision:(await primary.status(f.session)).revision,calendar_ids:['calendar-approved'],mail_folder_ids:['folder-approved']});
  if(connectSecondary){await connect(secondary);await secondary.select(f.session,{expected_revision:(await secondary.status(f.session)).revision,calendar_ids:['calendar-approved'],mail_folder_ids:[]});}
  const outlook=new MicrosoftCalendarSources(primary,secondary,clock);
  const respond=vi.fn<Reasoner['respond']>().mockRejectedValue(Error('A bounded calendar read must not use a model.'));
  const reasoner:Reasoner={bind:async scope=>({...scope,route_id:'chatgpt_plan_owner_practice',qualification:'owner_practice',account_binding_id:'synthetic-two-calendar-binding'}),respond};
  const service=new ConversationService(f.care,reasoner,f.session.user_id,clock,undefined,undefined,undefined,undefined,undefined,
   session=>primary.eligible(session),outlook,undefined,reasoningCandidates['sol-low'],true,72,false,false,false,undefined,false,false,undefined,false,false,false,undefined,undefined,undefined,true);
  services.push(service);
  const id=(await service.start(f.session)).session_id;
  const event=(subject:string,id='same-event-id'):GraphCalendarEvent=>({...original,id,subject,start:'2026-11-02T15:00:00Z',end:'2026-11-02T16:00:00Z',fetchedAt:now.toISOString()});
  const changes=async()=>(await db.pool.query('select count(*)::int count from companion_local.append_only_mutations where participant_id=$1',[f.settings.participantId])).rows[0].count;
  return {...f,primary,secondary,outlook,service,respond,primaryRead,secondaryRead,denied,events,event,changes,id};
 }
 const question=' please check my outlook calendar for any appointments.';
 const turn=(f:Awaited<ReturnType<typeof fixture>>)=>f.service.turn(f.id,f.session,randomUUID(),question);
 const noEmptyClaim=(text:string)=>expect(text).not.toMatch(/\bno (?:outlook )?(?:appointments|events|meetings)\b/i);

 it('returns the second account appointment when the primary account is empty for the exact reported request',async()=>{
  const f=await fixture(),before=await f.changes(),week=outlookDateRange('2026-11-01','America/Toronto',7);
  f.events.secondary=[f.event('Synthetic second-account physiotherapy')];
  const reply=await turn(f);
  expect(f.primaryRead).toHaveBeenCalledExactlyOnceWith('calendar-approved',week);
  expect(f.secondaryRead).toHaveBeenCalledExactlyOnceWith('calendar-approved',week);
  expect(reply.text).toContain('Synthetic second-account physiotherapy');
  expect(reply.text).toContain('additional calendar account');expect(reply.text).toContain('next seven days');
  expect(reply.text).toMatch(/November 2|Nov(?:\.)? 2|2026-11-02/);expect(reply.text).toMatch(/10:00\s*a\.?m\.?/i);
  noEmptyClaim(reply.text);expect(reply.changed).toBe(false);
  expect(f.respond).not.toHaveBeenCalled();expect(f.denied).not.toHaveBeenCalled();expect(f.calls.mail).toBe(0);expect(await f.changes()).toBe(before);
 });

 it('reports missing second-account coverage without calling both accounts empty',async()=>{
  const f=await fixture(false),before=await f.changes(),reply=await turn(f);
  expect(reply.text).toContain('incomplete');expect(reply.text).toContain('additional calendar account');
  noEmptyClaim(reply.text);expect(f.primaryRead).toHaveBeenCalledOnce();expect(f.secondaryRead).not.toHaveBeenCalled();
  expect(reply.changed).toBe(false);expect(f.respond).not.toHaveBeenCalled();expect(f.denied).not.toHaveBeenCalled();expect(f.calls.mail).toBe(0);expect(await f.changes()).toBe(before);
 });

 it('invalidates the active conversation when the second account disconnects',async()=>{
  const f=await fixture();f.events.secondary=[f.event('Synthetic appointment before disconnect')];
  expect((await turn(f)).text).toContain('Synthetic appointment before disconnect');
  await f.secondary.disconnect(f.session);
  expect((await f.primary.status(f.session)).state).toBe('connected');
  await expect(turn(f)).rejects.toMatchObject({code:'scope_changed'});
  await expect(f.service.speech(f.id,f.session,randomUUID())).rejects.toMatchObject({code:'conversation_ended'});
  expect(f.primaryRead).toHaveBeenCalledOnce();expect(f.secondaryRead).toHaveBeenCalledOnce();
  expect(f.respond).not.toHaveBeenCalled();expect(f.denied).not.toHaveBeenCalled();
 });

 it('preserves both titles and source labels when calendar and event IDs collide across accounts',async()=>{
  const f=await fixture(),read=vi.spyOn(f.outlook,'conversationContext');
  f.events.primary=[f.event('Synthetic primary dental visit')];f.events.secondary=[f.event('Synthetic secondary rehabilitation visit')];
  const reply=await turn(f),context=await read.mock.results[0].value;
  expect(context.calendars).toEqual([
   expect.objectContaining({id:'calendar-approved',source_key:'primary',events:[expect.objectContaining({id:'same-event-id',subject:'Synthetic primary dental visit'})]}),
   expect.objectContaining({id:'calendar-approved',source_key:'secondary',events:[expect.objectContaining({id:'same-event-id',subject:'Synthetic secondary rehabilitation visit'})]}),
  ]);
  expect(reply.text).toContain('Synthetic primary dental visit');expect(reply.text).toContain('primary Outlook account');
  expect(reply.text).toContain('Synthetic secondary rehabilitation visit');expect(reply.text).toContain('additional calendar account');
  noEmptyClaim(reply.text);expect(f.respond).not.toHaveBeenCalled();expect(f.denied).not.toHaveBeenCalled();expect(f.calls.mail).toBe(0);
 });
});
