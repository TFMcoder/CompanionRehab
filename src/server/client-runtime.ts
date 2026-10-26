import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import { configFromEnv, loadEnvironment } from './config.js';
import { createApp } from './app.js';
import { LocalCare } from './local-care.js';
import { LocalSpeech } from './local-speech.js';
import { PlanStore, defaultPlanPath } from './chatgpt-plan/storage.js';
import { PlanReasoner } from './plan-reasoner.js';
import { ConversationService } from './conversation.js';
import { RuntimeLog } from './telemetry.js';
import { TaskRequestService } from './task-requests.js';
import { createLocalFeatures } from './local-features.js';
import {startSpeechWarmup} from './speech-startup.js';
import {createMicrosoftRuntime} from './microsoft/runtime.js';
import {resolveCaregiverInference} from './caregiver-inference.js';
import {NancySuggestions} from './nancy-suggestions.js';
import {resolve} from 'node:path';
import {ClientRolloutPolicy} from './client-rollout.js';
import {ClientSessionRenewal} from './client-session-renewal.js';
import {ClientConversationRouter,type ConversationRuntime} from './conversation-router.js';
import {WarmPlanReasoner,PlanSocket} from './chatgpt-plan/warm-connection.js';
import {reasoningCandidates} from './chatgpt-plan/inference.js';
import {warmRecipeCatalogue} from './prepared-context.js';
import {currentNutritionReference} from './nutrition-reference.js';
import type {ConversationTurnMetric,InferenceCallMetric,MealPreparationMetric,ConversationPreparationMetric} from './conversation.js';
const startedAt = performance.now();
loadEnvironment();
const config = configFromEnv();
const care = config.databaseUrl ? new LocalCare({ connectionString: config.databaseUrl }) : undefined;
const runtimeLog = care ? new RuntimeLog(care.pool) : undefined;
const taskRequests = care ? new TaskRequestService(care.pool) : undefined;
const features=care?createLocalFeatures(care.pool,{dayContext:(participant,date)=>care.preparationFacts(participant,date)}):undefined;
const microsoft=care?await createMicrosoftRuntime(config,care.pool):undefined;
const store=config.sessionKey&&config.planUserId?new PlanStore(defaultPlanPath,config.sessionKey):undefined;
const caregiver=care&&config.planUserId?resolveCaregiverInference(config.caregiverVoiceConfig,config.planUserId,care.pool):undefined;
const rollout=care&&config.planUserId&&caregiver?new ClientRolloutPolicy(resolve('.local/runtime/client-rollout.json'),config.planUserId,caregiver):undefined;
const selection=await rollout?.configuration();
const selectedPolicyRef=selection?'sha256:'+createHash('sha256').update(JSON.stringify(selection)).digest('hex'):undefined;
if(selection){
  if(config.port!==8787||new URL(config.origin).protocol!=='https:'||new URL(config.origin).port!=='8443'||config.voiceTransport!=='local'||!config.caregiverVoiceConfig)
    throw Error('The selected client release requires its existing local care HTTPS route.');
  // The selected release uses the already-bound subscription only.
  config.openaiKey=undefined;delete process.env.OPENAI_API_KEY;
  warmRecipeCatalogue(currentNutritionReference());
}
const reasoner=store&&config.planUserId?new PlanReasoner(store,config.planUserId,undefined,undefined,caregiver):undefined;
const speech=config.voiceTransport==='local'&&care&&reasoner&&await reasoner.available()?new LocalSpeech():undefined;
const fastSpeech=selection&&speech?new LocalSpeech({latencyTrial:true,dialogueTrial:true}):undefined;
const record=(metric:(ConversationTurnMetric|InferenceCallMetric|MealPreparationMetric|ConversationPreparationMetric)&{policy_ref?:string})=>{
  const { actor_id, conversation_id, turn_id, outcome, ...measurements } = metric;
  runtimeLog?.record({ kind: 'conversation', actor_id, conversation_id, turn_id, outcome: outcome === 'completed' ? 'ok' : outcome === 'failed' ? 'error' : 'interrupted', measurements });
};
const recordFast=(metric:ConversationTurnMetric|InferenceCallMetric|MealPreparationMetric|ConversationPreparationMetric)=>record({...metric,policy_ref:selectedPolicyRef});
let conversation:ConversationRuntime|undefined=speech&&care&&reasoner?new ConversationService(care,reasoner,config.planUserId!,undefined,(text,signal)=>speech.synthesize(text,signal),record,record,taskRequests,features,session=>microsoft?.eligible(session)??Promise.resolve(false),microsoft,new NancySuggestions(care.pool)):undefined;
let clientSessionRenewal:ClientSessionRenewal|undefined;
if(selection&&rollout&&care&&store&&fastSpeech&&conversation&&caregiver){
  const fastReasoner=new WarmPlanReasoner(store,config.planUserId!,selection.participant_id,metric=>{
    const {actor_id,conversation_id,outcome,...measurements}=metric;
    runtimeLog?.record({kind:'conversation',actor_id,conversation_id,outcome:outcome==='completed'?'ok':outcome==='interrupted'?'interrupted':'error',measurements:{...measurements,policy_version:'nancy-2026-10-26-client-sol-low-w2',policy_ref:selectedPolicyRef}});
  },()=>new PlanSocket(undefined,false),{actorId:selection.client_actor_id,clientId:selection.participant_id,caregiver,authorizeBinding:async binding=>{await rollout.authorizeBinding(binding);}});
  clientSessionRenewal=new ClientSessionRenewal(config.planUserId!,selection.client_actor_id,config.origin);
  const fast=new ConversationService(care,fastReasoner,config.planUserId!,undefined,(text,signal)=>fastSpeech.synthesize(text,signal),recordFast,recordFast,taskRequests,features,session=>microsoft?.eligible(session)??Promise.resolve(false),microsoft,new NancySuggestions(care.pool),
    reasoningCandidates['sol-low'],true,72,true,true,true,recordFast,true,true,recordFast,true,true,true,clientSessionRenewal,undefined,rollout);
  conversation=new ClientConversationRouter(selection.client_actor_id,conversation,fast);
}
const app = await createApp(config, { care, speech, clientSpeech:selection&&fastSpeech?{actorId:selection.client_actor_id,speech:fastSpeech}:undefined, conversation, clientSessionRenewal, runtimeLog, taskRequests, features, microsoft, staticRoot:fileURLToPath(new URL('../../dist/client',import.meta.url)) });
// Durable due jobs survive restarts. Outlook preparation is separately consented,
// exact-account read-only retrieval; it never calls a model or opens a microphone.
let schedulerBusy=false;
const runLocalJobs=async(trigger:'scheduler'|'startup'='scheduler')=>{if(!features||schedulerBusy)return;schedulerBusy=true;try{await features.day.tick(trigger);await features.support.refreshNotifications();await microsoft?.prepareMorning();}catch{console.error('Local preparation or reminder maintenance failed; it will be checked again.');}finally{schedulerBusy=false;}};
const scheduler=setInterval(()=>{void runLocalJobs();},30_000);scheduler.unref();
let stopSpeechWarmup=()=>{};
let stopFastSpeechWarmup=()=>{};
app.addHook('onClose',async()=>{clearInterval(scheduler);stopSpeechWarmup();stopFastSpeechWarmup();});
await app.listen({ host: '127.0.0.1', port: config.port });
void runLocalJobs('startup');
runtimeLog?.record({ kind: 'startup', outcome: 'ready', measurements: { stage: 'http_ready', duration_ms: performance.now() - startedAt } });
console.log(`Nancy is running at ${config.origin}.`);
// HTTP/touch comes online immediately. Warm the selected speech workers without delaying sign-in.
if(speech)stopSpeechWarmup=startSpeechWarmup(speech,ready=>{
  runtimeLog?.record({kind:'startup',outcome:ready?'ready':'unavailable',measurements:{stage:ready?'speech_ready':'speech_warmup',duration_ms:performance.now()-startedAt}});
},()=>console.error('Local speech could not become ready. Touch remains available.'));
if(fastSpeech)stopFastSpeechWarmup=startSpeechWarmup(fastSpeech,()=>{},()=>console.error('Selected client speech preparation will retry. Touch remains available.'));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
