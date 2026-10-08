import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { loadEnvironment, configFromEnv } from '../src/server/config.js';
loadEnvironment();
const config=configFromEnv();
const login=JSON.parse(await readFile('.local/runtime/client-trial-login.json','utf8'));
const evidence:{status:string;observed_at:string;checks:Record<string,boolean>;timings:Record<string,number>;metrics?:unknown;error?:string}={status:'running',observed_at:new Date().toISOString(),checks:{},timings:{}};
const pool=new Pool({connectionString:config.databaseUrl,max:1,connectionTimeoutMillis:5000});
let cookie='', active:string|undefined;
function check(key:string,condition:unknown){evidence.checks[key]=!!condition;if(!condition)throw new Error(key);}
async function call(path:string,body?:unknown,method=body===undefined?'GET':'POST') {
  const response=await fetch(config.origin+path,{method,headers:{origin:config.origin,...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(110000)});
  const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];
  if(!response.ok)throw new Error('http_'+response.status+'_'+path.split('/')[2]);
  return response.headers.get('content-type')?.includes('audio/wav')?Buffer.from(await response.arrayBuffer()):response.json();
}
try {
  check('client_database_selected',new URL(config.databaseUrl!).pathname==='/nancy_client_trial'&&!config.synthetic);
  const before=(await pool.query('select count(*)::int as n from companion_local.activity_records')).rows[0].n;
  for(const path of ['/preview','/preview.html'])check('preview_removed_'+path.replaceAll('/','_'),(await fetch(config.origin+path)).status===404);
  check('care_requires_sign_in',(await fetch(config.origin+'/api/today')).status===401);
  await call('/api/auth/login',{email:login.email,password:login.password});
  const today=await call('/api/today');
  check('no_sample_care_data',today.tasks.length===0&&today.meal_options.length===0&&today.appointments.length===0&&today.activity_ledger.entries.length===0);
  const availability=await call('/api/config');check('selected_voice_ready',availability.voice_available&&availability.voice_transport==='local');
  let start=performance.now();const opened=await call('/api/conversation',{});active=opened.session_id;
  const greeting=await call(`/api/conversation/${active}/speech?turn_id=${opened.reply_id}&part=0`);
  evidence.timings.greeting_first_audio_ms=Math.round(performance.now()-start);
  check('heart_greeting',Buffer.isBuffer(greeting)&&greeting.toString('ascii',0,4)==='RIFF');
  await call(`/api/conversation/${active}/played`,{reply_id:opened.reply_id});
  start=performance.now();const navigation=await call(`/api/conversation/${active}/turn`,{turn_id:randomUUID(),text:'Show my tasks.'});
  const audio=await call(`/api/conversation/${active}/speech?turn_id=${navigation.reply_id}&part=0`);
  evidence.timings.navigation_audio_ms=Math.round(performance.now()-start);
  check('direct_navigation',navigation.navigate==='tasks'&&Buffer.isBuffer(audio));
  await call(`/api/conversation/${active}/played`,{reply_id:navigation.reply_id});
  start=performance.now();const recognized=await call(`/api/conversation/${active}/audio`,{turn_id:randomUUID(),wav:audio.toString('base64')});
  evidence.timings.generated_audio_turn_ms=Math.round(performance.now()-start);
  check('actual_local_asr',typeof recognized.transcript==='string'&&/tasks/i.test(recognized.transcript)&&!recognized.changed);
  const nutritionTurn=randomUUID();start=performance.now();
  const nutrition=await call(`/api/conversation/${active}/turn`,{turn_id:nutritionTurn,text:'Please retrieve one breakfast recipe from your repository nutrition reference and suggest it briefly. Do not save or plan anything.'});
  evidence.timings.nutrition_reply_ms=Math.round(performance.now()-start);
  check('repo_nutrition_provenance',nutrition.nutrition_refs?.some((ref:any)=>ref.document_id==='CR_NUTRITION_MEALS_V1'&&/^[a-f0-9]{64}$/.test(ref.sha256))&&!nutrition.changed);
  const nutritionAudio=await call(`/api/conversation/${active}/speech?turn_id=${nutrition.reply_id}&part=0`);
  check('nutrition_heart_audio',Buffer.isBuffer(nutritionAudio)&&nutritionAudio.length>44);
  await call(`/api/conversation/${active}`,undefined,'DELETE');active=undefined;
  await call('/api/auth/logout',{});
  check('logout_revokes_access',(await fetch(config.origin+'/api/today',{headers:{cookie}})).status===401);
  // The asynchronous metadata batch must persist without delaying the spoken response.
  await new Promise(resolve=>setTimeout(resolve,2500));
  const metrics=(await pool.query("select measurements,outcome from companion_local.runtime_events where kind='conversation' and turn_id=$1 and measurements->>'stage' is distinct from 'model'",[nutritionTurn])).rows;
  check('turn_metadata_persisted',metrics.length===1&&metrics[0].outcome==='ok'&&metrics[0].measurements.nutrition_refs?.length>0);
  const usageKeys=['input_tokens','output_tokens','total_tokens','cached_input_tokens','reasoning_output_tokens'];
  const hasUsage=(measurements:any)=>usageKeys.every(key=>Object.hasOwn(measurements,key)&&(measurements[key]===null||Number.isSafeInteger(measurements[key])&&measurements[key]>=0));
  check('turn_usage_numeric_or_unknown',metrics.length===1&&hasUsage(metrics[0].measurements));
  const inference=(await pool.query("select measurements from companion_local.runtime_events where kind='conversation' and turn_id=$1 and measurements->>'stage'='model' order by (measurements->>'model_call_index')::int",[nutritionTurn])).rows;
  check('per_call_usage_and_binding_metadata',inference.length===metrics[0]?.measurements.model_calls&&inference.length>0&&inference.every((row,index)=>
    hasUsage(row.measurements)&&row.measurements.model_call_index===index+1&&row.measurements.policy_version===metrics[0].measurements.policy_version&&
    /^sha256:[a-f0-9]{64}$/.test(row.measurements.binding_ref)&&row.measurements.binding_ref===metrics[0].measurements.binding_ref));
  evidence.metrics=metrics[0];
  check('no_activity_invented',(await pool.query('select count(*)::int as n from companion_local.activity_records')).rows[0].n===before);
  evidence.status='passed';
}catch(error){evidence.status='failed';evidence.error=error instanceof Error?error.message:'failed';process.exitCode=1;}
finally {
  if(active)await call(`/api/conversation/${active}`,undefined,'DELETE').catch(()=>{});
  await pool.end();await writeFile('.local/probes/client-readiness-live.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence));
}
