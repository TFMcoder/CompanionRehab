import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { pglitePool } from './helpers/pglite-pool.js';
import { localCareMigrations } from '../src/server/local-migrations.js';
import { bootstrapLocalUser, LocalCare } from '../src/server/local-care.js';
import { LocalDayService } from '../src/server/local-day.js';
import { dailyContext } from '../src/shared/daily-context.js';

describe('quiet preparation and confirmed significant continuity', () => {
 let db:PGlite,pool:Pool;
 beforeAll(async()=>{db=new PGlite();pool=pglitePool(db) as unknown as Pool;for(const file of localCareMigrations)await db.exec(await readFile(new URL('../db/'+file,import.meta.url),'utf8'));});
 afterAll(async()=>db.close());
 async function fixture(){
  let now=new Date('2026-10-13T09:59:00Z');const email=`${randomUUID()}@example.invalid`,password='synthetic-continuity-password';
  const person=await bootstrapLocalUser(pool,{email,password,role:'client'}),care=new LocalCare({pool,clock:()=>now}),session=await care.login(email,password);
  await pool.query("update companion_local.sessions set expires_at='2030-01-01T00:00:00Z' where id=$1",[session.session_id]);
  const read=vi.fn((participant:string,date:string)=>care.preparationFacts(participant,date));
  const service=new LocalDayService(pool,()=>now,{dayContext:read});
  const setNow=(instant:string)=>{now=new Date(instant);};
  const key=()=>({idempotency_key:randomUUID(),confirmed:true as const});
  return {person,care,session,service,read,setNow,key,clock:()=>now};
 }
 it('prepares once after local six without creating a plan, completion or prompt',async()=>{
  const f=await fixture();expect(await f.service.prepare(f.session)).toBeNull();expect(f.read).not.toHaveBeenCalled();
  f.setNow('2026-10-13T10:00:00Z');const first=await f.service.prepare(f.session);expect(first).toMatchObject({local_date:'2026-10-13',status:'prepared',trigger:'open',context_version:'daily-context-v1'});
  expect(await f.service.prepare(f.session)).toEqual(first);expect(f.read).toHaveBeenCalledOnce();
  const restarted=new LocalDayService(pool,f.clock,{dayContext:f.read});await restarted.tick('startup');expect(await restarted.prepare(f.session)).toEqual(first);expect(f.read).toHaveBeenCalledOnce();
  for(const table of ['daily_checkins','activity_records','prompt_jobs','append_only_mutations'])expect((await pool.query(`select count(*)::int as count from companion_local.${table} where participant_id=$1`,[f.person.participant_id])).rows[0].count).toBe(0);
  expect((await f.service.workspace(f.session)).preferences.enabled).toBe(false);
 });
 it('catches up a missed morning once on startup and starts a separate marker on the next local day',async()=>{
  const f=await fixture();f.setNow('2026-10-13T15:00:00Z');await f.service.tick('startup');
  expect(await f.service.prepare(f.session)).toMatchObject({local_date:'2026-10-13',trigger:'startup'});
  f.setNow('2026-10-14T10:00:00Z');await f.service.tick();await f.service.tick();
  expect(await f.service.prepare(f.session)).toMatchObject({local_date:'2026-10-14',trigger:'scheduler'});
  const rows=(await pool.query('select local_date::text as local_date from companion_local.daily_preparations where participant_id=$1 order by local_date',[f.person.participant_id])).rows;
  expect(rows.map(row=>row.local_date)).toEqual(['2026-10-13','2026-10-14']);
 });
 it('keeps preparation as metadata and reads actual changes freshly afterward',async()=>{
  const f=await fixture();f.setNow('2026-10-13T11:00:00Z');const first=await f.service.prepare(f.session);
  await f.care.activityCommand(f.session,{type:'record_activity',idempotency_key:randomUUID(),local_date:'2026-10-13',expected_revision:0,payload:{unplanned:{kind:'meal',title:'Synthetic breakfast',meal_slot:'breakfast'},status:'completed',occurred_at:'2026-10-13T11:00:00Z',notes:'',intake_kind:'full_meal'}});
  const fresh=dailyContext(await f.care.today(f.session),f.clock());expect(fresh.intake.latest_report?.elapsed_minutes).toBe(0);
  expect(await f.service.prepare(f.session)).toEqual(first);expect(f.read).toHaveBeenCalledOnce();
  const row=(await pool.query('select * from companion_local.daily_preparations where participant_id=$1',[f.person.participant_id])).rows[0];
  expect(Object.keys(row).sort()).toEqual(['context_version','local_date','participant_id','prepared_at','source_revisions','status','trigger']);
 });
 it('keeps day review available and retries when quiet preparation cannot finish',async()=>{
  const f=await fixture();f.setNow('2026-10-13T12:00:00Z');let unavailable=true;
  const service=new LocalDayService(pool,f.clock,{dayContext:async(participant,date)=>{if(unavailable)throw new Error('Synthetic preparation failure');return f.care.preparationFacts(participant,date);}});
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  try{expect((await service.workspace(f.session)).preparation).toBeNull();expect((await pool.query('select count(*)::int as count from companion_local.daily_preparations where participant_id=$1',[f.person.participant_id])).rows[0].count).toBe(0);
   unavailable=false;expect(await service.prepare(f.session)).toMatchObject({status:'prepared'});
  }finally{log.mockRestore();}
 });
 it('does not finish preparation after client permission is revoked during its read',async()=>{
  const f=await fixture();f.setNow('2026-10-13T11:00:00Z');
  const service=new LocalDayService(pool,f.clock,{dayContext:async(participant,date)=>{const facts=await f.care.preparationFacts(participant,date);await pool.query("update companion_local.role_grants set revoked_at=$2 where participant_id=$1 and role='client'",[participant,f.clock()]);return facts;}});
  await expect(service.prepare(f.session)).rejects.toMatchObject({status:401});
  expect((await pool.query('select count(*)::int as count from companion_local.daily_preparations where participant_id=$1',[f.person.participant_id])).rows[0].count).toBe(0);
 });
 it('retains an explicit significant event across dates and preserves receipts, source and corrections',async()=>{
  const f=await fixture();f.setNow('2026-10-13T12:00:00Z');
  const command={...f.key(),type:'record_significant_handoff' as const,summary:'Synthetic event to review tomorrow',occurred_at:'2026-10-13T11:00:00Z'};
  const first=await f.service.command(f.session,command);expect(first.handoff_id).toBeTruthy();expect((await f.service.command(f.session,command)).replayed).toBe(true);
  await expect(f.service.command(f.session,{...command,summary:'Changed replay'})).rejects.toMatchObject({status:409});
  f.setNow('2026-10-14T12:00:00Z');const active=await f.service.activeHandoffs(f.session);expect(active).toHaveLength(1);
  expect(active[0]).toMatchObject({id:first.handoff_id,source_actor_id:f.person.user_id,source:'client_report',status:'active',revision:1,reviewed_at:null});
  const correction=await f.service.command(f.session,{...f.key(),type:'correct_significant_handoff',handoff_id:first.handoff_id!,expected_revision:1,summary:'Corrected synthetic event',occurred_at:'2026-10-13T10:45:00Z',reason:'Corrected reported time and wording'});
  expect(correction.revision).toBe(2);expect(await f.service.receipt(f.session,command.idempotency_key)).toEqual(first);
  await expect(f.service.command(f.session,{...f.key(),type:'review_significant_handoff',handoff_id:first.handoff_id!,expected_revision:1,decision:'resolved',note:''})).rejects.toMatchObject({status:409});
  await f.service.command(f.session,{...f.key(),type:'review_significant_handoff',handoff_id:first.handoff_id!,expected_revision:2,decision:'still_relevant',note:'Still relevant today'});
  expect((await f.service.activeHandoffs(f.session))[0]).toMatchObject({revision:3,status:'active',source_actor_id:f.person.user_id,reviewed_by:f.person.user_id,occurred_at:'2026-10-13T10:45:00.000Z'});
  await f.service.command(f.session,{...f.key(),type:'review_significant_handoff',handoff_id:first.handoff_id!,expected_revision:3,decision:'resolved',note:'No longer relevant'});
  expect(await f.service.activeHandoffs(f.session)).toEqual([]);expect((await f.service.workspace(f.session)).handoff_history?.[0]).toMatchObject({revision:4,status:'resolved',resolution_note:'No longer relevant'});
  const events=(await pool.query("select data from companion_local.domain_events where participant_id=$1 and event_type='LocalDaycorrect_significant_handoff'",[f.person.participant_id])).rows;
  expect(events[0].data.handoff.before.summary).toBe(command.summary);expect(events[0].data.handoff.after.summary).toBe('Corrected synthetic event');
  await f.service.command(f.session,{...f.key(),type:'review_significant_handoff',handoff_id:first.handoff_id!,expected_revision:4,decision:'still_relevant',note:'Explicitly keep this again'});
  expect((await f.service.activeHandoffs(f.session))[0]).toMatchObject({status:'active',revision:5,resolved_at:null});
 });
 it('rejects fabricated future events and another participant’s note, and removes access on revocation',async()=>{
  const owner=await fixture(),other=await fixture();owner.setNow('2026-10-13T12:00:00Z');other.setNow('2026-10-13T12:00:00Z');
  await expect(owner.service.command(owner.session,{...owner.key(),type:'record_significant_handoff',summary:'Future fiction',occurred_at:'2026-10-14T12:00:00Z'})).rejects.toMatchObject({status:400});
  const saved=await owner.service.command(owner.session,{...owner.key(),type:'record_significant_handoff',summary:'Private synthetic context',occurred_at:'2026-10-13T11:00:00Z'});
  expect(await other.service.activeHandoffs(other.session)).toEqual([]);
  await expect(other.service.command(other.session,{...other.key(),type:'review_significant_handoff',handoff_id:saved.handoff_id!,expected_revision:1,decision:'resolved',note:''})).rejects.toMatchObject({status:409});
  await pool.query('update companion_local.accounts set disabled_at=$2 where id=$1',[owner.person.user_id,owner.clock()]);
  await expect(owner.service.activeHandoffs(owner.session)).rejects.toMatchObject({status:401});
  await expect(owner.service.command(owner.session,{...owner.key(),type:'review_significant_handoff',handoff_id:saved.handoff_id!,expected_revision:1,decision:'resolved',note:''})).rejects.toMatchObject({status:401});
 });
 it('retains the exact confirmed handoff through a lost response and restart until acknowledged',async()=>{
  const f=await fixture();f.setNow('2026-10-13T12:00:00Z');
  const command={...f.key(),type:'record_significant_handoff' as const,summary:'Synthetic recovery note',occurred_at:'2026-10-13T11:00:00Z'};
  await f.service.holdHandoff(f.session,command);await f.service.holdHandoff(f.session,command);
  await expect(f.service.holdHandoff(f.session,{...command,idempotency_key:randomUUID()})).rejects.toMatchObject({status:409});
  expect(await f.service.acknowledgeHandoff(f.session,command.idempotency_key)).toBe(false);
  const saved=await f.service.commitHeldHandoff(f.session,command);const restarted=new LocalDayService(pool,f.clock);
  expect(await restarted.pendingHandoff(f.session)).toEqual({command,scope_matches:true});expect(await restarted.receipt(f.session,command.idempotency_key)).toEqual(saved);
  expect((await restarted.commitHeldHandoff(f.session,command)).replayed).toBe(true);expect(await restarted.activeHandoffs(f.session)).toHaveLength(1);
  expect(await restarted.acknowledgeHandoff(f.session,randomUUID())).toBe(false);expect(await restarted.pendingHandoff(f.session)).not.toBeNull();
  expect(await restarted.discardPendingHandoff(f.session,command.idempotency_key)).toBe(false);expect(await restarted.pendingHandoff(f.session)).not.toBeNull();
  expect(await restarted.acknowledgeHandoff(f.session,command.idempotency_key)).toBe(true);expect(await restarted.pendingHandoff(f.session)).toBeNull();
  expect(await restarted.acknowledgeHandoff(f.session,command.idempotency_key)).toBe(true);
 });
 it('does not reuse a confirmed handoff after the client grant changes',async()=>{
  const f=await fixture();f.setNow('2026-10-13T12:00:00Z');const command={...f.key(),type:'record_significant_handoff' as const,summary:'Synthetic held note',occurred_at:'2026-10-13T11:00:00Z'};
  await f.service.holdHandoff(f.session,command);
  await pool.query("update companion_local.role_grants set granted_at=granted_at+interval '1 second' where participant_id=$1 and actor_id=$2 and role='client'",[f.person.participant_id,f.person.user_id]);
  expect(await f.service.pendingHandoff(f.session)).toEqual({command,scope_matches:false});
  await expect(f.service.holdHandoff(f.session,command)).rejects.toMatchObject({status:409});
  await expect(f.service.commitHeldHandoff(f.session,command)).rejects.toMatchObject({status:409});
  expect(await f.service.activeHandoffs(f.session)).toEqual([]);
 });
 it('discards an uncommitted confirmation and prevents a late callback from writing it',async()=>{
  const f=await fixture();f.setNow('2026-10-13T12:00:00Z');const command={...f.key(),type:'record_significant_handoff' as const,summary:'Synthetic cancelled note',occurred_at:'2026-10-13T11:00:00Z'};
  await expect(f.service.commitHeldHandoff(f.session,command)).rejects.toMatchObject({status:409});
  await f.service.holdHandoff(f.session,command);expect(await f.service.acknowledgeHandoff(f.session,command.idempotency_key)).toBe(false);
  expect(await f.service.discardPendingHandoff(f.session,command.idempotency_key)).toBe(true);
  await expect(f.service.commitHeldHandoff(f.session,command)).rejects.toMatchObject({status:409});
  expect(await f.service.pendingHandoff(f.session)).toBeNull();expect(await f.service.activeHandoffs(f.session)).toEqual([]);
 });
});
