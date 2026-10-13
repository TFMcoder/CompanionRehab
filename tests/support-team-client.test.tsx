// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SupportTeam, type SupportTeamClientService } from '../src/client/SupportTeam.js';
import type { SupportCommand, SupportWorkspace } from '../src/shared/support-contracts.js';

afterEach(cleanup);
function serviceFor(view:SupportWorkspace) {
  const command=vi.fn(async(_input:SupportCommand)=>({command_id:'saved',result:{},replayed:false}));
  const service:SupportTeamClientService={workspace:vi.fn(async()=>view),command,receipt:vi.fn(async()=>null)};
  return {service,command};
}
const base:SupportWorkspace={role:'client',local_date:'2026-10-13',time_zone:'America/Toronto',can_view_tasks:true,can_view_meals:true,progress_status:'unavailable',
  shares:[],preferences:null,items:[],next_items_cursor:null,notifications:[],next_notifications_cursor:null,notifications_quiet:false};
describe('Support Team direct view',()=>{
  it('shows a persistent Nancy entry and keeps task, meal and progress sharing separate',async()=>{
    const {service,command}=serviceFor({...base,shares:[{actor_id:'b7de6e1e-36a8-481d-a8e9-eb908f85df2a',role:'family_friend',label:'family@example.invalid',share_tasks:false,share_meals:false,share_progress:false,revision:0}]});
    const onTalk=vi.fn();render(<SupportTeam service={service} scopeKey="client" onTalk={onTalk} />);
    await screen.findByText(/family@example.invalid/);
    expect(screen.queryByText('Progress sharing is not available yet.')).toBeNull();
    fireEvent.click(screen.getByText('Talk to Nancy'));expect(onTalk).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByLabelText('Meals'));
    fireEvent.click(screen.getByText('Save sharing'));
    await waitFor(()=>expect(command).toHaveBeenCalledWith(expect.objectContaining({type:'set_support_share',share_tasks:false,share_meals:true,share_progress:false,expected_revision:0})));
  });
  it('lets each recipient choose meal alerts and shows quiet status without a fabricated alert',async()=>{
    const {service,command}=serviceFor({...base,role:'family_friend',can_view_tasks:false,can_view_meals:true,notifications_quiet:true,
      preferences:{revision:0,task_completion:false,meal_completion:false,task_reschedule:false,meal_reschedule:false,quiet_start:null,quiet_end:null,time_zone:'America/Toronto'}});
    render(<SupportTeam service={service} scopeKey="family" onTalk={()=>{}} />);
    await screen.findByText('Quiet hours are on. Alerts will appear afterward.');
    fireEvent.click(screen.getByLabelText('Meal completed'));
    fireEvent.click(screen.getByText('Save alert choices'));
    await waitFor(()=>expect(command).toHaveBeenCalledWith(expect.objectContaining({type:'set_support_notifications',meal_completion:true,task_completion:false})));
    expect(screen.queryByText(/Private/)).toBeNull();
  });
  it('shows shared timestamps in the client timezone when the recipient uses a different zone',async()=>{
    const {service}=serviceFor({...base,role:'family_friend',items:[{id:'task-1',kind:'task',title:'Afternoon walk',local_date:'2026-10-13',
      scheduled_at:'2026-10-13T20:00:00.000Z',urgency:'medium',meal_slot:null,status:'planned',occurred_at:null}],
      preferences:{revision:0,task_completion:false,meal_completion:false,task_reschedule:false,meal_reschedule:false,
        quiet_start:null,quiet_end:null,time_zone:'America/Los_Angeles'}});
    render(<SupportTeam service={service} scopeKey="family" onTalk={()=>{}} />);
    await screen.findByText('Afternoon walk');
    expect(screen.getByText('Times shown in the client’s time zone (America/Toronto).')).toBeTruthy();
    expect(screen.getByText(/Quiet hours use the time zone below/)).toBeTruthy();
    expect(screen.getByText(/Oct 13, 2026.*4:00/i)).toBeTruthy();
    expect(screen.queryByText(/1:00/i)).toBeNull();
  });
});
