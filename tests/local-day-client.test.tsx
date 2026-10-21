// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LocalDayPanel, makeRoutinePlan, type LocalDayClientService } from '../src/client/LocalDayPanel.js';
import { ReminderDelivery, type ReminderClientService } from '../src/client/ReminderDelivery.js';
import type { Today } from '../src/shared/contracts.js';
import type { LocalDayWorkspace } from '../src/shared/local-day-contracts.js';

afterEach(cleanup);
const today:Today={profile:null,local_date:'2026-10-13',tasks:[],meal_options:[],checkin:null};
const workspace:LocalDayWorkspace={local_date:'2026-10-13',time_zone:'America/Toronto',day_revision:0,carryover:[],carryover_history:[],history_truncated:false,next_carryover_before:null,
 preferences:{revision:0,enabled:false,meal_times:{breakfast:null,lunch:null,dinner:null},appointment_lead_minutes:30,quiet_start:'21:00',quiet_end:'08:00',foreground_speech:false,browser_notifications:false},
 routine:null,routine_suggestions:{task_ids:[],meals:[]},prompts:[]};

describe('local day client',()=>{
 it.each(['conversation','visibility'] as const)('does not deliver a late claim after a brief %s interruption has ended',async(kind)=>{
  let release!:(value:any)=>void,state='visible';
  Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>state});
  try{
   const claim=vi.fn(()=>new Promise<any>(resolve=>{release=resolve;})),ack=vi.fn(async()=>({ok:true}));
   const service:ReminderClientService={claim,ack};
   const panel=(active:boolean)=><ReminderDelivery service={service} scopeKey="client" conversationActive={active} onTalk={()=>{}} onActivity={()=>{}} voiceEligible={false}/>;
   const view=render(panel(false));await waitFor(()=>expect(claim).toHaveBeenCalledOnce());
   if(kind==='conversation'){view.rerender(panel(true));view.rerender(panel(false));}
   else {state='hidden';fireEvent(document,new Event('visibilitychange'));state='visible';fireEvent(document,new Event('visibilitychange'));}
   await act(async()=>{release({id:'late',message:'Stale food reminder',state:'claimed',claim_token:'token',due_at:'2026-10-13T12:00:00Z',expires_at:'2026-10-13T12:10:00Z'});});
   expect(screen.queryByText('Stale food reminder')).toBeNull();expect(ack).not.toHaveBeenCalled();
  }finally{Reflect.deleteProperty(document,'visibilityState');}
 });
 it('reviews a context note before saving and retries an uncertain result with the same command',async()=>{
  const command=vi.fn().mockRejectedValueOnce(new Error('Synthetic connection interruption')).mockResolvedValueOnce({proposal:null});
  const service:LocalDayClientService={workspace:vi.fn(async()=>workspace),command,receipt:vi.fn()};
  render(<LocalDayPanel service={service} scopeKey="client" today={today} onTalk={()=>{}} onChanged={()=>{}}/>);
  fireEvent.click(await screen.findByText('Keep in mind for next time'));
  fireEvent.change(screen.getByLabelText('Important context to remember'),{target:{value:'Synthetic context for tomorrow'}});
  await waitFor(()=>expect((screen.getByLabelText('Important context to remember') as HTMLTextAreaElement).value).toBe('Synthetic context for tomorrow'));
  fireEvent.click(screen.getByRole('button',{name:'Review note'}));expect(command).not.toHaveBeenCalled();
  expect((await screen.findByRole('group',{name:'Review context change'})).textContent).toContain('Synthetic context for tomorrow');
  fireEvent.click(screen.getByRole('button',{name:'Save note'}));await screen.findByText('Synthetic connection interruption');
  fireEvent.click(screen.getByRole('button',{name:'Save note'}));await screen.findByText('Saved.');
  expect(command).toHaveBeenCalledTimes(2);expect(command.mock.calls[1][0]).toEqual(command.mock.calls[0][0]);
  expect(command.mock.calls[0][0]).toMatchObject({type:'record_significant_handoff',summary:'Synthetic context for tomorrow',confirmed:true});
 });
 it('requires a review before resolving a saved note',async()=>{
  const view={...workspace,handoffs:[{id:'00000000-0000-4000-8000-000000000001',summary:'Synthetic active context',occurred_at:'2026-10-12T12:00:00Z',source:'client_report' as const,source_actor_id:'actor',recorded_at:'2026-10-12T12:00:00Z',revision:3,status:'active' as const,reviewed_at:null,reviewed_by:null,resolved_at:null,resolution_note:''}]};
  const command=vi.fn(async(_input:unknown)=>({proposal:null} as any)),service:LocalDayClientService={workspace:vi.fn(async()=>view),command,receipt:vi.fn()};
  render(<LocalDayPanel service={service} scopeKey="client" today={today} onTalk={()=>{}} onChanged={()=>{}}/>);
  fireEvent.click(await screen.findByText('Keep in mind for next time'));fireEvent.click(screen.getByRole('button',{name:'Resolve note'}));
  expect(command).not.toHaveBeenCalled();expect(screen.getByRole('group',{name:'Review context change'}).textContent).toContain('no longer includes it in active context');
  fireEvent.click(screen.getByRole('button',{name:'Save note'}));await waitFor(()=>expect(command).toHaveBeenCalledOnce());
  expect(command.mock.calls[0][0]).toMatchObject({type:'review_significant_handoff',expected_revision:3,decision:'resolved',confirmed:true});
 });
 it('can page past an empty unresolved page and displays cancelled history',async()=>{
  const first={...workspace,history_truncated:true,next_carryover_before:'2026-09-12'};
  const second={...workspace,carryover_history:[{source_date:'2026-09-01',source_plan_id:'old-plan',activity_id:'old-activity',task_title:'Call the clinic',decision:'cancel' as const,note:'Already handled',target_date:'2026-10-13',created_at:'2026-10-13T12:00:00Z',proposal_id:null,accepted:false}]};
  const service:LocalDayClientService={workspace:vi.fn(async(before?:string)=>before?second:first),command:vi.fn(),receipt:vi.fn()};
  render(<LocalDayPanel service={service} scopeKey="client" today={today} onTalk={()=>{}} onChanged={()=>{}}/>);
  fireEvent.click(await screen.findByText('Earlier days'));
  expect(await screen.findByText('Past choices')).toBeTruthy();fireEvent.click(screen.getByText('Past choices'));
  expect(screen.getByText(/Call the clinic from 2026-09-01: No longer needed/)).toBeTruthy();
  expect(service.workspace).toHaveBeenCalledWith('2026-09-12');
 });
 it('builds a reviewed routine proposal while retaining current plan tasks and filling all meals',()=>{
  const current:Today={...today,checkin:{id:'check',local_date:'2026-10-13',revision:2,proposal:null,accepted:{id:'accepted',task_ids:['existing'],tasks:[],meals:[
   {slot:'breakfast',option_id:'b',name:'Breakfast'},{slot:'lunch',option_id:'l',name:'Lunch'},{slot:'dinner',option_id:'d',name:'Dinner'}],created_at:'2026-10-13T12:00:00Z',version:1,accepted_at:'2026-10-13T12:00:00Z'}}};
  const result=makeRoutinePlan(current,{...workspace,routine_suggestions:{task_ids:['existing','new'],meals:[{slot:'lunch',option_id:'new-lunch'}]}});
  expect(result).toEqual({task_ids:['existing','new'],meals:[{slot:'breakfast',option_id:'b'},{slot:'lunch',option_id:'new-lunch'},{slot:'dinner',option_id:'d'}]});
  expect(makeRoutinePlan(today,{...workspace,routine_suggestions:{task_ids:['new'],meals:[]}})).toBeNull();
 });
 it('does not acknowledge a claim after conversation takes focus',async()=>{
  let resolveClaim!:(value:any)=>void;const claim=vi.fn(()=>new Promise<any>(resolve=>{resolveClaim=resolve;})),ack=vi.fn(async()=>({ok:true}));
  const service:ReminderClientService={claim,ack};const onActivity=vi.fn();
  const panel=(active:boolean)=><ReminderDelivery service={service} scopeKey="client" conversationActive={active} onTalk={()=>{}} onActivity={onActivity} voiceEligible={false}/>;
  const view=render(panel(false));await waitFor(()=>expect(claim).toHaveBeenCalledOnce());view.rerender(panel(true));
  resolveClaim({id:'one',message:'Lunch reminder',due_at:'2026-10-13T12:00:00Z',expires_at:'2026-10-13T12:10:00Z',state:'claimed',claim_token:'token'});
  await waitFor(()=>expect(screen.queryByText('Lunch reminder')).toBeNull());expect(ack).not.toHaveBeenCalled();
 });
 it('abandons an in-flight claim when the page is hidden or its client scope changes',async()=>{
  let resolveClaim!:(value:any)=>void,state='visible';
  Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>state});
  try{
   const claim=vi.fn().mockImplementationOnce(()=>new Promise<any>(resolve=>{resolveClaim=resolve;})).mockResolvedValue(null),ack=vi.fn(async()=>({ok:true}));
   const service:ReminderClientService={claim,ack};
   const panel=(scope:string)=><ReminderDelivery service={service} scopeKey={scope} conversationActive={false} onTalk={()=>{}} onActivity={()=>{}} voiceEligible={false}/>;
   const view=render(panel('first'));await waitFor(()=>expect(claim).toHaveBeenCalledOnce());
   state='hidden';document.dispatchEvent(new Event('visibilitychange'));view.rerender(panel('second'));
   resolveClaim({id:'old',message:'Old client reminder',due_at:'2026-10-13T12:00:00Z',expires_at:'2026-10-13T12:10:00Z',state:'claimed',claim_token:'old-token'});
   await waitFor(()=>expect(screen.queryByText('Old client reminder')).toBeNull());expect(ack).not.toHaveBeenCalled();
  }finally{Reflect.deleteProperty(document,'visibilityState');}
 });
 it('labels an uncertain claim and acknowledges only the visible text channel',async()=>{
  const service:ReminderClientService={claim:vi.fn().mockResolvedValueOnce({id:'one',message:'Breakfast reminder',due_at:'2026-10-13T12:00:00Z',expires_at:'2026-10-13T12:10:00Z',state:'claimed',claim_token:'token',delivery_uncertain:true,foreground_speech:true,browser_notifications:true}).mockResolvedValue(null),ack:vi.fn(async()=>({ok:true}))};
  render(<ReminderDelivery service={service} scopeKey="client" conversationActive={false} onTalk={()=>{}} onActivity={()=>{}} voiceEligible={false}/>);
  await screen.findByText('This reminder may have appeared earlier. Check it here.');
  await waitFor(()=>expect(service.ack).toHaveBeenCalledWith('one','token','in_app'));
 });
});
