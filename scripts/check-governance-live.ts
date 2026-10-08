import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { configFromEnv, loadEnvironment } from '../src/server/config.js';
import { PlanStore, defaultPlanPath } from '../src/server/chatgpt-plan/storage.js';
import { PlanReasoner } from '../src/server/plan-reasoner.js';
import { sumInferenceUsage, inferenceUsageFromError } from '../src/server/chatgpt-plan/inference.js';
import { NANCY_POLICY_VERSION, bindingRef } from '../src/server/inference-binding.js';
import { LocalSpeech } from '../src/server/local-speech.js';

// Synthetic owner-initiated service probe. No care DB, recipient route, API key,
// microphone or household facts. Does not qualify intended-user deployment.
loadEnvironment();const config=configFromEnv();
if(!config.sessionKey||!config.planUserId)throw new Error('The existing owner practice route is not configured.');
const reasoner=new PlanReasoner(new PlanStore(defaultPlanPath,config.sessionKey),config.planUserId);
const observation:Record<string,unknown>={observed_at:new Date().toISOString(),data_origin:'synthetic',scope:'owner practice; no household facts',status:'running',checks:{}};
const checks=observation.checks as Record<string,boolean>;
const speech=new LocalSpeech();let stage='binding';
try {
  const binding=await reasoner.bind({actor_id:config.planUserId,login_session_id:randomUUID(),active_role:'client',client_id:config.planUserId,grant_revision:'synthetic-probe',policy_version:NANCY_POLICY_VERSION});
  observation.binding_ref=bindingRef(binding);observation.policy_version=binding.policy_version;
  stage='inference';let started=performance.now();
  const result=await reasoner.respond([{role:'user',content:'This is a synthetic engineering check. Reply with one short greeting.'}],
    'You are Nancy. Give one short friendly greeting. No tools or care actions are requested.',[],AbortSignal.timeout(90000),undefined,binding);
  observation.model_ms=Math.round(performance.now()-started);observation.usage=sumInferenceUsage([result.usage]);
  checks.selected_model=result.completed&&result.model==='gpt-6-sol'&&result.effort==='high';
  checks.completed_text=!!result.text.trim();
  if(!checks.selected_model||!checks.completed_text)throw new Error('Selected response did not complete.');
  stage='speech';started=performance.now();await speech.ready();observation.speech_boot_ms=Math.round(performance.now()-started);
  started=performance.now();const wav=await speech.synthesize('Hi, what can I help with?',AbortSignal.timeout(60000));
  observation.heart_ms=Math.round(performance.now()-started);checks.heart_wav=wav.toString('ascii',0,4)==='RIFF'&&wav.length>44;
  observation.status=checks.heart_wav?'passed':'failed';
} catch(error) {
  observation.status='failed';observation.failed_stage=stage;
  observation.error_code=error&&typeof error==='object'&&'code' in error?String(error.code).slice(0,80):'service_probe_failed';
  observation.failed_usage=inferenceUsageFromError(error);process.exitCode=1;
} finally {
  await speech.close();await mkdir('.local/probes',{recursive:true});
  await writeFile('.local/probes/governance-live.json',JSON.stringify(observation,null,2)+'\n');console.log(JSON.stringify(observation));
}
