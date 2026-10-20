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
