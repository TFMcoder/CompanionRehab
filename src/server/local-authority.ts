import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Session } from './session.js';
import type { AppRole } from '../shared/contracts.js';
import { ApiError } from './errors.js';
import { assertReviewedAuthority } from './session.js';

export type LocalDb = Pick<PoolClient, 'query'>;
export interface LocalAuthority { actor: string; participant: string; role: AppRole; zone: string; profileRevision: number; grant: string }
export function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function localAuthority(db: LocalDb, session: Session, now: Date, lock = false): Promise<LocalAuthority> {
  const row=(await db.query(`select s.actor_id,s.participant_id,s.role,p.time_zone,p.revision,g.id,g.granted_at
    from companion_local.sessions s join companion_local.accounts a on a.id=s.actor_id
    join companion_local.role_grants g on g.actor_id=s.actor_id and g.participant_id=s.participant_id and g.role=s.role
    join companion_local.participant_profiles p on p.id=s.participant_id
    where s.id=$1 and s.access_hash=$2 and s.expires_at>$3 and s.revoked_at is null and a.disabled_at is null and g.revoked_at is null
    ${lock?'for share of s,a,g':''}`, [session.session_id,createHash('sha256').update(session.access_token).digest(),now])).rows[0];
  if(!row || row.actor_id!==session.user_id) throw new ApiError(401,'unauthorized','Please sign in again.');
  assertReviewedAuthority(session,{actor_id:row.actor_id,login_session_id:session.session_id,active_role:row.role,client_id:row.participant_id,
    grant_revision:createHash('sha256').update(`${row.id}:${new Date(row.granted_at).toISOString()}`).digest('hex')});
  return {actor:row.actor_id,participant:row.participant_id,role:row.role,zone:row.time_zone,profileRevision:row.revision,
    grant:createHash('sha256').update(canonicalJson([row.id,row.granted_at,row.role])).digest('hex')};
}
export function requireClient(ctx: LocalAuthority) { if(ctx.role!=='client')throw new ApiError(403,'forbidden','Only the client can make this choice.'); }
export async function localTransaction<T>(pool: Pool, work:(db:PoolClient)=>Promise<T>):Promise<T> {
  const db=await pool.connect();
  try {await db.query('begin');const value=await work(db);await db.query('commit');return value;}
  catch(error){await db.query('rollback').catch(()=>{});throw error;}
  finally{db.release();}
}
/** A profile lock serializes care commands across features, including legacy commands. */
export async function lockParticipant(db:LocalDb,ctx:LocalAuthority) {
  const row=(await db.query('select revision,time_zone from companion_local.participant_profiles where id=$1 for update',[ctx.participant])).rows[0];
  if(!row)throw new ApiError(409,'setup_required','Complete the day setup first.');
  ctx.profileRevision=row.revision;ctx.zone=row.time_zone;
}
export async function previousLocalCommand(db:LocalDb,ctx:LocalAuthority,key:string,command:unknown,eventPrefix:string):Promise<any|null> {
  const rows=(await db.query(`select command,result,event_type,actor_id from companion_local.append_only_mutations where participant_id=$1 and command_id=$2
    union all select command,result,'plan',null::uuid from companion_local.command_receipts where participant_id=$1 and command_id=$2
    union all select command,result,'request',actor_id from companion_local.request_receipts where participant_id=$1 and command_id=$2`,[ctx.participant,key])).rows;
  if(!rows.length)return null;
  const row=rows[0];
  if(rows.length!==1 || row.actor_id!==ctx.actor || !row.event_type.startsWith(eventPrefix) || canonicalJson(row.command)!==canonicalJson(command))
    throw new ApiError(409,'conflict','This request key was used for a different change. Review again.');
  return {...row.result,replayed:true};
}
export async function saveLocalCommand(db:LocalDb,ctx:LocalAuthority,command:{idempotency_key:string},result:unknown,eventType:string,date:string,details:unknown) {
  await db.query('insert into companion_local.append_only_mutations(participant_id,command_id,command,result,event_type,actor_id) values($1,$2,$3,$4,$5,$6)',[ctx.participant,command.idempotency_key,JSON.stringify(command),JSON.stringify(result),eventType,ctx.actor]);
  await db.query('insert into companion_local.domain_events(participant_id,actor_id,command_id,event_type,local_date,data) values($1,$2,$3,$4,$5,$6)',[ctx.participant,ctx.actor,command.idempotency_key,eventType,date,JSON.stringify(details)]);
}
