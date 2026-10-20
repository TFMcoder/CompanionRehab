import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { LocalCare, bootstrapLocalUser } from '../src/server/local-care.js';
import { MealGroceryService } from '../src/server/meal-grocery.js';
import { localCareMigrations } from '../src/server/local-migrations.js';
import { pglitePool } from './helpers/pglite-pool.js';

describe('mutation authority after a participant-lock wait',()=>{
 let db:PGlite,pool:Pool;
 const now=new Date('2026-10-13T14:00:00Z');
 beforeAll(async()=>{db=new PGlite();pool=pglitePool(db) as unknown as Pool;
  for(const file of localCareMigrations)await db.exec(await readFile(new URL('../db/'+file,import.meta.url),'utf8'));});
 afterAll(async()=>{await db.close();});
 async function actor(){const email=randomUUID()+'@example.invalid',password='synthetic-authority-password';
  const person=await bootstrapLocalUser(pool,{email,password,role:'client'});
  const care=new LocalCare({pool,clock:()=>now});return {person,care,session:await care.login(email,password)};}
 function interleave(change:(query:Pool['query'])=>Promise<unknown>){const wrapped=Object.create(pool);let fired=false;
  wrapped.connect=async()=>{const client=await pool.connect(),query=client.query.bind(client);
   return {query:async(sql:string,values?:unknown[])=>{if(!fired&&sql.includes('companion_local.participant_profiles')&&sql.includes('for update')){fired=true;await change(query as Pool['query']);}return query(sql,values);},release:()=>client.release()};};return wrapped as Pool;}
 for(const kind of ['session','account','grant'] as const)it('rejects a care command after '+kind+' revocation during preparation',async()=>{
  const {person,session}=await actor(),key=randomUUID();
  const wrapped=interleave(query=>kind==='session'?query('update companion_local.sessions set revoked_at=$2 where id=$1',[session.session_id,now]):
   kind==='account'?query('update companion_local.accounts set disabled_at=$2 where id=$1',[person.user_id,now]):
   query('update companion_local.role_grants set revoked_at=$2 where actor_id=$1',[person.user_id,now]));
  await expect(new LocalCare({pool:wrapped,clock:()=>now}).command(session,{type:'start_or_resume_checkin',idempotency_key:key,local_date:'2026-10-13',expected_revision:0,payload:{}})).rejects.toMatchObject({status:401});
  expect((await pool.query('select 1 from companion_local.command_receipts where command_id=$1',[key])).rows).toEqual([]);
 });
 it('rejects a family write after grocery sharing is removed during preparation',async()=>{
  const {person,care,session}=await actor(),email=randomUUID()+'@example.invalid',password='synthetic-helper-password';
  const helper=await bootstrapLocalUser(pool,{email,password,role:'family_friend',participant_id:person.participant_id}),family=await care.login(email,password);
  const service=new MealGroceryService(pool,{clock:()=>now});
  await service.command(session,{type:'set_grocery_share',idempotency_key:randomUUID(),actor_id:helper.user_id,role:'family_friend',expected_revision:0,can_read:true,can_edit:true});
  const wrapped=interleave(query=>query('update companion_local.grocery_shares set can_read=false,can_edit=false,revision=revision+1 where actor_id=$1',[helper.user_id]));
  const key=randomUUID();await expect(new MealGroceryService(wrapped,{clock:()=>now}).command(family,{type:'add_grocery',idempotency_key:key,item:{name:'Synthetic denied item',amount:null,unit:null},proposal_id:null,expected_proposal_revision:null})).rejects.toMatchObject({status:403});
  expect((await pool.query('select 1 from companion_local.meal_grocery_receipts where command_id=$1',[key])).rows).toEqual([]);
 });
});
