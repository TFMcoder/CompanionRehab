// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
vi.mock('../src/client/local-voice',()=>({startLocalVoice:vi.fn()}));
vi.mock('../src/client/voice',()=>({startVoice:vi.fn()}));
vi.mock('../src/client/pending-commands',()=>({PendingCommands:class {snapshot=[];async activate(){}async deactivate(){}subscribe(){return()=>{};}}}));
import {App} from '../src/client/App';
import {startLocalVoice} from '../src/client/local-voice';
import {clientBackend,clientDay,clientResponse} from './helpers/client-interface-fixture';
afterEach(()=>{cleanup();vi.resetAllMocks();vi.unstubAllGlobals();window.history.replaceState(null,'','/');});
function voice(){let options!:Parameters<typeof startLocalVoice>[0];const handle={stop:vi.fn(async()=>{}),interrupt:vi.fn(),sendText:vi.fn(async()=>{})};vi.mocked(startLocalVoice).mockImplementation(async input=>{options=input;input.onReady?.(handle);input.onState('listening');return handle;});return {handle,options:()=>options};}
describe('October 19 client interface contract',()=>{
 it('shows exactly the five requested tabs and no setup, subscription, wake or manual-entry clutter',async()=>{
  clientBackend({local:true,microsoft:true});const view=render(<App/>);const nav=await screen.findByRole('navigation',{name:'My Day views'});
  expect(within(nav).getAllByRole('button').map(b=>b.textContent)).toEqual(['Tasks','Meals','Groceries','Progress','Ask for Help']);
  expect(screen.getByRole('button',{name:'Suggestions for Nancy'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'Ways to use Nancy'})).toBeInTheDocument();
  expect(view.container.querySelectorAll('input,textarea,select')).toHaveLength(0);
  for(const name of ['Edit choices','More','Outlook','Sharing','Routines','Activity','Access settings','Add an appointment','See tasks','See meals','Add choices'])expect(screen.queryByRole('button',{name})).not.toBeInTheDocument();
  expect(screen.queryByText(/Using your caregiver/)).not.toBeInTheDocument();expect(screen.queryByText(/Microphone:|Hey Nancy is off|Short speech clips/)).not.toBeInTheDocument();expect(startLocalVoice).not.toHaveBeenCalled();
 });
 it('keeps every client tab read-only, even when the underlying account can edit or export',async()=>{
  const backend=clientBackend({local:true});const view=render(<App/>);await screen.findByRole('navigation');
  for(const name of ['Tasks','Meals','Groceries','Progress','Ask for Help']){fireEvent.click(screen.getByRole('button',{name}));await screen.findByRole('heading',{name});expect(view.container.querySelectorAll('input,textarea,select')).toHaveLength(0);}
  expect(backend.fetch.mock.calls.some(([url,init])=>/commands|setup|\/groceries$/.test(String(url))&&init?.method==='POST')).toBe(false);expect(startLocalVoice).not.toHaveBeenCalled();
 });
 it('displays a chronological day with the selected Outlook appointment, source and local time',async()=>{
  const backend=clientBackend({microsoft:true});render(<App/>);const timeline=await screen.findByRole('region',{name:'Your day'});
  await within(timeline).findByText('Synthetic appointment');const rows=within(timeline).getAllByRole('listitem');expect(rows[0]).toHaveTextContent('Fold laundry');expect(rows[1]).toHaveTextContent('Synthetic appointment');expect(rows[1]).toHaveTextContent('6:00 p.m.');expect(rows[1]).toHaveTextContent('Outlook');
  expect(backend.fetch.mock.calls.some(([url])=>String(url).includes('/api/microsoft/context'))).toBe(false);expect(backend.fetch.mock.calls.find(([url])=>String(url).includes('/api/microsoft/calendar'))?.[0]).toContain('start=2026-10-19T00%3A00%3A00-04%3A00');
 });
 it('does not call an unavailable calendar empty or promise that all appointments are shown',async()=>{
  clientBackend({microsoft:true,override:path=>path.startsWith('/api/microsoft/calendar')?clientResponse({error:{code:'unavailable'}},502):undefined});render(<App/>);expect(await screen.findByText(/Outlook could not refresh/)).toBeInTheDocument();expect(screen.queryByText(/No appointments saved/)).not.toBeInTheDocument();
 });
 it('keeps partial and cancelled calendar facts visible without interpreting them as completed activity',async()=>{
  clientBackend({microsoft:true,override:path=>path.startsWith('/api/microsoft/calendar')?clientResponse({source:'microsoft',fetched_at:'2026-10-19T16:00:00Z',calendars:[{id:'c',result:{complete:false,items:[{id:'e',subject:'Cancelled fixture',start:'2026-10-19T22:00:00Z',end:'2026-10-19T22:15:00Z',isAllDay:false,isCancelled:true}]}}]}):undefined});render(<App/>);expect(await screen.findByText(/Only part of your Outlook calendar/)).toBeInTheDocument();expect(screen.getByText('Cancelled fixture')).toBeInTheDocument();expect(screen.getByText('Cancelled · Outlook')).toBeInTheDocument();
 });
 it('opens the FAQ and both voice-topic pages without starting a microphone or submitting feedback',async()=>{
  const backend=clientBackend();render(<App/>);fireEvent.click(await screen.findByRole('button',{name:'Ways to use Nancy'}));fireEvent.click(screen.getByText('How do I start?'));expect(screen.getByText(/Tap Talk to Nancy and say what you need/)).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Ask for Help'}));expect(screen.getByText('What would you like a hand with?')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Suggestions for Nancy'}));await screen.findByRole('button',{name:'Tell Nancy my suggestion'});expect(startLocalVoice).not.toHaveBeenCalled();expect(backend.fetch.mock.calls.some(([,init])=>init?.method==='POST')).toBe(false);
 });
 it.each([{tab:'Ask for Help',button:'Talk to Nancy about help',purpose:'help'},{tab:'Suggestions for Nancy',button:'Tell Nancy my suggestion',purpose:'suggestions'}])('starts the explicit $purpose entry only on its voice button',async({tab,button,purpose})=>{
  const v=voice();clientBackend();render(<App/>);fireEvent.click(await screen.findByRole('button',{name:tab}));fireEvent.click(await screen.findByRole('button',{name:button}));await screen.findByRole('button',{name:'Stop voice'});expect(v.options().purpose).toBe(purpose);expect(v.handle.sendText).not.toHaveBeenCalled();
 });
 it('preserves one conversation through tabs, FAQ and feedback, and rejects removed destinations',async()=>{
  const v=voice();clientBackend();render(<App/>);fireEvent.click(await screen.findByRole('button',{name:'Talk to Nancy'}));await screen.findByRole('button',{name:'Stop voice'});act(()=>v.options().onTranscript('nancy','A continuing conversation.'));
  for(const name of ['Tasks','Meals','Groceries','Progress','Ask for Help','Ways to use Nancy','Suggestions for Nancy'])fireEvent.click(screen.getByRole('button',{name}));
  act(()=>v.options().onNavigate('outlook'));expect(screen.getByRole('region',{name:'Your day'})).toBeInTheDocument();expect(screen.getByText('A continuing conversation.')).toBeInTheDocument();expect(startLocalVoice).toHaveBeenCalledTimes(1);expect(v.handle.stop).not.toHaveBeenCalled();expect(screen.queryByLabelText('Type to Nancy')).not.toBeInTheDocument();
 });
 it('stops voice and drops conversation text when login scope changes',async()=>{
  const v=voice(),backend=clientBackend();render(<App/>);fireEvent.click(await screen.findByRole('button',{name:'Talk to Nancy'}));await screen.findByRole('button',{name:'Stop voice'});act(()=>v.options().onTranscript('nancy','Private old scope'));backend.state.scope='client-scope-b';act(()=>window.dispatchEvent(new Event('nancy:scope-changed')));await screen.findByRole('button',{name:'Talk to Nancy'});await waitFor(()=>expect(v.handle.stop).toHaveBeenCalled());expect(screen.queryByText('Private old scope')).not.toBeInTheDocument();
 });
 it('shows saved feedback as product feedback without placing it into the day plan',async()=>{
  const backend=clientBackend({override:path=>path==='/api/nancy-suggestions'?clientResponse({role:'client',items:[{id:'s',suggestion:'Make the buttons easier to read',created_at:'2026-10-19T12:00:00Z'}]}):undefined});render(<App/>);fireEvent.click(await screen.findByRole('button',{name:'Suggestions for Nancy'}));expect(await screen.findByText('Make the buttons easier to read')).toBeInTheDocument();expect(backend.state.today.checkin).toBeNull();expect(startLocalVoice).not.toHaveBeenCalled();
 });
 it('discards a late calendar response after the authenticated scope changes',async()=>{
  let resolve!:(value:Response)=>void,calls=0;const backend=clientBackend({microsoft:true,override:path=>{if(path.startsWith('/api/microsoft/calendar')&&++calls===1)return new Promise(done=>{resolve=done;});}});render(<App/>);await screen.findByText('Checking your calendar…');backend.state.scope='new-scope';act(()=>window.dispatchEvent(new Event('nancy:scope-changed')));await screen.findByText('Synthetic appointment');
  await act(async()=>resolve(clientResponse({source:'microsoft',fetched_at:'2026-10-19T16:00:00Z',calendars:[{id:'old',result:{complete:true,items:[{id:'old',subject:'Old scope appointment',start:'2026-10-19T22:00:00Z',end:'2026-10-19T22:15:00Z',isAllDay:false,isCancelled:false}]}}]})));expect(screen.queryByText('Old scope appointment')).not.toBeInTheDocument();
 });
});
