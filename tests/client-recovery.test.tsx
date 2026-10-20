// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/client/App';
import type { Today } from '../src/shared/contracts';
import type { ActivityEntry, ActivityLedger } from '../src/shared/activity-contracts';

const day: Today = {
  profile: { id: '11111111-1111-4111-8111-111111111111', display_name: 'Pat', time_zone: 'America/Toronto', preferences: '', revision: 1 },
  local_date: '2026-10-06', checkin: null, tasks: [], meal_options: [], appointments: [],
};
const entry: ActivityEntry = {
  id: '22222222-2222-4222-8222-222222222222', kind: 'task', title: 'Tuesday walk', local_date: day.local_date,
  source_id: null, meal_slot: null, plan_id: null, scheduled_at: null, status: 'completed', revision: 1, unplanned: true,
  occurred_at: '2026-10-06T13:00:00Z', recorded_at: '2026-10-06T13:01:00Z', updated_at: '2026-10-06T13:01:00Z', notes: '', portion: null, last_action: 'reported',
};
const ledger: ActivityLedger = {
  local_date: day.local_date, summary: { tasks_completed: 1, meals_eaten: 0, appointments_attended: 0, deferred: 0 },
  entries: [entry], options: [], recent_entries: [],
};
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
function common(path: string, data: Today = day) {
  if (path === '/api/config') return response({ configured: true, voice_available: true, voice_transport: 'local', assistant_name: 'Nancy', missing: [] });
  if (path === '/api/auth/session') return response({ authenticated: true, role: 'client', participant_id: '11111111-1111-4111-8111-111111111111', scope_key: 'client-test-scope', voice_eligible: true, task_requests_available: true });
  if (path === '/api/today') return response(data);
  throw new Error(`Unexpected request: ${path}`);
}
function history(date: string, title: string): ActivityLedger {
  return { ...ledger, local_date: date, entries: [{ ...entry, local_date: date, title, occurred_at: `${date}T13:00:00Z` }] };
}
async function fillAppointment() {
  fireEvent.click(await screen.findByText('Add an appointment'));
  fireEvent.change(screen.getByRole('textbox', { name: 'Appointment title' }), { target: { value: 'Clinic visit' } });
  fireEvent.change(screen.getByLabelText('Date and time in America/Toronto'), { target: { value: '2026-10-07T14:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add appointment' }));
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('client save and activity recovery', () => {

  it.each([false, true])('shows every reported meal once, including repeated slots (has plan: %s)', async hasPlan => {
    const meal1: ActivityEntry = { ...entry, kind: 'meal', title: 'Breakfast bowl', meal_slot: 'breakfast' };
    const meal2: ActivityEntry = { ...meal1, id: '33333333-3333-4333-8333-333333333333', title: 'Breakfast fruit' };
    const voided: ActivityEntry = { ...meal1, id: '44444444-4444-4444-8444-444444444444', title: 'Removed breakfast', status: 'voided' };
    const checkin: Today['checkin'] = hasPlan ? {
      id: '55555555-5555-4555-8555-555555555555', local_date: day.local_date, revision: 1, accepted: null,
      proposal: { id: '66666666-6666-4666-8666-666666666666', task_ids: [], tasks: [], created_at: '2026-10-06T12:00:00Z',
        meals: [{ slot: 'breakfast', option_id: '77777777-7777-4777-8777-777777777777', name: 'Planned toast' }] },
    } : null;
    vi.stubGlobal('fetch', vi.fn(async (path: string) => common(path, { ...day, checkin,
      activity_ledger: { ...ledger, entries: [meal1, meal2, voided], options: [meal1, meal2, voided], summary: { ...ledger.summary, tasks_completed: 0, meals_eaten: 2 } } })));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Meals' }));
    expect(screen.getAllByText('Breakfast bowl')).toHaveLength(1);
    expect(screen.getAllByText('Breakfast fruit')).toHaveLength(1);
    expect(screen.queryByText('Removed breakfast')).not.toBeInTheDocument();
    if (hasPlan) expect(screen.getByText('Planned toast')).toBeInTheDocument();
  });
});
