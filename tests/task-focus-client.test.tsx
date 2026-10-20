// @vitest-environment jsdom
import { afterEach,describe,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { TaskFocusControls } from '../src/client/TaskFocusControls.js';
import { ReminderDelivery } from '../src/client/ReminderDelivery.js';
import type { LocalDayWorkspace,TaskFocus } from '../src/shared/local-day-contracts.js';
import type { Today } from '../src/shared/contracts.js';
afterEach(cleanup);
const today:Today={profile:null,local_date:'2026-10-14',tasks:[],meal_options:[],checkin:null};
const workspace:LocalDayWorkspace={local_date:'2026-10-14',time_zone:'America/Toronto',day_revision:0,carryover:[],carryover_history:[],history_truncated:false,next_carryover_before:null,preferences:{revision:1,enabled:true,meal_times:{breakfast:null,lunch:null,dinner:null},appointment_lead_minutes:30,quiet_start:'23:00',quiet_end:'06:00',foreground_speech:false,browser_notifications:false},routine:null,routine_suggestions:{task_ids:[],meals:[]},prompts:[],focus:null,focus_options:[{activity_id:'task-one',task_id:'source-one',title:'Sort photos',local_date:'2026-10-14',activity_revision:0,source_version:'f'.repeat(64)}]};
const focus:TaskFocus={id:'focus-one',activity_id:'task-one',task_id:'source-one',title:'Sort photos',local_date:'2026-10-14',revision:2,state:'paused',interval_minutes:25,started_at:'2026-10-14T14:00Z',last_started_at:'2026-10-14T14:00Z',paused_at:'2026-10-14T14:10Z',finished_at:null,check_due_at:'2026-10-14T14:25Z'};
describe('minimal reviewed task focus and reminder responses',()=>{
 it('requires an individually entered interval and retries the same reviewed command',async()=>{
  const command=vi.fn().mockRejectedValueOnce(new Error('Lost response')).mockResolvedValue({result:'saved'}),service={workspace:vi.fn(async()=>workspace),command,receipt:vi.fn()};
  render(<TaskFocusControls service={service} scopeKey="client" today={today} onChanged={()=>{}}/>);await screen.findByText('Work on a task');expect(service.workspace).toHaveBeenCalledOnce();expect((screen.getByLabelText('Focus interval minutes') as HTMLInputElement).value).toBe('');
  fireEvent.change(screen.getByLabelText('Focus task'),{target:{value:'task-one'}});fireEvent.change(screen.getByLabelText('Focus interval minutes'),{target:{value:'25'}});fireEvent.click(screen.getByText('Start focus'));expect(command).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Save choice'));await screen.findByText(/This change is unconfirmed/);fireEvent.click(screen.getByText('Save choice'));await waitFor(()=>expect(command).toHaveBeenCalledTimes(2));
  expect(command.mock.calls[0][0]).toEqual(command.mock.calls[1][0]);expect(command.mock.calls[0][0]).toMatchObject({type:'start_task_focus',interval_minutes:25,expected_activity_version:'f'.repeat(64)});
 });
 it('keeps a newer focus state when an earlier read finally returns',async()=>{
  let resolveOld!:(value:LocalDayWorkspace)=>void;const service={workspace:vi.fn().mockImplementationOnce(()=>new Promise<LocalDayWorkspace>(resolve=>{resolveOld=resolve;})).mockResolvedValue({...workspace,focus}),command:vi.fn(),receipt:vi.fn()};
  const view=render(<TaskFocusControls service={service} scopeKey="client" today={today} onChanged={()=>{}}/>);await waitFor(()=>expect(service.workspace).toHaveBeenCalledOnce());
  view.rerender(<TaskFocusControls service={service} scopeKey="client" today={{...today}} onChanged={()=>{}}/>);await screen.findByText('Resume focus');resolveOld(workspace);await waitFor(()=>expect(screen.getByText('Resume focus')).toBeTruthy());expect(screen.queryByText('Start focus')).toBeNull();
  fireEvent.click(screen.getByText('Stop focusing'));expect(service.command).not.toHaveBeenCalled();expect(screen.getByText(/This does not report the task complete/)).toBeTruthy();
 });
 it('snoozes using a durable response command and keeps its key after an uncertain save',async()=>{
  const respond=vi.fn().mockRejectedValueOnce(new Error('Lost')).mockResolvedValue({result:'saved'}),claim=vi.fn().mockResolvedValueOnce({id:'prompt-one',message:'Have you eaten?',due_at:'2026-10-14T16:00Z',expires_at:'2026-10-14T16:10Z',state:'claimed',claim_token:'token',response_revision:2}).mockResolvedValue(null);
  render(<ReminderDelivery service={{claim,respond,ack:vi.fn(async()=>({ok:true}))}} scopeKey="client" conversationActive={false} onTalk={()=>{}} onActivity={()=>{}} voiceEligible={false}/>);
  await screen.findByText('Have you eaten?');fireEvent.change(screen.getByLabelText('Snooze minutes'),{target:{value:'30'}});fireEvent.click(screen.getByText('Snooze'));await screen.findByText(/That choice is unconfirmed/);fireEvent.click(screen.getByText('Snooze'));await waitFor(()=>expect(respond).toHaveBeenCalledTimes(2));expect(respond.mock.calls[0][0]).toEqual(respond.mock.calls[1][0]);expect(respond.mock.calls[0][0]).toMatchObject({type:'respond_prompt',expected_revision:2,decision:'snooze',snooze_minutes:30});
 });
 it('restores delivered text once on reopening without claiming, acknowledging or speaking again',async()=>{
  const resume=vi.fn(async()=>({id:'prompt-one',message:'Restored focus check',due_at:'2026-10-14T14:21Z',expires_at:'2026-10-14T14:31Z',state:'delivered',restored:true,response_revision:1,foreground_speech:false,browser_notifications:false})),claim=vi.fn(),ack=vi.fn(),onActivity=vi.fn();
  render(<ReminderDelivery service={{resume,claim,ack}} scopeKey="client" conversationActive={false} onTalk={()=>{}} onActivity={onActivity} voiceEligible={true}/>);await screen.findByText('Restored focus check');
  expect(resume).toHaveBeenCalledOnce();expect(claim).not.toHaveBeenCalled();expect(ack).not.toHaveBeenCalled();expect(onActivity).not.toHaveBeenCalledWith(true);
 });
});
