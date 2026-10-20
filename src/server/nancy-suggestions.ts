import type {Pool} from 'pg';
import {z} from 'zod';
import type {Session} from './session.js';
import {ApiError} from './errors.js';
import {localAuthority,localTransaction,lockParticipant,previousLocalCommand,saveLocalCommand,requireClient,type LocalAuthority} from './local-authority.js';

export const nancySuggestionSchema=z.object({idempotency_key:z.uuid(),suggestion:z.string().trim().min(1).max(1000),grant_revision:z.string().length(64)}).strict();
export type NancySuggestionCommand=z.infer<typeof nancySuggestionSchema>;
/** Product feedback is distinct from care preferences, tasks and clinical facts. No outbound notification. */
export class NancySuggestions {
 constructor(private pool:Pool,private clock=()=>new Date()){}
 private async recheck(session:Session,prior:LocalAuthority){const current=await localAuthority(this.pool,session,this.clock());if(current.actor!==prior.actor||current.participant!==prior.participant||current.role!==prior.role||current.grant!==prior.grant)throw new ApiError(403,'scope_changed','Your access changed. Reopen your suggestions.');}
 async prepare(session:Session,suggestion:string,key:string){const ctx=await localAuthority(this.pool,session,this.clock());requireClient(ctx);return nancySuggestionSchema.parse({idempotency_key:key,suggestion,grant_revision:ctx.grant});}
 async receipt(session:Session,key:string){const ctx=await localAuthority(this.pool,session,this.clock());requireClient(ctx);z.uuid().parse(key);const row=(await this.pool.query("select result from companion_local.append_only_mutations where participant_id=$1 and actor_id=$2 and command_id=$3 and event_type='nancy_suggestion'",[ctx.participant,ctx.actor,key])).rows[0];await this.recheck(session,ctx);return row?.result??null;}
 async save(session:Session,input:NancySuggestionCommand){const command=nancySuggestionSchema.parse(input);return localTransaction(this.pool,async db=>{
  const ctx=await localAuthority(db,session,this.clock(),true);requireClient(ctx);await lockParticipant(db,ctx);
  if(ctx.grant!==command.grant_revision)throw new ApiError(403,'scope_changed','Your access changed. Review the suggestion again.');
  const prior=await previousLocalCommand(db,ctx,command.idempotency_key,command,'nancy_suggestion');if(prior)return prior;
  const result={command_id:command.idempotency_key,result:'saved',replayed:false};
  const localDate=new Intl.DateTimeFormat('en-CA',{timeZone:ctx.zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(this.clock());
  await saveLocalCommand(db,ctx,command,result,'nancy_suggestion',localDate,{kind:'product_feedback'});return result;
 });}
 async workspace(session:Session){const ctx=await localAuthority(this.pool,session,this.clock());if(!['client','administrator'].includes(ctx.role))throw new ApiError(403,'forbidden','Suggestions are not shared with this role.');
  const rows=(await this.pool.query("select command_id,command->>'suggestion' as suggestion,created_at from companion_local.append_only_mutations where participant_id=$1 and event_type='nancy_suggestion'"+(ctx.role==='client'?' and actor_id=$2':'')+' order by created_at desc limit 20',ctx.role==='client'?[ctx.participant,ctx.actor]:[ctx.participant])).rows;
  await this.recheck(session,ctx);return {items:rows.map(r=>({id:r.command_id,suggestion:r.suggestion,created_at:new Date(r.created_at).toISOString()})),role:ctx.role};
 }
}
