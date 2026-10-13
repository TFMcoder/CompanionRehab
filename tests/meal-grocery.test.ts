import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { MealGroceryService } from '../src/server/meal-grocery.js';
import { LocalCare } from '../src/server/local-care.js';
import type { Session } from '../src/server/session.js';
import { pglitePool } from './helpers/pglite-pool.js';

describe('meal and grocery review transactions',()=>{
  let db:PGlite,pool:Pool,service:MealGroceryService;
  const now=new Date('2026-10-13T14:00:00Z');
  beforeAll(async()=>{
    db=new PGlite();pool=pglitePool(db) as unknown as Pool;
    for(const file of ['002_local_care.sql','003_activity_ledger.sql','004_client_readiness.sql','005_runtime_observability.sql','006_family_task_requests.sql','007_meals_groceries.sql'])
      await db.exec(await readFile(new URL(`../db/${file}`,import.meta.url),'utf8'));
    service=new MealGroceryService(pool,{clock:()=>now});
  });
  afterAll(async()=>{await db.close();});
  async function actor(role:'client'|'family_friend',participant?:string) {
    const id=randomUUID(),p=participant??id,token=randomUUID(),sessionId=randomUUID();
    await pool.query('insert into companion_local.accounts(id,email,password_salt,password_hash) values($1,$2,$3,$3)',[id,`${id}@example.invalid`,Buffer.from('synthetic')]);
    if(!participant)await pool.query("insert into companion_local.participant_profiles(id,display_name,time_zone,preferences) values($1,'Synthetic','America/Toronto','No invented clinical rules')",[p]);
    await pool.query('insert into companion_local.role_grants(participant_id,actor_id,role) values($1,$2,$3)',[p,id,role]);
    await pool.query('insert into companion_local.sessions(id,actor_id,participant_id,role,access_hash,refresh_hash,expires_at) values($1,$2,$3,$4,$5,$5,$6)',[sessionId,id,p,role,createHash('sha256').update(token).digest(),new Date(now.getTime()+3600000)]);
    return {session_id:sessionId,user_id:id,access_token:token,refresh_token:token,issued_at:now.getTime()/1000,expires_at:now.getTime()/1000+3600} satisfies Session;
  }
  const draft={name:'Synthetic lentil bowl',slots:['dinner'] as ['dinner'],portion:'One ordinary bowl',ingredients:[{name:'Lentils',amount:1,unit:'cup'}],preference_notes:'Client can adjust portion',source_refs:['docs/research/synthetic-example']};
  const key=()=>randomUUID();
  it('requires exact client acceptance, creates a stable meal option, and only adds reviewed missing ingredients',async()=>{
    const client=await actor('client');
    const cmd={type:'propose_meal' as const,idempotency_key:key(),draft};
    const proposed=await service.command(client,cmd);
    expect((await service.command(client,cmd)).replayed).toBe(true);
    await expect(service.command(client,{...cmd,draft:{...draft,name:'Changed'}})).rejects.toMatchObject({code:'conflict'});
    const id=proposed.result.proposal_id as string;
    expect((await service.workspace(client)).accepted_meals).toEqual([]);
    await expect(service.command(client,{type:'accept_meal',idempotency_key:key(),proposal_id:id,expected_revision:2})).rejects.toMatchObject({code:'conflict'});
    const accepted=await service.command(client,{type:'accept_meal',idempotency_key:key(),proposal_id:id,expected_revision:1});
    const option=accepted.result.option_id as string;
    expect((await service.workspace(client)).accepted_meals[0]).toMatchObject({id:option,name:draft.name,portion:draft.portion});
    await expect(pool.query('update companion_local.meal_options set name=$2 where id=$1',[option,'Changed name'])).rejects.toBeTruthy();
    const suggestion=(await service.suggestions(client,id))[0];
    expect(suggestion).toMatchObject({name:'Lentils',already_in_pantry:false,already_on_list:false});
    const add={type:'add_grocery' as const,idempotency_key:key(),item:{name:suggestion.name,amount:suggestion.amount,unit:suggestion.unit},proposal_id:id,expected_proposal_revision:suggestion.proposal_revision};
    const saved=await service.command(client,add);
    expect((await service.command(client,add)).replayed).toBe(true);
    expect((await service.command(client,{...add,idempotency_key:key()})).result).toMatchObject({item_id:saved.result.item_id,already_on_list:true});
    await expect(service.command(client,{...add,idempotency_key:key(),item:{name:'Other',amount:1,unit:'cup'}})).rejects.toMatchObject({code:'conflict'});
  });
  it('preserves legacy grocery IDs and blocks stale edits, changed retries and duplicate quantities',async()=>{
    const client=await actor('client');
    const legacy=(await pool.query("insert into companion_local.grocery_items(participant_id,name,quantity,created_by) values($1,'Apples','a few',$1) returning id",[client.user_id])).rows[0].id;
    expect((await service.workspace(client)).groceries.find(i=>i.id===legacy)).toMatchObject({legacy_quantity:'a few',revision:1});
    const update={type:'update_grocery' as const,idempotency_key:key(),item_id:legacy,expected_revision:1,item:{name:'Apples',amount:3,unit:'each'}};
    await service.command(client,update);
    expect((await service.command(client,update)).replayed).toBe(true);
    await expect(service.command(client,{...update,idempotency_key:key()})).rejects.toMatchObject({code:'conflict'});
    await expect(service.command(client,{...update,item:{name:'Apples',amount:4,unit:'each'}})).rejects.toMatchObject({code:'conflict'});
    const acquired=await service.command(client,{type:'mark_grocery_acquired',idempotency_key:key(),item_id:legacy,expected_revision:2});
    expect(acquired.result.acquired).toBe(true);
    await expect(service.command(client,{type:'mark_grocery_acquired',idempotency_key:key(),item_id:legacy,expected_revision:2})).rejects.toMatchObject({code:'conflict'});
  });
  it('requires explicit sharing; revocation removes reads and writes immediately',async()=>{
    const client=await actor('client'),family=await actor('family_friend',client.user_id),other=await actor('client');
    await expect(service.workspace(family)).rejects.toMatchObject({status:403});
    await expect(service.command(family,{type:'add_grocery',idempotency_key:key(),item:{name:'Tea',amount:null,unit:null},proposal_id:null,expected_proposal_revision:null})).rejects.toMatchObject({status:403});
    await expect(service.workspace(other)).resolves.toMatchObject({groceries:[]});
    const grant={type:'set_grocery_share' as const,idempotency_key:key(),actor_id:family.user_id,role:'family_friend' as const,expected_revision:0,can_read:true,can_edit:true};
    await service.command(client,grant);
    await service.command(family,{type:'add_grocery',idempotency_key:key(),item:{name:'Tea',amount:1,unit:'box'},proposal_id:null,expected_proposal_revision:null});
    expect((await service.workspace(family)).groceries).toHaveLength(1);
    await service.command(client,{...grant,idempotency_key:key(),expected_revision:1,can_read:false,can_edit:false});
    await expect(service.workspace(family)).rejects.toMatchObject({status:403});
    await expect(service.command(family,{type:'add_grocery',idempotency_key:key(),item:{name:'Milk',amount:1,unit:'carton'},proposal_id:null,expected_proposal_revision:null})).rejects.toMatchObject({status:403});
  });
  it('separates proposal details from shared grocery access and refuses keys used by older care commands',async()=>{
    const client=await actor('client'),family=await actor('family_friend',client.user_id);
    await service.command(client,{type:'set_grocery_share',idempotency_key:key(),actor_id:family.user_id,role:'family_friend',expected_revision:0,can_read:true,can_edit:true});
    const proposed=await service.command(client,{type:'propose_meal',idempotency_key:key(),draft});
    const id=proposed.result.proposal_id as string;
    await service.command(client,{type:'accept_meal',idempotency_key:key(),proposal_id:id,expected_revision:1});
    const shared=await service.workspace(family);
    expect(shared.proposals).toEqual([]);expect(shared.accepted_meals).toEqual([]);expect(shared.preferences).toBeNull();
    await expect(service.command(family,{type:'add_grocery',idempotency_key:key(),proposal_id:id,expected_proposal_revision:2,item:draft.ingredients[0]})).rejects.toMatchObject({status:403});
    const used=key();
    await pool.query(`insert into companion_local.append_only_mutations(participant_id,command_id,actor_id,command,result,event_type)
      values($1,$2,$1,'{}','{}','SyntheticPrior')`,[client.user_id,used]);
    await expect(service.command(client,{type:'add_grocery',idempotency_key:used,item:{name:'Rice',amount:1,unit:'bag'},proposal_id:null,expected_proposal_revision:null})).rejects.toMatchObject({code:'conflict'});
  });
  it('shows a quantity shortfall without treating partial pantry stock as sufficient',async()=>{
    const client=await actor('client');
    await service.command(client,{type:'upsert_pantry',idempotency_key:key(),item_id:null,expected_revision:0,item:{name:'Lentils',amount:0.4,unit:'cup'}});
    const proposed=await service.command(client,{type:'propose_meal',idempotency_key:key(),draft});
    const id=proposed.result.proposal_id as string;
    await service.command(client,{type:'accept_meal',idempotency_key:key(),proposal_id:id,expected_revision:1});
    const suggestion=(await service.suggestions(client,id))[0];
    expect(suggestion.already_in_pantry).toBe(false);expect(suggestion.amount).toBeCloseTo(0.6);
    const added=await service.command(client,{type:'add_grocery',idempotency_key:key(),proposal_id:id,expected_proposal_revision:2,item:{name:'Lentils',amount:0.6,unit:'cup'}});
    expect(added.result.already_on_list).toBe(false);
  });
  it('keeps the old S01 grocery command working and rejects key reuse in both directions',async()=>{
    const client=await actor('client'),care=new LocalCare({pool,clock:()=>now});
    const oldKey=key();const old=await care.addGrocery(client,{idempotency_key:oldKey,name:'  Oats  ',quantity:'one bag'});
    expect((await service.workspace(client)).groceries.find(i=>i.id===old.item.id)).toMatchObject({name:'Oats',legacy_quantity:'one bag'});
    await expect(service.command(client,{type:'add_grocery',idempotency_key:oldKey,item:{name:'Oats',amount:1,unit:'bag'},proposal_id:null,expected_proposal_revision:null})).rejects.toMatchObject({code:'conflict'});
    const newKey=key();await service.command(client,{type:'add_grocery',idempotency_key:newKey,item:{name:'Bread',amount:1,unit:'loaf'},proposal_id:null,expected_proposal_revision:null});
    await expect(care.addGrocery(client,{idempotency_key:newKey,name:'Bread',quantity:'one loaf'})).rejects.toMatchObject({code:'conflict'});
  });
});
