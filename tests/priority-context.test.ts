import { describe, expect, it } from 'vitest';
import { priorityContext } from '../src/shared/priority-context.js';
import type { AcceptedPlan, Today } from '../src/shared/contracts.js';
import type { ActivityLedger, ActivityOption } from '../src/shared/activity-contracts.js';
const today: Today = { profile: { id: 'p', display_name: 'Test', time_zone: 'America/Toronto', preferences: '', revision: 0 }, local_date: '2026-10-05', tasks: [{ id: 'exercise', title: 'Approved walk', time_hint: null, category: 'exercise' }, { id: 'rehab', title: 'Approved rehab', time_hint: null, category: 'rehab' }], meal_options: [], checkin: null };
const accepted = (tasks: Today['tasks'], meals: AcceptedPlan['meals'] = []): AcceptedPlan => ({ id: 'a', version: 1, accepted_at: '', created_at: '', tasks, task_ids: tasks.map(task => task.id), meals });
const option = (overrides: Partial<ActivityOption> & Pick<ActivityOption, 'id' | 'kind' | 'title'>): ActivityOption => ({
  local_date: today.local_date, source_id: null, meal_slot: null, plan_id: 'a', scheduled_at: null, status: 'pending', revision: 0, unplanned: false, ...overrides,
});
const ledger = (options: ActivityOption[]): ActivityLedger => ({
  local_date: today.local_date, options, entries: [], recent_entries: [], summary: { tasks_completed: 0, meals_eaten: 0, appointments_attended: 0, deferred: 0 },
});
describe('fresh participant-local priorities', () => {
  it.each([['11:59', 'morning'], ['12:00', 'morning_routine'], ['14:59', 'morning_routine'], ['15:00', 'morning']])('handles 08–11 bounds at UTC %s', (utc, period) => {
    expect(priorityContext(today, new Date(`2026-10-05T${utc}:00Z`)).period).toBe(period);
  });
  it('asks about unknown breakfast and does not infer completion from an accepted menu', () => {
    const plan = accepted(today.tasks, [{ slot: 'breakfast' as const, option_id: 'b', name: 'Oats' }]);
    const c = priorityContext({ ...today, checkin: { id: 'c', revision: 1, local_date: today.local_date, proposal: plan, accepted: plan } }, new Date('2026-10-05T14:00:00Z'));
    expect(c.suggestions[0]).toMatchObject({ kind: 'breakfast', label: 'Breakfast: Oats' });
    expect(c.suggestions[0].reason).toContain('Ask whether');
  });
  it('prioritizes a near appointment and only surfaces existing routines after actual breakfast', () => {
    const state: Today = { ...today, appointments: [{ id: 'a', title: 'Appointment', starts_at: '2026-10-05T14:30:00Z' }], activity_reports: [{ target_id: 'b', meal_slot: 'breakfast', status: 'completed', local_date: today.local_date, occurred_at: '2026-10-05T13:00:00Z' }] };
    expect(priorityContext(state, new Date('2026-10-05T14:00:00Z')).suggestions[0].kind).toBe('appointment');
    state.checkin = { id: 'c', revision: 1, local_date: today.local_date, proposal: null, accepted: accepted(state.tasks) };
    expect(priorityContext(state, new Date('2026-10-05T14:00:00Z')).suggestions[1].kind).toBe('exercise');
    state.activity_reports![0].local_date = '2026-10-04';
    expect(priorityContext(state, new Date('2026-10-05T14:00:00Z')).suggestions[1].kind).toBe('breakfast');
  });
  it('uses corrected status and effective reschedules for pending task order', () => {
    const tasks: Today['tasks'] = [
      { id: 'deferred', title: 'Deferred errand', time_hint: null, urgency: 'high', scheduled_time: '13:00' },
      { id: 'tomorrow', title: 'Moved to tomorrow', time_hint: null, urgency: 'high', scheduled_time: '13:15' },
      { id: 'restored', title: 'Restored task', time_hint: null, urgency: 'low', scheduled_time: '08:00' },
    ];
    const state: Today = {
      ...today, tasks, checkin: { id: 'c', revision: 1, local_date: today.local_date, proposal: null, accepted: accepted(tasks) },
      activity_ledger: ledger([
        option({ id: '1', kind: 'task', title: tasks[0].title, source_id: 'deferred', status: 'deferred', scheduled_at: '2026-10-05T17:00:00Z' }),
        option({ id: '2', kind: 'task', title: tasks[1].title, source_id: 'tomorrow', status: 'pending', scheduled_at: '2026-10-06T15:00:00Z', revision: 1 }),
        option({ id: '3', kind: 'task', title: tasks[2].title, source_id: 'restored', status: 'voided', scheduled_at: '2026-10-05T19:30:00Z', revision: 2 }),
      ]),
    };
    const context = priorityContext(state, new Date('2026-10-05T18:00:00Z'));
    expect(context.suggestions).toContainEqual({ kind: 'task', label: 'Restored task', reason: 'Planned for 15:30; ask about its current status.' });
    expect(context.suggestions.map(suggestion => suggestion.label)).not.toContain('Deferred errand');
    expect(context.suggestions.map(suggestion => suggestion.label)).not.toContain('Moved to tomorrow');
  });
  it('uses the overridden appointment instant and does not infer attendance from its schedule', () => {
    const state: Today = {
      ...today,
      appointments: [
        { id: 'moved-near', title: 'Moved appointment', starts_at: '2026-10-05T22:00:00Z' },
        { id: 'moved-away', title: 'Tomorrow appointment', starts_at: '2026-10-05T18:15:00Z' },
      ],
      activity_ledger: ledger([
        option({ id: '1', kind: 'appointment', title: 'Moved appointment', source_id: 'moved-near', scheduled_at: '2026-10-05T18:30:00Z', revision: 1 }),
        option({ id: '2', kind: 'appointment', title: 'Tomorrow appointment', source_id: 'moved-away', scheduled_at: '2026-10-06T18:15:00Z', revision: 1 }),
      ]),
    };
    const context = priorityContext(state, new Date('2026-10-05T18:00:00Z'));
    expect(context.suggestions[0]).toEqual({ kind: 'appointment', label: 'Moved appointment', reason: 'Starts in 30 minutes. Check preparation and travel time together.' });
    expect(context.suggestions.map(suggestion => suggestion.label)).not.toContain('Tomorrow appointment');
  });
  it('suppresses factual midday meal, task and appointment actuals across plan revisions', () => {
    const tasks: Today['tasks'] = [
      { id: 'done-task', title: 'Completed task', time_hint: null, scheduled_time: '12:00' },
      { id: 'next-task', title: 'Next task', time_hint: null, scheduled_time: '13:00' },
    ];
    const plan = accepted(tasks, [{ slot: 'lunch', option_id: 'new-lunch-option', name: 'Revised lunch' }]);
    const state: Today = {
      ...today, tasks, checkin: { id: 'c', revision: 2, local_date: today.local_date, proposal: null, accepted: plan },
      appointments: [{ id: 'attended', title: 'Attended appointment', starts_at: '2026-10-05T16:20:00Z' }],
      activity_reports: [
        { target_id: 'done-task', status: 'completed', local_date: today.local_date, occurred_at: '2026-10-05T15:00:00Z' },
        { target_id: 'attended', status: 'completed', local_date: today.local_date, occurred_at: '2026-10-05T15:30:00Z' },
      ],
      activity_ledger: ledger([
        option({ id: 'task-done', kind: 'task', title: 'Completed task', source_id: 'done-task', status: 'completed', scheduled_at: '2026-10-05T16:00:00Z' }),
        option({ id: 'task-next', kind: 'task', title: 'Next task', source_id: 'next-task', scheduled_at: '2026-10-05T17:00:00Z' }),
        option({ id: 'meal-lunch', kind: 'meal', title: 'Earlier lunch option', source_id: 'old-lunch-option', meal_slot: 'lunch', status: 'completed' }),
        option({ id: 'appointment', kind: 'appointment', title: 'Attended appointment', source_id: 'attended', status: 'completed', scheduled_at: '2026-10-05T16:20:00Z' }),
      ]),
    };
    const context = priorityContext(state, new Date('2026-10-05T16:00:00Z'));
    expect(context.suggestions.map(suggestion => suggestion.label)).toEqual(['Next task']);
  });
  it('keeps legacy unplanned breakfast reports authoritative when a ledger is present', () => {
    const plan = accepted(today.tasks, [{ slot: 'breakfast', option_id: 'planned-breakfast', name: 'Oats' }]);
    const state: Today = {
      ...today, checkin: { id: 'c', revision: 1, local_date: today.local_date, proposal: null, accepted: plan },
      activity_reports: [{ target_id: 'unplanned-breakfast', meal_slot: 'breakfast', status: 'completed', local_date: today.local_date, occurred_at: '2026-10-05T13:00:00Z' }],
      activity_ledger: ledger([option({ id: 'breakfast', kind: 'meal', title: 'Oats', source_id: 'planned-breakfast', meal_slot: 'breakfast' })]),
    };
    const context = priorityContext(state, new Date('2026-10-05T14:00:00Z'));
    expect(context.suggestions.some(suggestion => suggestion.kind === 'breakfast')).toBe(false);
    expect(context.suggestions.some(suggestion => suggestion.kind === 'exercise')).toBe(true);
  });
  it('surfaces a task moved onto this day even when today’s accepted plan has different tasks', () => {
    const currentTask: Today['tasks'][number] = { id: 'current', title: 'Current plan task', time_hint: null, scheduled_time: '16:00' };
    const plan = accepted([currentTask]);
    const state: Today = {
      ...today, local_date: '2026-10-06', tasks: [currentTask], checkin: { id: 'c', revision: 1, local_date: '2026-10-06', proposal: null, accepted: plan },
      activity_reports: [{ target_id: 'unplanned-breakfast', meal_slot: 'breakfast', status: 'completed', local_date: '2026-10-06', occurred_at: '2026-10-06T13:00:00Z' }],
      activity_ledger: { ...ledger([
        option({ id: 'moved-id', kind: 'task', title: 'Moved from yesterday', local_date: '2026-10-05', source_id: 'old-task', scheduled_at: '2026-10-06T15:00:00Z', revision: 1 }),
        option({ id: 'current-id', kind: 'task', title: currentTask.title, local_date: '2026-10-06', source_id: currentTask.id, scheduled_at: '2026-10-06T20:00:00Z' }),
        option({ id: 'done-id', kind: 'task', title: 'Already completed moved task', local_date: '2026-10-05', source_id: 'done-old', scheduled_at: '2026-10-06T14:00:00Z', status: 'completed' }),
      ]), local_date: '2026-10-06' },
    };
    const context = priorityContext(state, new Date('2026-10-06T14:00:00Z'));
    expect(context.suggestions[0]).toEqual({ kind: 'task', label: 'Moved from yesterday', reason: 'Planned for 11:00; ask about its current status.' });
    expect(context.suggestions.map(suggestion => suggestion.label)).not.toContain('Already completed moved task');
  });
  it('surfaces a moved appointment from the due ledger when the source appointment is outside today’s query', () => {
    const state: Today = {
      ...today, local_date: '2026-10-06', appointments: [],
      activity_ledger: { ...ledger([
        option({ id: 'moved-appointment', kind: 'appointment', title: 'Moved clinic visit', local_date: '2026-10-05', source_id: 'old-appointment', scheduled_at: '2026-10-06T14:30:00Z', revision: 1 }),
        option({ id: 'deferred-appointment', kind: 'appointment', title: 'Deferred visit', local_date: '2026-10-05', source_id: 'deferred-old', scheduled_at: '2026-10-06T14:15:00Z', status: 'deferred' }),
      ]), local_date: '2026-10-06' },
    };
    const context = priorityContext(state, new Date('2026-10-06T14:00:00Z'));
    expect(context.suggestions[0]).toEqual({ kind: 'appointment', label: 'Moved clinic visit', reason: 'Starts in 30 minutes. Check preparation and travel time together.' });
    expect(context.suggestions.map(suggestion => suggestion.label)).not.toContain('Deferred visit');
  });
  it('does not suggest a future-dated exercise or rehab definition without an accepted plan', () => {
    const state: Today = {
      ...today,
      tasks: [
        { id: 'future-exercise', title: 'Tomorrow walk', time_hint: null, category: 'exercise', scheduled_date: '2026-10-06' },
        { id: 'today-rehab', title: 'Today rehab', time_hint: null, category: 'rehab', scheduled_date: today.local_date },
      ],
      activity_reports: [{ target_id: 'breakfast', meal_slot: 'breakfast', status: 'completed', local_date: today.local_date, occurred_at: '2026-10-05T13:00:00Z' }],
    };
    const context = priorityContext(state, new Date('2026-10-05T14:00:00Z'));
    expect(context.suggestions.map(suggestion => suggestion.label)).toContain('Today rehab');
    expect(context.suggestions.map(suggestion => suggestion.label)).not.toContain('Tomorrow walk');
  });
});
