import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import type {Session} from './session.js';
import {dateInZone,uuid} from '../shared/contracts.js';
import {preferenceCommandSchema,type ClientPreference,type PreferenceCommand,type PreferenceReceipt,type PreferenceWorkspace,type PendingPreference} from '../shared/preference-contracts.js';
import {ApiError} from './errors.js';
import {canonicalJson,localAuthority,lockParticipant,localTransaction,previousLocalCommand,requireClient,saveLocalCommand,type LocalDb,type LocalAuthority} from './local-authority.js';

const rowView=(row:any):ClientPreference=>({id:row.id,category:row.category,text:row.text,duration:row.duration,local_date:row.local_date?String(row.local_date).slice(0,10):null,revision:row.revision,active:row.active,updated_at:new Date(row.updated_at).toISOString()});
const conflict=(message:string):never=>{throw new ApiError(409,'preference_review_required',message);};
/** Explicit ordinary preferences. No inferred traits, protocol updates or model calls. */
export class PreferenceService {
  constructor(private pool:Pool,private clock=()=>new Date()){}
  private async scope(db:LocalDb,session:Session,lock=false){
    let ctx=await localAuthority(db,session,this.clock());requireClient(ctx);
    if(lock){await lockParticipant(db,ctx);const current=await localAuthority(db,session,this.clock(),true);requireClient(current);
      if(current.participant!==ctx.participant)throw new ApiError(403,'scope_changed','Your care scope changed. Refresh before saving.');ctx=current;}
    return ctx;
  }
  private async items(db:LocalDb,ctx:LocalAuthority){
    const day=dateInZone(this.clock(),ctx.zone);
    const rows=(await db.query(`select *,local_date::text as local_date from companion_local.client_preferences where participant_id=$1 and active
      and (duration='lasting' or local_date=$2) order by created_at,id limit 20`,[ctx.participant,day])).rows;
    return rows.map(rowView);
  }
  private async receiptFor(db:LocalDb,ctx:LocalAuthority,key:string):Promise<PreferenceReceipt|null>{
    const row=(await db.query(`select result from companion_local.append_only_mutations where participant_id=$1 and actor_id=$2 and command_id=$3
      and event_type in ('PreferenceSaved','PreferenceRemoved')`,[ctx.participant,ctx.actor,uuid.parse(key)])).rows[0];
    return row?{...row.result,replayed:true}:null;
  }
  private async pendingFor(db:LocalDb,ctx:LocalAuthority):Promise<PendingPreference|null>{
    const row=(await db.query('select command,grant_revision from companion_local.pending_preference_commands where participant_id=$1 and actor_id=$2',[ctx.participant,ctx.actor])).rows[0];
    if(!row)return null;
    const command=preferenceCommandSchema.parse(row.command);
    return {command,scope_matches:row.grant_revision===ctx.grant,receipt:await this.receiptFor(db,ctx,command.idempotency_key)};
  }
  async workspace(session:Session):Promise<PreferenceWorkspace>{
    const ctx=await this.scope(this.pool,session),items=await this.items(this.pool,ctx),pending=await this.pendingFor(this.pool,ctx);
    const current=await this.scope(this.pool,session);
    if(canonicalJson(current)!==canonicalJson(ctx))throw new ApiError(403,'scope_changed','Your care scope changed. Refresh preferences.');
    return {local_date:dateInZone(this.clock(),ctx.zone),items,pending};
  }
  async receipt(session:Session,key:string):Promise<PreferenceReceipt|null>{
    const ctx=await this.scope(this.pool,session),receipt=await this.receiptFor(this.pool,ctx,key);
    if(canonicalJson(await this.scope(this.pool,session))!==canonicalJson(ctx))throw new ApiError(403,'scope_changed','Your care scope changed. Refresh preferences.');
    return receipt;
  }
  async hold(session:Session,input:PreferenceCommand):Promise<void>{
    const command=preferenceCommandSchema.parse(input);
    await localTransaction(this.pool,async db=>{
      const ctx=await this.scope(db,session,true),pending=await this.pendingFor(db,ctx);
      if(pending){if(canonicalJson(pending.command)!==canonicalJson(command))throw new ApiError(409,'outcome_unconfirmed','Review the previous preference save before making another change.');return;}
      await db.query(`insert into companion_local.pending_preference_commands(participant_id,actor_id,command_id,grant_revision,command,confirmed_at)
        values($1,$2,$3,$4,$5,$6)`,[ctx.participant,ctx.actor,command.idempotency_key,ctx.grant,JSON.stringify(command),this.clock()]);
    });
  }
  async command(session:Session,input:PreferenceCommand):Promise<PreferenceReceipt>{
    const command=preferenceCommandSchema.parse(input);
    await this.hold(session,command);
    return this.commitHeld(session,command);
  }
  async retry(session:Session,key:string):Promise<PreferenceReceipt>{
    const current=await this.workspace(session),command=current.pending?.command;
    if(!command||command.idempotency_key!==uuid.parse(key)){
      const receipt=await this.receipt(session,key);if(receipt)return receipt;
      throw new ApiError(404,'not_found','No confirmed preference request is available to retry.');
    }
    return this.commitHeld(session,command);
  }
  async commitHeld(session:Session,input:PreferenceCommand):Promise<PreferenceReceipt>{
    const command=preferenceCommandSchema.parse(input);
    try{return await localTransaction(this.pool,async db=>{
      const ctx=await this.scope(db,session,true);
      const previous=await previousLocalCommand(db,ctx,command.idempotency_key,command,'Preference');if(previous)return previous;
      const held=await this.pendingFor(db,ctx);
      if(!held||!held.scope_matches||canonicalJson(held.command)!==canonicalJson(command))conflict('This preference request was cancelled or access changed. Review it again.');
      const now=this.clock(),day=dateInZone(now,ctx.zone);
      const old=command.preference_id?(await db.query('select *,local_date::text as local_date from companion_local.client_preferences where participant_id=$1 and id=$2',[ctx.participant,command.preference_id])).rows[0]:null;
      if(command.preference_id&&(!old||!old.active||old.revision!==command.expected_revision))conflict('This preference changed. Review the latest value.');
      let result:ClientPreference;
      if(command.type==='save_preference'){
        if(command.duration==='today'&&command.local_date!==day)conflict('Today-only preferences must use your current local date. Review again.');
        if(!old&&(await this.items(db,ctx)).length>=20)conflict('Review or remove an existing preference before adding another.');
        const duplicate=(await db.query(`select 1 from companion_local.client_preferences where participant_id=$1 and active and category=$2
          and lower(text)=lower($3) and duration=$4 and local_date is not distinct from $5::date and id<>$6`,[ctx.participant,command.category,command.text,command.duration,command.local_date,old?.id??'00000000-0000-0000-0000-000000000000'])).rows[0];
        if(duplicate)conflict('This preference is already saved. Review it before adding another copy.');
        const id=old?.id??randomUUID(),revision=(old?.revision??0)+1;
        result={id,category:command.category,text:command.text,duration:command.duration,local_date:command.local_date,revision,active:true,updated_at:now.toISOString()};
        await db.query(`insert into companion_local.client_preferences(id,participant_id,category,text,duration,local_date,revision,active,actor_id,created_at,updated_at)
          values($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$9) on conflict(id) do update set category=$3,text=$4,duration=$5,local_date=$6,revision=$7,actor_id=$8,updated_at=$9`,
          [id,ctx.participant,command.category,command.text,command.duration,command.local_date,revision,ctx.actor,now]);
      }else{
        result={...rowView(old),active:false,revision:old.revision+1,updated_at:now.toISOString()};
        await db.query('update companion_local.client_preferences set active=false,revision=revision+1,actor_id=$3,updated_at=$4 where participant_id=$1 and id=$2',[ctx.participant,command.preference_id,ctx.actor,now]);
      }
      const receipt:PreferenceReceipt={command_id:command.idempotency_key,result:command.type==='remove_preference'?'removed':'saved',preference:result,replayed:false};
      await saveLocalCommand(db,ctx,command,receipt,command.type==='remove_preference'?'PreferenceRemoved':'PreferenceSaved',day,{before:old?rowView(old):null,after:result});
      return receipt;
    });}catch(error){
      // Definite rejections can be reviewed afresh. Unknown outcomes retain the
      // exact command; a committed result cannot be discarded by this path.
      if(error instanceof ApiError&&error.status<500)await this.discard(session,command.idempotency_key).catch(()=>undefined);
      throw error;
    }
  }
  async acknowledge(session:Session,key:string):Promise<void>{
    await localTransaction(this.pool,async db=>{const ctx=await this.scope(db,session,true);
      if(!await this.receiptFor(db,ctx,key))throw new ApiError(409,'outcome_unconfirmed','No saved preference receipt is available yet.');
      await db.query('delete from companion_local.pending_preference_commands where participant_id=$1 and actor_id=$2 and command_id=$3',[ctx.participant,ctx.actor,uuid.parse(key)]);
    });
  }
  async discard(session:Session,key:string):Promise<boolean>{
    return localTransaction(this.pool,async db=>{const ctx=await this.scope(db,session,true);
      if(await this.receiptFor(db,ctx,key))return false;
      await db.query('delete from companion_local.pending_preference_commands where participant_id=$1 and actor_id=$2 and command_id=$3',[ctx.participant,ctx.actor,uuid.parse(key)]);return true;
    });
  }
}
