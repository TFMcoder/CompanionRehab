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
import type {ActivityEntry} from '../src/shared/activity-contracts';
afterEach(()=>{cleanup();vi.resetAllMocks();vi.unstubAllGlobals();window.history.replaceState(null,'','/');});
function voice(){let options!:Parameters<typeof startLocalVoice>[0];const handle={stop:vi.fn(async()=>{}),interrupt:vi.fn(),sendText:vi.fn(async()=>{})};vi.mocked(startLocalVoice).mockImplementation(async input=>{options=input;input.onReady?.(handle);input.onState('listening');return handle;});return {handle,options:()=>options};}
function taskActivityDay(status:ActivityEntry['status'],last_action:ActivityEntry['last_action'],scheduled_at:string|null='2026-10-20T03:00:00Z'){
 const today=structuredClone(clientDay),task={...today.tasks[0],scheduled_date:null,scheduled_time:null};today.tasks=[task];
 const entry:ActivityEntry={id:'saved-task-activity',kind:'task',title:task.title,local_date:today.local_date,source_id:task.id,meal_slot:null,plan_id:null,scheduled_at,status,revision:last_action==='rescheduled'?1:2,unplanned:false,occurred_at:status==='completed'?'2026-10-20T02:51:00Z':null,recorded_at:'2026-10-20T02:00:00Z',updated_at:'2026-10-20T02:51:00Z',notes:'',portion:null,last_action};
 today.activity_ledger={local_date:today.local_date,options:[entry],entries:[entry],recent_entries:[],summary:{tasks_completed:status==='completed'?1:0,meals_eaten:0,appointments_attended:0,deferred:status==='deferred'?1:0}};
 return today;
}
describe('October 19 client interface contract',()=>{
 it('keeps the reviewed owner schedule across a voice-confirmed completion and shows actual time separately',async()=>{
  vi.stubGlobal('__NANCY_OWNER_TASK_DATES__',true);const v=voice(),backend=clientBackend({today:taskActivityDay('pending','rescheduled')});render(<App/>);
  const timeline=await screen.findByRole('region',{name:'Your day'});expect(within(timeline).getByRole('heading',{name:'Fold laundry'}).closest('li')).toHaveTextContent('11:00 p.m.');expect(within(timeline).queryByText(/Task done/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Talk to Nancy'}));await screen.findByRole('button',{name:'Stop voice'});
  backend.state.today=taskActivityDay('completed','reported');act(()=>v.options().onChange());
  const completed=await within(timeline).findByText('Task done · Oct 19, 10:51 p.m.');expect(completed.closest('li')).toHaveTextContent('11:00 p.m.');expect(within(timeline).queryByText('No times planned yet.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Tasks'}));const tasks=screen.getByRole('region',{name:'Tasks'});expect(within(tasks).getByRole('listitem')).toHaveTextContent('Task done · Oct 19, 10:51 p.m. · Scheduled for Oct 19, 11:00 p.m.');expect(v.handle.stop).not.toHaveBeenCalled();
 });
 it.each([{status:'completed',last_action:'corrected',detail:'Task done'},{status:'deferred',last_action:'reported',detail:'Deferred'},{status:'voided',last_action:'corrected',detail:'Mistaken report removed'}] as const)('retains the owner schedule after $status/$last_action without treating scheduled time as an actual report',async({status,last_action,detail})=>{
  vi.stubGlobal('__NANCY_OWNER_TASK_DATES__',true);clientBackend({today:taskActivityDay(status,last_action)});render(<App/>);const timeline=await screen.findByRole('region',{name:'Your day'}),row=within(timeline).getByRole('heading',{name:'Fold laundry'}).closest('li');
  expect(row).toHaveTextContent('11:00 p.m.');expect(row).toHaveTextContent(detail);if(status!=='completed')expect(row).not.toHaveTextContent('Task done');
  fireEvent.click(screen.getByRole('button',{name:'Tasks'}));const tasks=screen.getByRole('region',{name:'Tasks'});expect(within(tasks).getByRole('listitem')).toHaveTextContent('Scheduled for Oct 19, 11:00 p.m.');
 });
 it('preserves the default client display when the owner schedule flag is absent',async()=>{
  clientBackend({today:taskActivityDay('completed','reported')});render(<App/>);const timeline=await screen.findByRole('region',{name:'Your day'});
  expect(within(timeline).getByText('No times planned yet.')).toBeInTheDocument();expect(within(timeline).getByRole('heading',{name:'Fold laundry'}).closest('li')).toHaveTextContent('No time set');expect(within(timeline).getByRole('heading',{name:'Fold laundry'}).closest('li')).toHaveTextContent('Task done · Oct 19, 10:51 p.m.');
  fireEvent.click(screen.getByRole('button',{name:'Tasks'}));expect(screen.getByRole('region',{name:'Tasks'})).not.toHaveTextContent('Scheduled for');
 });
 it('leaves an unknown owner schedule unknown after completion',async()=>{
  vi.stubGlobal('__NANCY_OWNER_TASK_DATES__',true);clientBackend({today:taskActivityDay('completed','reported',null)});render(<App/>);const timeline=await screen.findByRole('region',{name:'Your day'});
  expect(within(timeline).getByText('No times planned yet.')).toBeInTheDocument();expect(within(timeline).getByRole('heading',{name:'Fold laundry'}).closest('li')).toHaveTextContent('No time set');fireEvent.click(screen.getByRole('button',{name:'Tasks'}));expect(screen.getByRole('region',{name:'Tasks'})).not.toHaveTextContent('Scheduled for');
 });
 it('uses the retained owner schedule date to keep another day out of today’s timeline',async()=>{
  vi.stubGlobal('__NANCY_OWNER_TASK_DATES__',true);clientBackend({today:taskActivityDay('completed','corrected','2026-10-20T14:00:00Z')});render(<App/>);const timeline=await screen.findByRole('region',{name:'Your day'});
  expect(within(timeline).queryByRole('heading',{name:'Fold laundry'})).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Tasks'}));expect(screen.getByRole('region',{name:'Tasks'})).toHaveTextContent('Scheduled for Oct 20, 10:00 a.m.');
 });
 it('offers a startup audio gesture only when requested and cancels it with Stop',async()=>{
  let options!:Parameters<typeof startLocalVoice>[0];vi.mocked(startLocalVoice).mockImplementation(input=>{options=input;return new Promise(()=>{});});
  clientBackend();render(<App/>);fireEvent.click(await screen.findByRole('button',{name:'Talk to Nancy'}));
  await waitFor(()=>expect(options).toBeDefined());expect(screen.queryByRole('button',{name:'Enable sound'})).not.toBeInTheDocument();
  const resume=vi.fn();act(()=>options.onAudioUnlock?.(resume));fireEvent.click(screen.getByRole('button',{name:'Enable sound'}));expect(resume).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button',{name:'Stop voice'}));expect(screen.queryByRole('button',{name:'Enable sound'})).not.toBeInTheDocument();
  act(()=>options.onAudioUnlock?.(resume));expect(screen.queryByRole('button',{name:'Enable sound'})).not.toBeInTheDocument();expect(options.signal?.aborted).toBe(true);
 });
 it.each([true,false])('shows date-only duplicate task dates only in the owner build: %s',async preview=>{
  if(preview)vi.stubGlobal('__NANCY_OWNER_TASK_DATES__',true);
  const today=structuredClone(clientDay);today.tasks=[{id:'grocery-one',title:'[TEST] Pick up groceries',time_hint:'Asana sandbox',scheduled_date:'2026-10-26',scheduled_time:null},{id:'grocery-two',title:'[TEST] Pick up groceries',time_hint:'Asana sandbox',scheduled_date:'2026-10-28',scheduled_time:null},{id:'undated',title:'[TEST] Task with no date',time_hint:'Asana sandbox',scheduled_date:null,scheduled_time:null}];
  clientBackend({today});render(<App/>);fireEvent.click(await screen.findByRole('button',{name:'Tasks'}));
  const rows=within(screen.getByRole('region',{name:'Tasks'})).getAllByRole('listitem');expect(rows[0]).toHaveTextContent('No time set');expect(rows[1]).toHaveTextContent('No time set');
  if(preview){expect(rows[0]).toHaveTextContent('Monday, October 26');expect(rows[1]).toHaveTextContent('Wednesday, October 28');}else{expect(rows[0]).not.toHaveTextContent('October 26');expect(rows[1]).not.toHaveTextContent('October 28');}
  expect(rows[2]).not.toHaveTextContent(/Oct/);expect(rows[2]).toHaveTextContent('No time set');expect(startLocalVoice).not.toHaveBeenCalled();
 });
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
