import {afterEach,describe,it,expect,vi} from 'vitest';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import Fastify from 'fastify';
import {ZodError} from 'zod';
import {SafariStudy,registerSafariStudy,readSafariStages} from '../src/server/safari-study';
import {safariSampleSchema,safariRatingSchema} from '../src/shared/safari-study';
import {voiceTimingMetric} from '../src/client/voice-timing';
import {ApiError} from '../src/server/errors';

const temporary:string[]=[];
afterEach(async()=>{for(const path of temporary.splice(0))await rm(path,{recursive:true,force:true});});
async function fixture(){const directory=await mkdtemp(join(tmpdir(),'nancy-safari-'));temporary.push(directory);
 const actor=randomUUID(),participant=randomUUID(),login=randomUUID(),binding={actor_id:actor,client_id:participant,login_session_id:login,grant_revision:'grants-1'};
 const study=new SafariStudy(directory,actor,participant);const setup={id:randomUUID(),network:'wifi' as const,browser:'safari' as const,audio:'phone_speaker' as const,condition:'new_page' as const};
 const sample=()=>safariSampleSchema.parse({id:randomUUID(),scenario_id:'general',conversation_id:randomUUID(),turn_id:randomUUID(),
   metric:voiceTimingMetric({inputMode:'speech',inputAt:100,speechEndedAt:100,requestAt:1000,repliedAt:2000},{reply_id:randomUUID()},2500,.02),
   detail:{audio_headers_ms:350,audio_download_ms:100,audio_decode_ms:50,audio_preparation_server_ms:300,audio_bytes:32000,sample_rate:48000,context_state:'running'}});
 return{directory,actor,participant,login,binding,study,setup,sample};}
const rating=()=>safariRatingSchema.parse({heard_after_detected_end_ms:2600,heard_after_input_ms:2600,transcript:'correct',answer:'not_sure',responsiveness:'too_slow',problem:'none'});
describe('isolated phone-study records',()=>{
 it('persists an idempotent pass, separate manual ratings and unknown actual audibility without content',async()=>{
  const f=await fixture();await f.study.create(f.setup,f.binding);await f.study.create(f.setup,f.binding);
  const s=f.sample();await Promise.all([f.study.sample(f.setup.id,s,f.binding),f.study.sample(f.setup.id,s,f.binding)]);
  await f.study.rate(f.setup.id,s.id,rating(),f.binding);await f.study.finish(f.setup.id,f.binding);
  const result=await f.study.result(f.setup.id,f.binding);expect(result.samples).toHaveLength(1);expect(result.samples[0]).toMatchObject({metric:{audible_response_ms:null},rating:{heard_after_detected_end_ms:2600}});
  expect(result.completed).toBe(true);expect(result).not.toHaveProperty('binding');
  const privateFile=await readFile(join(f.directory,f.setup.id+'.json'),'utf8');expect(privateFile).not.toContain('transcript_text');expect(privateFile).not.toContain('access_token');
  await expect(f.study.sample(f.setup.id,f.sample(),f.binding)).rejects.toMatchObject({code:'study_full'});
 });
 it('rejects changed payloads and stale owner/login/client/grant scope',async()=>{
  const f=await fixture();await f.study.create(f.setup,f.binding);const s=f.sample();await f.study.sample(f.setup.id,s,f.binding);
  await expect(f.study.sample(f.setup.id,{...s,scenario_id:'breakfast'},f.binding)).rejects.toMatchObject({code:'study_conflict'});
  for(const key of Object.keys(f.binding))await expect(f.study.result(f.setup.id,{...f.binding,[key]:randomUUID()})).rejects.toMatchObject({code:'study_scope'});
  await expect(f.study.create({...f.setup,network:'cellular'},f.binding)).rejects.toMatchObject({code:'study_conflict'});
 });
 it('keeps failed/locked tests as events rather than successful audio samples',async()=>{
  const f=await fixture();await f.study.create(f.setup,f.binding);const event={id:randomUUID(),scenario_id:'pause' as const,kind:'no_reply' as const};
  await Promise.all([f.study.event(f.setup.id,event,f.binding),f.study.event(f.setup.id,event,f.binding)]);
  const r=await f.study.result(f.setup.id,f.binding);expect(r.events).toHaveLength(1);expect(r.samples).toHaveLength(0);
  await expect(f.study.event(f.setup.id,{...event,kind:'voice_error'},f.binding)).rejects.toMatchObject({code:'study_conflict'});
 });
 it('correlates submitted turn IDs and keeps missing server stages unknown with numeric-only output',async()=>{
  const f=await fixture(),s=f.sample(),query=vi.fn(async(_sql:string,_params:any[])=>({rows:[
   {conversation_id:s.conversation_id,turn_id:s.turn_id,measurements:{stage:'asr',duration_ms:125,transcript:'private'}},
   {conversation_id:s.conversation_id,turn_id:s.turn_id,measurements:{duration_ms:2000,model_duration_ms:1500,model_calls:1,tool_calls:0,total_tokens:1234,input_tokens:null,private:'secret'}},
   {conversation_id:s.conversation_id,turn_id:s.metric.reply_id,measurements:{stage:'asr',duration_ms:99999}},
  ]}));
  const result=await readSafariStages({query},f.actor,[s,{...f.sample(),turn_id:null}]);
  expect(result).toEqual([{sample_id:s.id,asr_ms:125,server_turn_ms:2000,model_ms:1500,model_calls:1,tool_calls:0,input_tokens:null,output_tokens:null,total_tokens:1234}]);
  expect(query.mock.calls[0][1][0]).toBe(f.actor);expect(JSON.stringify(result)).not.toMatch(/private|secret/);
 });
 it('bounds observations and expires private data after fourteen days',async()=>{
  const f=await fixture(),clock={now:Date.now()},study=new SafariStudy(f.directory,f.actor,f.participant,()=>clock.now);
  await study.create(f.setup,f.binding);await Promise.all(Array.from({length:16},()=>study.sample(f.setup.id,f.sample(),f.binding)));
  await expect(study.sample(f.setup.id,f.sample(),f.binding)).rejects.toMatchObject({code:'study_full'});
  clock.now+=15*86400_000;await expect(study.result(f.setup.id,f.binding)).rejects.toMatchObject({code:'study_expired'});
  await study.create({...f.setup,id:randomUUID()},f.binding);expect((await readdir(f.directory)).filter(x=>x.endsWith('.json'))).toHaveLength(1);
 });
 it('rejects audio, transcripts, actor overrides, fabricated acoustic measurements and invalid durations',async()=>{
  const f=await fixture(),s=f.sample();
  for(const extra of [{audio:'base64'},{transcript:'private'},{actor_id:randomUUID()}])expect(safariSampleSchema.safeParse({...s,...extra}).success).toBe(false);
  expect(safariSampleSchema.safeParse({...s,metric:{...s.metric,audible_response_ms:123}}).success).toBe(false);
  expect(safariSampleSchema.safeParse({...s,detail:{...s.detail,audio_decode_ms:-1}}).success).toBe(false);
  expect(safariRatingSchema.safeParse({...rating(),note:'private words'}).success).toBe(false);
 });
});
describe('owner-only phone-study endpoint',()=>{
 it('requires fresh exact owner/client authority and retained-reply validation on every observation',async()=>{
  const f=await fixture(),app=Fastify(),sessions=new WeakMap(),session={user_id:f.actor,session_id:f.login};
  let current={...f.binding,active_role:'client'};const authority=vi.fn(async()=>current),speech=vi.fn(async()=> 'Not saved'),limit=vi.fn();
  app.addHook('onRequest',async req=>{if(req.headers.authorization==='synthetic-test')sessions.set(req,session);});
  app.setErrorHandler((error,_req,res)=>res.code(error instanceof ZodError?400:error instanceof ApiError?error.status:500).send({error:'test'}));
  registerSafariStudy(app,{study:f.study,synthetic:true,sessions,authority:authority as any,conversation:{speech} as any,limit});
  const headers={authorization:'synthetic-test'};
  try{
   expect((await app.inject('/api/safari-study')).statusCode).toBe(401);
   expect((await app.inject({method:'POST',url:'/api/safari-study',headers,payload:f.setup})).statusCode).toBe(200);
   const s=f.sample(),url=`/api/safari-study/${f.setup.id}/sample`;
   for(let i=0;i<2;i++)expect((await app.inject({method:'POST',url,headers,payload:s})).statusCode).toBe(200);
   expect(speech).toHaveBeenCalledTimes(2);expect(speech).toHaveBeenLastCalledWith(s.conversation_id,session,s.metric.reply_id);
   current={...current,active_role:'administrator'};expect((await app.inject({method:'POST',url,headers,payload:s})).statusCode).toBe(403);
   current={...current,active_role:'client'};speech.mockRejectedValueOnce(new ApiError(403,'revoked','revoked'));
   expect((await app.inject({method:'POST',url,headers,payload:s})).statusCode).toBe(403);
   expect((await app.inject({method:'POST',url,headers,payload:{...s,transcript:'private'}})).statusCode).toBe(400);
   expect(authority.mock.calls.length).toBeGreaterThanOrEqual(6);
  }finally{await app.close();}
 });
 it('refuses registration for the live runtime',async()=>{
  const f=await fixture(),app=Fastify();expect(()=>registerSafariStudy(app,{study:f.study,synthetic:false} as any)).toThrow(/synthetic owner/);await app.close();
 });
});
