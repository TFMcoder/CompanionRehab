import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {ConversationService} from '../src/server/conversation.js';
import {reasoningCandidates} from '../src/server/chatgpt-plan/inference.js';
import type {Reasoner} from '../src/server/plan-reasoner.js';
import {MicrosoftService} from '../src/server/microsoft/service.js';
import {outlookDateRange} from '../src/server/microsoft/conversation.js';
import type {GraphCalendarEvent,GraphCollection,GraphDateRange} from '../src/server/microsoft/graph.js';
import {createMicrosoftFixture,microsoftTestDatabase} from './helpers/microsoft-fixture.js';

/** Synthetic care/connector integration: no real account, provider or model. */
describe('calendar query repair through the authenticated conversation',()=>{
 let db:Awaited<ReturnType<typeof microsoftTestDatabase>>;
 const services:ConversationService[]=[];
 beforeAll(async()=>{db=await microsoftTestDatabase();});
 afterAll(async()=>db.close());
 afterEach(()=>{services.splice(0).forEach(service=>service.close());});

 async function fixture(selected=true){
  const now=new Date('2026-11-01T14:00:00Z'),clock=()=>now;
  const f=await createMicrosoftFixture(db.pool,clock);await f.connect();
  const original=(await f.graph.calendarView()).items[0];
  let events:GraphCalendarEvent[]=[],outcome:'complete'|'partial'|'unavailable'='complete';
  const calendarView=vi.fn(async(id:string,range:GraphDateRange):Promise<GraphCollection<GraphCalendarEvent>>=>{
   expect(id).toBe('calendar-approved');
   if(outcome==='unavailable')throw Error('Synthetic calendar outage');
   return {items:events.filter(event=>Date.parse(event.start)<Date.parse(range.end)&&Date.parse(event.end)>Date.parse(range.start)),
    complete:outcome==='complete',truncation:outcome==='partial'?'pages':null,fetchedAt:now.toISOString()};
  });
  const graph={...f.graph,calendarView};
  const microsoft=new MicrosoftService(db.pool,{...f.settings,modelUseApproved:true,reviewedWritesApproved:true},f.oauth,{clock,graph:()=>graph});
  await microsoft.select(f.session,{expected_revision:(await microsoft.status(f.session)).revision,calendar_ids:selected?['calendar-approved']:[],mail_folder_ids:['folder-approved']});
  const respond=vi.fn<Reasoner['respond']>().mockRejectedValue(Error('A bounded calendar read must not use a model.'));
  const reasoner:Reasoner={bind:async scope=>({...scope,route_id:'chatgpt_plan_owner_practice',qualification:'owner_practice',account_binding_id:'synthetic-calendar-binding'}),respond};
  const service=new ConversationService(f.care,reasoner,f.session.user_id,clock,undefined,undefined,undefined,undefined,undefined,
   session=>microsoft.eligible(session),microsoft,undefined,reasoningCandidates['sol-low'],true,72,false,false,false,undefined,false,false,undefined,false,false,false,undefined,undefined,undefined,true);
  services.push(service);
  const id=(await service.start(f.session)).session_id;
  const event=(identifier:string,subject:string,start:string,end:string):GraphCalendarEvent=>({...original,id:identifier,subject,start,end,fetchedAt:now.toISOString()});
  const savedChanges=async()=>(await db.pool.query('select count(*)::int count from companion_local.append_only_mutations where participant_id=$1',[f.settings.participantId])).rows[0].count;
  return {...f,service,microsoft,respond,calendarView,id,event,savedChanges,
   setEvents:(value:GraphCalendarEvent[])=>{events=value;},setOutcome:(value:typeof outcome)=>{outcome=value;}};
 }
 const turn=(f:Awaited<ReturnType<typeof fixture>>,text:string,key=randomUUID())=>f.service.turn(f.id,f.session,key,text);
 const noEmptyClaim=(text:string)=>expect(text).not.toMatch(/\bno (?:outlook )?(?:appointments|events|meetings)\b/i);

 it('freshly checks the undated upcoming week after tomorrow history and an empty prepared snapshot',async()=>{
  const f=await fixture(),week=outlookDateRange('2026-11-01','America/Toronto',7),before=await f.savedChanges();
  await f.microsoft.conversationContext(f.session,week,'calendar');
  expect((await f.microsoft.preparedContext(f.session,week,'calendar')).state).toBe('prepared');
  const tomorrow=await turn(f,'Check my Outlook calendar for tomorrow.');
  expect(tomorrow.text).toMatch(/November 2|Nov(?:\.)? 2|2026-11-02/);
  // Re-establish a broader empty cache after the previous tomorrow conversation.
  await f.microsoft.conversationContext(f.session,week,'calendar');
  f.setEvents([
   f.event('monday','Synthetic physiotherapy visit','2026-11-02T15:00:00Z','2026-11-02T16:00:00Z'),
   f.event('wednesday','Synthetic library meeting','2026-11-04T18:00:00Z','2026-11-04T19:00:00Z'),
  ]);
  const readsBefore=f.calendarView.mock.calls.length;
  const reply=await turn(f,' please check my outlook calendar for any appointments.');
  expect(f.calendarView).toHaveBeenCalledTimes(readsBefore+1);
  expect(f.calendarView.mock.lastCall).toEqual(['calendar-approved',week]);
  expect(week).toEqual({start:'2026-11-01T00:00:00-04:00',end:'2026-11-08T00:00:00-05:00'});
  expect(Date.parse(week.end)-Date.parse(week.start)).toBe(169*3600000);
  expect(reply.text).toContain('Synthetic physiotherapy visit');
  expect(reply.text).toContain('Synthetic library meeting');
  expect(reply.text).toMatch(/November 2|Nov(?:\.)? 2|2026-11-02/);
  expect(reply.text).toMatch(/November 4|Nov(?:\.)? 4|2026-11-04/);
  noEmptyClaim(reply.text);expect(reply.changed).toBe(false);
  expect(f.respond).not.toHaveBeenCalled();expect(f.calls.mail).toBe(0);
  expect(await f.savedChanges()).toBe(before);
 });

 it('preserves an explicit tomorrow date and does not disclose the rest of a cached week',async()=>{
  const f=await fixture(),week=outlookDateRange('2026-11-01','America/Toronto',7);
  f.setEvents([
   f.event('tomorrow','Synthetic Monday appointment','2026-11-02T15:00:00Z','2026-11-02T16:00:00Z'),
   f.event('later','UNRELATED_WEDNESDAY_APPOINTMENT','2026-11-04T18:00:00Z','2026-11-04T19:00:00Z'),
  ]);
  await f.microsoft.conversationContext(f.session,week,'calendar');
  const reply=await turn(f,'Please check my Outlook calendar for any appointments tomorrow.');
  expect(f.calendarView.mock.lastCall).toEqual(['calendar-approved',outlookDateRange('2026-11-02','America/Toronto')]);
  expect(reply.text).toContain('Synthetic Monday appointment');
  expect(reply.text).not.toContain('UNRELATED_WEDNESDAY_APPOINTMENT');
  expect(reply.text).toMatch(/November 2|Nov(?:\.)? 2|2026-11-02/);
  expect(f.respond).not.toHaveBeenCalled();expect(f.calls.mail).toBe(0);
 });

 it.each(['partial','unavailable'] as const)('does not call an empty %s calendar complete',async outcome=>{
  const f=await fixture();f.setOutcome(outcome);
  const reply=await turn(f,'Please check my Outlook calendar for any appointments.');
  noEmptyClaim(reply.text);
  expect(reply.text).toMatch(/partial|incomplete|could not|couldn't|cannot|unavailable|not complete|only part|unable/i);
  expect(reply.changed).toBe(false);expect(f.respond).not.toHaveBeenCalled();
 });

 it('does not call a connected account with no selected calendar empty or read its Inbox',async()=>{
  const f=await fixture(false),reply=await turn(f,'Please check my Outlook calendar for any appointments.');
  noEmptyClaim(reply.text);expect(reply.text).toMatch(/select|calendar.*(?:available|connected|approved)|cannot|could not/i);
  expect(f.calendarView).not.toHaveBeenCalled();expect(f.calls.mail).toBe(0);expect(f.respond).not.toHaveBeenCalled();
 });

 it('replays a repeated read receipt without another provider call and rejects changed payloads',async()=>{
  const f=await fixture(),key=randomUUID(),question='Please check my Outlook calendar for any appointments.';
  f.setEvents([f.event('known','Synthetic appointment','2026-11-02T15:00:00Z','2026-11-02T16:00:00Z')]);
  const reply=await turn(f,question,key),reads=f.calendarView.mock.calls.length;
  expect(await turn(f,question,key)).toEqual(reply);expect(f.calendarView).toHaveBeenCalledTimes(reads);
  await expect(turn(f,'Check my Outlook calendar for tomorrow.',key)).rejects.toBeDefined();
  expect(f.respond).not.toHaveBeenCalled();expect(await f.savedChanges()).toBe(0);
 });

 it('refuses a changed selected-resource scope before returning another calendar answer',async()=>{
  const f=await fixture();await turn(f,'Please check my Outlook calendar for any appointments.');
  const reads=f.calendarView.mock.calls.length;
  await f.microsoft.select(f.session,{expected_revision:(await f.microsoft.status(f.session)).revision,calendar_ids:[],mail_folder_ids:['folder-approved']});
  await expect(turn(f,'Check my Outlook calendar for tomorrow.')).rejects.toMatchObject({code:'scope_changed'});
  expect(f.calendarView).toHaveBeenCalledTimes(reads);expect(f.respond).not.toHaveBeenCalled();
 });
});
