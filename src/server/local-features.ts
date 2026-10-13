import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { ApiError } from './errors.js';
import type { Session } from './session.js';
import type { CareService } from './care-access.js';
import type { LocalSpeech } from './local-speech.js';
import { uuid } from '../shared/contracts.js';
import { MealGroceryService } from './meal-grocery.js';
import { mealGroceryCommandSchema } from '../shared/meal-grocery-contracts.js';
import { LocalDayService } from './local-day.js';
import { localDayCommandSchema } from '../shared/local-day-contracts.js';
import { ProgramService } from './programs.js';
import { programCommandSchema } from '../shared/program-contracts.js';
import { SupportTeamService } from './support-team.js';
import { supportCommandSchema, supportWorkspaceQuerySchema } from '../shared/support-contracts.js';
import { parseWakeRecognitionRequest, isHeyNancyPhrase } from './wake-phrase.js';
import { localAuthority, canonicalJson } from './local-authority.js';
import { ProgressService } from './progress.js';
import { progressCommandSchema, progressRangeSchema } from '../shared/progress-contracts.js';
import { OperationsService } from './operations.js';
import { operationsCommandSchema, operationsQuerySchema } from '../shared/operations-contracts.js';
import { randomUUID } from 'node:crypto';

export function createLocalFeatures(pool:Pool) {return {meals:new MealGroceryService(pool),day:new LocalDayService(pool),programs:new ProgramService(pool),support:new SupportTeamService(pool),progress:new ProgressService(pool),operations:new OperationsService(pool),
 authorityRevision:async(session:Session)=>{
  const ctx=await localAuthority(pool,session,new Date());
  const revisions=await pool.query(`select 'groceries' as source,revision from companion_local.grocery_shares where participant_id=$1 and actor_id=$2 and role=$3
   union all select 'support',revision from companion_local.support_shares where participant_id=$1 and actor_id=$2 and role=$3
   union all select 'programs',revision from companion_local.program_access where participant_id=$1 and actor_id=$2 and role=$3
   union all select 'progress',revision from companion_local.progress_access where participant_id=$1 and actor_id=$2 and role=$3
   union all select 'operations',revision from companion_local.operations_access where participant_id=$1 and actor_id=$2 and role=$3 order by source`,[ctx.participant,ctx.actor,ctx.role]);
  return canonicalJson([ctx.grant,revisions.rows]);
 }};}
export type LocalFeatures=ReturnType<typeof createLocalFeatures>;
/** Registered after the application's common session/origin hooks. Services recheck durable authority. */
export function registerLocalFeatures(app:FastifyInstance,options:{features?:LocalFeatures;sessions:WeakMap<FastifyRequest,Session>;care:CareService;speech?:LocalSpeech;voiceOwner?:string;limit:(request:FastifyRequest,key:string,max:number)=>void}) {
 const {features,sessions,care,speech,voiceOwner,limit}=options;
 const get=()=>{if(!features)throw new ApiError(503,'local_features_unavailable','This feature is not available on this care connection.');return features;};
 const session=(r:FastifyRequest)=>sessions.get(r)!;
 const key=(r:FastifyRequest)=>uuid.parse((r.params as {key:string}).key);
 const receipt=async(value:Promise<unknown>)=>{const result=await value;if(!result)throw new ApiError(404,'not_found','No saved change was found for this receipt.');return result;};
 const write=(r:FastifyRequest)=>limit(r,`local-command:${session(r).session_id}`,40);
 app.get('/api/meals-groceries',r=>get().meals.workspace(session(r)));
 app.get('/api/meals-groceries/suggestions/:id',r=>get().meals.suggestions(session(r),uuid.parse((r.params as {id:string}).id)));
 app.post('/api/meals-groceries/commands',r=>{write(r);return get().meals.command(session(r),mealGroceryCommandSchema.parse(r.body));});
 app.get('/api/meals-groceries/receipts/:key',r=>receipt(get().meals.receipt(session(r),key(r))));
 app.get('/api/local-day',r=>{const q=z.object({before:z.iso.date().optional()}).strict().parse(r.query);return get().day.workspace(session(r),q.before);});
 app.post('/api/local-day/commands',r=>{write(r);return get().day.command(session(r),localDayCommandSchema.parse(r.body));});
 app.get('/api/local-day/receipts/:key',r=>receipt(get().day.receipt(session(r),key(r))));
 app.get('/api/programs',r=>get().programs.workspace(session(r)));
 app.post('/api/programs/commands',r=>{write(r);return get().programs.command(session(r),programCommandSchema.parse(r.body));});
 app.get('/api/programs/receipts/:key',r=>receipt(get().programs.receipt(session(r),key(r))));
 app.get('/api/support-team',r=>get().support.workspace(session(r),supportWorkspaceQuerySchema.extend({limit:z.coerce.number().int().min(1).max(50).optional()}).parse(r.query)));
 app.post('/api/support-team/commands',r=>{write(r);return get().support.command(session(r),supportCommandSchema.parse(r.body));});
 app.get('/api/support-team/receipts/:key',r=>receipt(get().support.receipt(session(r),key(r))));
 app.get('/api/progress',r=>get().progress.workspace(session(r),progressRangeSchema.parse(r.query)));
 app.post('/api/progress/commands',r=>{write(r);return get().progress.command(session(r),progressCommandSchema.parse(r.body));});
 app.get('/api/progress/receipts/:key',r=>receipt(get().progress.receipt(session(r),key(r))));
 app.get('/api/operations',r=>get().operations.workspace(session(r),operationsQuerySchema.extend({limit:z.coerce.number().int().min(1).max(50).optional()}).parse(r.query)));
 app.post('/api/operations/commands',r=>{write(r);return get().operations.command(session(r),operationsCommandSchema.parse(r.body));});
 app.get('/api/operations/receipts/:key',r=>receipt(get().operations.receipt(session(r),key(r))));
 app.post('/api/prompts/claim',r=>{z.object({}).strict().parse(r.body);limit(r,`prompt-claim:${session(r).session_id}`,12);return get().day.claimPrompt(session(r));});
 const claim=z.object({claim_token:uuid}).strict();
 app.post('/api/prompts/:id/ack',r=>{write(r);const input=claim.extend({channel:z.enum(['in_app','speech','notification'])}).parse(r.body);return get().day.acknowledgePrompt(session(r),uuid.parse((r.params as {id:string}).id),input.claim_token,input.channel);});
 app.post('/api/prompts/:id/speech',async(r,reply)=>{
  const input=claim.parse(r.body),id=uuid.parse((r.params as {id:string}).id),s=session(r);write(r);
  if(!speech||s.user_id!==voiceOwner)throw new ApiError(403,'voice_unavailable','Spoken reminders are not enabled for this account.');
  const text=await get().day.beginPromptSpeech(s,id,input.claim_token),controller=new AbortController();
  reply.raw.once('close',()=>{if(!reply.raw.writableFinished)controller.abort();});
  const audio=await speech.synthesize(text,controller.signal);
  // A preference, login or grant revocation while Heart was speaking invalidates delivery.
  await get().day.promptText(s,id,input.claim_token);
  return reply.type('audio/wav').send(audio);
 });
 const wakeBindings=new Map<string,{scope:string;sessionId:string;expires:number}>(),wakeBusy=new Set<string>();
 const purgeWakeBindings=()=>{for(const [token,entry] of wakeBindings)if(entry.expires<=Date.now())wakeBindings.delete(token);};
 const wakeScope=async(s:Session)=>{
  if(!speech||s.user_id!==voiceOwner||speech.readiness().asr!=='ready'||!care.authority)
   throw new ApiError(403,'voice_unavailable','The foreground listener is not available for this account.');
  const authority=await care.authority(s);
  if(!['client','administrator','family_friend'].includes(authority.active_role))
   throw new ApiError(403,'forbidden','The foreground listener is not available in this role.');
  return JSON.stringify(authority);
 };
 app.post('/api/wake/consent',r=>{
  z.object({enabled:z.literal(true)}).strict().parse(r.body);
  return (async()=>{
   const s=session(r),scope=await wakeScope(s);limit(r,`wake-consent:${s.session_id}`,8);purgeWakeBindings();
   if(wakeBindings.size>=500)throw new ApiError(429,'rate_limited','Try the listener again shortly.');
   const token=randomUUID(),expires=Date.now()+30*60000;
   wakeBindings.set(token,{scope,sessionId:s.session_id,expires});
   return {consent_token:token,expires_at:new Date(expires).toISOString()};
  })();
 });
 app.post('/api/wake/consent/revoke',r=>{
  const {consent_token}=z.object({consent_token:uuid}).strict().parse(r.body),s=session(r);
  const binding=wakeBindings.get(consent_token);
  if(binding?.sessionId===s.session_id)wakeBindings.delete(consent_token);
  return {ok:true};
 });
 app.post('/api/wake/recognize',{bodyLimit:220000},async(r,reply)=>{
  const s=session(r),scope=await wakeScope(s);
  let parsed:ReturnType<typeof parseWakeRecognitionRequest>;
  try{parsed=parseWakeRecognitionRequest(r.body);}catch{throw new ApiError(400,'invalid_input','Use a short microphone clip.');}
  purgeWakeBindings();
  const binding=wakeBindings.get(parsed.consentToken);
  if(!binding||binding.sessionId!==s.session_id)throw new ApiError(403,'consent_required','Enable the foreground listener again.');
  if(binding.scope!==scope)throw new ApiError(403,'scope_changed','Enable the listener again in this account.');
  limit(r,`wake:${s.session_id}`,24);limit(r,`wake-token:${parsed.consentToken}`,24);
  if(wakeBusy.has(s.session_id))throw new ApiError(409,'speech_busy','The last speech clip is still being checked.');
  const controller=new AbortController();wakeBusy.add(s.session_id);reply.raw.once('close',()=>{if(!reply.raw.writableFinished)controller.abort();});
  try {const transcript=await speech!.transcribe(parsed.audio,controller.signal);
   if(wakeBindings.get(parsed.consentToken)!==binding)throw new ApiError(403,'consent_revoked','The foreground listener was stopped.');
   if(JSON.stringify(await care.authority!(s))!==scope)throw new ApiError(403,'scope_changed','Your access changed. Enable the listener again.');
   const detected=isHeyNancyPhrase(transcript);if(detected)wakeBindings.delete(parsed.consentToken);
   return {detected};
  }finally{wakeBusy.delete(s.session_id);parsed.audio.fill(0);}
 });
}
