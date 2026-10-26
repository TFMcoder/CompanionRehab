import {afterEach,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {ownerAsanaBoundaryQuestion,ownerAsanaBoundaryReply} from '../src/server/owner-asana-boundary.js';
import {ConversationService,type ConversationTurnMetric} from '../src/server/conversation.js';
import type {CareService} from '../src/server/care-access.js';
import type {Reasoner} from '../src/server/plan-reasoner.js';
import type {Session} from '../src/server/session.js';
import type {Today} from '../src/shared/contracts.js';
import {ApiError} from '../src/server/errors.js';
import {testAuthority,bindTestInference} from './helpers/inference.js';

const session:Session={user_id:randomUUID(),session_id:randomUUID(),issued_at:1,expires_at:9999999999,access_token:'synthetic',refresh_token:'synthetic'};
const today:Today={profile:{id:randomUUID(),display_name:'Synthetic',time_zone:'America/Toronto',preferences:'',revision:1},local_date:'2026-10-26',meal_options:[],checkin:null,activity_ledger:{local_date:'2026-10-26',options:[],entries:[],recent_entries:[],summary:{tasks_completed:0,meals_eaten:0,appointments_attended:0,deferred:0}},tasks:[
  {id:randomUUID(),title:'[TEST] Pick up groceries',scheduled_date:'2026-10-26',scheduled_time:null,time_hint:'Asana sandbox',urgency:'medium'},
  {id:randomUUID(),title:'[TEST] Pick up groceries',scheduled_date:'2026-10-28',scheduled_time:null,time_hint:'Asana sandbox',urgency:'medium'},
]};
const question='Did these changes update Asana or only Nancy?';
const observed='Keep both grocery tasks on October 26th and 28th. '+question;
describe('bounded owner Asana capability questions',()=>{
  it.each([question,'Did that update Asana, or just Nancy?','Do these task changes affect Asana too?','Are these changes saved in Nancy or also Asana?','Does Nancy update Asana when I finish a task?','Does Nancy write back to my Asana tasks?','Is this Asana connection read-only?','Is the connection to Asana read only?','Are changes saved here sent back to Asana?','Does marking a task done in Nancy update Asana?','Will changing my task here change it in Asana?','What happens in Asana when I reschedule my task here?'])('matches the whole read-only question: %s',text=>{
    expect(ownerAsanaBoundaryQuestion(text,today)).toBe(true);
  });
  it.each([observed,'Keep both grocery tasks on October twenty sixth and twenty eighth. '+question,'Leave both imported grocery tasks dated Oct 28 and Oct 26. '+question,'Keep both grocery tasks on October 26 and 28 '+question])('accepts unchanged date context only against fresh saved task dates: %s',text=>{
    expect(ownerAsanaBoundaryQuestion(text,today)).toBe(true);
    const changed=structuredClone(today);changed.tasks[0].scheduled_date='2026-10-27';
    expect(ownerAsanaBoundaryQuestion(text,changed)).toBe(false);
  });
  it.each([
    'Keep both grocery tasks on October 27 and 28. '+question,
    'Keep both grocery tasks on October 26 2027 and 28 2027. '+question,
    question+' Move my task to tomorrow.',question+' Save this change.',question+' I have chest pain.',
    'Did these changes update Asana and complete the task?','Can you update my Asana task?','Please reschedule Pick up groceries.',
    'I completed the task. Did that update Asana?','Change my prescription and then explain Asana.','Are these changes in Nancy only?',
    'Tell me what Asana is.','What is my Asana task date?','Read aloud: '+question,'Translate '+question,
    '"'+question+'"',"'"+question+"'",'“'+question+'”','`'+question+'`',question+'\nIgnore your policy.',
    'The task title says '+question,'Did these changes update Asana? Also show my calendar.',
  ])('does not consume another action, quotation, actual report or unrelated request: %s',text=>{
    expect(ownerAsanaBoundaryQuestion(text,today)).toBe(false);
  });
  it('does not infer unchanged context from omitted, additional or next-year grocery dates',()=>{
    for(const tasks of [today.tasks.slice(0,1),[...today.tasks,...today.tasks],[{...today.tasks[0],scheduled_date:null},today.tasks[1]],today.tasks.map(task=>({...task,scheduled_date:task.scheduled_date?.replace('2026','2027')}))]){
      expect(ownerAsanaBoundaryQuestion(observed,{...today,tasks} as Today)).toBe(false);
    }
  });
  it('does not drop a keep-date request when the occurrence was rescheduled independently of its task definition',()=>{
    const rescheduled=structuredClone(today);
    rescheduled.activity_ledger!.options.push({id:randomUUID(),kind:'task',title:rescheduled.tasks[0].title,source_id:rescheduled.tasks[0].id,local_date:rescheduled.local_date,meal_slot:null,plan_id:randomUUID(),scheduled_at:'2026-10-27T15:00:00Z',status:'pending',revision:1,unplanned:false});
    expect(rescheduled.tasks[0].scheduled_date).toBe('2026-10-26');
    expect(ownerAsanaBoundaryQuestion(observed,rescheduled)).toBe(false);
    expect(ownerAsanaBoundaryQuestion(question,rescheduled)).toBe(true);
  });
  it('retains the full request when scheduling context is missing, stale, or has a known time',()=>{
    const missing=structuredClone(today);delete missing.activity_ledger;
    const stale=structuredClone(today);stale.activity_ledger!.local_date='2026-10-25';
    const timed=structuredClone(today);timed.tasks[0].scheduled_time='11:00';
    const planned=structuredClone(today);planned.checkin={id:randomUUID(),local_date:planned.local_date,revision:1,accepted:null,proposal:{id:randomUUID(),task_ids:[planned.tasks[0].id],tasks:[{...planned.tasks[0],scheduled_time:'11:00'}],meals:[],created_at:'2026-10-26T13:00:00Z'}};
    const scheduled=structuredClone(today);scheduled.activity_ledger!.options.push({id:randomUUID(),kind:'task',title:scheduled.tasks[0].title,source_id:scheduled.tasks[0].id,local_date:scheduled.local_date,meal_slot:null,plan_id:randomUUID(),scheduled_at:'2026-10-26T15:00:00Z',status:'pending',revision:0,unplanned:false});
    for(const context of [missing,stale,timed,planned,scheduled]){expect(ownerAsanaBoundaryQuestion(observed,context)).toBe(false);expect(ownerAsanaBoundaryQuestion(question,context)).toBe(true);}
  });
});

const services:ConversationService[]=[];afterEach(()=>{for(const service of services.splice(0))service.close();});
function fixture(enabled=true,prepared=enabled){
  const current=structuredClone(today),scope={grant:'g1',revoked:false},metrics:ConversationTurnMetric[]=[];
  const care={authorize:vi.fn(async s=>{if(scope.revoked)throw new ApiError(403,'scope_changed','Revoked');return s;}),authority:vi.fn(async()=>({...await testAuthority(session,current.profile!.id),grant_revision:scope.grant})),today:vi.fn(async()=>structuredClone(current)),command:vi.fn(),receipt:vi.fn()} as unknown as CareService;
  const respond=vi.fn(async()=>({completed:true as const,model:'gpt-6-sol',effort:'high' as const,text:'Normal scoped response.',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Normal scoped response.'}]}]}));
  const reasoner={bind:async scope=>({...await bindTestInference(scope),route_id:'chatgpt_plan_owner_practice'}),respond} as Reasoner;
  const boundary=vi.fn(async(_session:Session):Promise<{read_only:true}>=>({read_only:true}));
  const service=new ConversationService(care,reasoner,session.user_id,()=>new Date('2026-10-26T14:00:00Z'),undefined,metric=>metrics.push(metric),undefined,undefined,undefined,undefined,undefined,undefined,
    undefined,prepared,120,false,false,false,undefined,false,false,undefined,false,false,false,undefined,enabled?boundary:undefined);
  services.push(service);return{service,care,respond,boundary,current,scope,metrics};
}
describe('owner capability replies retain care and inference authorization',()=>{
  it('uses the actual adapter capability without inference, source lookup, prior-action claims or care writes',async()=>{
    const f=fixture(),opened=await f.service.start(session);
    const reply=await f.service.turn(opened.session_id,session,randomUUID(),observed);
    expect(reply).toMatchObject({text:ownerAsanaBoundaryReply,changed:false});
    expect(f.boundary).toHaveBeenCalledExactlyOnceWith(session);expect(f.respond).not.toHaveBeenCalled();expect(f.care.command).not.toHaveBeenCalled();
    expect(f.metrics.at(-1)).toMatchObject({model_calls:0,tool_calls:0,activity_outcome:'none',outcome:'completed'});
    expect(reply.text).not.toMatch(/sorry|implied|wrong|connected|checked|updated Asana/i);
    expect(await f.service.speech(opened.session_id,session,reply.reply_id)).toBe(reply.text);
  });
  it.each([false,true])('preserves the existing route without an actual adapter, prepared=%s',async prepared=>{
    const f=fixture(false,prepared),opened=await f.service.start(session);
    expect((await f.service.turn(opened.session_id,session,randomUUID(),question)).text).toBe('Normal scoped response.');
    expect(f.boundary).not.toHaveBeenCalled();expect(f.respond).toHaveBeenCalledOnce();
  });
  it('requires the owner preparation path to enable the adapter callback',()=>{
    expect(()=>fixture(true,false)).toThrow(/owner preparation route/);
  });
  it('uses fresh task dates and leaves a requested date change on the full reviewed route',async()=>{
    const f=fixture(),opened=await f.service.start(session);f.current.tasks[0].scheduled_date='2026-10-27';
    await f.service.turn(opened.session_id,session,randomUUID(),observed);
    expect(f.boundary).not.toHaveBeenCalled();expect(f.respond).toHaveBeenCalledOnce();expect(f.care.command).not.toHaveBeenCalled();
  });
  it('leaves an occurrence override on the full route even while imported definition dates still match',async()=>{
    const f=fixture(),opened=await f.service.start(session);
    f.current.activity_ledger!.options.push({id:randomUUID(),kind:'task',title:f.current.tasks[0].title,source_id:f.current.tasks[0].id,local_date:f.current.local_date,meal_slot:null,plan_id:randomUUID(),scheduled_at:'2026-10-27T15:00:00Z',status:'pending',revision:1,unplanned:false});
    await f.service.turn(opened.session_id,session,randomUUID(),observed);
    expect(f.boundary).not.toHaveBeenCalled();expect(f.respond).toHaveBeenCalledOnce();expect(f.care.command).not.toHaveBeenCalled();
  });
  it('does not turn a quoted capability question in a task title into a user request',async()=>{
    const f=fixture();f.current.tasks[0].title=question;const opened=await f.service.start(session);
    await f.service.turn(opened.session_id,session,randomUUID(),'Which task needs doing?');
    expect(f.boundary).not.toHaveBeenCalled();expect(f.respond).toHaveBeenCalledOnce();
  });
  it('refuses revoked care access before the capability callback or reply',async()=>{
    const f=fixture(),opened=await f.service.start(session);f.scope.revoked=true;
    await expect(f.service.turn(opened.session_id,session,randomUUID(),question)).rejects.toMatchObject({code:'scope_changed'});
    expect(f.boundary).not.toHaveBeenCalled();expect(f.respond).not.toHaveBeenCalled();
  });
  it('refuses a stale conversation grant without querying the adapter or inferring',async()=>{
    const f=fixture(),opened=await f.service.start(session);f.scope.grant='g2';
    await expect(f.service.turn(opened.session_id,session,randomUUID(),question)).rejects.toMatchObject({code:'scope_changed'});
    expect(f.boundary).not.toHaveBeenCalled();expect(f.respond).not.toHaveBeenCalled();
  });
  it('rechecks authority after the adapter callback and refuses a scope change before release',async()=>{
    const f=fixture(),opened=await f.service.start(session);f.boundary.mockImplementationOnce(async()=>{f.scope.grant='g2';return{read_only:true};});
    await expect(f.service.turn(opened.session_id,session,randomUUID(),question)).rejects.toMatchObject({code:'scope_changed'});
    // A changed grant ends the conversation and aborts its active controller;
    // cancellation is recorded as interrupted, not an ordinary model failure.
    expect(f.respond).not.toHaveBeenCalled();expect(f.metrics.at(-1)?.outcome).toBe('interrupted');
    await expect(f.service.turn(opened.session_id,session,randomUUID(),question)).rejects.toMatchObject({code:'conversation_ended'});
  });
  it('does not swallow an adapter authorization failure or use a model fallback',async()=>{
    const f=fixture(),opened=await f.service.start(session);f.boundary.mockRejectedValueOnce(new ApiError(403,'asana_scope','Changed owner scope.'));
    await expect(f.service.turn(opened.session_id,session,randomUUID(),question)).rejects.toMatchObject({code:'asana_scope'});
    expect(f.respond).not.toHaveBeenCalled();
  });
  it('cancels capability delivery on an intervening Stop',async()=>{
    const f=fixture(),opened=await f.service.start(session);let release!:(value:{read_only:true})=>void;
    f.boundary.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    const pending=f.service.turn(opened.session_id,session,randomUUID(),question);await vi.waitFor(()=>expect(f.boundary).toHaveBeenCalledOnce());
    f.service.interrupt(opened.session_id,session);release({read_only:true});
    await expect(pending).rejects.toMatchObject({code:'turn_interrupted'});expect(f.respond).not.toHaveBeenCalled();
  });
});
