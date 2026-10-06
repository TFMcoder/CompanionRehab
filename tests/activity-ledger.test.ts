import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { LocalCare, bootstrapLocalUser } from '../src/server/local-care.js';
import type { Session } from '../src/server/session.js';
import type { ActivityCommand, ActivityOption } from '../src/shared/activity-contracts.js';
import type { CareCommand } from '../src/shared/contracts.js';
import { pglitePool } from './helpers/pglite-pool.js';

const NOW = new Date('2026-10-05T15:00:00.000Z'); // 11:00 in America/Toronto.
const TODAY = '2026-10-05';
const uuid = () => crypto.randomUUID();
type RecordActivityCommand = Extract<ActivityCommand, { type: 'record_activity' }>;

interface Fixture {
  session: Session;
  taskId: string;
  acceptedPlanId: string;
}

async function createParticipant(care: LocalCare, suffix: string): Promise<Fixture> {
  const email = `ledger-${suffix}@example.invalid`;
  const password = `ledger-${suffix}-password`;
  await bootstrapLocalUser(care.pool, {
    email,
    password,
    role: 'client',
    display_name: `Ledger ${suffix}`,
    time_zone: 'America/Toronto',
  });
  const session = await care.login(email, password);
  const setup = await care.setup(session, {
    display_name: `Ledger ${suffix}`,
    time_zone: 'America/Toronto',
    expected_revision: 0,
    preferences: 'Synthetic records only',
    tasks: [{ title: `Synthetic ${suffix} walk`, time_hint: 'morning', urgency: 'medium', scheduled_time: '09:15', category: 'exercise', duration_minutes: 15 }],
    meal_options: [
      { name: `Synthetic ${suffix} oats`, slots: ['breakfast'] },
      { name: `Synthetic ${suffix} soup`, slots: ['lunch'] },
      { name: `Synthetic ${suffix} pasta`, slots: ['dinner'] },
    ],
  });
  const started = await care.command(session, {
    type: 'start_or_resume_checkin', idempotency_key: uuid(), local_date: TODAY, expected_revision: 0, payload: {},
  });
  const proposal: CareCommand = {
    type: 'propose_day_plan', idempotency_key: uuid(), local_date: TODAY, expected_revision: started.revision,
    payload: {
      task_ids: [setup.tasks[0].id],
      meals: [
        { slot: 'breakfast', option_id: setup.meal_options.find(meal => meal.slots.includes('breakfast'))!.id },
        { slot: 'lunch', option_id: setup.meal_options.find(meal => meal.slots.includes('lunch'))!.id },
        { slot: 'dinner', option_id: setup.meal_options.find(meal => meal.slots.includes('dinner'))!.id },
      ],
    },
  };
  const proposed = await care.command(session, proposal);
  const accepted = await care.command(session, {
    type: 'accept_day_plan', idempotency_key: uuid(), local_date: TODAY, expected_revision: proposed.revision,
    payload: { proposal_id: proposed.plan!.id },
  });
  return { session, taskId: setup.tasks[0].id, acceptedPlanId: accepted.plan!.id };
}

function option(options: ActivityOption[], kind: ActivityOption['kind'], titlePart?: string) {
  const matches = options.filter(candidate => candidate.kind === kind && (!titlePart || candidate.title.includes(titlePart)));
  expect(matches, `one ${kind} occurrence${titlePart ? ` containing ${titlePart}` : ''}`).toHaveLength(1);
  return matches[0];
}

function record(activity: ActivityOption, overrides: Partial<Omit<RecordActivityCommand, 'payload'>> & { payload?: RecordActivityCommand['payload'] } = {}): RecordActivityCommand {
  return {
    type: 'record_activity',
    idempotency_key: uuid(),
    local_date: activity.local_date,
    expected_revision: activity.revision,
    payload: { activity_id: activity.id, status: 'completed', occurred_at: '2026-10-05T13:30:00.000Z', notes: 'Synthetic completion' },
    ...overrides,
  } as RecordActivityCommand;
}

describe('durable factual activity ledger', () => {
  let db: PGlite;
  let care: LocalCare;
  let owner: Fixture;
  let other: Fixture;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(await readFile(new URL('../db/002_local_care.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../db/003_activity_ledger.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../db/004_client_readiness.sql', import.meta.url), 'utf8'));
    care = new LocalCare({ pool: pglitePool(db) as any, clock: () => new Date(NOW) });
    owner = await createParticipant(care, 'owner');
    other = await createParticipant(care, 'other');
    await care.setAppointment(owner.session, {
      title: 'Synthetic physiotherapy appointment',
      starts_at: '2026-10-05T18:00:00.000Z',
      idempotency_key: uuid(),
    });
    await care.setAppointment(other.session, {
      title: 'Synthetic physiotherapy appointment',
      starts_at: '2026-10-05T18:00:00.000Z',
      idempotency_key: uuid(),
    });
  });
  afterAll(async () => { await db.close(); });

  it('keeps planned task and meal occurrences pending until factual reports, then replays one exact write', async () => {
    const before = await care.ledger(owner.session);
    const meal = option(before.options, 'meal', 'oats');
    const task = option(before.options, 'task', 'walk');
    expect(before.summary).toEqual({ tasks_completed: 0, meals_eaten: 0, appointments_attended: 0, deferred: 0 });
    expect(meal).toMatchObject({ status: 'pending', revision: 0, unplanned: false, meal_slot: 'breakfast', plan_id: owner.acceptedPlanId });
    expect(task).toMatchObject({ status: 'pending', revision: 0, unplanned: false, source_id: owner.taskId, plan_id: owner.acceptedPlanId });

    const command = record(meal, { payload: { activity_id: meal.id, status: 'completed', occurred_at: '2026-10-05T12:30:00.000Z', notes: 'Ate all of it', portion: 'one bowl' } });
    const first = await care.activityCommand(owner.session, command);
    const replay = await care.activityCommand(owner.session, command);
    expect(first).toMatchObject({ result: 'reported', replayed: false, entry: { id: meal.id, kind: 'meal', status: 'completed', meal_slot: 'breakfast', portion: 'one bowl', revision: 1 } });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(await care.activityReceipt(owner.session, command.idempotency_key)).toEqual(first);

    const after = await care.ledger(owner.session);
    expect(after.summary).toEqual({ tasks_completed: 0, meals_eaten: 1, appointments_attended: 0, deferred: 0 });
    expect(after.entries.filter(entry => entry.id === meal.id)).toHaveLength(1);
    expect(after.options.find(candidate => candidate.id === meal.id)).toMatchObject({ status: 'completed', revision: 1 });
    const projected = (await care.today(owner.session)).activity_reports!.filter(report => report.meal_slot === 'breakfast');
    expect(projected).toEqual([{ target_id: meal.source_id, meal_slot: 'breakfast', status: 'completed', local_date: TODAY, occurred_at: '2026-10-05T12:30:00.000Z' }]);

    await expect(care.activityCommand(owner.session, {
      ...command,
      payload: { ...command.payload, notes: 'Changed payload under the same request key' },
    })).rejects.toMatchObject({ status: 409, code: 'conflict' });
    await expect(care.activityCommand(owner.session, record({ ...meal, revision: 1 }))).rejects.toMatchObject({ status: 409, code: 'already_reported' });
  });

  it('rejects unknown, cross-participant and stale activity targets without creating receipts', async () => {
    const ledger = await care.ledger(owner.session);
    const ownerTask = option(ledger.options, 'task', 'walk');
    const unknownKey = uuid();
    await expect(care.activityCommand(owner.session, record({ ...ownerTask, id: uuid() }, { idempotency_key: unknownKey })))
      .rejects.toMatchObject({ status: 400, code: 'unknown_activity' });
    expect(await care.activityReceipt(owner.session, unknownKey)).toBeNull();

    const crossUserKey = uuid();
    await expect(care.activityCommand(other.session, record(ownerTask, { idempotency_key: crossUserKey })))
      .rejects.toMatchObject({ status: 400, code: 'unknown_activity' });
    expect(await care.activityReceipt(other.session, crossUserKey)).toBeNull();

    const reported = await care.activityCommand(owner.session, record(ownerTask));
    await expect(care.activityCommand(owner.session, {
      type: 'correct_activity', idempotency_key: uuid(), local_date: TODAY, expected_revision: 0,
      payload: { activity_id: ownerTask.id, status: 'completed', occurred_at: reported.entry.occurred_at, notes: 'Stale correction', reason: 'Synthetic stale device' },
    })).rejects.toMatchObject({ status: 409, code: 'conflict' });
  });

  it('stores explicit unplanned work and immutable correction/void history without changing the accepted plan', async () => {
    const acceptedBefore = await care.pool.query('select plan from companion_local.accepted_day_plan_versions where proposal_id=$1', [owner.acceptedPlanId]);
    expect(acceptedBefore.rows).toHaveLength(1);
    const reportKey = uuid();
    const reported = await care.activityCommand(owner.session, {
      type: 'record_activity', idempotency_key: reportKey, local_date: TODAY, expected_revision: 0,
      payload: { unplanned: { kind: 'task', title: 'Synthetic unplanned laundry' }, status: 'completed', occurred_at: '2026-10-05T14:00:00.000Z', notes: 'Not in the accepted plan' },
    });
    expect(reported.entry).toMatchObject({ kind: 'task', title: 'Synthetic unplanned laundry', unplanned: true, plan_id: null, source_id: null, status: 'completed', revision: 1 });

    const correctionKey = uuid();
    const corrected = await care.activityCommand(owner.session, {
      type: 'correct_activity', idempotency_key: correctionKey, local_date: TODAY, expected_revision: reported.entry.revision,
      payload: { activity_id: reported.entry.id, status: 'voided', occurred_at: null, notes: 'Entered on the wrong day', reason: 'Synthetic correction test' },
    });
    expect(corrected).toMatchObject({ result: 'corrected', entry: { id: reported.entry.id, status: 'voided', revision: 2, last_action: 'corrected' } });
    expect((await care.ledger(owner.session)).entries.find(entry => entry.id === reported.entry.id)).toMatchObject({ status: 'voided', revision: 2 });

    const deferred = await care.activityCommand(owner.session, {
      type: 'record_activity', idempotency_key: uuid(), local_date: TODAY, expected_revision: 0,
      payload: { unplanned: { kind: 'task', title: 'Synthetic deferred phone call' }, status: 'deferred', occurred_at: null, notes: 'Moved by explicit participant report' },
    });
    expect(deferred.entry).toMatchObject({ unplanned: true, status: 'deferred', occurred_at: null, revision: 1 });
    expect((await care.ledger(owner.session)).summary.deferred).toBe(1);

    const events = await care.pool.query<{ command_id: string; event_type: string; data: any }>(
      'select command_id,event_type,data from companion_local.domain_events where command_id=any($1::uuid[]) order by created_at,id',
      [[reportKey, correctionKey]],
    );
    expect(events.rows.map(event => event.command_id).sort()).toEqual([reportKey, correctionKey].sort());
    expect(events.rows.find(event => event.command_id === reportKey)).toMatchObject({
      event_type: 'ActivityReported', data: { activity_id: reported.entry.id, after: { status: 'completed', revision: 1 } },
    });
    expect(events.rows.find(event => event.command_id === correctionKey)).toMatchObject({
      event_type: 'ActivityCorrected', data: { activity_id: reported.entry.id, before: { status: 'completed', revision: 1 }, after: { status: 'voided', revision: 2 }, reason: 'Synthetic correction test' },
    });
    await expect(care.pool.query('update companion_local.domain_events set data=$2 where command_id=$1', [reportKey, JSON.stringify({ replaced: true })]))
      .rejects.toBeTruthy();
    const acceptedAfter = await care.pool.query('select plan from companion_local.accepted_day_plan_versions where proposal_id=$1', [owner.acceptedPlanId]);
    expect(acceptedAfter.rows).toEqual(acceptedBefore.rows);
  });

  it('reports actual appointment attendance and reschedules a task with old/new event facts only', async () => {
    const ledger = await care.ledger(other.session);
    const appointment = option(ledger.options, 'appointment', 'physiotherapy');
    const appointmentResult = await care.activityCommand(other.session, record(appointment, {
      payload: { activity_id: appointment.id, status: 'completed', occurred_at: '2026-10-05T14:45:00.000Z', notes: 'Arrived early' },
    }));
    expect(appointmentResult.entry).toMatchObject({ kind: 'appointment', status: 'completed', occurred_at: '2026-10-05T14:45:00.000Z' });
    expect((await care.ledger(other.session)).summary.appointments_attended).toBe(1);

    const task = option(ledger.options, 'task', 'walk');
    const planBefore = await care.pool.query('select plan from companion_local.accepted_day_plan_versions where proposal_id=$1', [other.acceptedPlanId]);
    expect(planBefore.rows).toHaveLength(1);
    const rescheduleKey = uuid();
    const command: ActivityCommand = {
      type: 'reschedule_activity', idempotency_key: rescheduleKey, local_date: TODAY, expected_revision: task.revision,
      payload: { activity_id: task.id, scheduled_at: '2026-10-05T17:00:00.000Z', reason: 'Synthetic time change' },
    };
    const changed = await care.activityCommand(other.session, command);
    expect(changed).toMatchObject({ result: 'rescheduled', entry: { id: task.id, scheduled_at: '2026-10-05T17:00:00.000Z', revision: task.revision + 1, last_action: 'rescheduled', status: task.status } });
    expect(await care.activityCommand(other.session, command)).toEqual({ ...changed, replayed: true });
    const event = (await care.pool.query<{ event_type: string; data: any }>('select event_type,data from companion_local.domain_events where command_id=$1', [rescheduleKey])).rows[0];
    expect(event).toMatchObject({ event_type: 'ActivityRescheduled' });
    expect(event.data).toMatchObject({ activity_id: task.id, old_scheduled_at: task.scheduled_at, new_scheduled_at: '2026-10-05T17:00:00.000Z', reason: 'Synthetic time change' });
    expect((await care.pool.query('select plan from companion_local.accepted_day_plan_versions where proposal_id=$1', [other.acceptedPlanId])).rows).toEqual(planBefore.rows);
  });

  it('uses the participant local day, validates future and mismatched dates, and reads durable facts after adapter restart', async () => {
    const backdatedKey = uuid();
    const backdated = await care.activityCommand(owner.session, {
      type: 'record_activity', idempotency_key: backdatedKey, local_date: '2026-10-04', expected_revision: 0,
      payload: { unplanned: { kind: 'meal', title: 'Synthetic late snack', meal_slot: 'dinner' }, status: 'completed', occurred_at: '2026-10-05T02:30:00.000Z', notes: '22:30 on the Toronto local day', portion: 'small bowl' },
    });
    expect(backdated.entry).toMatchObject({ local_date: '2026-10-04', occurred_at: '2026-10-05T02:30:00.000Z' });
    expect((await care.ledger(owner.session, '2026-10-04')).entries.some(entry => entry.id === backdated.entry.id)).toBe(true);

    await expect(care.activityCommand(owner.session, {
      type: 'record_activity', idempotency_key: uuid(), local_date: TODAY, expected_revision: 0,
      payload: { unplanned: { kind: 'task', title: 'Wrong local day' }, status: 'completed', occurred_at: '2026-10-05T02:30:00.000Z', notes: '' },
    })).rejects.toMatchObject({ status: 400, code: 'invalid_activity_time' });
    await expect(care.activityCommand(owner.session, {
      type: 'record_activity', idempotency_key: uuid(), local_date: '2026-10-06', expected_revision: 0,
      payload: { unplanned: { kind: 'task', title: 'Future local day' }, status: 'completed', occurred_at: '2026-10-06T13:00:00.000Z', notes: '' },
    })).rejects.toMatchObject({ status: 400, code: 'invalid_activity_time' });
    await expect(care.activityCommand(owner.session, {
      type: 'record_activity', idempotency_key: uuid(), local_date: TODAY, expected_revision: 0,
      payload: { unplanned: { kind: 'task', title: 'Future occurrence' }, status: 'completed', occurred_at: '2026-10-05T16:00:00.000Z', notes: '' },
    })).rejects.toMatchObject({ status: 400, code: 'invalid_activity_time' });
    await expect(care.ledger(owner.session, '2026-02-30')).rejects.toMatchObject({ status: 400, code: 'invalid_input' });

    const restarted = new LocalCare({ pool: pglitePool(db) as any, clock: () => new Date(NOW) });
    expect(await restarted.activityReceipt(owner.session, backdatedKey)).toEqual(backdated);
    const afterRestart = await restarted.ledger(owner.session, '2026-10-04');
    expect(afterRestart.entries.find(entry => entry.id === backdated.entry.id)).toMatchObject({ title: 'Synthetic late snack', status: 'completed', portion: 'small bowl' });
  });

  it('keeps the latest actor and command beside the factual projection and refuses a key reused across command families', async () => {
    const task = option((await care.ledger(other.session)).options, 'task', 'walk');
    const key = uuid();
    const first = await care.activityCommand(other.session, record(task, { idempotency_key: key }));
    const participant = (await care.pool.query('select participant_id from companion_local.role_grants where actor_id=$1', [other.session.user_id])).rows[0].participant_id;
    const projected = (await care.pool.query('select last_actor_id,last_command_id from companion_local.activity_records where participant_id=$1 and id=$2', [participant,task.id])).rows[0];
    expect(projected).toEqual({ last_actor_id: other.session.user_id, last_command_id: key });
    expect((await care.pool.query('select actor_id,command_id from companion_local.domain_events where participant_id=$1 and command_id=$2', [participant,key])).rows)
      .toEqual([{ actor_id: other.session.user_id, command_id: key }]);
    expect((await care.pool.query("select data->>'time_zone' as time_zone from companion_local.domain_events where participant_id=$1 and command_id=$2", [participant,key])).rows)
      .toEqual([{time_zone:'America/Toronto'}]);
    await expect(care.command(other.session, {
      type: 'start_or_resume_checkin', idempotency_key: key, local_date: TODAY, expected_revision: 0, payload: {},
    })).rejects.toMatchObject({ status: 409, code: 'conflict' });
    expect(await care.activityReceipt(other.session,key)).toEqual(first);
  });

  it('holds future external intents behind participant-scoped targets with no delivery state', async () => {
    const actor = other.session.user_id;
    const participant = (await care.pool.query('select participant_id from companion_local.role_grants where actor_id=$1', [actor])).rows[0].participant_id;
    const ownerParticipant = (await care.pool.query('select participant_id from companion_local.role_grants where actor_id=$1', [owner.session.user_id])).rows[0].participant_id;
    const event = (await care.pool.query('select id from companion_local.domain_events where participant_id=$1 order by created_at,id limit 1', [participant])).rows[0];
    const targetId = uuid();
    await care.pool.query(`insert into companion_local.actuation_targets(id,participant_id,system,provider,destination_ref,created_by)
      values($1,$2,'calendar','future-provider','opaque-test-target',$3)`, [targetId,participant,actor]);
    await expect(care.pool.query(`insert into companion_local.actuation_targets(participant_id,system,provider,destination_ref,created_by)
      values($1,'email','future-provider','opaque-wrong-actor',$2)`, [participant,owner.session.user_id])).rejects.toBeTruthy();
    await care.pool.query(`insert into companion_local.external_resource_links(participant_id,target_id,local_kind,local_id,remote_id,linked_by)
      values($1,$2,'task_definition',$3,'remote-task-1',$4)`, [participant,targetId,other.taskId,actor]);
    await expect(care.pool.query(`insert into companion_local.external_resource_links(participant_id,target_id,local_kind,local_id,remote_id,linked_by)
      values($1,$2,'task_definition',$3,'cross-client-task',$4)`, [participant,targetId,owner.taskId,actor])).rejects.toBeTruthy();
    await expect(care.pool.query(`insert into companion_local.external_resource_links(participant_id,target_id,local_kind,local_id,remote_id,linked_by)
      values($1,$2,'appointment',$3,'unknown-local-id',$4)`, [participant,targetId,uuid(),actor])).rejects.toBeTruthy();
    const intentId = uuid();
    await care.pool.query(`insert into companion_local.actuation_intents(id,participant_id,event_id,target_id,operation,request,requested_by)
      values($1,$2,$3,$4,'create',$5,$6)`, [intentId,participant,event.id,targetId,JSON.stringify({ local_id: uuid() }),actor]);
    expect((await care.pool.query('select state from companion_local.actuation_intents where id=$1', [intentId])).rows[0].state).toBe('held');
    await expect(care.pool.query(`insert into companion_local.actuation_intents(participant_id,event_id,target_id,operation,request,requested_by)
      values($1,$2,$3,'create','{}',$4)`, [participant,event.id,targetId,actor])).rejects.toBeTruthy();
    await expect(care.pool.query(`insert into companion_local.actuation_intents(participant_id,event_id,target_id,operation,request,requested_by)
      values($1,$2,$3,'notify','{}',$4)`, [ownerParticipant,event.id,targetId,owner.session.user_id])).rejects.toBeTruthy();
    await expect(care.pool.query("update companion_local.actuation_intents set state='sent' where id=$1", [intentId])).rejects.toBeTruthy();
  });
});
