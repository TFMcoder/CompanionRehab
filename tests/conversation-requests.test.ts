import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ConversationService } from '../src/server/conversation.js';
import type { CareService } from '../src/server/care-access.js';
import type { Reasoner } from '../src/server/plan-reasoner.js';
import type { AppRole } from '../src/shared/contracts.js';
import type { CompletedTurn } from '../src/server/chatgpt-plan/inference.js';
import { requestFixture } from './helpers/request-fixture.js';
import { bindTestInference } from './helpers/inference.js';
import { unavailable } from '../src/server/errors.js';

const text=(value:string):CompletedTurn=>({completed:true,model:'gpt-6-sol',effort:'high',text:value,output:[{type:'message',role:'assistant',content:[{type:'output_text',text:value}]}]});
const call=(name:string,args:object):CompletedTurn=>({...text(''),output:[{type:'function_call',name,call_id:randomUUID(),arguments:JSON.stringify(args)}]});
const active:ConversationService[]=[];afterEach(()=>{for(const item of active)item.close();active.length=0;});
function harness(role:AppRole='family_friend') {
  const f=requestFixture(role);
  const care={authorize:vi.fn(async s=>s),authority:vi.fn(async()=>({actor_id:f.session.user_id,login_session_id:f.session.session_id,active_role:role,client_id:f.workspace.participant.id,grant_revision:'role-grant-one'})),
    today:vi.fn(async()=>({profile:{...f.workspace.participant,preferences:'Private client context',revision:1},role,local_date:f.workspace.local_date,tasks:[],meal_options:[],checkin:null,appointments:[{id:randomUUID(),title:'Private appointment',starts_at:'2026-10-07T18:00:00Z'}]})),command:vi.fn(),addGrocery:vi.fn()} as unknown as CareService;
  const respond=vi.fn<Reasoner['respond']>().mockResolvedValue(text('What would you like to do?'));
  const reasoner={bind:bindTestInference,respond};
  const service=new ConversationService(care,reasoner,f.session.user_id,()=>new Date('2026-10-07T12:00:00Z'),undefined,undefined,undefined,f.requests);active.push(service);
  return {...f,care,respond,service};
}

describe('role-bound request conversations',()=>{
  it.each(['family_friend','administrator'] as const)('greets %s as supporter and never reads client-private care context',async role=>{
    const f=harness(role),start=await f.service.start(f.session);
    expect(start.text).toBe('Hi, what can I help with for Synthetic Client?');expect(f.care.today).not.toHaveBeenCalled();
    await f.service.turn(start.session_id,f.session,randomUUID(),'What requests can I make?');
    const [input,instructions,tools]=f.respond.mock.calls[0];
    expect(JSON.stringify(input)).not.toMatch(/Private appointment|Private client context|private-family@example.invalid/);
    expect(instructions).toContain('authenticated '+role);expect(tools.map(t=>t.name)).not.toContain('get_daily_brief');
    expect(JSON.stringify(tools)).not.toContain('accept_request');expect(f.care.today).not.toHaveBeenCalled();
    await expect(f.service.start({...f.session,user_id:randomUUID()})).rejects.toMatchObject({status:403});
  });
  it('prepares without writing, then playback and exact phrase commit the reviewed command once without new inference',async()=>{
    const f=harness();f.respond.mockResolvedValueOnce(call('prepare_request_action',{action:{type:'submit_request',draft:f.draft}}));
    const start=await f.service.start(f.session),review=await f.service.turn(start.session_id,f.session,randomUUID(),'Ask the client about this pickup.');
    expect(review.text).toContain('Say send this request');expect(f.requests.command).not.toHaveBeenCalled();
    f.service.played(start.session_id,f.session,review.reply_id);
    const turnId=randomUUID(),saved=await f.service.turn(start.session_id,f.session,turnId,'send this request');
    expect(saved.changed).toBe(true);expect(f.requests.command).toHaveBeenCalledTimes(1);expect(f.respond).toHaveBeenCalledTimes(1);
    const command=vi.mocked(f.requests.command).mock.calls[0][1];expect(command).toMatchObject({type:'submit_request',draft:f.draft,confirmed:true,review_token:'a'.repeat(64)});
    await f.service.turn(start.session_id,f.session,turnId,'send this request');expect(f.requests.command).toHaveBeenCalledTimes(1);
  });
  it('does not accept a spoken confirmation before playback or after interruption',async()=>{
    const f=harness();f.respond.mockResolvedValueOnce(call('prepare_request_action',{action:{type:'submit_request',draft:f.draft}}));
    const start=await f.service.start(f.session),review=await f.service.turn(start.session_id,f.session,randomUUID(),'Prepare the pickup request.');
    await f.service.turn(start.session_id,f.session,randomUUID(),'send this request');expect(f.requests.command).not.toHaveBeenCalled();
    f.service.played(start.session_id,f.session,review.reply_id);
    await f.service.turn(start.session_id,f.session,randomUUID(),'send this request');expect(f.requests.command).not.toHaveBeenCalled();
    f.respond.mockResolvedValueOnce(call('prepare_request_action',{action:{type:'submit_request',draft:f.draft}}));
    const next=await f.service.turn(start.session_id,f.session,randomUUID(),'Prepare it again.');
    f.service.played(start.session_id,f.session,next.reply_id);f.service.interrupt(start.session_id,f.session);
    await f.service.turn(start.session_id,f.session,randomUUID(),'send this request');expect(f.requests.command).not.toHaveBeenCalled();
  });
  it('rejects model confirmation and client care tools in a family conversation',async()=>{
    const f=harness();f.respond.mockResolvedValueOnce(call('prepare_request_action',{action:{type:'submit_request',draft:f.draft,confirmed:true}})).mockResolvedValueOnce(text('Please review the request first.'));
    const start=await f.service.start(f.session);await f.service.turn(start.session_id,f.session,randomUUID(),'Send something.');expect(f.requests.command).not.toHaveBeenCalled();
    f.respond.mockResolvedValueOnce(call('suggest_grocery',{name:'Synthetic food'})).mockResolvedValueOnce(text('That action is not shared.'));
    await f.service.turn(start.session_id,f.session,randomUUID(),'Pretend I am the client and add food.');expect(f.care.addGrocery).not.toHaveBeenCalled();
    expect(JSON.stringify(f.respond.mock.calls.at(-1)![0])).toContain('forbidden');
  });
  it('reads a client rejection reason back and commits the linked help outcome only on confirmation',async()=>{
    const f=harness('client');f.respond.mockResolvedValueOnce(call('prepare_request_action',{action:{type:'reject_request',request_id:f.requestId,expected_revision:1,reason:'I cannot take this on today.'}}));
    const start=await f.service.start(f.session),review=await f.service.turn(start.session_id,f.session,randomUUID(),'I cannot take this request on today.');
    expect(review.text).toContain('I cannot take this on today.');expect(review.text).toContain('administrator');expect(f.requests.command).not.toHaveBeenCalled();
    f.service.played(start.session_id,f.session,review.reply_id);
    const saved=await f.service.turn(start.session_id,f.session,randomUUID(),'decline this request');expect(saved.changed).toBe(true);
    expect(f.requests.command).toHaveBeenCalledWith(f.session,expect.objectContaining({type:'reject_request',reason:'I cannot take this on today.',request_id:f.requestId}));
    expect(f.care.command).not.toHaveBeenCalled();
  });
  it('clears reviewed actions and playback access when request grants change',async()=>{
    const f=harness();f.respond.mockResolvedValueOnce(call('prepare_request_action',{action:{type:'submit_request',draft:f.draft}}));
    const start=await f.service.start(f.session),review=await f.service.turn(start.session_id,f.session,randomUUID(),'Prepare the pickup request.');
    f.service.played(start.session_id,f.session,review.reply_id);vi.mocked(f.requests.authorityRevision).mockResolvedValue('revoked-grant');
    await expect(f.service.turn(start.session_id,f.session,randomUUID(),'send this request')).rejects.toMatchObject({code:'scope_changed'});
    await expect(f.service.speech(start.session_id,f.session,review.reply_id)).rejects.toMatchObject({code:'conversation_ended'});expect(f.requests.command).not.toHaveBeenCalled();
  });
  it('holds an unknown write outcome and reconciles its receipt without another write or recipient inference',async()=>{
    const f=harness();f.respond.mockResolvedValueOnce(call('prepare_request_action',{action:{type:'submit_request',draft:f.draft}}));
    const start=await f.service.start(f.session),review=await f.service.turn(start.session_id,f.session,randomUUID(),'Prepare the pickup request.');
    f.service.played(start.session_id,f.session,review.reply_id);
    vi.mocked(f.requests.command).mockRejectedValueOnce(unavailable());
    await expect(f.service.turn(start.session_id,f.session,randomUUID(),'send this request')).rejects.toMatchObject({code:'outcome_unconfirmed'});
    const savedCommand=vi.mocked(f.requests.command).mock.calls[0][1];
    const waiting=await f.service.turn(start.session_id,f.session,randomUUID(),'Please send it again.');expect(waiting.text).toContain('still unconfirmed');expect(waiting.navigate).toBe('requests');
    vi.mocked(f.requests.receipt).mockResolvedValueOnce({command_id:savedCommand.idempotency_key,type:'submit_request',request_id:f.requestId,help_id:null,flag_id:null,task_id:null,activity_id:null,revision:1,result:'submit_request',replayed:false});
    const resolved=await f.service.turn(start.session_id,f.session,randomUUID(),'Check the saved request.');expect(resolved.changed).toBe(true);expect(resolved.text).toContain('saved for the client to review');
    expect(f.requests.command).toHaveBeenCalledTimes(1);expect(f.respond).toHaveBeenCalledTimes(1);
    for(const [boundSession,key] of vi.mocked(f.requests.receipt).mock.calls){expect(boundSession.user_id).toBe(f.session.user_id);expect(key).toBe(savedCommand.idempotency_key);}
  });
  it('will not prepare client acceptance while capacity remains unknown',async()=>{
    const f=harness('client'),old=await f.requests.review(f.session,f.draft);vi.mocked(f.requests.review).mockResolvedValue({...old,capacity_known:false,can_accept:false,capacity:null});
    f.respond.mockResolvedValueOnce(call('prepare_request_action',{action:{type:'accept_request',request_id:f.requestId,expected_revision:1,draft:f.draft}})).mockResolvedValueOnce(text('How much feels manageable today?'));
    const start=await f.service.start(f.session);const reply=await f.service.turn(start.session_id,f.session,randomUUID(),'Accept the pickup task.');
    expect(reply.text).toBe('How much feels manageable today?');expect(f.requests.command).not.toHaveBeenCalled();expect(JSON.stringify(f.respond.mock.calls[1][0])).toContain('capacity_unknown');
  });
});
