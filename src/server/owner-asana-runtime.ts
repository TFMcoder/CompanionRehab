import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {OwnerAsana,validateOwnerAsana,openAsana} from './owner-asana.js';
import type {LocalCare} from './local-care.js';
import type {OwnerTestSettings} from './owner-test-config.js';
import {ApiError} from './errors.js';
import {assertReviewedAuthority} from './session.js';
export async function ownerAsanaRuntime(settings:OwnerTestSettings,care:LocalCare,directory:string){
 let raw:string;try{raw=await readFile(join(directory,'asana-config.enc'),'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
 const key=Buffer.from(settings.session_key,'base64'),config=validateOwnerAsana(settings,openAsana(raw,key,'nancy-owner-asana-config-v1'));
 const identity=(await care.pool.query('select current_database() db,current_user role')).rows[0];
 if(identity.db!==settings.database_name||identity.role!==settings.database_role)throw Error('Asana sandbox database identity mismatch.');
 return new OwnerAsana(config,care.pool,async(session,client)=>{
  if(!client)return care.authority(session);
  const row=(await client.query(`select s.actor_id,s.participant_id,s.role,g.id grant_id,g.granted_at
   from companion_local.sessions s join companion_local.accounts a on a.id=s.actor_id
   join companion_local.role_grants g on g.actor_id=s.actor_id and g.participant_id=s.participant_id and g.role=s.role
   where s.id=$1 and s.access_hash=$2 and s.expires_at>now() and s.revoked_at is null and a.disabled_at is null and g.revoked_at is null
   for share of s,a,g`,[session.session_id,createHash('sha256').update(session.access_token).digest()])).rows[0];
  if(!row||row.actor_id!==session.user_id)throw new ApiError(403,'asana_scope','Your practice account access changed.');
  const a={actor_id:row.actor_id,login_session_id:session.session_id,active_role:row.role,client_id:row.participant_id,
   grant_revision:createHash('sha256').update(`${row.grant_id}:${new Date(row.granted_at).toISOString()}`).digest('hex')};
  assertReviewedAuthority(session,a);return a;
 },key);
}
