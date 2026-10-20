// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {Preferences,type PreferenceClientService} from '../src/client/Preferences';
import type {PreferenceCommand,PreferenceWorkspace,ClientPreference} from '../src/shared/preference-contracts';

const id='10000000-0000-4000-8000-000000000001',key='10000000-0000-4000-8000-000000000002';
const item:ClientPreference={id,category:'meals',text:'Oatmeal for breakfast',duration:'lasting',local_date:null,revision:1,active:true,updated_at:'2026-10-13T14:00:00Z'};
const command:PreferenceCommand={type:'save_preference',idempotency_key:key,confirmed:true,preference_id:null,expected_revision:0,category:'meals',text:'Oatmeal for breakfast',duration:'lasting',local_date:null};
function service(view:PreferenceWorkspace={local_date:'2026-10-13',items:[],pending:null}){
 const state={view};const api={workspace:vi.fn(async()=>state.view),command:vi.fn(async(c:PreferenceCommand)=>({command_id:c.idempotency_key,result:'saved' as const,preference:item,replayed:false})),retry:vi.fn(async()=>({command_id:key,result:'saved' as const,preference:item,replayed:true})),acknowledge:vi.fn(async()=>({ok:true as const})),discard:vi.fn(async()=>({discarded:true}))} satisfies PreferenceClientService;return {state,api};
}
afterEach(cleanup);
describe('small optional preference panel',()=>{
 it('reviews today-only wording before the shared confirmed command and clears on acknowledged save',async()=>{
  const f=service(),changed=vi.fn();f.api.command.mockImplementation(async c=>{f.state.view={...f.state.view,items:[{...item,duration:'today',local_date:'2026-10-13'}]};return {command_id:c.idempotency_key,result:'saved',preference:f.state.view.items[0],replayed:false};});
  render(<Preferences service={f.api} scopeKey="one" onChange={changed}/>);fireEvent.click(screen.getByText('What Nancy should remember'));
  await screen.findByLabelText('My preference');fireEvent.change(screen.getByLabelText('My preference'),{target:{value:'Oatmeal for breakfast'}});fireEvent.change(screen.getByLabelText('Remember for'),{target:{value:'today'}});
  fireEvent.click(screen.getByText('Review preference'));expect(f.api.command).not.toHaveBeenCalled();expect(screen.getByText(/for today only \(2026-10-13\)/)).toBeInTheDocument();
  fireEvent.click(screen.getByText('Save reviewed preference'));await screen.findByText('Preference saved.');
  expect(f.api.command).toHaveBeenCalledWith(expect.objectContaining({confirmed:true,duration:'today',local_date:'2026-10-13'}));expect(f.api.acknowledge).toHaveBeenCalledWith(expect.any(String));expect(changed).toHaveBeenCalledTimes(1);
 });
 it('restores a durable unknown intent and waits for explicit same-key retry',async()=>{
  const f=service({local_date:'2026-10-13',items:[],pending:{command,scope_matches:true,receipt:null}});
  render(<Preferences service={f.api} scopeKey="one"/>);fireEvent.click(screen.getByText('What Nancy should remember'));
  await screen.findByText('Retry reviewed preference');expect(f.api.command).not.toHaveBeenCalled();expect(f.api.retry).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Retry reviewed preference'));await waitFor(()=>expect(f.api.retry).toHaveBeenCalledWith(key));expect(f.api.command).not.toHaveBeenCalled();
 });
 it('shows a stale correction as a fresh-review requirement without crashing the panel',async()=>{
  const f=service({local_date:'2026-10-13',items:[item],pending:null});f.api.command.mockImplementation(async()=>{f.state.view={...f.state.view,items:[{...item,text:'Eggs for breakfast',revision:2}]};throw new Error('This preference changed.');});
  render(<Preferences service={f.api} scopeKey="one"/>);fireEvent.click(screen.getByText('What Nancy should remember'));await screen.findByText('Change');fireEvent.click(screen.getByText('Change'));
  fireEvent.change(screen.getByLabelText('My preference'),{target:{value:'Toast for breakfast'}});fireEvent.click(screen.getByText('Review preference'));fireEvent.click(screen.getByText('Save reviewed preference'));
  await screen.findByText('This preference changed. Go back and review its current value.');expect(screen.getByText('Save reviewed preference')).toBeDisabled();expect(screen.getByText(/Eggs for breakfast/)).toBeInTheDocument();
 });
 it('does not expose old-scope results after an account switch',async()=>{
  let finish!:(view:PreferenceWorkspace)=>void;const old=service(),current=service();old.api.workspace.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const view=render(<Preferences service={old.api} scopeKey="old"/>);view.rerender(<Preferences service={current.api} scopeKey="new"/>);
  await screen.findByText('No preferences have been saved here yet.');finish({local_date:'2026-10-13',items:[item],pending:null});
  await waitFor(()=>expect(screen.queryByText(/Oatmeal for breakfast/)).not.toBeInTheDocument());
 });
 it('offers cancellation rather than replay under changed authority',async()=>{
  const f=service({local_date:'2026-10-13',items:[],pending:{command,scope_matches:false,receipt:null}});
  render(<Preferences service={f.api} scopeKey="new"/>);fireEvent.click(screen.getByText('What Nancy should remember'));await screen.findByText('Cancel unconfirmed request');
  expect(screen.queryByText('Retry reviewed preference')).not.toBeInTheDocument();fireEvent.click(screen.getByText('Cancel unconfirmed request'));await waitFor(()=>expect(f.api.discard).toHaveBeenCalledWith(key));expect(f.api.command).not.toHaveBeenCalled();
 });
});
