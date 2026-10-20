// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Programs, type ProgramClientService } from '../src/client/Programs';
import type { ProgramReceipt, ProgramWorkspace } from '../src/shared/program-contracts';

afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});

const rehabSteps=[
  {id:'first',title:'First rehab step',instruction:'Do the first approved step.',optional:false,depends_on:[],estimated_minutes:5},
  {id:'second',title:'Second rehab step',instruction:'Do the second approved step.',optional:false,depends_on:['first'],estimated_minutes:5},
] as const;
function rehabView(stepIndex=0):ProgramWorkspace {
  const current=rehabSteps[stepIndex];
  return {role:'client',capabilities:[],local_date:'2026-10-13',time_zone:'America/Toronto',sharing:[],capacity:null,
    planning:{task_count:0,meal_count:0,appointment_count:0,requires_acceptance:true},conflicts:[],conflicts_by_version:{},
    versions:[{id:'rehab-version',definition_id:'rehab-definition',kind:'rehab',title:'Approved rehab',version:1,
      steps:rehabSteps.map(item=>({...item,depends_on:[...item.depends_on]})),protected_start:null,protected_end:null,rest_minutes:0,
      approved:true,approval_ref:'Synthetic approval',current:true}],
    runs:[{id:'rehab-run',definition_id:'rehab-definition',version_id:'rehab-version',title:'Approved rehab',local_date:'2026-10-13',
      status:'active',revision:stepIndex+1,current_step:{...current,depends_on:[...current.depends_on]},obsolete:false,
      blocked_reason:null,pause_reason:null,results:stepIndex?[{step_id:'first',outcome:'completed',reason:'',difficulty:'',assistance:'',notes:'',revision:1,reported_at:'2026-10-13T12:00:00Z'}]:[]}]};
}
const receipt:ProgramReceipt={command_id:'saved-key',result:'report_program_step',definition_id:null,version_id:null,run_id:'rehab-run',step_id:'first',revision:2,replayed:false};
it('refreshes rest eligibility from the server without a reload',async()=>{
 const waiting=rehabView(1);waiting.runs[0].current_step=null;waiting.runs[0].blocked_reason='Rest briefly.';waiting.runs[0].rest_until=new Date(Date.now()+2000).toISOString();
 const service:ProgramClientService={workspace:vi.fn().mockResolvedValueOnce(waiting).mockResolvedValue(rehabView(1)),command:vi.fn(),receipt:vi.fn()};
 vi.useFakeTimers();render(<Programs service={service} scopeKey="scope" onTalk={vi.fn()}/>);await act(async()=>{await Promise.resolve();});
 expect(screen.queryByText('Do the second approved step.')).not.toBeInTheDocument();await act(async()=>{await vi.advanceTimersByTimeAsync(2200);});
 expect(screen.getByText('Do the second approved step.')).toBeInTheDocument();expect(service.workspace).toHaveBeenCalledTimes(2);
});
it.each([true,false])('formats protected-time conflicts in the client zone (active: %s)',async active=>{
 const view=rehabView();view.time_zone='America/Los_Angeles';const conflict={id:'appointment',title:'Appointment fixture',starts_at:'2026-10-13T13:00:00Z'};
 view.conflicts=[conflict];view.conflicts_by_version={'rehab-version':[conflict]};if(!active)view.runs=[];
 const service:ProgramClientService={workspace:vi.fn(async()=>view),command:vi.fn(),receipt:vi.fn()};render(<Programs service={service} scopeKey="scope" onTalk={vi.fn()}/>);
 expect(await screen.findByText(/Appointment fixture · 6:00/)).toBeInTheDocument();expect(screen.getByText('Times are in America/Los_Angeles.')).toBeInTheDocument();
});
it('shows saved results and submits an exact reviewed correction with a reason',async()=>{
 const view=rehabView(1);const service:ProgramClientService={workspace:vi.fn(async()=>view),command:vi.fn(async()=>receipt),receipt:vi.fn()};
 render(<Programs service={service} scopeKey="scope" onTalk={vi.fn()}/>);fireEvent.click(await screen.findByRole('button',{name:'Correct this step result'}));
 expect(screen.getByRole('button',{name:'Save reviewed correction'})).toBeDisabled();fireEvent.change(screen.getByLabelText('Why correct this result?'),{target:{value:'Correct mistaken assistance detail'}});
 fireEvent.change(screen.getByLabelText('Corrected assistance'),{target:{value:'A helper read the instruction'}});fireEvent.click(screen.getByRole('button',{name:'Save reviewed correction'}));
 await waitFor(()=>expect(service.command).toHaveBeenCalledWith(expect.objectContaining({type:'correct_program_step',run_id:'rehab-run',step_id:'first',expected_revision:1,assistance:'A helper read the instruction',correction_reason:'Correct mistaken assistance detail',confirmed:true})));
});

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

it('keeps pause and end reasons separate and clears rehab facts for the next saved step',async()=>{
  vi.stubGlobal('crypto',{randomUUID:()=> '11111111-1111-4111-8111-111111111111'});
  let current=rehabView();
  const service:ProgramClientService={workspace:vi.fn(async()=>current),
    command:vi.fn(async command=>{if(command.type==='report_program_step')current=rehabView(1);return receipt;}),receipt:vi.fn(async()=>receipt)};
  render(<Programs service={service} scopeKey="client-a" onTalk={()=>{}}/>);
  await screen.findByText('Do the first approved step.');
  fireEvent.change(screen.getByLabelText('Why pause?'),{target:{value:'Need a rest'}});
  expect(screen.getByLabelText('Reason for ending this run')).toHaveValue('');
  expect(screen.getByRole('button',{name:'End this run'})).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Reason for ending this run'),{target:{value:'End for today'}});
  expect(screen.getByLabelText('Why pause?')).toHaveValue('Need a rest');
  fireEvent.change(screen.getByLabelText('Difficulty, if any'),{target:{value:'First-step difficulty'}});
  fireEvent.change(screen.getByLabelText('Assistance, if any'),{target:{value:'First-step assistance'}});
  fireEvent.change(screen.getByLabelText('Private session note'),{target:{value:'Private first-step note'}});
  fireEvent.click(screen.getByRole('button',{name:'I completed this step'}));
  await waitFor(()=>expect(service.command).toHaveBeenCalledWith(expect.objectContaining({type:'report_program_step',step_id:'first',
    difficulty:'First-step difficulty',assistance:'First-step assistance',notes:'Private first-step note'})));
  expect(await screen.findByText('Do the second approved step.')).toBeInTheDocument();
  expect(screen.getByLabelText('Difficulty, if any')).toHaveValue('');
  expect(screen.getByLabelText('Assistance, if any')).toHaveValue('');
  expect(screen.getByLabelText('Private session note')).toHaveValue('');
});

it('retains an unconfirmed step note until its receipt is found, then clears it',async()=>{
  vi.stubGlobal('crypto',{randomUUID:()=> '22222222-2222-4222-8222-222222222222'});
  let current=rehabView();
  const service:ProgramClientService={workspace:vi.fn(async()=>current),
    command:vi.fn(async()=>{throw new Error('Save unconfirmed');}),
    receipt:vi.fn(async()=>{current=rehabView(1);return receipt;})};
  render(<Programs service={service} scopeKey="client-a" onTalk={()=>{}}/>);
  await screen.findByText('Do the first approved step.');
  fireEvent.change(screen.getByLabelText('Private session note'),{target:{value:'Keep this until confirmed'}});
  fireEvent.click(screen.getByRole('button',{name:'I completed this step'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Save unconfirmed');
  expect(screen.getByLabelText('Private session note')).toHaveValue('Keep this until confirmed');
  expect(screen.getByRole('button',{name:'I completed this step'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Check saved receipt'}));
  await waitFor(()=>expect(service.receipt).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222'));
  expect(await screen.findByText('Do the second approved step.')).toBeInTheDocument();
  expect(screen.getByLabelText('Private session note')).toHaveValue('');
});

it('clears private step input and ignores a late save failure after scope change',async()=>{
  vi.stubGlobal('crypto',{randomUUID:()=> '33333333-3333-4333-8333-333333333333'});
  let rejectOld!:(error:Error)=>void;
  const service:ProgramClientService={workspace:vi.fn(async()=>rehabView()),
    command:vi.fn(()=>new Promise<ProgramReceipt>((_resolve,reject)=>{rejectOld=reject;})),receipt:vi.fn(async()=>receipt)};
  const view=render(<Programs service={service} scopeKey="client-a" onTalk={()=>{}}/>);
  await screen.findByText('Do the first approved step.');
  fireEvent.change(screen.getByLabelText('Private session note'),{target:{value:'Old client private note'}});
  fireEvent.click(screen.getByRole('button',{name:'I completed this step'}));
  await waitFor(()=>expect(service.command).toHaveBeenCalledOnce());
  view.rerender(<Programs service={service} scopeKey="client-b" onTalk={()=>{}}/>);
  await waitFor(()=>expect(screen.getByLabelText('Private session note')).toHaveValue(''));
  expect(screen.queryByRole('button',{name:'Check saved receipt'})).not.toBeInTheDocument();
  rejectOld(new Error('Old client save failed'));
  await Promise.resolve();
  expect(screen.queryByText('Old client save failed')).not.toBeInTheDocument();
});
