/** Owner-only synthetic runtime. Never loads live care configuration or Microsoft runtime. */
import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {join} from 'node:path';
import {createApp} from './app.js';
import {configFromEnv} from './config.js';
import {ownerTestDirectory,ownerTestSchema,ownerTestReasoning,ownerTestPreparation,ownerTestSpeech,ownerTestQuickReads,ownerTestSpokenReplies,ownerTestTelemetryPolicy} from './owner-test-config.js';
import {NANCY_POLICY_VERSION} from './inference-binding.js';
import {LocalCare} from './local-care.js';
import {LocalSpeech} from './local-speech.js';
import {PlanStore,defaultPlanPath} from './chatgpt-plan/storage.js';
import {PlanReasoner} from './plan-reasoner.js';
import {ConversationService,type ConversationTurnMetric,type InferenceCallMetric} from './conversation.js';
import {createLocalFeatures} from './local-features.js';
import {TaskRequestService} from './task-requests.js';
import {NancySuggestions} from './nancy-suggestions.js';
import {SessionRevocations} from './revocations.js';
import {RuntimeLog} from './telemetry.js';
import {startSpeechWarmup} from './speech-startup.js';
import {createPlanRequest} from './chatgpt-plan/inference.js';
import {warmRecipeCatalogue} from './prepared-context.js';
import {currentNutritionReference} from './nutrition-reference.js';

const settings=ownerTestSchema.parse(JSON.parse(await readFile(join(ownerTestDirectory,'config.json'),'utf8')));
let selection:unknown;
try{selection=JSON.parse(await readFile(join(ownerTestDirectory,'reasoning-experiment.json'),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
const reasoningProfile=ownerTestReasoning(settings,selection);
const prepareContext=ownerTestPreparation(settings,selection);
const latencyTrial=ownerTestSpeech(settings,selection);
const quickReads=ownerTestQuickReads(settings,selection);
const spokenReplies=ownerTestSpokenReplies(settings,selection);
const telemetryPolicy=ownerTestTelemetryPolicy(NANCY_POLICY_VERSION,settings,selection);
if(prepareContext)warmRecipeCatalogue(currentNutritionReference());
// Read only the existing owner's encryption key and selected speech settings.
// Do not copy a credential store, rebind an account or load a caregiver route.
let source:NodeJS.ProcessEnv={};
for(const path of ['.local/runtime/local-care.env','.env.local']){try{source={...source,...parseEnv(await readFile(path,'utf8'))};}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
source={...source,...Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>typeof entry[1]==='string'))};
if(source.NANCY_PLAN_USER_ID!==settings.owner_actor_id)throw Error('Test login must retain the existing actual owner identity.');
for(const [key,value] of Object.entries(source))if(/^NANCY_(ASR|KOKORO)_/.test(key)&&typeof value==='string')process.env[key]=value;
delete process.env.OPENAI_API_KEY;delete process.env.NANCY_MICROSOFT_CONFIG;delete process.env.NANCY_CAREGIVER_VOICE_CONFIG;
const liveKey=Buffer.from(source.SESSION_KEY??'','base64');
const sessionKey=Buffer.from(settings.session_key,'base64');
if(liveKey.length!==32||sessionKey.equals(liveKey))throw Error('Independent test-session configuration is required.');
const config={...configFromEnv({PUBLIC_ORIGIN:settings.origin,PORT:String(settings.port),DATABASE_URL:settings.database_url,SESSION_KEY:settings.session_key,NANCY_PLAN_USER_ID:settings.owner_actor_id,NANCY_SYNTHETIC:'1'}),sessionCookieName:'nancy_test_session' as const};
const care=new LocalCare({connectionString:settings.database_url});
const actual=(await care.pool.query('select current_database() as db,current_user as role')).rows[0];
const grants=(await care.pool.query(`select actor_id,participant_id,role from companion_local.role_grants where revoked_at is null`)).rows;
if(actual.db!==settings.database_name||actual.role!==settings.database_role||grants.length!==1||grants[0].actor_id!==settings.owner_actor_id||grants[0].participant_id!==settings.participant_id||grants[0].role!=='client')throw Error('Test data identity check failed.');
const store=new PlanStore(defaultPlanPath,liveKey),bound=(await store.load()).nancyBinding;
if(bound?.actorId!==settings.owner_actor_id)throw Error('Existing owner connection is not bound; do not create a replacement.');
const reasoner=new PlanReasoner(store,settings.owner_actor_id,createPlanRequest(reasoningProfile));
if(!await reasoner.available())throw Error('Existing owner reasoning is unavailable.');
const runtimeLog=new RuntimeLog(care.pool),taskRequests=new TaskRequestService(care.pool);
const features=createLocalFeatures(care.pool,{dayContext:(participant,date)=>care.preparationFacts(participant,date)});
const speech=new LocalSpeech({latencyTrial});
const record=(metric:ConversationTurnMetric|InferenceCallMetric)=>{const {actor_id,conversation_id,turn_id,outcome,...measurements}=metric;runtimeLog.record({kind:'conversation',actor_id,conversation_id,turn_id,outcome:outcome==='completed'?'ok':outcome==='failed'?'error':'interrupted',measurements:{...measurements,policy_version:telemetryPolicy}});};
const conversation=new ConversationService(care,reasoner,settings.owner_actor_id,undefined,(text,signal)=>speech.synthesize(text,signal),record,record,taskRequests,features,()=>Promise.resolve(false),undefined,new NancySuggestions(care.pool),reasoningProfile,prepareContext,latencyTrial?72:120,quickReads,spokenReplies);
const app=await createApp(config,{care,speech,conversation,runtimeLog,taskRequests,features,microsoft:null,staticRoot:join(ownerTestDirectory,'client'),revocations:new SessionRevocations(join(ownerTestDirectory,'revoked-sessions.json'))});
let busy=false;
const tick=async()=>{if(busy)return;busy=true;try{await features.day.tick('scheduler');await features.support.refreshNotifications();}catch{console.error('Test reminder maintenance will retry.');}finally{busy=false;}};
const timer=setInterval(()=>{void tick();},30000);timer.unref();
const stopWarmup=startSpeechWarmup(speech,()=>{},()=>console.error('Test speech warm-up will retry.'));
app.addHook('onClose',async()=>{clearInterval(timer);stopWarmup();});
await app.listen({host:'127.0.0.1',port:settings.port});
console.log('Nancy owner test is running with isolated practice data.');
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void app.close().then(()=>process.exit(0));});
