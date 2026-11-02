import {describe,it,expect} from 'vitest';
import {medicalAppointmentContext,isMedicalAppointmentTask,isMedicalAppointmentRequest} from '../src/shared/medical-appointments.js';
import {priorityContext} from '../src/shared/priority-context.js';
import type {Today} from '../src/shared/contracts.js';
const now=new Date('2026-10-26T18:12:00Z'),base:Today={profile:{id:'synthetic',display_name:'Synthetic',time_zone:'America/Toronto',preferences:'',revision:1},local_date:'2026-10-26',tasks:[],meal_options:[],checkin:null};
describe('medical appointment administration context',()=>{
 it('keeps same-ID appointments from separate approved accounts distinct and labels their source',()=>{
  const event={id:'same-event',subject:'Clinic visit',start:'2026-10-28T14:00:00Z',end:'2026-10-28T15:00:00Z'};
  const source={source:'microsoft',state:'fresh',fetched_at:now.toISOString(),coverage_complete:true,calendars:[
   {id:'same-calendar',source_key:'primary',source_label:'Primary approved account',complete:true,events:[event]},
   {id:'same-calendar',source_key:'secondary',source_label:'Additional approved account',complete:true,events:[{...event,subject:'Dentist appointment',start:'2026-10-28T16:00:00Z',end:'2026-10-28T17:00:00Z'}]},
  ]};
  const context=medicalAppointmentContext(base,[source,source],now);
  expect(context.calendar_entries).toHaveLength(2);
  expect(context.calendar_entries[0]).toMatchObject({source_key:'primary',source_label:'Primary approved account',id:'same-event',title:'Clinic visit'});
  expect(context.calendar_entries[1]).toMatchObject({source_key:'secondary',source_label:'Additional approved account',id:'same-event',title:'Dentist appointment'});
  expect(context.source_checks[0].calendars_complete).toBe(true);
 });
 it('never marks appointment coverage complete when only an empty primary calendar was checked',()=>{
  const coverage=[{source_key:'primary',label:'Primary approved account',state:'fresh',available:true},{source_key:'secondary',label:'Additional approved account',state:'not_authorized',available:false}];
  const source={source:'microsoft',state:'fresh',fetched_at:now.toISOString(),coverage_complete:false,calendar_coverage:coverage,calendars:[{id:'cal',complete:true,events:[]}]};
  const context=medicalAppointmentContext(base,[source],now);
  expect(context.calendar_entries).toEqual([]);expect(context.source_checks[0]).toMatchObject({calendars_complete:false,calendar_coverage:coverage,mail_complete:null});
 });
 it('keeps missing-source coverage incomplete even when no calendar results are available',()=>{
  const source={source:'microsoft',state:'unavailable',coverage_complete:false,calendars:[]};
  expect(medicalAppointmentContext(base,[source],now).source_checks[0].calendars_complete).toBe(false);
 });
 it.each(['Call clinic to confirm appointment','Book dentist appointment','Prepare travel for physiotherapy session','Arrange specialist follow-up'])('recognizes an administrative task: %s',title=>expect(isMedicalAppointmentTask(title)).toBe(true));
 it.each(['Read medical newsletter','Buy a gift for my doctor','Discuss the history of therapy','Medical webinar booking'])('does not treat general material as appointment administration: %s',title=>expect(isMedicalAppointmentTask(title)).toBe(false));
 it('keeps possible appointment email distinct from a calendar entry, a reply obligation and clinical urgency',()=>{
  const source={source:'microsoft',state:'fresh',fetched_at:now.toISOString(),calendars:[{id:'cal',complete:true,events:[{id:'visit',subject:'Clinic visit',start:'2026-10-28T14:00:00Z',end:'2026-10-28T15:00:00Z'},{id:'cancelled',subject:'Dentist appointment',start:'2026-10-27T14:00:00Z',cancelled:true}]}],mail_folders:[{id:'inbox',complete:false,messages:[{id:'mail',subject:'Clinic referral appointment',preview:'Could we arrange a consultation?',is_read:false,received_at:'2026-10-25T12:00:00Z'},{id:'unrelated',subject:'Dinner party',preview:'UNRELATED_CONTENT'}]}]};
  const context=medicalAppointmentContext(base,[source],now);expect(context.calendar_entries).toHaveLength(1);expect(context.correspondence).toHaveLength(1);expect(context.correspondence[0]).toMatchObject({id:'mail',booking_status:'unverified',reply_status:'unknown',action_status:'needs_review'});expect(context.source_checks[0].mail_complete).toBe(false);expect(JSON.stringify(context)).not.toContain('UNRELATED_CONTENT');
 });
 it('respects effective local appointment dates, completion and deferral',()=>{
  const appointments=[{id:'moved',title:'Clinic visit',starts_at:'2026-10-27T14:00:00Z'},{id:'done',title:'Dentist appointment',starts_at:'2026-10-26T15:00:00Z'}];
  const today={...base,appointments,activity_reports:[{target_id:'done',local_date:base.local_date,status:'completed' as const,occurred_at:'2026-10-26T15:30:00Z'}]};
  expect(medicalAppointmentContext(today,[],now).calendar_entries.map(e=>e.id)).toEqual(['moved']);expect(medicalAppointmentContext({...today,local_date:'2026-10-25'},[],now).calendar_entries).toEqual([]);
 });
 it('prefers an existing medical appointment task over an optional chore while keeping the food check first',()=>{
  const tasks=[{id:'chore',title:'Fold laundry',time_hint:null,scheduled_time:'09:00'},{id:'clinic',title:'Call clinic to confirm appointment',time_hint:null}];
  const today={...base,tasks,checkin:{id:'check',revision:1,local_date:base.local_date,proposal:null,accepted:{id:'plan',version:1,created_at:now.toISOString(),accepted_at:now.toISOString(),tasks,task_ids:tasks.map(t=>t.id),meals:[]}}};
  const priorities=priorityContext(today,now);expect(priorities.suggestions[0].kind).toBe('intake_check');expect(priorities.suggestions[1].label).toBe(tasks[1].title);expect(priorities.suggestions[1].reason).toContain('client choice');
 });
 it('honors declined medical tasks instead of repeatedly prioritizing them',()=>{
  const today={...base,tasks:[{id:'clinic',title:'Call clinic to confirm appointment',time_hint:null}],activity_reports:[{target_id:'clinic',local_date:base.local_date,status:'deferred' as const,occurred_at:now.toISOString()}]};
  expect(medicalAppointmentContext(today,[],now).tasks).toEqual([]);expect(priorityContext(today,now).suggestions.some(s=>s.label===today.tasks[0].title)).toBe(false);
 });
 it('keeps explicit management requests tool-capable without interpreting ordinary medical discussion as booking intent',()=>{
  expect(isMedicalAppointmentRequest('Help me arrange my clinic appointment')).toBe(true);expect(isMedicalAppointmentRequest('What is the history of medical appointments?')).toBe(false);
 });
});
