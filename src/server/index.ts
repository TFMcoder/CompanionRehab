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
const startedAt = performance.now();
loadEnvironment();
const config = configFromEnv();
const care = config.databaseUrl ? new LocalCare({ connectionString: config.databaseUrl }) : undefined;
const runtimeLog = care ? new RuntimeLog(care.pool) : undefined;
const taskRequests = care ? new TaskRequestService(care.pool) : undefined;
const features=care?createLocalFeatures(care.pool,{dayContext:(participant,date)=>care.preparationFacts(participant,date)}):undefined;
const microsoft=care?await createMicrosoftRuntime(config,care.pool):undefined;
const reasoner = config.sessionKey && config.planUserId ? new PlanReasoner(new PlanStore(defaultPlanPath, config.sessionKey), config.planUserId,
  undefined, undefined, care ? resolveCaregiverInference(config.caregiverVoiceConfig, config.planUserId, care.pool) : undefined) : undefined;
const speech = config.voiceTransport === 'local' && care && reasoner && await reasoner.available() ? new LocalSpeech() : undefined;
const conversation = speech && care && reasoner ? new ConversationService(care, reasoner, config.planUserId!, undefined, (text, signal) => speech.synthesize(text, signal), metric => {
  const { actor_id, conversation_id, turn_id, outcome, ...measurements } = metric;
  runtimeLog?.record({ kind: 'conversation', actor_id, conversation_id, turn_id, outcome: outcome === 'completed' ? 'ok' : outcome === 'failed' ? 'error' : 'interrupted', measurements });
}, metric => {
  const { actor_id, conversation_id, turn_id, outcome, ...measurements } = metric;
  runtimeLog?.record({ kind: 'conversation', actor_id, conversation_id, turn_id, outcome: outcome === 'completed' ? 'ok' : outcome === 'failed' ? 'error' : 'interrupted', measurements });
}, taskRequests, features, session=>microsoft?.eligible(session)??Promise.resolve(false),microsoft,care?new NancySuggestions(care.pool):undefined) : undefined;
const app = await createApp(config, { care, speech, conversation, runtimeLog, taskRequests, features, microsoft });
// Durable due jobs survive restarts. Outlook preparation is separately consented,
// exact-account read-only retrieval; it never calls a model or opens a microphone.
let schedulerBusy=false;
const runLocalJobs=async(trigger:'scheduler'|'startup'='scheduler')=>{if(!features||schedulerBusy)return;schedulerBusy=true;try{await features.day.tick(trigger);await features.support.refreshNotifications();await microsoft?.prepareMorning();}catch{console.error('Local preparation or reminder maintenance failed; it will be checked again.');}finally{schedulerBusy=false;}};
const scheduler=setInterval(()=>{void runLocalJobs();},30_000);scheduler.unref();
let stopSpeechWarmup=()=>{};
app.addHook('onClose',async()=>{clearInterval(scheduler);stopSpeechWarmup();});
await app.listen({ host: '127.0.0.1', port: config.port });
void runLocalJobs('startup');
runtimeLog?.record({ kind: 'startup', outcome: 'ready', measurements: { stage: 'http_ready', duration_ms: performance.now() - startedAt } });
console.log(`Nancy is running at ${config.origin}.`);
// HTTP/touch comes online immediately. Warm the selected speech workers without delaying sign-in.
if(speech)stopSpeechWarmup=startSpeechWarmup(speech,ready=>{
  runtimeLog?.record({kind:'startup',outcome:ready?'ready':'unavailable',measurements:{stage:ready?'speech_ready':'speech_warmup',duration_ms:performance.now()-startedAt}});
},()=>console.error('Local speech could not become ready. Touch remains available.'));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
