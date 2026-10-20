import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ZodError } from 'zod';
import type { Session } from './session.js';
import { ApiError, unavailable } from './errors.js';
import { mealGroceryCommandSchema, type MealGroceryCommand, type MealGroceryReceipt, type MealGroceryWorkspace, type GrocerySuggestion, type MealDraft } from '../shared/meal-grocery-contracts.js';

type Db = Pick<PoolClient,'query'>;
type Scope = { actor: string; participant: string; role: string; canRead: boolean; canEdit: boolean; grant: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
const normalize = (name: string) => name.trim().replace(/\s+/g,' ').toLocaleLowerCase('en');
const conflict = (message = 'The saved details changed. Refresh and review again.'): never => { throw new ApiError(409,'conflict',message); };
function mapError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  if (error instanceof ZodError) throw new ApiError(400,'invalid_input','Check the meal or grocery details and try again.');
  const code = (error as {code?: string})?.code;
  if (['23505','23503','40001','40P01'].includes(code??'')) return conflict();
  if (['23514','22P02','22023'].includes(code??'')) throw new ApiError(400,'invalid_input','Check the meal or grocery details and try again.');
  throw unavailable();
}

/** All authority is rederived from the authenticated session and current grants. */
export class MealGroceryService {
  private readonly clock: () => Date;
  constructor(private readonly pool: Pool, options: {clock?: () => Date} = {}) { this.clock = options.clock ?? (()=>new Date()); }
  private async transaction<T>(work: (db: PoolClient)=>Promise<T>): Promise<T> {
    const db=await this.pool.connect();
    try { await db.query('begin'); const value=await work(db); await db.query('commit'); return value; }
    catch(error) { await db.query('rollback').catch(()=>{}); return mapError(error); }
    finally { db.release(); }
  }
  private async scope(db: Db, session: Session, lock=false): Promise<Scope> {
    const s=(await db.query(`select s.actor_id,s.participant_id,s.role,g.id grant_id,g.granted_at,
      sh.can_read,sh.can_edit,sh.revision share_revision
      from companion_local.sessions s join companion_local.accounts a on a.id=s.actor_id
      join companion_local.role_grants g on g.participant_id=s.participant_id and g.actor_id=s.actor_id and g.role=s.role
      left join companion_local.grocery_shares sh on sh.participant_id=s.participant_id and sh.actor_id=s.actor_id and sh.role=s.role
      where s.id=$1 and s.access_hash=$2 and s.expires_at>$3 and s.revoked_at is null and a.disabled_at is null and g.revoked_at is null
      ${lock?'for share of s,a,g':''}`,[session.session_id,Buffer.from(hash(session.access_token),'hex'),this.clock()])).rows[0];
    if(!s||s.actor_id!==session.user_id) throw new ApiError(401,'unauthorized','Please sign in again.');
    const canRead=s.role==='client'||!!s.can_read||!!s.can_edit;
    return {actor:s.actor_id,participant:s.participant_id,role:s.role,canRead,canEdit:s.role==='client'||!!s.can_edit,
      grant:hash(canonical([s.grant_id,s.granted_at,s.share_revision??0,s.can_read??false,s.can_edit??false]))};
  }
  private requireRead(s: Scope) { if(!s.canRead) throw new ApiError(403,'forbidden','This list is not shared with this account.'); }
  private requireEdit(s: Scope) { if(!s.canEdit) throw new ApiError(403,'forbidden','Editing this list is not shared with this account.'); }
  private requireClient(s: Scope) { if(s.role!=='client') throw new ApiError(403,'forbidden','Only the client can review or accept meals and sharing.'); }
  async workspace(session: Session): Promise<MealGroceryWorkspace> {
    try {
      const scope=await this.scope(this.pool,session); this.requireRead(scope);
      const [profile,pantry,groceries,proposals,meals,shares]=await Promise.all([
        this.pool.query('select revision,preferences from companion_local.participant_profiles where id=$1',[scope.participant]),
        this.pool.query('select id,name,amount::float8 amount,unit,revision from companion_local.pantry_items where participant_id=$1 order by name,id',[scope.participant]),
        this.pool.query('select id,name,amount::float8 amount,unit,revision,acquired_at,meal_proposal_id,quantity legacy_quantity from companion_local.grocery_items where participant_id=$1 order by acquired_at nulls first,created_at,id',[scope.participant]),
        scope.role==='client'?this.pool.query('select id,revision,proposal draft,accepted_option_id,created_at from companion_local.meal_proposals where participant_id=$1 order by created_at desc,id desc limit 50',[scope.participant]):Promise.resolve({rows:[]}),
        scope.role==='client'?this.pool.query(`select m.id,m.name,m.slots,d.portion,d.ingredients,d.preference_notes,d.source_refs,d.proposal_id,d.accepted_at
          from companion_local.meal_option_details d join companion_local.meal_options m on m.id=d.option_id and m.participant_id=d.participant_id
          where d.participant_id=$1 order by d.accepted_at desc,m.id desc limit 50`,[scope.participant]):Promise.resolve({rows:[]}),
        scope.role==='client'?this.pool.query(`select g.actor_id,g.role,a.email label,coalesce(sh.can_read,false) can_read,coalesce(sh.can_edit,false) can_edit,coalesce(sh.revision,0) revision
          from companion_local.role_grants g join companion_local.accounts a on a.id=g.actor_id
          left join companion_local.grocery_shares sh on sh.participant_id=g.participant_id and sh.actor_id=g.actor_id and sh.role=g.role
          where g.participant_id=$1 and g.role in ('family_friend','administrator') and g.revoked_at is null and a.disabled_at is null order by a.email`,[scope.participant]):Promise.resolve({rows:[]}),
      ]);
      if(canonical(await this.scope(this.pool,session))!==canonical(scope)) throw new ApiError(403,'forbidden','Sharing changed. Refresh before continuing.');
      return {role:scope.role,can_edit:scope.canEdit,profile_revision:profile.rows[0].revision,preferences:scope.role==='client'?profile.rows[0].preferences:null,
        pantry:pantry.rows,groceries:groceries.rows.map(r=>({...r,acquired_at:r.acquired_at?new Date(r.acquired_at).toISOString():null})),
        proposals:proposals.rows.map(r=>({...r,created_at:new Date(r.created_at).toISOString()})),
        accepted_meals:meals.rows.map(r=>({...r,accepted_at:new Date(r.accepted_at).toISOString()})),shares:shares.rows};
    } catch(error) { return mapError(error); }
  }
  async suggestions(session: Session, proposalId: string): Promise<GrocerySuggestion[]> {
    try {
      const s=await this.scope(this.pool,session); this.requireClient(s);
      const proposal=(await this.pool.query('select revision,proposal,accepted_option_id from companion_local.meal_proposals where id=$1 and participant_id=$2',[proposalId,s.participant])).rows[0];
      if(!proposal||!proposal.accepted_option_id) return conflict('Accept the reviewed meal before adding its ingredients.');
      const [pantry,groceries]=await Promise.all([
        this.pool.query('select normalized_name,unit,amount::float8 amount from companion_local.pantry_items where participant_id=$1',[s.participant]),
        this.pool.query('select normalized_name,unit from companion_local.grocery_items where participant_id=$1 and acquired_at is null',[s.participant]),
      ]);
      const matches=(rows:any[],name:string,unit:string|null)=>rows.some(r=>r.normalized_name===normalize(name) && r.unit===unit);
      const out=(proposal.proposal as MealDraft).ingredients.map(i=>{
        const found=pantry.rows.filter(r=>r.normalized_name===normalize(i.name)&&r.unit===i.unit);
        const known=found.filter(r=>r.amount!==null).reduce((sum:number,r:any)=>sum+Number(r.amount),0);
        const enough=i.amount===null?found.length>0:known>=i.amount;
        return {...i,amount:i.amount===null?null:Math.max(0,i.amount-known),proposal_id:proposalId,proposal_revision:proposal.revision,
          already_in_pantry:enough,already_on_list:matches(groceries.rows,i.name,i.unit)};
      });
      if(canonical(await this.scope(this.pool,session))!==canonical(s)) throw new ApiError(403,'forbidden','Sharing changed. Refresh before continuing.');
      return out;
    } catch(error) { return mapError(error); }
  }
  async receipt(session: Session, key: string): Promise<MealGroceryReceipt|null> {
    try {
      const s=await this.scope(this.pool,session); this.requireRead(s);
      const row=(await this.pool.query('select actor_id,result from companion_local.meal_grocery_receipts where participant_id=$1 and command_id=$2',[s.participant,key])).rows[0];
      if(!row||row.actor_id!==s.actor) return null;
      if(canonical(await this.scope(this.pool,session))!==canonical(s)) throw new ApiError(403,'forbidden','Sharing changed. Refresh before continuing.');
      return {command_id:key,result:row.result,replayed:true};
    } catch(error) { return mapError(error); }
  }
  async command(session: Session, raw: MealGroceryCommand): Promise<MealGroceryReceipt> {
    try {
      const cmd=mealGroceryCommandSchema.parse(raw);
      return await this.transaction(async db=>{
        let s=await this.scope(db,session); this.requireRead(s);
        if(['propose_meal','accept_meal','set_grocery_share'].includes(cmd.type)) this.requireClient(s); else this.requireEdit(s);
        // Serializes edits and receipt checks for one client, including the old S01 command ledger.
        const profile=(await db.query('select revision from companion_local.participant_profiles where id=$1 for update',[s.participant])).rows[0];
        const participant=s.participant;
        s=await this.scope(db,session,true);
        if(s.participant!==participant)throw new ApiError(403,'scope_changed','Your care scope changed. Refresh before saving.');
        this.requireRead(s);
        if(['propose_meal','accept_meal','set_grocery_share'].includes(cmd.type))this.requireClient(s);else this.requireEdit(s);
        const prior=(await db.query('select actor_id,command,result from companion_local.meal_grocery_receipts where participant_id=$1 and command_id=$2',[s.participant,cmd.idempotency_key])).rows[0];
        if(prior) {
          if(prior.actor_id!==s.actor||canonical(prior.command)!==canonical(cmd)) return conflict('This request key was already used for another change.');
          return {command_id:cmd.idempotency_key,result:prior.result,replayed:true};
        }
        const used=(await db.query(`select 1 from companion_local.append_only_mutations where participant_id=$1 and command_id=$2
          union all select 1 from companion_local.command_receipts where participant_id=$1 and command_id=$2
          union all select 1 from companion_local.request_receipts where participant_id=$1 and command_id=$2`,[s.participant,cmd.idempotency_key])).rows[0];
        if(used) return conflict('This request key was already used for another change.');
        let result:Record<string,unknown>={}; let event='';
        if(cmd.type==='propose_meal') {
          const id=randomUUID();
          await db.query('insert into companion_local.meal_proposals(id,participant_id,actor_id,proposal,profile_revision) values($1,$2,$3,$4,$5)',[id,s.participant,s.actor,JSON.stringify(cmd.draft),profile.revision]);
          result={proposal_id:id,revision:1,draft:cmd.draft,accepted:false}; event='MealProposed';
        } else if(cmd.type==='accept_meal') {
          const row=(await db.query('select * from companion_local.meal_proposals where id=$1 and participant_id=$2 for update',[cmd.proposal_id,s.participant])).rows[0];
          if(!row||row.revision!==cmd.expected_revision||row.accepted_option_id||row.profile_revision!==profile.revision) return conflict('This meal proposal changed. Review the current choices.');
          const draft=row.proposal as MealDraft;
          const option=(await db.query('insert into companion_local.meal_options(participant_id,name,slots,setup_revision) values($1,$2,$3,$4) returning id',[s.participant,draft.name,draft.slots,profile.revision])).rows[0];
          await db.query('insert into companion_local.meal_option_details(option_id,participant_id,proposal_id,portion,ingredients,source_refs,preference_notes) values($1,$2,$3,$4,$5,$6,$7)',[option.id,s.participant,row.id,draft.portion,JSON.stringify(draft.ingredients),JSON.stringify(draft.source_refs),draft.preference_notes]);
          await db.query('update companion_local.meal_proposals set accepted_option_id=$2,accepted_at=$3,revision=revision+1 where id=$1',[row.id,option.id,this.clock()]);
          result={proposal_id:row.id,option_id:option.id,revision:2,accepted:true,name:draft.name}; event='MealAccepted';
        } else if(cmd.type==='upsert_pantry') {
          if(cmd.item_id===null) {
            if(cmd.expected_revision!==0) return conflict();
            const row=(await db.query('insert into companion_local.pantry_items(participant_id,name,normalized_name,amount,unit,created_by) values($1,$2,$3,$4,$5,$6) returning id,revision',[s.participant,cmd.item.name,normalize(cmd.item.name),cmd.item.amount,cmd.item.unit,s.actor])).rows[0];
            result={item_id:row.id,revision:row.revision}; event='PantryItemAdded';
          } else {
            const row=(await db.query('update companion_local.pantry_items set name=$4,normalized_name=$5,amount=$6,unit=$7,revision=revision+1,updated_at=$8 where id=$1 and participant_id=$2 and revision=$3 returning id,revision',[cmd.item_id,s.participant,cmd.expected_revision,cmd.item.name,normalize(cmd.item.name),cmd.item.amount,cmd.item.unit,this.clock()])).rows[0];
            if(!row) return conflict(); result={item_id:row.id,revision:row.revision}; event='PantryItemUpdated';
          }
        } else if(cmd.type==='remove_pantry') {
          const row=(await db.query('delete from companion_local.pantry_items where id=$1 and participant_id=$2 and revision=$3 returning id',[cmd.item_id,s.participant,cmd.expected_revision])).rows[0];
          if(!row) return conflict(); result={item_id:row.id,removed:true}; event='PantryItemRemoved';
        } else if(cmd.type==='add_grocery') {
          let requiredAmount:number|null=null;
          if(cmd.proposal_id) {
            this.requireClient(s);
            const p=(await db.query('select revision,proposal,accepted_option_id from companion_local.meal_proposals where id=$1 and participant_id=$2',[cmd.proposal_id,s.participant])).rows[0];
            if(!p||!p.accepted_option_id||p.revision!==cmd.expected_proposal_revision) return conflict('Review the accepted meal ingredients again.');
            const ingredient=(p.proposal as MealDraft).ingredients.find(i=>normalize(i.name)===normalize(cmd.item.name)&&i.unit===cmd.item.unit
              && (i.amount===null?cmd.item.amount===null:cmd.item.amount!==null&&cmd.item.amount<=i.amount));
            if(!ingredient) return conflict('This ingredient is different from the reviewed meal.');
            requiredAmount=ingredient.amount;
          } else if(cmd.expected_proposal_revision!==null) return conflict();
          const name=normalize(cmd.item.name);
          const pantry=(await db.query('select amount::float8 amount from companion_local.pantry_items where participant_id=$1 and normalized_name=$2 and unit is not distinct from $3',[s.participant,name,cmd.item.unit])).rows;
          const stock=pantry.filter(r=>r.amount!==null).reduce((sum:number,r:any)=>sum+Number(r.amount),0);
          if(cmd.proposal_id&&(requiredAmount===null?pantry.length>0:stock>=requiredAmount)) return conflict('This ingredient is already in the pantry. Review before adding it.');
          const existing=(await db.query('select id,amount::float8 amount,unit,revision from companion_local.grocery_items where participant_id=$1 and normalized_name=$2 and acquired_at is null for update',[s.participant,name])).rows;
          if(existing.length) {
            const equal=existing.find(r=>r.unit===cmd.item.unit&&r.amount===cmd.item.amount);
            if(!equal) return conflict('This item is already on the list with another quantity or unit. Review it before changing it.');
            result={item_id:equal.id,revision:equal.revision,already_on_list:true}; event='GroceryItemConfirmed';
          } else {
            const row=(await db.query('insert into companion_local.grocery_items(participant_id,name,normalized_name,amount,unit,quantity,created_by,meal_proposal_id) values($1,$2,$3,$4,$5,$6,$7,$8) returning id,revision',[s.participant,cmd.item.name,name,cmd.item.amount,cmd.item.unit,cmd.item.amount===null?null:`${cmd.item.amount}${cmd.item.unit?` ${cmd.item.unit}`:''}`,s.actor,cmd.proposal_id])).rows[0];
            result={item_id:row.id,revision:row.revision,already_on_list:false}; event='GroceryItemAdded';
          }
        } else if(cmd.type==='update_grocery') {
          const duplicate=(await db.query('select id from companion_local.grocery_items where participant_id=$1 and normalized_name=$2 and id<>$3 and acquired_at is null',[s.participant,normalize(cmd.item.name),cmd.item_id])).rows[0];
          if(duplicate) return conflict('This item already appears on the list. Review the existing quantity.');
          const row=(await db.query('update companion_local.grocery_items set name=$4,normalized_name=$5,amount=$6,unit=$7,quantity=$8,revision=revision+1,updated_at=$9 where id=$1 and participant_id=$2 and revision=$3 and acquired_at is null returning id,revision',[cmd.item_id,s.participant,cmd.expected_revision,cmd.item.name,normalize(cmd.item.name),cmd.item.amount,cmd.item.unit,cmd.item.amount===null?null:`${cmd.item.amount}${cmd.item.unit?` ${cmd.item.unit}`:''}`,this.clock()])).rows[0];
          if(!row) return conflict(); result={item_id:row.id,revision:row.revision}; event='GroceryItemUpdated';
        } else if(cmd.type==='mark_grocery_acquired') {
          const row=(await db.query('update companion_local.grocery_items set acquired_at=$4,acquired_by=$5,revision=revision+1,updated_at=$4 where id=$1 and participant_id=$2 and revision=$3 and acquired_at is null returning id,revision',[cmd.item_id,s.participant,cmd.expected_revision,this.clock(),s.actor])).rows[0];
          if(!row) return conflict(); result={item_id:row.id,revision:row.revision,acquired:true}; event='GroceryItemAcquired';
        } else {
          const grant=(await db.query(`select 1 from companion_local.role_grants g join companion_local.accounts a on a.id=g.actor_id
            where g.participant_id=$1 and g.actor_id=$2 and g.role=$3 and g.revoked_at is null and a.disabled_at is null for share of g,a`,[s.participant,cmd.actor_id,cmd.role])).rows[0];
          if(!grant) throw new ApiError(400,'invalid_input','Choose an account with a current grant for this client.');
          const old=(await db.query('select revision from companion_local.grocery_shares where participant_id=$1 and actor_id=$2 and role=$3 for update',[s.participant,cmd.actor_id,cmd.role])).rows[0];
          if((old?.revision??0)!==cmd.expected_revision) return conflict();
          const row=(await db.query(`insert into companion_local.grocery_shares(participant_id,actor_id,role,can_read,can_edit) values($1,$2,$3,$4,$5)
            on conflict(participant_id,actor_id,role) do update set can_read=excluded.can_read,can_edit=excluded.can_edit,revision=grocery_shares.revision+1,updated_at=$6 returning revision`,[s.participant,cmd.actor_id,cmd.role,cmd.can_read||cmd.can_edit,cmd.can_edit,this.clock()])).rows[0];
          result={actor_id:cmd.actor_id,revision:row.revision,can_read:cmd.can_read||cmd.can_edit,can_edit:cmd.can_edit}; event='GrocerySharingChanged';
        }
        await db.query('insert into companion_local.meal_grocery_receipts(participant_id,command_id,actor_id,command,result) values($1,$2,$3,$4,$5)',[s.participant,cmd.idempotency_key,s.actor,JSON.stringify(cmd),JSON.stringify(result)]);
        // The existing care and request services already check this shared ledger.
        await db.query('insert into companion_local.append_only_mutations(participant_id,command_id,actor_id,command,result,event_type) values($1,$2,$3,$4,$5,$6)',[s.participant,cmd.idempotency_key,s.actor,JSON.stringify(cmd),JSON.stringify(result),event]);
        await db.query('insert into companion_local.domain_events(participant_id,actor_id,command_id,event_type,data) values($1,$2,$3,$4,$5)',[s.participant,s.actor,cmd.idempotency_key,event,JSON.stringify(result)]);
        return {command_id:cmd.idempotency_key,result,replayed:false};
      });
    } catch(error) { return mapError(error); }
  }
}
