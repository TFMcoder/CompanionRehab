import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { LocalCare, bootstrapLocalUser } from '../src/server/local-care.js';
import { activityId, projectLedger } from '../src/server/activity-ledger.js';
import { groceryInput, type Today } from '../src/shared/contracts.js';
import type { ActivityOption, ActivityEntry } from '../src/shared/activity-contracts.js';
import type { Session } from '../src/server/session.js';
import { pglitePool } from './helpers/pglite-pool.js';

const uuid = randomUUID;
describe('activity identity across plan changes and day boundaries', () => {
  let db: PGlite | undefined, pool: Pool, care: LocalCare, session: Session, today: Today;
  let now = new Date('2026-10-06T16:00:00Z');
  beforeAll(async () => {
    const url = process.env.NANCY_REGRESSION_DATABASE_URL;
    if (url) {
      const parsed = new URL(url);
      if (!['localhost','127.0.0.1'].includes(parsed.hostname) || !/^\/nancy_audit_[a-z0-9_]+$/.test(parsed.pathname)) throw new Error('Use a separate disposable audit database.');
      pool = new Pool({connectionString:url,max:1});
    } else { db = new PGlite(); pool = pglitePool(db) as any; }
    for (const name of ['002_local_care','003_activity_ledger','004_client_readiness','005_runtime_observability']) {
      const sql=await readFile(new URL(`../db/${name}.sql`, import.meta.url),'utf8');
      if(db)await db.exec(sql);else await pool.query(sql);
    }
    care = new LocalCare({pool,clock:()=>new Date(now)});
  });
  afterAll(async()=>{ if(db)await db.close();else await pool.end(); });
  beforeEach(async()=>{
    now = new Date('2026-10-06T16:00:00Z');
    const email=`identity-${uuid()}@example.invalid`,password='disposable-regression-password';
    await bootstrapLocalUser(pool,{email,password,role:'client',display_name:'Synthetic identity test',time_zone:'America/Toronto'});
    session=await care.login(email,password);
    today=await care.setup(session,{display_name:'Synthetic identity test',time_zone:'America/Toronto',expected_revision:0,preferences:'',
      tasks:[{title:'Organize room',time_hint:null,scheduled_time:'10:30',urgency:'medium'}],
      meal_options:[{name:'Oatmeal',slots:['breakfast']},{name:'Eggs',slots:['breakfast']},{name:'Soup',slots:['lunch']},{name:'Rice',slots:['dinner']}]});
  });
  async function acceptBreakfast(name:string) {
    let state=await care.today(session);
    if(!state.checkin){ await care.command(session,{type:'start_or_resume_checkin',idempotency_key:uuid(),local_date:state.local_date,expected_revision:0,payload:{}});state=await care.today(session); }
    const p=await care.command(session,{type:state.checkin?.accepted?'revise_day_plan':'propose_day_plan',idempotency_key:uuid(),local_date:state.local_date,expected_revision:state.checkin!.revision,
      payload:{task_ids:state.tasks.map(t=>t.id),meals:[{slot:'breakfast',option_id:state.meal_options.find(m=>m.name===name)!.id},
        {slot:'lunch',option_id:state.meal_options.find(m=>m.name==='Soup')!.id},{slot:'dinner',option_id:state.meal_options.find(m=>m.name==='Rice')!.id}]}});
    await care.command(session,{type:'accept_day_plan',idempotency_key:uuid(),local_date:state.local_date,expected_revision:p.revision,payload:{proposal_id:p.plan!.id}});
    return (await care.ledger(session)).options.find(o=>o.meal_slot==='breakfast'&&o.title===name)!;
  }
  function report(option:ActivityOption,date='2026-10-06',key=uuid()) {
    return {type:'record_activity' as const,idempotency_key:key,local_date:date,expected_revision:option.revision,
      payload:{activity_id:option.id,status:'completed' as const,occurred_at:`${date}T15:00:00Z`,notes:''}};
  }
  it('rejects an old breakfast report after replacing the accepted food',async()=>{
    const old=await acceptBreakfast('Oatmeal'),current=await acceptBreakfast('Eggs');
    expect(current.id).not.toBe(old.id);
    const stale=report(old);
    await expect(care.activityCommand(session,stale)).rejects.toMatchObject({code:'unknown_activity'});
    expect(await care.activityReceipt(session,stale.idempotency_key)).toBeNull();
    expect((await care.ledger(session)).summary.meals_eaten).toBe(0);
    expect((await care.activityCommand(session,report(current))).entry.title).toBe('Eggs');
  });
  it('keeps one occurrence when an unchanged meal is reaccepted and preserves saved facts after replacement',async()=>{
    const old=await acceptBreakfast('Oatmeal');
    expect((await acceptBreakfast('Oatmeal')).id).toBe(old.id);
    const command=report(old),saved=await care.activityCommand(session,command);
    const replacement=await acceptBreakfast('Eggs');
    const ledger=await care.ledger(session);
    expect(ledger.entries.find(e=>e.id===old.id)?.title).toBe('Oatmeal');
    expect(ledger.options.find(o=>o.id===replacement.id)?.status).toBe('pending');
    expect(ledger.summary.meals_eaten).toBe(1);
    expect(await care.activityCommand(session,command)).toEqual({...saved,replayed:true});
  });
  it('keeps saved legacy slot identities without projecting a second pending copy',async()=>{
    const meal=await acceptBreakfast('Oatmeal'),state=await care.today(session);
    const legacy:ActivityEntry={...meal,id:activityId(state.profile!.id,state.local_date,'meal','breakfast'),status:'completed',revision:1,
      occurred_at:'2026-10-06T15:00:00Z',notes:'',portion:null,last_action:'reported',recorded_at:now.toISOString(),updated_at:now.toISOString()};
    const ledger=projectLedger(state,[legacy],state.local_date);
    expect(ledger.options.filter(o=>o.meal_slot==='breakfast')).toEqual([legacy]);
    expect(ledger.summary.meals_eaten).toBe(1);
  });
  it('reconciles tomorrow with the moved occurrence and rejects a stale generated destination ID',async()=>{
    const task=(await care.ledger(session)).options.find(o=>o.kind==='task')!;
    const moved=await care.activityCommand(session,{type:'reschedule_activity',idempotency_key:uuid(),local_date:today.local_date,expected_revision:task.revision,
      payload:{activity_id:task.id,scheduled_at:'2026-10-07T15:00:00Z',reason:'Move to tomorrow'}});
    now=new Date('2026-10-07T16:00:00Z');
    session=await care.authorize(session);
    const next=await care.ledger(session),options=next.options.filter(o=>o.source_id===task.source_id);
    expect(options).toHaveLength(1);expect(options[0]).toMatchObject({id:task.id,scheduled_at:'2026-10-07T15:00:00.000Z',revision:moved.entry.revision});
    const stale={...task,id:activityId(today.profile!.id,'2026-10-07','task',task.source_id!),local_date:'2026-10-07'};
    await expect(care.activityCommand(session,report(stale,'2026-10-07'))).rejects.toMatchObject({code:'unknown_activity'});
    await care.activityCommand(session,report(options[0],'2026-10-07'));
    const after=await care.ledger(session);
    expect(after.options.filter(o=>o.source_id===task.source_id)).toHaveLength(1);
    expect(after.summary.tasks_completed).toBe(1);
    await expect(care.activityCommand(session,report({...options[0],revision:options[0].revision+1},'2026-10-07'))).rejects.toMatchObject({code:'already_reported'});
  });
  it('keeps an explicit future move through intervening days and a second reschedule',async()=>{
    const task=(await care.ledger(session)).options.find(o=>o.kind==='task')!;
    let moved=await care.activityCommand(session,{type:'reschedule_activity',idempotency_key:uuid(),local_date:today.local_date,expected_revision:task.revision,
      payload:{activity_id:task.id,scheduled_at:'2026-10-08T15:00:00Z',reason:'Move two days'}});
    now=new Date('2026-10-07T16:00:00Z');session=await care.authorize(session);
    expect((await care.ledger(session)).options.filter(o=>o.source_id===task.source_id)).toEqual([moved.entry]);
    moved=await care.activityCommand(session,{type:'reschedule_activity',idempotency_key:uuid(),local_date:'2026-10-07',expected_revision:moved.entry.revision,
      payload:{activity_id:task.id,scheduled_at:'2026-10-09T15:00:00Z',reason:'Move again'}});
    expect((await care.ledger(session)).options.filter(o=>o.source_id===task.source_id)).toEqual([moved.entry]);
    now=new Date('2026-10-09T16:00:00Z');session=await care.authorize(session);
    expect((await care.ledger(session)).options.filter(o=>o.source_id===task.source_id)).toEqual([moved.entry]);
  });
  it('preserves a persisted legacy meal ID through completion, replay and correction',async()=>{
    const meal=await acceptBreakfast('Oatmeal'),state=await care.today(session);
    const legacyId=activityId(state.profile!.id,state.local_date,'meal','breakfast');
    await pool.query(`insert into companion_local.activity_records(id,participant_id,local_date,kind,title,source_id,meal_slot,plan_id,unplanned,status,revision,last_action,recorded_at,updated_at)
      values($1,$2,$3,'meal',$4,$5,'breakfast',$6,false,'deferred',1,'reported',$7,$7)`,[legacyId,state.profile!.id,state.local_date,meal.title,meal.source_id,meal.plan_id,now]);
    const option=(await care.ledger(session)).options.find(o=>o.meal_slot==='breakfast')!;
    expect(option.id).toBe(legacyId);
    const command=report(option),saved=await care.activityCommand(session,command);
    expect(saved.entry).toMatchObject({id:legacyId,title:'Oatmeal',status:'completed',revision:2});
    expect(await care.activityCommand(session,command)).toEqual({...saved,replayed:true});
    const corrected=await care.activityCommand(session,{type:'correct_activity',idempotency_key:uuid(),local_date:state.local_date,expected_revision:2,
      payload:{activity_id:legacyId,status:'voided',occurred_at:null,notes:'',reason:'Mistaken report'}});
    expect(corrected.entry).toMatchObject({id:legacyId,status:'voided',revision:3});
    expect((await care.ledger(session)).options.filter(o=>o.meal_slot==='breakfast')).toHaveLength(1);
  });
  it('retains a future reschedule even after it leaves the recent-history window',async()=>{
    const task=(await care.ledger(session)).options.find(o=>o.kind==='task')!;
    await care.activityCommand(session,{type:'reschedule_activity',idempotency_key:uuid(),local_date:today.local_date,expected_revision:0,
      payload:{activity_id:task.id,scheduled_at:'2026-10-08T15:00:00Z',reason:'Move two days'}});
    now=new Date('2026-10-07T16:00:00Z');session=await care.authorize(session);
    await pool.query(`insert into companion_local.activity_records(id,participant_id,local_date,kind,title,unplanned,status,revision,last_action,recorded_at,updated_at)
      select gen_random_uuid(),$1,'2026-10-07','task','Synthetic history '||n,true,'deferred',1,'reported',$2,$2 from generate_series(1,101) n`,[today.profile!.id,now]);
    const options=(await care.ledger(session)).options.filter(o=>o.source_id===task.source_id);
    expect(options).toHaveLength(1);expect(options[0]).toMatchObject({id:task.id,scheduled_at:'2026-10-08T15:00:00.000Z'});
  });
  it('uses the shared grocery length limit through validation and database write',async()=>{
    const input=groceryInput.parse({name:'a'.repeat(160),quantity:'one',idempotency_key:uuid()});
    const saved=await care.addGrocery(session,input);
    expect(saved.item.name).toHaveLength(160);
    expect(await care.addGrocery(session,input)).toEqual(saved);
    await expect(care.addGrocery(session,{...input,name:'a'.repeat(161),idempotency_key:uuid()})).rejects.toMatchObject({code:'invalid_input'});
  });
});
