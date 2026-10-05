import { describe, expect, it } from 'vitest';
import { priorityContext } from '../src/shared/priority-context.js';
import type { Today } from '../src/shared/contracts.js';
const today: Today = { profile: { id: 'p', display_name: 'Test', time_zone: 'America/Toronto', preferences: '', revision: 0 }, local_date: '2026-10-05', tasks: [{ id: 'exercise', title: 'Approved walk', time_hint: null, category: 'exercise' }, { id: 'rehab', title: 'Approved rehab', time_hint: null, category: 'rehab' }], meal_options: [], checkin: null };
describe('fresh participant-local priorities', () => {
  it.each([['11:59', 'morning'], ['12:00', 'morning_routine'], ['14:59', 'morning_routine'], ['15:00', 'morning']])('handles 08–11 bounds at UTC %s', (utc, period) => {
    expect(priorityContext(today, new Date(`2026-10-05T${utc}:00Z`)).period).toBe(period);
  });
  it('asks about unknown breakfast and does not infer completion from an accepted menu', () => {
    const accepted = { id: 'a', version: 1, accepted_at: '', created_at: '', tasks: today.tasks, task_ids: ['exercise', 'rehab'], meals: [{ slot: 'breakfast' as const, option_id: 'b', name: 'Oats' }] };
    const c = priorityContext({ ...today, checkin: { id: 'c', revision: 1, local_date: today.local_date, proposal: accepted, accepted } }, new Date('2026-10-05T14:00:00Z'));
    expect(c.suggestions[0]).toMatchObject({ kind: 'breakfast', label: 'Breakfast: Oats' });
    expect(c.suggestions[0].reason).toContain('Ask whether');
  });
  it('prioritizes a near appointment and only surfaces existing routines after actual breakfast', () => {
    const state: Today = { ...today, appointments: [{ id: 'a', title: 'Appointment', starts_at: '2026-10-05T14:30:00Z' }], activity_reports: [{ target_id: 'b', meal_slot: 'breakfast', status: 'completed', local_date: today.local_date, occurred_at: '2026-10-05T13:00:00Z' }] };
    expect(priorityContext(state, new Date('2026-10-05T14:00:00Z')).suggestions[0].kind).toBe('appointment');
    state.checkin = { id: 'c', revision: 1, local_date: today.local_date, proposal: null, accepted: { id: 'a', version: 1, accepted_at: '', created_at: '', tasks: state.tasks, task_ids: state.tasks.map(t => t.id), meals: [] } };
    expect(priorityContext(state, new Date('2026-10-05T14:00:00Z')).suggestions[1].kind).toBe('exercise');
    state.activity_reports![0].local_date = '2026-10-04';
    expect(priorityContext(state, new Date('2026-10-05T14:00:00Z')).suggestions[1].kind).toBe('breakfast');
  });
});
