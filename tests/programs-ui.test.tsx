// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Programs, type ProgramClientService } from '../src/client/Programs';
import type { ProgramWorkspace } from '../src/shared/program-contracts';

afterEach(cleanup);

it('presents one approved step, requires a reason to skip, and preserves the Talk entry',async()=>{
  vi.stubGlobal('crypto',{randomUUID:()=> '11111111-1111-4111-8111-111111111111'});
  const view:ProgramWorkspace={role:'client',capabilities:[],local_date:'2026-10-13',time_zone:'America/Toronto',sharing:[],capacity:null,
    planning:{task_count:1,meal_count:1,appointment_count:0,requires_acceptance:true},conflicts:[],conflicts_by_version:{},
    versions:[{id:'version-1',definition_id:'definition-1',kind:'routine',title:'Morning',version:1,steps:[
      {id:'first',title:'First step',instruction:'Follow first approved instruction.',optional:true,depends_on:[],estimated_minutes:5},
      {id:'second',title:'Second step',instruction:'Follow second approved instruction.',optional:false,depends_on:['first'],estimated_minutes:5}],
      protected_start:null,protected_end:null,rest_minutes:0,approved:true,approval_ref:'synthetic approval',current:true}],
    runs:[{id:'run-1',definition_id:'definition-1',version_id:'version-1',title:'Morning',local_date:'2026-10-13',status:'active',revision:1,
      current_step:{id:'first',title:'First step',instruction:'Follow first approved instruction.',optional:true,depends_on:[],estimated_minutes:5},
      obsolete:false,blocked_reason:null,pause_reason:null,results:[]}]};
  const service:ProgramClientService={workspace:vi.fn(async()=>view),command:vi.fn(async()=>({command_id:'id',result:'report_program_step',definition_id:null,version_id:null,run_id:'run-1',step_id:'first',revision:2,replayed:false})),receipt:vi.fn()};
  const talk=vi.fn();render(<Programs service={service} scopeKey="scope-1" onTalk={talk}/>);
  expect(await screen.findByText('Follow first approved instruction.')).toBeInTheDocument();
  expect(screen.queryByText('Follow second approved instruction.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Talk to Nancy'}));expect(talk).toHaveBeenCalledOnce();
  expect(screen.getByRole('button',{name:'Skip with reason'})).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Why skip this optional step?'),{target:{value:'Synthetic choice'}});
  fireEvent.click(screen.getByRole('button',{name:'Skip with reason'}));
  await waitFor(()=>expect(service.command).toHaveBeenCalledWith(expect.objectContaining({type:'report_program_step',step_id:'first',outcome:'skipped',reason:'Synthetic choice'})));
});
