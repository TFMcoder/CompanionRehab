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
  it.each([false, true])('keeps a committed appointment confirmed when refresh fails (retry: %s)', async retry => {
    let reads = 0;
    const requests: Array<{ idempotency_key: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/today') {
        if (++reads > 1) throw new Error('Refresh unavailable');
        return response(day);
      }
      if (path === '/api/appointments') {
        requests.push(JSON.parse(String(init?.body)));
        return retry && requests.length === 1 ? response({}, 503)
          : response({ appointment: { id: 'appointment-1', title: 'Clinic visit', starts_at: '2026-10-07T14:00:00-04:00' } });
      }
      return common(path);
    }));
    render(<App />);
    await fillAppointment();
    if (retry) fireEvent.click(await screen.findByRole('button', { name: 'Retry same appointment add' }));
    expect(await screen.findByText(`${retry ? 'Appointment confirmed.' : 'Appointment added.'} Refresh your day to see the latest appointments.`)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Appointment title' })).toHaveValue('');
    expect(screen.getByLabelText('Date and time in America/Toronto')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Retry same appointment add' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add appointment' }));
    expect(requests).toHaveLength(retry ? 2 : 1);
    if (retry) expect(requests[0].idempotency_key).toBe(requests[1].idempotency_key);
  });

  it('does not show or edit the previous ledger when a selected historical day fails, and can retry', async () => {
    let attempts = 0;
    vi.stubGlobal('fetch', vi.fn(async (path: string) => path.startsWith('/api/activity?')
      ? ++attempts === 1 ? response({ error: { message: 'Offline' } }, 503) : response(history('2026-10-05', 'Monday walk'))
      : common(path, { ...day, activity_ledger: ledger })));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Activity' }));
    fireEvent.change(screen.getByLabelText('Activity date'), { target: { value: '2026-10-05' } });
    await screen.findByText('Offline');
    expect(screen.queryByRole('heading', { name: 'Tuesday walk' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Correct|Mark .* done|Add unplanned activity/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Tasks done')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Monday walk' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recorded on Monday, October 5' })).toBeInTheDocument();
  });

  it('ignores a late historical response after the participant selects another date', async () => {
    let resolveFirst!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path === '/api/activity?date=2026-10-05') return new Promise<Response>(resolve => { resolveFirst = resolve; });
      if (path === '/api/activity?date=2026-10-04') return response(history('2026-10-04', 'Sunday walk'));
      return common(path, { ...day, activity_ledger: ledger });
    }));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Activity' }));
    fireEvent.change(screen.getByLabelText('Activity date'), { target: { value: '2026-10-05' } });
    await waitFor(() => expect(resolveFirst).toBeDefined());
    fireEvent.change(screen.getByLabelText('Activity date'), { target: { value: '2026-10-04' } });
    expect(await screen.findByRole('heading', { name: 'Sunday walk' })).toBeInTheDocument();
    await act(async () => { resolveFirst(response(history('2026-10-05', 'Monday walk'))); });
    expect(screen.getByRole('heading', { name: 'Sunday walk' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Monday walk' })).not.toBeInTheDocument();
  });

  it('refuses a response whose ledger date does not match the requested day', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => path.startsWith('/api/activity?') ? response(ledger) : common(path, { ...day, activity_ledger: ledger })));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Activity' }));
    fireEvent.change(screen.getByLabelText('Activity date'), { target: { value: '2026-10-05' } });
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Tuesday walk' })).not.toBeInTheDocument();
  });

  it('retains the last valid date when the date input is cleared or set in the future', async () => {
    const fetchMock = vi.fn(async (path: string) => common(path, { ...day, activity_ledger: ledger }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Activity' }));
    for (const value of ['', '2026-10-07']) {
      fireEvent.change(screen.getByLabelText('Activity date'), { target: { value } });
      expect(screen.getByLabelText('Activity date')).toHaveValue(day.local_date);
      expect(screen.getByRole('heading', { name: 'Tuesday walk' })).toBeInTheDocument();
    }
    expect(fetchMock.mock.calls.filter(([path]) => path.startsWith('/api/activity'))).toHaveLength(0);
  });

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
