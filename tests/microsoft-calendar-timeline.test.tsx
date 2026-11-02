// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render,screen,within} from '@testing-library/react';
vi.mock('../src/client/local-voice',()=>({startLocalVoice:vi.fn()}));
vi.mock('../src/client/voice',()=>({startVoice:vi.fn()}));
vi.mock('../src/client/pending-commands',()=>({PendingCommands:class {snapshot=[];async activate(){}async deactivate(){}subscribe(){return()=>{};}}}));
import {App} from '../src/client/App';
import {clientBackend,clientResponse} from './helpers/client-interface-fixture';
const stamp='2026-10-19T16:00:00Z';
const appointment={id:'same-event-id',subject:'Primary appointment',start:'2026-10-19T22:00:00Z',end:'2026-10-19T22:15:00Z',isAllDay:false,isCancelled:false};
const source=(source_key:'primary'|'secondary',items:typeof appointment[],complete=true)=>({id:'same-calendar-id',source_key,source_label:source_key==='primary'?'Primary approved account':'Additional approved account',result:{items,complete,truncation:null,fetchedAt:stamp}});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();window.history.replaceState(null,'','/');});
describe('two-source appointment timeline',()=>{
 it('preserves each source label and keeps identical provider IDs distinct',async()=>{
  const errors=vi.spyOn(console,'error').mockImplementation(()=>{});
  clientBackend({microsoft:true,override:path=>path.startsWith('/api/microsoft/calendar?')?clientResponse({source:'microsoft',fetched_at:stamp,calendars:[source('primary',[appointment]),source('secondary',[{...appointment,subject:'Additional appointment'}])]}):undefined});
  render(<App/>);const timeline=await screen.findByRole('region',{name:'Your day'});await within(timeline).findByText('Additional appointment');
  expect(within(timeline).getByText('Primary appointment').closest('li')).toHaveTextContent('Primary approved account');expect(within(timeline).getByText('Additional appointment').closest('li')).toHaveTextContent('Additional approved account');
  expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key|unique.*key/i);
 });
 it('shows incomplete coverage while retaining appointments from the available source',async()=>{
  clientBackend({microsoft:true,override:path=>path.startsWith('/api/microsoft/calendar?')?clientResponse({source:'microsoft',fetched_at:stamp,calendars:[source('primary',[appointment]),source('secondary',[],false)]}):undefined});
  render(<App/>);const timeline=await screen.findByRole('region',{name:'Your day'});await within(timeline).findByText('Primary appointment');expect(within(timeline).getByText('Only part of your Outlook calendar was returned.')).toBeInTheDocument();
 });
});
