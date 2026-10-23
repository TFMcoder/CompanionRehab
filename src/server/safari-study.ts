import {mkdir,readFile,writeFile,rename,readdir,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Session} from './session.js';
import type {CareAuthority} from './care-access.js';
import type {ConversationService} from './conversation.js';
import {ApiError} from './errors.js';
import {safariRunInput,safariSampleSchema,safariRatingSchema,type SafariRunInput,type SafariSample,type SafariRating} from '../shared/safari-study.js';

const nonnegative=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
/** Select numeric server stages only; the separate reply ID is never mistaken for the submitted turn ID. */
export async function readSafariStages(db:{query:(sql:string,params:any[])=>Promise<{rows:any[]}>},actor:string,samples:SafariSample[]){
  const measurable=samples.filter(s=>s.turn_id!==null);if(!measurable.length)return[];
  const {rows}=await db.query(`select conversation_id,turn_id,measurements from companion_local.runtime_events
    where actor_id=$1 and kind='conversation' and conversation_id=any($2::uuid[]) and turn_id=any($3::uuid[])
    and recorded_at > now()-interval '14 days' order by recorded_at desc limit 256`,[actor,measurable.map(s=>s.conversation_id),measurable.map(s=>s.turn_id)]);
  return measurable.map(sample=>{const events=rows.filter(r=>r.conversation_id===sample.conversation_id&&r.turn_id===sample.turn_id);
    const summary=events.find(r=>r.measurements.stage===undefined&&typeof r.measurements.model_calls==='number')?.measurements;
    const asr=events.find(r=>r.measurements.stage==='asr')?.measurements;
    return{sample_id:sample.id,asr_ms:nonnegative(asr?.duration_ms),server_turn_ms:nonnegative(summary?.duration_ms),
      model_ms:nonnegative(summary?.model_duration_ms),model_calls:nonnegative(summary?.model_calls),tool_calls:nonnegative(summary?.tool_calls),
      input_tokens:nonnegative(summary?.input_tokens),output_tokens:nonnegative(summary?.output_tokens),total_tokens:nonnegative(summary?.total_tokens)};});
}

type Binding=Pick<CareAuthority,'actor_id'|'login_session_id'|'client_id'|'grant_revision'>;
const eventSchema=z.object({id:z.string().uuid(),scenario_id:z.enum(['opening','breakfast','ingredient','general','followup','schedule','pause','resume']),
  kind:z.enum(['page_hidden','page_visible','no_reply','permission_error','voice_error','unexpected_navigation','timing_save_failed'])}).strict();
type StudyEvent=z.infer<typeof eventSchema>&{recorded_at:string};
type Run={id:string;created_at:string;binding:Binding;setup:SafariRunInput;samples:Array<SafariSample&{rating?:SafariRating}>;events:StudyEvent[];completed:boolean};
/** Private bounded numeric observations. No care database writes, transcript/audio fields or inference. */
export class SafariStudy {
  private queue:Promise<unknown>=Promise.resolve();
  constructor(readonly directory:string,readonly owner:string,readonly participant:string,private now=()=>Date.now(),private stages?:(samples:SafariSample[])=>Promise<unknown>){}
  private async prune(maximum=64){
    await mkdir(this.directory,{recursive:true});
    const files=(await readdir(this.directory)).filter(f=>/^[a-f0-9-]{36}\.json$/.test(f)).sort();
    const retained:Array<{name:string;created:number}>=[];
    for(const name of files){const r=JSON.parse(await readFile(join(this.directory,name),'utf8')) as Run;const created=Date.parse(r.created_at);
      if(!Number.isFinite(created)||created<this.now()-14*86400_000)await unlink(join(this.directory,name));else retained.push({name,created});}
    for(const f of retained.sort((a,b)=>b.created-a.created).slice(maximum))await unlink(join(this.directory,f.name));
  }
  private exclusive<T>(fn:()=>Promise<T>):Promise<T>{const next=this.queue.then(fn);this.queue=next.catch(()=>{});return next;}
  private path(id:string){return join(this.directory,z.string().uuid().parse(id)+'.json');}
  private async read(id:string,binding:Binding){
    let run:Run;try{run=JSON.parse(await readFile(this.path(id),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')throw new ApiError(404,'study_missing','This test pass is unavailable.');throw e;}
    if(Object.keys(binding).some(k=>binding[k as keyof Binding]!==run.binding[k as keyof Binding]))throw new ApiError(403,'study_scope','This test belongs to another login or account view. Start a new pass.');
    if(Date.parse(run.created_at)<this.now()-14*86400_000)throw new ApiError(410,'study_expired','This test pass expired. Start a new pass.');
    return run;
  }
  private async write(run:Run){const path=this.path(run.id);await writeFile(path+'.tmp',JSON.stringify(run,null,2)+'\n');await rename(path+'.tmp',path);}
  async create(input:SafariRunInput,binding:Binding){return this.exclusive(async()=>{
    try{const prior=await this.read(input.id,binding);if(JSON.stringify(prior.setup)!==JSON.stringify(input))throw new ApiError(409,'study_conflict','Start a new pass for different test conditions.');return {id:prior.id};}
    catch(e){if(!(e instanceof ApiError)||e.status!==404)throw e;}
    await this.prune(63);await this.write({id:input.id,created_at:new Date(this.now()).toISOString(),binding,setup:input,samples:[],events:[],completed:false});return{id:input.id};});}
  async sample(id:string,sample:SafariSample,binding:Binding){return this.exclusive(async()=>{const run=await this.read(id,binding);
    const previous=run.samples.find(s=>s.id===sample.id);if(previous){const{rating:_,...body}=previous;if(JSON.stringify(body)!==JSON.stringify(sample))throw new ApiError(409,'study_conflict','That observation already has different timings.');return {ok:true};}
    if(run.completed||run.samples.length>=16)throw new ApiError(409,'study_full','This pass is finished. Start a new pass.');
    run.samples.push(sample);await this.write(run);return{ok:true};});}
  async rate(id:string,sampleId:string,rating:SafariRating,binding:Binding){return this.exclusive(async()=>{const run=await this.read(id,binding),sample=run.samples.find(s=>s.id===sampleId);
    if(!sample)throw new ApiError(404,'sample_missing','Save the timing before rating it.');sample.rating=rating;await this.write(run);return{ok:true};});}
  async finish(id:string,binding:Binding){return this.exclusive(async()=>{const run=await this.read(id,binding);run.completed=true;await this.write(run);return{ok:true};});}
  async event(id:string,event:z.infer<typeof eventSchema>,binding:Binding){return this.exclusive(async()=>{const run=await this.read(id,binding);
    const prior=run.events.find(e=>e.id===event.id);if(prior){const{recorded_at:_,...body}=prior;if(JSON.stringify(body)!==JSON.stringify(event))throw new ApiError(409,'study_conflict','That event already has different details.');return{ok:true};}if(run.completed||run.events.length>=48)throw new ApiError(409,'study_full','This pass is finished.');
    run.events.push({...event,recorded_at:new Date(this.now()).toISOString()});await this.write(run);return{ok:true};});}
  async result(id:string,binding:Binding){return this.exclusive(async()=>{const run=await this.read(id,binding);const{binding:_,...result}=run;
    let server_stages:unknown=null;try{server_stages=await this.stages?.(run.samples)??null;}catch{/* Missing diagnostics stay unknown. */}return{...result,server_stages};});}
  async maintain(){return this.exclusive(()=>this.prune());}
}

export function registerSafariStudy(app:FastifyInstance,options:{study:SafariStudy;synthetic:boolean;sessions:WeakMap<FastifyRequest,Session>;
  authority:(session:Session)=>Promise<CareAuthority>;conversation:ConversationService;limit:(request:FastifyRequest,key:string,max:number)=>void}){
  if(!options.synthetic)throw Error('Safari study is restricted to the synthetic owner runtime.');
  const cleanup=setInterval(()=>{void options.study.maintain().catch(()=>{});},3600_000);cleanup.unref();
  app.addHook('onClose',async()=>{clearInterval(cleanup);});
  const binding=async(request:FastifyRequest)=>{const session=options.sessions.get(request);if(!session)throw new ApiError(401,'unauthorized','Please sign in.');
    const current=await options.authority(session);
    if(session.user_id!==options.study.owner||current.actor_id!==options.study.owner||current.client_id!==options.study.participant||current.active_role!=='client'||current.login_session_id!==session.session_id)
      throw new ApiError(403,'study_owner_only','This test is available only in the owner practice account.');
    options.limit(request,`safari-study:${session.user_id}`,90);
    return{actor_id:current.actor_id,login_session_id:current.login_session_id,client_id:current.client_id,grant_revision:current.grant_revision};};
  const id=(request:FastifyRequest)=>z.string().uuid().parse((request.params as{id:string}).id);
  app.get('/api/safari-study',async req=>{await binding(req);return{available:true,retention_days:14,network_source:'user_selected',audibility_source:'manual_tap_includes_reaction_time',outlook_connected:false};});
  app.post('/api/safari-study',async req=>options.study.create(safariRunInput.parse(req.body),await binding(req)));
  app.get('/api/safari-study/:id',async req=>options.study.result(id(req),await binding(req)));
  app.post('/api/safari-study/:id/sample',async req=>{const bound=await binding(req),sample=safariSampleSchema.parse(req.body);
    await options.conversation.speech(sample.conversation_id,options.sessions.get(req)!,sample.metric.reply_id);
    return options.study.sample(id(req),sample,bound);});
  app.post('/api/safari-study/:id/rating',async req=>{const bound=await binding(req),body=z.object({sample_id:z.string().uuid(),rating:safariRatingSchema}).strict().parse(req.body);
    return options.study.rate(id(req),body.sample_id,body.rating,bound);});
  app.post('/api/safari-study/:id/finish',async req=>{z.object({}).strict().parse(req.body);return options.study.finish(id(req),await binding(req));});
  app.post('/api/safari-study/:id/event',async req=>options.study.event(id(req),eventSchema.parse(req.body),await binding(req)));
}
