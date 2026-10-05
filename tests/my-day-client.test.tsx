// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/client/App';
import { startLocalVoice } from '../src/client/local-voice';
import type { Today } from '../src/shared/contracts';

vi.mock('../src/client/local-voice', () => ({ startLocalVoice: vi.fn() }));
vi.mock('../src/client/voice', () => ({ startVoice: vi.fn() }));

const day: Today = {
  profile: { id: '11111111-1111-4111-8111-111111111111', display_name: 'Pat', time_zone: 'America/Toronto', preferences: '', revision: 1 },
  local_date: '2026-10-05', checkin: null,
  tasks: [{ id: '22222222-2222-4222-8222-222222222222', title: 'Fold laundry', time_hint: null, urgency: 'high', scheduled_time: '10:30', duration_minutes: 20 }],
  meal_options: [
    { id: '33333333-3333-4333-8333-333333333333', name: 'Oatmeal', slots: ['breakfast'] },
    { id: '44444444-4444-4444-8444-444444444444', name: 'Soup', slots: ['lunch'] },
    { id: '55555555-5555-4555-8555-555555555555', name: 'Pasta', slots: ['dinner'] },
  ],
};
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
function mockRequests(data: Today = day) {
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/config') return response({ configured: true, voice_available: true, voice_transport: 'local', assistant_name: 'Nancy', missing: [] });
    if (path === '/api/auth/session') return response({ authenticated: true });
    if (path === '/api/today') return response(data);
    if (path === '/api/groceries' && !init?.method) return response({ items: [{ id: 'g1', name: 'Apples', quantity: '2' }] });
    if (path === '/api/groceries' && init?.method === 'POST') return response({ id: 'g2', name: 'Milk' });
    throw new Error(`Unexpected request ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('My Day client workflow', () => {
  beforeEach(() => { vi.stubGlobal('crypto', { randomUUID: () => '66666666-6666-4666-8666-666666666666' }); });
  afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

  it('shows tasks and meals independently before the check-in and keeps Talk in every view', async () => {
    mockRequests(); render(<App />);
    expect(await screen.findByRole('heading', { name: 'Start today’s check-in' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hello, Pat.' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What would help now?' })).toBeInTheDocument();
    expect(screen.getByText('Choose what matters first at your pace.')).toBeInTheDocument();
    expect(screen.getByText('Fold laundry')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    const taskView = screen.getByRole('heading', { name: 'Tasks' }).closest('section')!;
    expect(taskView).toBeInTheDocument();
    expect(within(taskView).getByText('Fold laundry')).toBeInTheDocument();
    expect(screen.getByText('high urgency')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Talk to Nancy' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Meals' }));
    expect(screen.getByRole('heading', { name: 'Meals' })).toBeInTheDocument();
    expect(screen.getByText('Oatmeal')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Talk to Nancy' })).toBeInTheDocument();
  });

  it('keeps one local conversation mounted while tabs and voice navigation change', async () => {
    mockRequests();
    let navigate: ((view: string) => void) | undefined;
    const stop = vi.fn(async () => undefined);
    vi.mocked(startLocalVoice).mockImplementation(async options => {
      navigate = options.onNavigate;
      options.onState('listening', 'Nancy is listening.');
      return { stop, sendText: vi.fn(async () => undefined) };
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Talk to Nancy' }));
    expect(await screen.findByRole('button', { name: 'Stop voice' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Meals' }));
    navigate?.('groceries');
    expect(await screen.findByRole('heading', { name: 'Groceries' })).toBeInTheDocument();
    expect(startLocalVoice).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Stop voice' })).toBeInTheDocument();
  });

  it('shows task timing, urgency and duration in the plan review', async () => {
    const plan = {
      id: '99999999-9999-4999-8999-999999999999', task_ids: [day.tasks[0].id], tasks: day.tasks,
      meals: [
        { slot: 'breakfast' as const, option_id: day.meal_options[0].id, name: 'Oatmeal' },
        { slot: 'lunch' as const, option_id: day.meal_options[1].id, name: 'Soup' },
        { slot: 'dinner' as const, option_id: day.meal_options[2].id, name: 'Pasta' },
      ], created_at: '2026-10-05T14:00:00Z',
    };
    mockRequests({ ...day, checkin: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', local_date: day.local_date, revision: 2, proposal: plan, accepted: null } });
    render(<App />);
    const review = (await screen.findByRole('heading', { name: 'Review this plan' })).closest('section')!;
    expect(within(review).getByText('10:30 · high urgency · 20 min')).toBeInTheDocument();
  });

  it('preserves a reviewed task schedule when touch edits a meal', async () => {
    const plan = {
      id: '99999999-9999-4999-8999-999999999999', task_ids: [day.tasks[0].id], tasks: day.tasks,
      meals: [
        { slot: 'breakfast' as const, option_id: day.meal_options[0].id, name: 'Oatmeal' },
        { slot: 'lunch' as const, option_id: day.meal_options[1].id, name: 'Soup' },
        { slot: 'dinner' as const, option_id: day.meal_options[2].id, name: 'Pasta' },
      ], created_at: '2026-10-05T14:00:00Z',
    };
    let command: { payload: { task_overrides: unknown[] } } | undefined;
    const data: Today = { ...day, checkin: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', local_date: day.local_date, revision: 2, proposal: plan, accepted: null } };
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/config') return response({ configured: true, voice_available: false, assistant_name: 'Nancy', missing: [] });
      if (path === '/api/auth/session') return response({ authenticated: true });
      if (path === '/api/today') return response(data);
      if (path === '/api/commands') { command = JSON.parse(String(init?.body)); return response({ command_id: 'c1', checkin_id: data.checkin!.id, revision: 3, result: 'proposed', plan, replayed: false }); }
      throw new Error(`Unexpected request ${path}`);
    }));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Make changes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save plan for review' }));
    await waitFor(() => expect(command).toBeDefined());
    expect(command!.payload.task_overrides).toEqual([{ id: day.tasks[0].id, urgency: 'high', scheduled_time: '10:30', duration_minutes: 20 }]);
  });

  it('adds a grocery only after an explicit Add action', async () => {
    const fetchMock = mockRequests(); render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Groceries' }));
    expect(await screen.findByText('Apples')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Item' }), { target: { value: 'Milk' } });
    expect(fetchMock.mock.calls.filter(([path, init]) => path === '/api/groceries' && (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Add to groceries' }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([path, init]) => path === '/api/groceries' && (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(1));
    const [, init] = fetchMock.mock.calls.find(([path, options]) => path === '/api/groceries' && (options as RequestInit | undefined)?.method === 'POST')!;
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ name: 'Milk', idempotency_key: '66666666-6666-4666-8666-666666666666' });
  });

  it('preserves and edits task scheduling fields in the scoped setup form', async () => {
    let posted: unknown;
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/config') return response({ configured: true, voice_available: false, assistant_name: 'Nancy', missing: [] });
      if (path === '/api/auth/session') return response({ authenticated: true });
      if (path === '/api/today') return response(day);
      if (path === '/api/setup') { posted = JSON.parse(String(init?.body)); return response(day); }
      throw new Error(`Unexpected request ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock); render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit choices' }));
    fireEvent.change(await screen.findByRole('combobox', { name: 'Urgency for Fold laundry' }), { target: { value: 'medium' } });
    fireEvent.change(screen.getByLabelText('Time for Fold laundry'), { target: { value: '11:15' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Category for Fold laundry' }), { target: { value: 'rehab' } });
    fireEvent.change(screen.getByLabelText('Minutes for Fold laundry'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save choices' }));
    await waitFor(() => expect(posted).toBeDefined());
    expect((posted as { tasks: unknown[] }).tasks[0]).toMatchObject({ id: day.tasks[0].id, urgency: 'medium', scheduled_time: '11:15', category: 'rehab', duration_minutes: 25 });
  });

  it('requires an explicit offset and Add action before saving an appointment', async () => {
    let current = day;
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/config') return response({ configured: true, voice_available: false, assistant_name: 'Nancy', missing: [] });
      if (path === '/api/auth/session') return response({ authenticated: true });
      if (path === '/api/today') return response(current);
      if (path === '/api/appointments' && init?.method === 'POST') {
        const input = JSON.parse(String(init.body));
        current = { ...day, appointments: [{ id: 'a1', title: input.title, starts_at: input.starts_at }] };
        return response({ appointment: current.appointments![0] });
      }
      throw new Error(`Unexpected request ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock); render(<App />);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Appointment title' }), { target: { value: 'Clinic visit' } });
    fireEvent.change(screen.getByLabelText('Date and time in America/Toronto'), { target: { value: '2026-03-08T02:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add appointment' }));
    expect(await screen.findByText(/That time does not occur on this date/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/appointments')).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Date and time in America/Toronto'), { target: { value: '2026-10-05T14:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add appointment' }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([path]) => path === '/api/appointments')).toHaveLength(1));
    const [, appointmentRequest] = fetchMock.mock.calls.find(([path]) => path === '/api/appointments')!;
    expect(JSON.parse(String((appointmentRequest as RequestInit).body)).starts_at).toBe('2026-10-05T14:00:00-04:00');
    expect(await screen.findByText(/Clinic visit ·/)).toBeInTheDocument();
  });

  it('retains an uncertain grocery request and reuses its idempotency key across tabs', async () => {
    const uuid = vi.fn().mockReturnValueOnce('77777777-7777-4777-8777-777777777777').mockReturnValueOnce('88888888-8888-4888-8888-888888888888');
    vi.stubGlobal('crypto', { randomUUID: uuid });
    const bodies: Array<{ idempotency_key: string }> = [];
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/config') return response({ configured: true, voice_available: false, assistant_name: 'Nancy', missing: [], synthetic: true });
      if (path === '/api/auth/session') return response({ authenticated: true });
      if (path === '/api/today') return response(day);
      if (path === '/api/groceries' && !init?.method) return response({ items: [] });
      if (path === '/api/groceries' && init?.method === 'POST') { bodies.push(JSON.parse(String(init.body))); return bodies.length === 1 ? response({}, 503) : response({ id: 'g1', name: 'Milk' }); }
      throw new Error(`Unexpected request ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock); render(<App />);
    expect(await screen.findByText('Practice account · sample data only')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Groceries' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Item' }), { target: { value: 'Milk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to groceries' }));
    expect(await screen.findByRole('button', { name: 'Retry same grocery add' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Groceries' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry same grocery add' }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies.map(body => body.idempotency_key)).toEqual(['77777777-7777-4777-8777-777777777777', '77777777-7777-4777-8777-777777777777']);
    expect(uuid).toHaveBeenCalledTimes(1);
  });
});
