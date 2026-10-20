import { describe, expect, it } from 'vitest';
import { dailyContext, type IntakeKind } from '../src/shared/daily-context.js';
import { priorityContext } from '../src/shared/priority-context.js';
import type { ActivityEntry } from '../src/shared/activity-contracts.js';
import type { Today } from '../src/shared/contracts.js';

const base: Today = { profile: { id: 'p', display_name: 'Synthetic', time_zone: 'America/Toronto', preferences: '', revision: 1 }, local_date: '2026-10-05', tasks: [], meal_options: [], checkin: null };
const meal = (overrides: Partial<ActivityEntry & { intake_kind: IntakeKind }> = {}): ActivityEntry & { intake_kind: IntakeKind } => ({
  id: 'food', kind: 'meal', title: 'Reported food', local_date: base.local_date, source_id: null, meal_slot: 'breakfast', plan_id: null,
  scheduled_at: null, status: 'completed', revision: 1, unplanned: true, occurred_at: '2026-10-05T14:30:00Z', recorded_at: '2026-10-05T14:35:00Z',
  updated_at: '2026-10-05T14:35:00Z', notes: '', portion: null, last_action: 'reported', intake_kind: 'full_meal', ...overrides,
});
const state = (entries: ActivityEntry[] = [], overrides: Partial<Today> = {}): Today => ({ ...base,
  activity_ledger: { local_date: base.local_date, options: entries, entries, recent_entries: entries,
    summary: { tasks_completed: 0, meals_eaten: 0, appointments_attended: 0, deferred: 0 } }, ...overrides });
const accepted = (tasks: Today['tasks'] = []): Today['checkin'] => ({ id: 'check', local_date: base.local_date, revision: 1, proposal: null,
  accepted: { id: 'plan', version: 1, created_at: '2026-10-05T10:00:00Z', accepted_at: '2026-10-05T10:00:00Z', task_ids: tasks.map(t => t.id), tasks,
    meals: [{ slot: 'breakfast', name: 'Oats', option_id: 'oats' }, { slot: 'lunch', name: 'Soup', option_id: 'soup' }, { slot: 'dinner', name: 'Rice', option_id: 'rice' }] } });

describe('fresh daily temporal context', () => {
  it.each([
    ['09:59', 'before_morning'], ['10:00', 'morning_routine'], ['12:59', 'morning_routine'],
    ['13:00', 'morning_catchup'], ['14:59', 'morning_catchup'], ['15:00', 'daytime'], ['19:59', 'daytime'], ['20:00', 'evening'],
  ])('uses participant-local rhythm at UTC %s', (utc, period) => {
    expect(dailyContext(base, new Date(`2026-10-05T${utc}:00Z`)).period).toBe(period);
  });
  it('makes delayed catch-up optional when the actual breakfast and morning work are complete', () => {
    const ready = state([meal({ occurred_at: '2026-10-05T12:00:00Z' })], { checkin: accepted() });
    const c = dailyContext(ready, new Date('2026-10-05T13:30:00Z'));
    expect(c.period).toBe('daytime');expect(c.morning).toEqual({ catchup_available: true, unfinished: false, breakfast_status: 'reported' });
  });
  it('uses occurrence time rather than report time or accepted meal choices', () => {
    const c = dailyContext(state([meal({ occurred_at: '2026-10-05T11:00:00Z', recorded_at: '2026-10-05T14:00:00Z' })], { checkin: accepted() }), new Date('2026-10-05T14:00:00Z'));
    expect(c.intake.latest_report).toMatchObject({ occurred_at: '2026-10-05T11:00:00.000Z', recorded_at: '2026-10-05T14:00:00Z', elapsed_minutes: 180 });
    expect(dailyContext({ ...base, checkin: accepted() }, new Date('2026-10-05T14:00:00Z')).intake.latest_report).toBeNull();
  });
  it('does not suggest an automatic lunch thirty minutes after an actual late breakfast', () => {
    const c = priorityContext(state([meal()], { checkin: accepted() }), new Date('2026-10-05T15:00:00Z'));
    expect(c.temporal?.intake.automatic_full_meal).toBe('suppress_recent_full_meal');
    expect(c.suggestions.some(item => item.kind === 'lunch')).toBe(false);
    expect(dailyContext(state([meal()]), new Date('2026-10-05T15:30:00Z')).intake.automatic_full_meal).toBe('eligible');
  });
  it('distinguishes a reported snack and unknown food without inferring size from its name or slot', () => {
    const now = new Date('2026-10-05T15:00:00Z');
    const snack = dailyContext(state([meal({ intake_kind: 'snack' })]), now);
    expect(snack.intake.latest_report?.intake_kind).toBe('snack');expect(snack.intake.latest_full_meal).toBeNull();
    expect(snack.intake.automatic_full_meal).toBe('eligible');expect(snack.intake.check_needed).toBe(false);
    const unknown = dailyContext(state([meal({ intake_kind: 'unknown' })]), now);
    expect(unknown.intake.automatic_full_meal).toBe('clarify_recent_unknown_intake');
    expect(unknown.intake.latest_full_meal).toBeNull();
    const legacy = meal();delete (legacy as Partial<typeof legacy>).intake_kind;
    expect(dailyContext(state([legacy]), now).intake.automatic_full_meal).toBe('clarify_recent_unknown_intake');
  });
  it('keeps a recent full meal relevant when a newer snack is reported', () => {
    const c = dailyContext(state([meal({ id: 'full' }), meal({ id: 'snack', meal_slot: null, intake_kind: 'snack', occurred_at: '2026-10-05T14:50:00Z' })]), new Date('2026-10-05T15:00:00Z'));
    expect(c.intake.latest_report?.activity_id).toBe('snack');expect(c.intake.latest_full_meal?.activity_id).toBe('full');
    expect(c.intake.automatic_full_meal).toBe('suppress_recent_full_meal');
  });
  it('uses current corrections and voids instead of stale legacy completed reports', () => {
    const old = meal({ id: 'meal', source_id: 'oats', unplanned: false });
    const corrected = meal({ ...old, status: 'voided', occurred_at: null, revision: 2, last_action: 'corrected' });
    const current = state([old], { activity_reports: [{ target_id: 'oats', local_date: base.local_date, status: 'completed', occurred_at: old.occurred_at!, meal_slot: 'breakfast' }] });
    current.activity_ledger!.options = [corrected];
    expect(dailyContext(current, new Date('2026-10-05T15:00:00Z')).intake.latest_report).toBeNull();
    expect(dailyContext(state([meal({ status: 'deferred', occurred_at: null })]), new Date('2026-10-05T15:00:00Z')).intake.latest_report).toBeNull();
    expect(dailyContext(state([meal({ occurred_at: '2026-10-05T16:00:00Z' })]), new Date('2026-10-05T15:00:00Z')).intake.latest_report).toBeNull();
  });
  it('checks missing reports after six preferred daytime hours without claiming fasting or wakefulness', () => {
    expect(dailyContext(base, new Date('2026-10-05T15:59:00Z')).intake.check_needed).toBe(false);
    const c = dailyContext(base, new Date('2026-10-05T16:00:00Z'));
    expect(c.intake).toMatchObject({ latest_report: null, check_needed: true, minutes_in_day_window_without_report: 360,
      intake_since_latest_report: 'unknown', awake_state: 'unknown', check_basis: 'preferred_day_window_not_observed_awake' });
    expect(dailyContext(base, new Date('2026-10-05T09:59:00Z')).intake.check_needed).toBe(false);
    expect(dailyContext(base, new Date('2026-10-06T00:00:00Z')).intake.check_needed).toBe(true);
    const reported = state([meal({ occurred_at: '2026-10-05T11:00:00Z' })]);
    expect(dailyContext(reported, new Date('2026-10-05T16:00:00Z')).intake.check_needed).toBe(false);
    expect(dailyContext(reported, new Date('2026-10-05T17:00:00Z')).intake.check_needed).toBe(true);
  });
  it('does not treat the task finish target as bedtime during a late active conversation',()=>{
    const late=priorityContext(state([meal({occurred_at:'2026-10-05T19:00:00Z',meal_slot:null,intake_kind:'snack'})]),new Date('2026-10-06T02:00:00Z'));
    expect(late.local_time).toBe('22:00');
    expect(late.temporal?.task_window.after_finish_target).toBe(true);
    expect(late.temporal?.intake).toMatchObject({check_needed:true,awake_state:'unknown',minutes_in_day_window_without_report:420});
    expect(late.suggestions[0].kind).toBe('intake_check');
  });
  it('does not use yesterday’s completed occurrence to resolve today’s routine task',()=>{
    const task={id:'routine-task',title:'Existing routine',category:'exercise' as const,time_hint:null,duration_minutes:15,scheduled_time:'10:00'};
    const yesterday:ActivityEntry={...meal(),id:'yesterday-task',kind:'task',meal_slot:null,source_id:task.id,local_date:'2026-10-04',occurred_at:'2026-10-04T14:00:00Z',scheduled_at:'2026-10-04T14:00:00Z',unplanned:false};
    const current:ActivityEntry={...yesterday,id:'today-task',local_date:base.local_date,status:'pending',occurred_at:null,scheduled_at:'2026-10-05T14:00:00Z'};
    const today=state([meal({occurred_at:'2026-10-05T12:00:00Z'})],{tasks:[task],checkin:accepted([task])});
    today.activity_ledger!.recent_entries=[yesterday,...today.activity_ledger!.recent_entries];
    today.activity_ledger!.options=[...today.activity_ledger!.entries,current];
    const context=dailyContext(today,new Date('2026-10-05T13:30:00Z'));
    expect(context.morning.unfinished).toBe(true);expect(context.period).toBe('morning_catchup');
    expect(context.task_timing[0].scheduled_at).toBe('2026-10-05T14:00:00Z');
  });
  it.each([
    ['2026-10-06', '2026-10-06T03:50:00Z', '2026-10-06T04:10:00Z', 20],
    ['2026-03-08', '2026-03-08T06:30:00Z', '2026-03-08T07:30:00Z', 60],
    ['2026-11-01', '2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z', 60],
  ])('preserves elapsed UTC time across midnight or DST on %s', (local_date, occurred_at, instant, elapsed) => {
    const c = dailyContext(state([meal({ occurred_at })], { local_date }), new Date(instant));
    expect(c.local_date).toBe(local_date);expect(c.intake.latest_report?.elapsed_minutes).toBe(elapsed);
  });
  it('uses the participant zone and refreshes stale day facts before producing actionable suggestions', () => {
    const c = priorityContext({ ...base, profile: { ...base.profile!, time_zone: 'Asia/Tokyo' } }, new Date('2026-10-05T20:00:00Z'));
    expect(c.local_date).toBe('2026-10-06');expect(c.local_time).toBe('05:00');expect(c.temporal?.facts_are_current_day).toBe(false);
    expect(c.suggestions.map(item => item.kind)).toEqual(['refresh']);
  });
  it('checks known task duration against the soft finish target while preserving unknown buffers', () => {
    const tasks: Today['tasks'] = [{ id: 'long', title: 'Long task', time_hint: null, duration_minutes: 90 }, { id: 'short', title: 'Short task', time_hint: null, duration_minutes: 30 }, { id: 'unknown', title: 'Unknown task', time_hint: null }];
    const c = dailyContext({ ...base, tasks, checkin: accepted(tasks) }, new Date('2026-10-05T23:30:00Z'));
    expect(c.task_window).toMatchObject({ minutes_remaining: 30, after_finish_target: false, preparation_travel_rest: 'unknown' });
    expect(c.task_timing.map(task => task.duration_fits_before_finish_target)).toEqual([false, true, null]);
    const late = priorityContext({ ...base, tasks: [tasks[0]], checkin: accepted([tasks[0]]) }, new Date('2026-10-05T23:30:00Z'));
    expect(late.suggestions.some(item => item.label === 'Long task')).toBe(false);
    const evening = priorityContext({ ...base, tasks, checkin: accepted(tasks) }, new Date('2026-10-06T00:00:00Z'));
    expect(evening.suggestions.map(item => item.kind)).toEqual(['intake_check']);
  });
  it('offers a dinner preparation review at sixteen without claiming dinner is due immediately', () => {
    const c = priorityContext(state([meal({ occurred_at: '2026-10-05T18:00:00Z', meal_slot: 'lunch' })], { checkin: accepted() }), new Date('2026-10-05T20:00:00Z'));
    expect(c.suggestions[0]).toMatchObject({ kind: 'dinner_preparation' });expect(c.suggestions[0].reason).toContain('preferred dinner time');
  });
});
