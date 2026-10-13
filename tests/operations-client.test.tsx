// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Operations, type OperationsClientService } from '../src/client/Operations.js';
import type { OperationsCommand, OperationsWorkspace } from '../src/shared/operations-contracts.js';

afterEach(cleanup);
function serviceFor(view:OperationsWorkspace) {
  const command=vi.fn(async(_input:OperationsCommand)=>({command_id:'saved',result:{},replayed:false}));
  const service:OperationsClientService={workspace:vi.fn(async()=>view),command,receipt:vi.fn(async()=>null)};
  return {service,command};
}
const base:OperationsWorkspace={role:'administrator',local_date:'2026-10-13',can_view:true,can_manage_local_issues:false,can_view_audit:false,
  operators:[],day:{local_date:'2026-10-13',accepted_plan_version:null,planned_tasks:0,planned_meals:0,completed_tasks:0,completed_meals:0,
    deferred_tasks:0,deferred_meals:0,appointments_scheduled:0,source_as_of:null},
  connector:{state:'not_connected',targets:0,linked_resources:0,held_intents:0,failed_syncs:'unknown',last_sync_at:null},
  held_intents:[],next_cursor:null,audit:[],audit_available:false};
describe('operations direct view',()=>{
  it('keeps Nancy available and separates view, issue and audit permissions',async()=>{
    const actor='f807da12-cb3b-4b68-9161-d72c82027215';
    const {service,command}=serviceFor({...base,role:'client',can_view:false,day:null,connector:null,
      operators:[{actor_id:actor,label:'operator@example.invalid',revision:0,can_view:false,can_manage_local_issues:false,can_view_audit:false}]});
    const onTalk=vi.fn();render(<Operations service={service} scopeKey="client" onTalk={onTalk} />);
    await screen.findByText('operator@example.invalid');
    fireEvent.click(screen.getByText('Talk to Nancy'));expect(onTalk).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByLabelText('View operations'));
    fireEvent.click(screen.getByLabelText('Review local issues'));
    fireEvent.click(screen.getByText('Save operator access'));
    await waitFor(()=>expect(command).toHaveBeenCalledWith(expect.objectContaining({type:'set_operations_access',actor_id:actor,
      can_view:true,can_manage_local_issues:true,can_view_audit:false,expected_revision:0})));
  });
  it('shows held intent review without an external retry control',async()=>{
    const intent='1f23a461-386f-4788-af16-65182e35ad38';
    const {service,command}=serviceFor({...base,can_manage_local_issues:true,connector:{...base.connector!,held_intents:1},
      held_intents:[{id:intent,created_at:'2026-10-13T12:00:00Z',system:'email',provider:'Synthetic provider',operation:'notify',state:'held',
        review_status:'unreviewed',review_revision:0,review_note:null,reviewed_at:null}]});
    render(<Operations service={service} scopeKey="admin" onTalk={()=>{}} />);
    await screen.findByText('email · notify · Synthetic provider');
    expect(screen.getByText('Not connected. No external send or retry is available.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(`Review note for ${intent}`),{target:{value:'Inspect local target.'}});
    fireEvent.click(screen.getByText('Save note'));
    await waitFor(()=>expect(command).toHaveBeenCalledWith(expect.objectContaining({type:'note_held_intent',intent_id:intent,note:'Inspect local target.'})));
    expect(screen.queryByText('Retry')).toBeNull();
  });
});
