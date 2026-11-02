import {describe,it,expect,vi} from 'vitest';
import {MicrosoftCalendarSources} from '../src/server/microsoft/calendar-sources.js';
import type {MicrosoftService} from '../src/server/microsoft/service.js';
import type {Session} from '../src/server/session.js';
import {outlookCalendarReply,strictOutlookRead} from '../src/server/microsoft/fast-read.js';
const now=new Date('2026-11-01T20:00:00Z'),zone='America/Toronto';
const intent=strictOutlookRead('please check my outlook calendar for any appointments.','2026-11-01',zone)!;
const session={} as Session;
function source(subject?:string){
 const snapshot={source:'microsoft',state:'fresh',fetched_at:now.toISOString(),range:intent.range,mail_range:intent.range,
  calendars:[{id:'same-calendar-id',complete:true,omitted:0,truncation:null,fetched_at:now.toISOString(),events:subject?[{id:'event',subject,start:'2026-11-02T17:00:00Z',end:'2026-11-02T18:00:00Z',cancelled:false,all_day:false}]:[]}],mail_folders:[],limitations:[]};
 const port={status:vi.fn(async()=>({available:true,eligible:true,state:'connected',revision:1,selected_calendar_ids:['same-calendar-id'],selected_mail_folder_ids:[],model_disclosure_enabled:true,reviewed_writes_enabled:true})),
  authorityRevision:vi.fn(async()=>'revision-1'),preparedContext:vi.fn(async()=>({...snapshot,state:'prepared'})),conversationContext:vi.fn(async()=>snapshot),
  calendarContext:vi.fn(async()=>({source:'microsoft',fetched_at:now.toISOString(),calendars:[{id:'same-calendar-id',result:{items:snapshot.calendars[0].events,complete:true,truncation:null,fetchedAt:now.toISOString()}}]})),
  conversationMessage:vi.fn(),conversationMailSearch:vi.fn(),prepareAction:vi.fn(),confirmAction:vi.fn(),actionReceipt:vi.fn()};
 return {snapshot,port,service:port as unknown as MicrosoftService};
}
describe('two exact Outlook calendar sources',()=>{
 it('includes the second calendar when the primary is empty and reports the source and local date',async()=>{
  const p=source(),s=source('Synthetic community lunch'),adapter=new MicrosoftCalendarSources(p.service,s.service,()=>now);
  const context=await adapter.conversationContext(session,intent.range,'calendar');
  const reply=outlookCalendarReply(context,intent,zone,now);
  expect(reply).toContain('Synthetic community lunch (additional calendar account)');expect(reply).toContain('12:00');expect(reply).toContain('November 2');
  expect(reply).not.toContain('no appointments');expect(context).toMatchObject({coverage_complete:true});
  expect(p.port.conversationContext).toHaveBeenCalledWith(session,intent.range,'calendar');expect(s.port.conversationContext).toHaveBeenCalledWith(session,intent.range,'calendar');
 });
 it.each(['disconnected','unavailable','not_authorized','not_prepared'])('never treats a %s secondary as an empty calendar',async state=>{
  const p=source(),s=source();s.port.conversationContext.mockResolvedValue({source:'microsoft',state} as typeof s.snapshot);
  const adapter=new MicrosoftCalendarSources(p.service,s.service,()=>now),context=await adapter.conversationContext(session,intent.range,'calendar');
  expect(context).toMatchObject({coverage_complete:false});const reply=outlookCalendarReply(context,intent,zone,now);
  expect(reply).toContain('additional calendar account could not be checked');expect(reply).not.toMatch(/no appointments/);
 });
 it('preserves known positive events while clearly marking missing primary coverage',async()=>{
  const p=source(),s=source('Synthetic lunch');p.port.conversationContext.mockResolvedValue({source:'microsoft',state:'unavailable'} as typeof p.snapshot);
  const adapter=new MicrosoftCalendarSources(p.service,s.service,()=>now),reply=outlookCalendarReply(await adapter.conversationContext(session,intent.range,'calendar'),intent,zone,now);
  expect(reply).toContain('Synthetic lunch');expect(reply).toContain('primary Outlook account could not be checked');expect(reply).toContain('incomplete');
 });
 it('rejects a stale secondary snapshot and an empty selection as complete coverage',async()=>{
  for(const stale of [true,false]){const p=source(),s=source();if(stale)s.snapshot.fetched_at='2026-11-01T19:00:00Z';else s.snapshot.calendars=[];
   const adapter=new MicrosoftCalendarSources(p.service,s.service,()=>now),context=await adapter.preparedContext(session,intent.range,'calendar');
   expect(context).toMatchObject({coverage_complete:false});expect(outlookCalendarReply(context,intent,zone,now)).not.toContain('no appointments');}
 });
 it('propagates changed care authority without partial disclosure',async()=>{
  const p=source(),s=source('PRIVATE_SYNTHETIC');s.port.conversationContext.mockRejectedValue({status:403,code:'microsoft_scope_changed'});
  await expect(new MicrosoftCalendarSources(p.service,s.service,()=>now).conversationContext(session,intent.range,'calendar')).rejects.toMatchObject({status:403});
 });
 it('changes conversation authority when either source changes',async()=>{
  const p=source(),s=source(),adapter=new MicrosoftCalendarSources(p.service,s.service,()=>now),initial=await adapter.authorityRevision(session);
  s.port.authorityRevision.mockResolvedValue('revision-2');expect(await adapter.authorityRevision(session)).not.toBe(initial);
  s.port.authorityRevision.mockResolvedValue('revision-1');p.port.authorityRevision.mockResolvedValue('revision-2');expect(await adapter.authorityRevision(session)).not.toBe(initial);
 });
 it('uses only primary for Inbox, message, search and reviewed actions',async()=>{
  const p=source(),s=source(),adapter=new MicrosoftCalendarSources(p.service,s.service,()=>now);
  await adapter.conversationContext(session,intent.range,'inbox');await adapter.preparedContext(session,intent.range,'inbox');
  await adapter.conversationMessage(session,'folder','message');await adapter.conversationMailSearch(session,{});
  await adapter.prepareAction(session,{} as never);await adapter.confirmAction(session,{} as never);await adapter.actionReceipt(session,'id');
  for(const name of ['conversationContext','preparedContext','conversationMessage','conversationMailSearch','prepareAction','confirmAction','actionReceipt'] as const){expect(p.port[name]).toHaveBeenCalled();expect(s.port[name]).not.toHaveBeenCalled();}
 });
 it('marks the touch timeline partial when the second account has no selected calendar',async()=>{
  const p=source(),s=source();s.port.status.mockResolvedValue({...await s.port.status(),selected_calendar_ids:[]});
  const context=await new MicrosoftCalendarSources(p.service,s.service,()=>now).calendarContext(session,intent.range);
  expect(context.calendars).toHaveLength(2);expect(context.calendars[1].result.complete).toBe(false);expect(s.port.calendarContext).not.toHaveBeenCalled();
 });
 it('keeps touch coverage partial if a calendar is deselected between status and the provider read',async()=>{
  const p=source(),s=source();s.port.calendarContext.mockResolvedValue({source:'microsoft',fetched_at:now.toISOString(),calendars:[]});
  const context=await new MicrosoftCalendarSources(p.service,s.service,()=>now).calendarContext(session,intent.range);
  expect(context.calendars).toHaveLength(2);expect(context.calendars[1].result.complete).toBe(false);
 });
});
