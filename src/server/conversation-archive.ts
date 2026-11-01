import {createCipheriv,createDecipheriv,randomBytes,randomUUID,hkdfSync} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,unlink,readdir,lstat,realpath} from 'node:fs/promises';
import {resolve,join,sep,basename} from 'node:path';import {z} from 'zod';import type{Pool}from'pg';
import type{Session}from'./session.js';import{ApiError}from'./errors.js';
import{localAuthority,localTransaction,lockParticipant,requireClient,type LocalAuthority}from'./local-authority.js';
import{archivePolicyVersion,archiveChoiceSchema,archiveDeleteSchema,type ArchiveSettings,type ArchiveSummary,type ArchivedConversation,type ArchiveTurn}from'../shared/conversation-archive-contracts.js';
import type{ConversationReply}from'./conversation.js';

interface Policy {revision:number;enabled:boolean;actor:string|null;grant:string|null;epoch:string;last_request?:{id:string;payload:string};}
const filePattern=/^\d{13}-[a-f0-9-]{36}\.enc$/;
const emptyPolicy=():Policy=>({revision:0,enabled:false,actor:null,grant:null,epoch:randomUUID()});
const unavailable=()=>new ApiError(503,'archive_unavailable','Conversation text could not be saved. Your care result is unchanged.');

/** Private local transcript archive. Never a care report, operational log or automatic model memory. */
export class ConversationArchive {
 private root:string;private key:Buffer;
 constructor(private pool:Pool,key:Buffer,directory='.local/runtime/conversation-archive',private clock=()=>new Date()){
  if(key.length!==32)throw Error('Conversation archive requires the existing encryption key.');
  this.root=resolve(directory);if(!this.root.startsWith(resolve('.local')+sep))throw Error('Conversation archive must remain in private local storage.');
  this.key=Buffer.from(hkdfSync('sha256',key,Buffer.alloc(0),Buffer.from('nancy-conversation-archive-v1'),32));
 }
 private async directory(participant:string){
  z.uuid().parse(participant);await mkdir(this.root,{recursive:true});if((await realpath(this.root)).toLowerCase()!==this.root.toLowerCase())throw unavailable();
  const path=join(this.root,participant);await mkdir(path,{recursive:true});if((await realpath(path)).toLowerCase()!==path.toLowerCase())throw unavailable();return path;
 }
 private async read<T>(directory:string,file:string):Promise<T|undefined>{
  const path=join(directory,file);try{const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4*1024*1024)throw unavailable();const bytes=await readFile(path);if(bytes.length<29)throw unavailable();const decipher=createDecipheriv('aes-256-gcm',this.key,bytes.subarray(0,12));decipher.setAAD(Buffer.from('nancy-archive-v1\0'+basename(directory)+'\0'+file));decipher.setAuthTag(bytes.subarray(12,28));return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8')) as T;}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw unavailable();}
 }
 private async write(directory:string,file:string,value:unknown){
  const data=Buffer.from(JSON.stringify(value));if(data.length>2*1024*1024)throw unavailable();
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(Buffer.from('nancy-archive-v1\0'+basename(directory)+'\0'+file));const encrypted=Buffer.concat([cipher.update(data),cipher.final()]);
  const temporary=join(directory,file+'.'+randomUUID()+'.tmp');try{await writeFile(temporary,Buffer.concat([iv,cipher.getAuthTag(),encrypted]),{flag:'wx',mode:0o600});const target=join(directory,file);try{if((await lstat(target)).isSymbolicLink())throw unavailable();}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}await rename(temporary,target);}finally{await unlink(temporary).catch(()=>{});}
 }
 private async scoped<T>(session:Session,work:(ctx:LocalAuthority,directory:string,policy:Policy)=>Promise<T>):Promise<T>{
  return localTransaction(this.pool,async db=>{const ctx=await localAuthority(db,session,this.clock(),true);if(!['client','administrator'].includes(ctx.role))throw new ApiError(403,'forbidden','Conversation text is not shared with this role.');
   // Reuse the care service's participant lock for cross-process file serialization;
   // no profile or database record is changed, and no model runs under this lock.
   await lockParticipant(db,ctx);const directory=await this.directory(ctx.participant),policy=await this.read<Policy>(directory,'settings.enc')??emptyPolicy();return work(ctx,directory,policy);
  });
 }
 private settingsOf(ctx:LocalAuthority,p:Policy):ArchiveSettings{return{available:true,enabled:p.enabled&&p.actor===ctx.actor&&p.grant===ctx.grant,revision:p.revision,role:ctx.role,retention:'until_deleted',policy_version:archivePolicyVersion,sharing:'client_and_current_administrators'};}
 settings(session:Session){return this.scoped(session,async(ctx,_dir,p)=>this.settingsOf(ctx,p));}
 choose(session:Session,input:unknown){const command=archiveChoiceSchema.parse(input);return this.scoped(session,async(ctx,dir,p)=>{requireClient(ctx);const payload=JSON.stringify(command);
  if(p.last_request?.id===command.request_id){if(p.last_request.payload!==payload||p.actor!==ctx.actor||p.grant!==ctx.grant)throw new ApiError(409,'conflict','Review this recording choice again.');return this.settingsOf(ctx,p);}
  if(p.revision!==command.expected_revision)throw new ApiError(409,'conflict','The recording choice changed. Refresh and review it.');
  p={...p,revision:p.revision+1,enabled:command.enabled,actor:ctx.actor,grant:ctx.grant,last_request:{id:command.request_id,payload}};await this.write(dir,'settings.enc',p);return this.settingsOf(ctx,p);
 });}
 private async names(dir:string){return(await readdir(dir)).filter(name=>filePattern.test(name)).sort().reverse();}
 private async record(dir:string,id:string){z.uuid().parse(id);const file=(await this.names(dir)).find(n=>n.endsWith('-'+id+'.enc'));return file?{file,data:await this.read<ArchivedConversation>(dir,file)}:undefined;}
 private canCapture(ctx:LocalAuthority,p:Policy){return ctx.role==='client'&&p.enabled&&p.actor===ctx.actor&&p.grant===ctx.grant;}
 begin(session:Session,reply:ConversationReply){return this.scoped(session,async(ctx,dir,p)=>{if(!this.canCapture(ctx,p))return false;z.uuid().parse(reply.session_id);if(await this.record(dir,reply.session_id))throw new ApiError(409,'conflict','This conversation was already archived.');if((await this.names(dir)).length>=20000)throw unavailable();
  const at=this.clock(),data:ArchivedConversation={id:reply.session_id,started_at:at.toISOString(),turns:0,ended_at:null,actor_id:ctx.actor,participant_id:ctx.participant,login_session_id:session.session_id,consent_revision:p.revision,epoch:p.epoch,greeting:{id:reply.reply_id,text:reply.text,playback_completed_at:null},entries:[]};await this.write(dir,String(at.getTime()).padStart(13,'0')+'-'+data.id+'.enc',data);return true;
 });}
 capture(session:Session,id:string,turnId:string,input:string,mode:ArchiveTurn['input_mode'],reply?:ConversationReply,outcome:ArchiveTurn['outcome']='completed'){
  z.uuid().parse(turnId);if(!input.trim()||input.length>2000||reply&&(reply.session_id!==id||reply.text.length>1500))throw unavailable();return this.scoped(session,async(ctx,dir,p)=>{if(!this.canCapture(ctx,p))return false;const record=await this.record(dir,id),data=record?.data;if(!record||!data||data.epoch!==p.epoch||data.consent_revision!==p.revision||data.ended_at)return false;
   if(data.actor_id!==ctx.actor||data.participant_id!==ctx.participant||data.login_session_id!==session.session_id)throw new ApiError(403,'scope_changed','Conversation access changed.');
   const prior=data.entries.find(e=>e.id===turnId);if(prior){if(prior.input!==input||prior.input_mode!==mode)throw new ApiError(409,'conflict','This conversation turn changed.');if(!reply&&outcome==='received'||prior.reply)return true;prior.outcome=outcome;if(reply)prior.reply={id:reply.reply_id,text:reply.text,changed:reply.changed,playback_completed_at:null,...(reply.nutrition_refs?{nutrition_refs:reply.nutrition_refs.map(({document_id,sha256,items})=>({document_id,sha256,items}))}:{})};await this.write(dir,record.file,data);return true;}
   if(data.entries.length>=500)throw unavailable();
   const entry:ArchiveTurn={id:turnId,input,input_mode:mode,recorded_at:this.clock().toISOString(),outcome};
   if(reply){if(reply.session_id!==id||reply.text.length>1500)throw unavailable();entry.reply={id:reply.reply_id,text:reply.text,changed:reply.changed,playback_completed_at:null,...(reply.nutrition_refs?{nutrition_refs:reply.nutrition_refs.map(({document_id,sha256,items})=>({document_id,sha256,items}))}:{})};}
   data.entries.push(entry);data.turns=data.entries.length;await this.write(dir,record.file,data);return true;
  });
 }
 played(session:Session,id:string,replyId:string){z.uuid().parse(replyId);return this.scoped(session,async(ctx,dir,p)=>{if(!this.canCapture(ctx,p))return;const record=await this.record(dir,id),data=record?.data;if(!data||!record||data.epoch!==p.epoch||data.consent_revision!==p.revision||data.actor_id!==ctx.actor||data.login_session_id!==session.session_id)return;const response=data.greeting.id===replyId?data.greeting:data.entries.find(e=>e.reply?.id===replyId)?.reply;if(response&&!response.playback_completed_at){response.playback_completed_at=this.clock().toISOString();await this.write(dir,record.file,data);}});}
 end(session:Session,id:string){return this.scoped(session,async(ctx,dir,p)=>{const record=await this.record(dir,id),data=record?.data;if(data&&record&&data.epoch===p.epoch&&data.actor_id===ctx.actor&&data.login_session_id===session.session_id&&!data.ended_at){data.ended_at=this.clock().toISOString();await this.write(dir,record.file,data);}});}
 list(session:Session,cursor?:string){if(cursor&&!filePattern.test(cursor))throw new ApiError(400,'invalid_cursor','Invalid conversation page.');return this.scoped(session,async(ctx,dir,p)=>{const names=(await this.names(dir)).filter(n=>!cursor||n<cursor),items:ArchiveSummary[]=[];let last:string|undefined;
  for(const file of names){const data=await this.read<ArchivedConversation>(dir,file);if(data?.epoch!==p.epoch||ctx.role==='client'&&data.actor_id!==ctx.actor)continue;items.push({id:data.id,started_at:data.started_at,turns:data.turns,ended_at:data.ended_at});last=file;if(items.length===20)break;}
  return{items,next_cursor:last&&names.some(n=>n<last!)?last:null};
 });}
 get(session:Session,id:string){return this.scoped(session,async(ctx,dir,p)=>{const data=(await this.record(dir,id))?.data;if(!data||data.epoch!==p.epoch||ctx.role==='client'&&data.actor_id!==ctx.actor)throw new ApiError(404,'not_found','No saved conversation is available.');return data;});}
 deleteAll(session:Session,input:unknown){const command=archiveDeleteSchema.parse(input);return this.scoped(session,async(ctx,dir,p)=>{requireClient(ctx);const payload=JSON.stringify(command);
  if(p.last_request?.id===command.request_id){if(p.last_request.payload!==payload)throw new ApiError(409,'conflict','Review deletion again.');}
  else{if(p.revision!==command.expected_revision)throw new ApiError(409,'conflict','The recording choice changed. Refresh and review deletion.');p={...p,revision:p.revision+1,enabled:false,epoch:randomUUID(),last_request:{id:command.request_id,payload}};await this.write(dir,'settings.enc',p);}
  let deleted=0;for(const name of await readdir(dir)){if(!filePattern.test(name)&&!/^\d{13}-[a-f0-9-]{36}\.enc\.[a-f0-9-]{36}\.tmp$/.test(name))continue;const path=join(dir,name);if(!(await lstat(path)).isFile())throw unavailable();await unlink(path);deleted++;}return{deleted,settings:this.settingsOf(ctx,p)};
 });}
}
