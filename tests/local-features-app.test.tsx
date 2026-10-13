// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Today } from '../src/shared/contracts';

const recovery = vi.hoisted(() => ({ events: [] as string[], rows: [] as Array<{key:string;family:string;status:string}>, commands:[] as Array<{family:string;command:any}>, scope: '', failSubmit: false, today:null as any }));
vi.mock('../src/client/pending-commands', () => ({ PendingCommands: class {
  get snapshot() { return recovery.rows; }
  subscribe(listener: (rows: unknown[])=>void) { listener(recovery.rows); return () => undefined; }
  async activate(scope: string) { recovery.events.push(`activate:${scope}`); recovery.scope=scope; recovery.rows=[]; }
  async deactivate() { recovery.events.push(`deactivate:${recovery.scope}`); recovery.scope=''; recovery.rows=[]; }
  async queue(family: string, command: {idempotency_key:string}) { recovery.events.push(`queue:${family}`); recovery.commands.push({family,command}); const row={key:command.idempotency_key,family,status:'queued'}; recovery.rows.push(row); return row; }
  async submit(key:string) { recovery.events.push(`submit:${key}`); const row=recovery.rows.find(item=>item.key===key)!; row.status='unknown'; if(recovery.failSubmit) throw { status:0,code:'connection_unconfirmed' }; row.status='saved';
    const input=recovery.commands.find(item=>item.command.idempotency_key===key);
    if(input?.family==='care'&&recovery.today){const current=recovery.today,command=input.command;
      const plan={id:'88888888-8888-4888-8888-888888888888',task_ids:command.payload.task_ids,tasks:current.tasks.filter((task:any)=>command.payload.task_ids.includes(task.id)).map((task:any)=>({...task,...command.payload.task_overrides?.find((override:any)=>override.id===task.id)})),meals:command.payload.meals.map((meal:any)=>({...meal,name:current.meal_options.find((option:any)=>option.id===meal.option_id)?.name})),created_at:'2026-10-13T12:00:00Z'};
      recovery.today={...current,checkin:{...current.checkin,revision:current.checkin.revision+1,proposal:plan}};
      return {command_id:key,checkin_id:current.checkin.id,revision:current.checkin.revision+1,result:'proposed',plan,replayed:false};
    }
    return {command_id:key,result:'saved'}; }
  async reconcile(key:string) { recovery.events.push(`receipt:${key}`); const row=recovery.rows.find(item=>item.key===key)!; row.status='ready_retry'; return null; }
  async retry(key:string) { recovery.events.push(`retry:${key}`); const row=recovery.rows.find(item=>item.key===key)!; row.status='saved'; return {command_id:key,result:'saved'}; }
  async discard(key:string) { recovery.rows=recovery.rows.filter(item=>item.key!==key); }
} }));
vi.mock('../src/client/local-voice', () => ({ startLocalVoice: vi.fn() }));
vi.mock('../src/client/MealGroceries', () => ({ MealGroceries: ({scopeKey,service}:any) => <section>Meal choices {scopeKey}<button onClick={()=>void service.command({type:'grocery_test',idempotency_key:'same-key'}).catch(()=>undefined)}>Save grocery</button><button onClick={()=>void service.receipt('same-key').catch(()=>undefined)}>Check grocery receipt</button><button onClick={()=>void service.command({type:'grocery_test',idempotency_key:'same-key'}).catch(()=>undefined)}>Retry grocery</button></section> }));
vi.mock('../src/client/Programs', () => ({ Programs: ({scopeKey}:any) => <section>Routines module {scopeKey}</section> }));
vi.mock('../src/client/SupportTeam', () => ({ SupportTeam: ({scopeKey}:any) => <section>Support module {scopeKey}</section> }));
vi.mock('../src/client/LocalDayPanel', () => ({ LocalDayPanel: ({scopeKey,onProposeRoutine}:any) => <section>Day review module {scopeKey}<button onClick={()=>void onProposeRoutine?.({task_ids:['22222222-2222-4222-8222-222222222222'],meals:[{slot:'breakfast',option_id:'33333333-3333-4333-8333-333333333333'},{slot:'lunch',option_id:'44444444-4444-4444-8444-444444444444'},{slot:'dinner',option_id:'55555555-5555-4555-8555-555555555555'}]})}>Propose routine test</button></section> }));
vi.mock('../src/client/Operations', () => ({ Operations: ({scopeKey}:any) => <section>Operations module {scopeKey}</section> }));
vi.mock('../src/client/Progress', () => ({ Progress: ({scopeKey,visible}:any) => visible ? <section>Progress module {scopeKey}</section> : null }));
vi.mock('../src/client/WakeControl', () => ({ WakeControl: ({conversationActive,scopeKey}:any) => <output data-testid="wake">{scopeKey}:{conversationActive?'busy':'ready'}</output> }));
vi.mock('../src/client/ReminderDelivery', () => ({ ReminderDelivery: ({conversationActive,scopeKey}:any) => <output data-testid="reminder">{scopeKey}:{conversationActive?'busy':'ready'}</output> }));

import { App } from '../src/client/App';
import { startLocalVoice } from '../src/client/local-voice';

const day:Today={profile:{id:'11111111-1111-4111-8111-111111111111',display_name:'Pat',time_zone:'America/Toronto',preferences:'',revision:1},local_date:'2026-10-13',checkin:null,tasks:[],meal_options:[],appointments:[],groceries:[]};
const response=(body:unknown)=>({ok:true,status:200,json:async()=>body}) as Response;
let scope='scope-a';
function backend(){vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
  if(path==='/api/config')return response({configured:true,assistant_name:'Nancy',missing:[],voice_available:true,voice_transport:'local'});
  if(path==='/api/auth/session')return response({authenticated:true,role:'client',participant_id:day.profile!.id,scope_key:scope,voice_eligible:true,task_requests_available:false,local_features_available:true});
  if(path==='/api/today')return response(recovery.today??day);
  throw Error(`Unexpected request ${path}`);
}));}
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.clearAllMocks();vi.unstubAllGlobals();recovery.events=[];recovery.rows=[];recovery.commands=[];recovery.scope='';recovery.failSubmit=false;recovery.today=null;scope='scope-a';});

describe('local feature client integration',()=>{
  it('clears the recovery marker after an ordinary confirmed save',async()=>{
    backend();render(<App/>);
    fireEvent.click(await screen.findByRole('button',{name:'Groceries'}));
    fireEvent.click(screen.getByRole('button',{name:'Save grocery'}));
    await waitFor(()=>expect(recovery.events).toEqual(expect.arrayContaining(['queue:meal_grocery','submit:same-key'])));
    await waitFor(()=>expect(recovery.rows).toEqual([]));
    expect(recovery.events).not.toContain('receipt:same-key');
  });

  it('keeps one voice conversation across panels and clears it with device work on scope change',async()=>{
    const handle={stop:vi.fn(async()=>undefined),sendText:vi.fn(async()=>undefined),interrupt:vi.fn()};
    vi.mocked(startLocalVoice).mockImplementation(async options=>{options.onReady?.(handle);options.onState('listening');return handle;});
    backend();render(<App/>);
    await screen.findByRole('button',{name:'Day review'});
    expect(recovery.events).toContain('activate:scope-a');
    fireEvent.click(screen.getByRole('button',{name:'Talk to Nancy'}));
    await screen.findByRole('button',{name:'Stop voice'});
    expect(screen.getByTestId('wake')).toHaveTextContent('scope-a:busy');
    expect(screen.getByTestId('reminder')).toHaveTextContent('scope-a:busy');
    fireEvent.click(screen.getByText('More'));
    for(const [tab,marker] of [['Meals','Meal choices'],['Groceries','Meal choices'],['Day review','Day review module'],['Routines','Routines module'],['Sharing','Support module'],['Progress','Progress module'],['Access settings','Operations module']] as const){
      fireEvent.click(screen.getByRole('button',{name:tab}));
      if(tab==='Meals')fireEvent.click(screen.getByText('Meal choices'));
      expect(await screen.findByText(new RegExp(`${marker} scope-a`))).toBeInTheDocument();
      expect(screen.getByRole('button',{name:'Stop voice'})).toBeInTheDocument();
    }
    expect(startLocalVoice).toHaveBeenCalledTimes(1);
    expect(handle.stop).not.toHaveBeenCalled();
    scope='scope-b';act(()=>window.dispatchEvent(new Event('nancy:scope-changed')));
    await waitFor(()=>expect(recovery.events).toEqual(expect.arrayContaining(['deactivate:scope-a','activate:scope-b'])));
    fireEvent.click(screen.getByText('More'));
    fireEvent.click(await screen.findByRole('button',{name:'Routines'}));
    expect(screen.getByText('Routines module scope-b')).toBeInTheDocument();
    expect(screen.queryByText('Routines module scope-a')).not.toBeInTheDocument();
    await waitFor(()=>expect(handle.stop).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('wake')).toHaveTextContent('scope-b:ready');
  });

  it('persists a typed write before dispatch and checks its receipt before explicit retry',async()=>{
    backend();recovery.failSubmit=true;render(<App/>);
    fireEvent.click(await screen.findByRole('button',{name:'Groceries'}));
    fireEvent.click(screen.getByRole('button',{name:'Save grocery'}));
    await waitFor(()=>expect(recovery.events).toEqual(expect.arrayContaining(['queue:meal_grocery','submit:same-key'])));
    expect(recovery.events.indexOf('queue:meal_grocery')).toBeLessThan(recovery.events.indexOf('submit:same-key'));
    fireEvent.click(screen.getByRole('button',{name:'Retry grocery'}));
    await waitFor(()=>expect(recovery.events).toContain('receipt:same-key'));
    expect(recovery.events).not.toContain('retry:same-key');
    fireEvent.click(screen.getByRole('button',{name:'Check grocery receipt'}));
    await waitFor(()=>expect(recovery.events).toContain('receipt:same-key'));
    expect(recovery.events).not.toContain('retry:same-key');
    fireEvent.click(screen.getByRole('button',{name:'Retry grocery'}));
    await waitFor(()=>expect(recovery.events).toContain('retry:same-key'));
    expect(recovery.events.filter(event=>event==='submit:same-key')).toHaveLength(1);
  });

  it('turns reviewed repeat-day choices into a proposal and leaves acceptance to My Day',async()=>{
    recovery.today={...day,tasks:[{id:'22222222-2222-4222-8222-222222222222',title:'Walk',time_hint:null}],
      meal_options:[{id:'33333333-3333-4333-8333-333333333333',name:'Oats',slots:['breakfast']},{id:'44444444-4444-4444-8444-444444444444',name:'Soup',slots:['lunch']},{id:'55555555-5555-4555-8555-555555555555',name:'Rice',slots:['dinner']}],
      checkin:{id:'66666666-6666-4666-8666-666666666666',local_date:day.local_date,revision:1,proposal:null,accepted:null}};
    backend();render(<App/>);
    fireEvent.click(await screen.findByText('More'));
    fireEvent.click(await screen.findByRole('button',{name:'Day review'}));
    fireEvent.click(screen.getByRole('button',{name:'Propose routine test'}));
    await waitFor(()=>expect(recovery.commands.some(item=>item.family==='care')).toBe(true));
    expect(recovery.commands.filter(item=>item.family==='care').map(item=>item.command.type)).toEqual(['propose_day_plan']);
    expect(recovery.commands.find(item=>item.family==='care')!.command).toMatchObject({expected_revision:1,payload:{task_ids:['22222222-2222-4222-8222-222222222222']}});
    fireEvent.click(screen.getByRole('button',{name:'My Day'}));
    expect(await screen.findByRole('heading',{name:'Review this plan'})).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Accept this plan'})).toBeInTheDocument();
    expect(recovery.today.checkin.accepted).toBeNull();
  });

  it('carries a same-day activity reschedule into a repeat proposal without replacing the accepted plan',async()=>{
    const taskId='22222222-2222-4222-8222-222222222222',planId='77777777-7777-4777-8777-777777777777';
    const task={id:taskId,title:'Fold clean towels',time_hint:null,scheduled_time:'11:30'};
    const meals=[{slot:'breakfast',option_id:'33333333-3333-4333-8333-333333333333',name:'Oats'},
      {slot:'lunch',option_id:'44444444-4444-4444-8444-444444444444',name:'Soup'},
      {slot:'dinner',option_id:'55555555-5555-4555-8555-555555555555',name:'Rice'}];
    const accepted={id:planId,task_ids:[taskId],tasks:[task],meals,created_at:'2026-10-13T12:00:00Z',version:1,accepted_at:'2026-10-13T12:01:00Z'};
    const activity={id:'99999999-9999-4999-8999-999999999999',kind:'task',title:task.title,local_date:day.local_date,source_id:taskId,meal_slot:null,plan_id:planId,scheduled_at:'2026-10-13T16:15:00Z',status:'pending',revision:2,unplanned:false};
    recovery.today={...day,tasks:[task],meal_options:meals.map(meal=>({id:meal.option_id,name:meal.name,slots:[meal.slot]})),
      checkin:{id:'66666666-6666-4666-8666-666666666666',local_date:day.local_date,revision:2,proposal:accepted,accepted},
      activity_ledger:{local_date:day.local_date,options:[activity],entries:[{...activity,occurred_at:null,recorded_at:'2026-10-13T16:00:00Z',updated_at:'2026-10-13T16:00:00Z',notes:'',portion:null,last_action:'rescheduled'}],recent_entries:[],summary:{tasks_completed:0,meals_eaten:0,appointments_attended:0,deferred:0}}};
    backend();render(<App/>);
    fireEvent.click(await screen.findByText('More'));
    fireEvent.click(await screen.findByRole('button',{name:'Day review'}));
    fireEvent.click(screen.getByRole('button',{name:'Propose routine test'}));
    await waitFor(()=>expect(recovery.commands.some(item=>item.family==='care')).toBe(true));
    expect(recovery.commands.find(item=>item.family==='care')!.command.payload.task_overrides[0].scheduled_time).toBe('12:15');
    expect(recovery.today.checkin.accepted.tasks[0].scheduled_time).toBe('11:30');
    fireEvent.click(screen.getByRole('button',{name:'My Day'}));
    expect(await screen.findByRole('heading',{name:'Review this plan'})).toBeInTheDocument();
    expect(screen.getByText(/Your accepted plan remains in place/)).toBeInTheDocument();
    expect(screen.getByText('12:15')).toBeInTheDocument();
    expect(recovery.today.checkin.proposal.tasks[0].scheduled_time).toBe('12:15');
  });

  it('offers scoped clinical progress under secondary views without fetching a private client day',async()=>{
    const fetchMock=vi.fn(async(path:string)=>{
      if(path==='/api/config')return response({configured:true,assistant_name:'Nancy',missing:[],voice_available:true,voice_transport:'local'});
      if(path==='/api/auth/session')return response({authenticated:true,role:'clinician',participant_id:day.profile!.id,scope_key:'scope-a',voice_eligible:false,local_features_available:true,task_requests_available:false});
      if(path==='/api/support-team')return response({local_date:'2026-10-13',time_zone:'America/Toronto'});
      throw Error(`Unexpected request ${path}`);
    });
    vi.stubGlobal('fetch',fetchMock);render(<App/>);
    expect(await screen.findByRole('heading',{name:'Clinician Partners'})).toBeInTheDocument();
    fireEvent.click(screen.getByText('More shared views and settings'));
    expect(await screen.findByText('Progress module scope-a')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([path])=>path==='/api/today')).toBe(false);
  });
});
