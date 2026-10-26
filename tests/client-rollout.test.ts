import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve,sep} from 'node:path';
import {ClientRolloutPolicy,clientRolloutSchema,clientRolloutPath,type ClientRolloutConfig} from '../src/server/client-rollout.js';
import type {InferenceBinding,InferenceScope} from '../src/server/inference-binding.js';
import {NANCY_POLICY_VERSION} from '../src/server/inference-binding.js';
import type {CaregiverInferenceAuthorization,ResolveCaregiverInference} from '../src/server/caregiver-inference.js';
import {ConversationService} from '../src/server/conversation.js';
import type {CareService} from '../src/server/care-access.js';
import type {Reasoner} from '../src/server/plan-reasoner.js';
import type {Session} from '../src/server/session.js';
import type {Today} from '../src/shared/contracts.js';
import {reasoningCandidates} from '../src/server/chatgpt-plan/inference.js';
import {ApiError} from '../src/server/errors.js';

const cleanups:Array<()=>Promise<unknown>|void>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
async function fixture(){
  const directory=resolve('.local/runtime/client-rollout-test-'+randomUUID());
  if(!directory.startsWith(resolve('.local/runtime')+sep))throw Error('Unsafe test directory');
  await mkdir(directory,{recursive:true});cleanups.push(()=>rm(directory,{recursive:true,force:true}));
  const path=resolve(directory,'selection.json'),owner=randomUUID(),actor=randomUUID(),participant=randomUUID();
  const config:ClientRolloutConfig={schema_version:1,enabled:true,owner_actor_id:owner,client_actor_id:actor,participant_id:participant,
    account_binding_id:randomUUID(),host_id:'urn:uuid:'+randomUUID(),caregiver_authorization_ref:'sha256:'+'a'.repeat(64),
    approved_at:'2026-10-26T12:00:00Z',authorization_ref:'Synthetic exact-client rollout test',profile:'sol-low',context_mode:'prepared-v1',speech_mode:'heart-latency-v1',read_mode:'quick-v1',reply_mode:'spoken-v1',meal_mode:'ahead-v1',continuation_mode:'dialogue-v1',chat_mode:'ahead-v1',reference_mode:'verified-v1',connection_mode:'warm-v2'};
  const authority:CaregiverInferenceAuthorization={ownerActorId:owner,accountBindingId:config.account_binding_id,hostId:config.host_id,authorizationRef:config.caregiver_authorization_ref};
  const caregiver=vi.fn<ResolveCaregiverInference>(async()=>({...authority}));
  const save=async(value:unknown=config)=>writeFile(path,JSON.stringify(value));await save();
  const policy=new ClientRolloutPolicy(path,owner,caregiver);
  const scope:InferenceScope={actor_id:actor,login_session_id:randomUUID(),active_role:'client',client_id:participant,grant_revision:'synthetic-care-grants-v1',policy_version:NANCY_POLICY_VERSION};
  const binding=async():Promise<InferenceBinding>=>{
    const selected=await policy.authorizeScope(scope);if(!selected)throw Error('Fixture selection unavailable');
    return {...scope,policy_version:selected.policyVersion,route_id:'chatgpt_plan_caregiver',qualification:'caregiver_authorized',account_binding_id:config.account_binding_id,account_owner_actor_id:owner,authorization_ref:authority.authorizationRef};
  };
  return{directory,path,config,owner,actor,participant,authority,caregiver,policy,scope,binding,save};
}

describe('explicit client rollout selection',()=>{
  it('binds the fixed qualified profile to the actual client and existing account authorization',async()=>{
    const f=await fixture(),bound=await f.binding(),selected=await f.policy.authorizeBinding(bound);
    expect(selected).toMatchObject({ownerActorId:f.owner,actorId:f.actor,clientId:f.participant,accountBindingId:f.config.account_binding_id,hostId:f.config.host_id,caregiverAuthorizationRef:f.authority.authorizationRef,settings:{model:'gpt-6-sol',effort:'low',speechPartSize:72,warmConnection:true}});
    expect(bound.policy_version).toBe(selected.policyVersion);expect(bound.policy_version).toContain(selected.policyHash);expect(f.caregiver).toHaveBeenCalledTimes(2);
  });
  it('treats established actor and participant UUID namespaces independently',async()=>{
    const f=await fixture();f.config.participant_id=f.owner;f.scope.client_id=f.owner;await f.save();
    expect((await f.policy.authorizeScope(f.scope))?.clientId).toBe(f.owner);
    expect(clientRolloutSchema.safeParse({...f.config,client_actor_id:f.owner}).success).toBe(false);
  });
  it('confines the selected file to ignored local runtime storage',()=>{
    expect(()=>clientRolloutPath('docs/selection.json')).toThrow(/local runtime/);
    expect(()=>clientRolloutPath('.local/runtime/../owner-test/config.json')).toThrow(/local runtime/);
    expect(()=>clientRolloutPath('.local/runtime')).toThrow(/local runtime/);
  });
  it.each(['sol-high','sol-none','luna-low'])('refuses a different reasoning profile instead of silently selecting %s',async profile=>{
    const f=await fixture();await f.save({...f.config,profile});
    await expect(f.policy.authorizeScope(f.scope)).rejects.toMatchObject({code:'client_rollout_unavailable'});
  });
  it('refuses undeclared modes and extra access controls',async()=>{
    const f=await fixture();for(const value of [{...f.config,connection_mode:'warm-v3'},{...f.config,allow_all_clients:true},{...f.config,reference_mode:undefined}]){
      await f.save(value);await expect(f.policy.authorizeScope(f.scope)).rejects.toMatchObject({code:'client_rollout_unavailable'});
    }
  });
  it('does not grant another actor, participant or role the selected route',async()=>{
    const f=await fixture();for(const scope of [{...f.scope,actor_id:randomUUID()},{...f.scope,client_id:randomUUID()},{...f.scope,active_role:'administrator' as const},{...f.scope,active_role:'family_friend' as const},{...f.scope,actor_id:f.owner}])expect(await f.policy.authorizeScope(scope)).toBeUndefined();
    expect(f.caregiver).not.toHaveBeenCalled();
  });
  it('refuses missing or revoked caregiver authority and changed account/host/reference',async()=>{
    const f=await fixture();for(const authority of [undefined,{...f.authority,ownerActorId:randomUUID()},{...f.authority,accountBindingId:randomUUID()},{...f.authority,hostId:'urn:uuid:'+randomUUID()},{...f.authority,authorizationRef:'sha256:'+'b'.repeat(64)}]){
      f.caregiver.mockResolvedValueOnce(authority);await expect(f.policy.authorizeScope(f.scope)).rejects.toMatchObject({code:'client_rollout_changed'});
    }
  });
  it('invalidates an issued binding when selection, approval, or caregiver grants change',async()=>{
    const f=await fixture(),bound=await f.binding();await f.save({...f.config,approved_at:'2026-10-26T12:01:00Z'});
    await expect(f.policy.authorizeBinding(bound)).rejects.toMatchObject({code:'client_rollout_changed'});
    await f.save();f.authority.authorizationRef='sha256:'+'b'.repeat(64);
    await expect(f.policy.authorizeBinding(bound)).rejects.toMatchObject({code:'client_rollout_changed'});
  });
  it('rechecks a selection change while caregiver authorization is awaiting',async()=>{
    const f=await fixture();let release!:(value:CaregiverInferenceAuthorization)=>void;
    f.caregiver.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    const pending=f.policy.authorizeScope(f.scope);await vi.waitFor(()=>expect(f.caregiver).toHaveBeenCalledOnce());await f.save({...f.config,enabled:false});release(f.authority);
    await expect(pending).rejects.toMatchObject({code:'client_rollout_changed'});
  });
  it('disabled, absent and malformed configuration never authorizes a bound conversation',async()=>{
    const f=await fixture(),bound=await f.binding();await f.save({...f.config,enabled:false});expect(await f.policy.authorizeScope(f.scope)).toBeUndefined();
    await expect(f.policy.authorizeBinding(bound)).rejects.toMatchObject({code:'client_rollout_changed'});
    await rm(f.path);expect(await f.policy.authorizeScope(f.scope)).toBeUndefined();
    await writeFile(f.path,'invalid json');await expect(f.policy.authorizeBinding(bound)).rejects.toMatchObject({code:'client_rollout_unavailable'});
  });
  it('rejects route, policy, qualification, account and speaker tampering',async()=>{
    const f=await fixture(),bound=await f.binding();for(const changed of [{route_id:'chatgpt_plan_owner_practice'},{qualification:'owner_practice' as const},{account_owner_actor_id:randomUUID()},{account_binding_id:randomUUID()},{authorization_ref:'sha256:'+'c'.repeat(64)},{actor_id:randomUUID()},{active_role:'administrator' as const},{client_id:randomUUID()},{policy_version:NANCY_POLICY_VERSION}]){
      await expect(f.policy.authorizeBinding({...bound,...changed})).rejects.toMatchObject({code:'client_rollout_changed'});
    }
  });
});

async function conversationFixture(enabled=true){
  const f=await fixture(),current={grant:'g1',role:'client' as 'client'|'family_friend',actor:f.actor,client:f.participant,login:f.scope.login_session_id};
  const session:Session={user_id:f.actor,session_id:f.scope.login_session_id,issued_at:1,expires_at:9999999999,access_token:'synthetic',refresh_token:'synthetic'};
  const today:Today={profile:{id:f.participant,display_name:'Synthetic client',time_zone:'America/Toronto',preferences:'',revision:1},local_date:'2026-10-26',tasks:[],meal_options:[],checkin:null};
  const care={authorize:vi.fn(async()=>session),authority:vi.fn(async()=>({actor_id:current.actor,login_session_id:current.login,active_role:current.role,client_id:current.client,grant_revision:current.grant})),today:vi.fn(async()=>structuredClone(today)),command:vi.fn(),receipt:vi.fn()} as unknown as CareService;
  const respond=vi.fn(async()=>({completed:true as const,model:'gpt-6-sol',effort:'low',text:'Synthetic bounded answer.',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Synthetic bounded answer.'}]}]}));
  const bind=vi.fn(async(scope:InferenceScope):Promise<InferenceBinding>=>({...scope,route_id:'chatgpt_plan_caregiver',qualification:'caregiver_authorized',account_binding_id:f.config.account_binding_id,account_owner_actor_id:f.owner,authorization_ref:f.authority.authorizationRef}));
  const reasoner={bind,respond,warmConnection:vi.fn(async()=>{}),releaseConnection:vi.fn()} as Reasoner;
  const service=new ConversationService(care,reasoner,f.owner,()=>new Date('2026-10-26T14:00:00Z'),undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,
    reasoningCandidates['sol-low'],true,72,true,true,true,undefined,true,true,undefined,true,true,true,undefined,undefined,enabled?f.policy:undefined);
  cleanups.push(()=>service.close());return{...f,current,session,today,care,bind,respond,reasoner,service};
}
describe('exact client performance route retains conversation authorization',()=>{
  it('starts only the selected caregiver client and permits freshly scoped meal status',async()=>{
    const f=await conversationFixture(),opened=await f.service.start(f.session);
    expect(opened.text).toContain('Synthetic client');expect(f.bind.mock.calls[0][0]).toMatchObject({actor_id:f.actor,client_id:f.participant,active_role:'client'});
    expect(f.bind.mock.calls[0][0].policy_version).toContain(':client-rollout-v1:');
    expect(await f.service.voiceAccess(f.session)).toMatchObject({connection:'caregiver_authorized'});
    expect(await f.service.mealPreparationStatus(f.session)).toEqual({state:'unavailable'});expect(f.care.command).not.toHaveBeenCalled();
  });
  it('retains the owner-only experiment guard when no explicit client policy is supplied',async()=>{
    const f=await conversationFixture(false);await expect(f.service.start(f.session)).rejects.toMatchObject({code:'experiment_owner_only'});expect(f.bind).not.toHaveBeenCalled();
  });
  it('refuses changed actor/client/role scope before a selected-client inference call',async()=>{
    for(const change of ['actor','client','role'] as const){const f=await conversationFixture();if(change==='role')f.current.role='family_friend';else f.current[change]=randomUUID();
      await expect(f.service.start(f.session)).rejects.toBeInstanceOf(ApiError);expect(f.respond).not.toHaveBeenCalled();
    }
  });
  it('requires the care service login identity to match the actual session before selecting a profile',async()=>{
    const f=await conversationFixture();f.current.login=randomUUID();
    await expect(f.service.start(f.session)).rejects.toMatchObject({code:'scope_changed'});expect(f.bind).not.toHaveBeenCalled();expect(f.caregiver).not.toHaveBeenCalled();
  });
  it('ends the old conversation and its prepared delivery when the rollout selection changes',async()=>{
    const f=await conversationFixture(),opened=await f.service.start(f.session);await f.save({...f.config,approved_at:'2026-10-26T12:02:00Z'});
    await expect(f.service.speech(opened.session_id,f.session,opened.reply_id)).rejects.toMatchObject({code:'scope_changed'});
    await expect(f.service.turn(opened.session_id,f.session,randomUUID(),'Thanks')).rejects.toMatchObject({code:'conversation_ended'});expect(f.respond).not.toHaveBeenCalled();
  });
  it('discards an in-flight answer when the selected policy changes during inference',async()=>{
    const f=await conversationFixture(),opened=await f.service.start(f.session);let release!:(value:Awaited<ReturnType<typeof f.respond>>)=>void;
    f.respond.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    const pending=f.service.turn(opened.session_id,f.session,randomUUID(),'What do salamanders eat?');await vi.waitFor(()=>expect(f.respond).toHaveBeenCalledOnce());
    await f.save({...f.config,approved_at:'2026-10-26T12:03:00Z'});release({completed:true,model:'gpt-6-sol',effort:'low',text:'A late answer.',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'A late answer.'}]}]});
    await expect(pending).rejects.toMatchObject({code:'scope_changed'});await expect(f.service.speech(opened.session_id,f.session,opened.reply_id)).rejects.toMatchObject({code:'conversation_ended'});expect(f.care.command).not.toHaveBeenCalled();
  });
  it('keeps the ordinary owner-practice route unchanged without a client policy',async()=>{
    const f=await fixture(),session:Session={user_id:f.owner,session_id:randomUUID(),issued_at:1,expires_at:9999999999,access_token:'synthetic',refresh_token:'synthetic'};
    const care={authorize:async()=>session,authority:async()=>({actor_id:f.owner,login_session_id:session.session_id,active_role:'client' as const,client_id:f.participant,grant_revision:'g1'}),today:async()=>({profile:{id:f.participant,display_name:'Owner practice',time_zone:'America/Toronto',preferences:'',revision:1},local_date:'2026-10-26',tasks:[],meal_options:[],checkin:null})} as unknown as CareService;
    const bind=vi.fn(async(scope:InferenceScope)=>({...scope,route_id:'chatgpt_plan_owner_practice',qualification:'owner_practice' as const,account_binding_id:f.config.account_binding_id}));
    const service=new ConversationService(care,{bind,respond:vi.fn()} as unknown as Reasoner,f.owner);cleanups.push(()=>service.close());
    expect((await service.start(session)).text).toContain('Owner practice');expect(bind.mock.calls[0][0].policy_version).toBe(NANCY_POLICY_VERSION);expect(await service.voiceAccess(session)).toMatchObject({connection:'owner_practice'});
  });
});
