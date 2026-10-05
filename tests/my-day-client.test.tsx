// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/client/App';
import { startLocalVoice } from '../src/client/local-voice';
import type { Today } from '../src/shared/contracts';
import type { ActivityEntry, ActivityLedger } from '../src/shared/activity-contracts';

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
const activityLedger: ActivityLedger = {
  local_date: '2026-10-05',
  summary: { tasks_completed: 1, meals_eaten: 0, appointments_attended: 0, deferred: 0 },
  options: [
    { id: '10101010-1010-4010-8010-101010101010', kind: 'task', title: 'Fold laundry', local_date: '2026-10-05', source_id: day.tasks[0].id, meal_slot: null, plan_id: null, scheduled_at: '2026-10-05T10:30:00-04:00', status: 'pending', revision: 2, unplanned: false },
    { id: '20202020-2020-4020-8020-202020202020', kind: 'meal', title: 'Oatmeal', local_date: '2026-10-05', source_id: day.meal_options[0].id, meal_slot: 'breakfast', plan_id: null, scheduled_at: null, status: 'pending', revision: 1, unplanned: false },
    { id: '30303030-3030-4030-8030-303030303030', kind: 'appointment', title: 'Clinic visit', local_date: '2026-10-05', source_id: '40404040-4040-4040-8040-404040404040', meal_slot: null, plan_id: null, scheduled_at: '2026-10-05T14:00:00-04:00', status: 'pending', revision: 1, unplanned: false },
  ],
  entries: [{ id: '50505050-5050-4050-8050-505050505050', kind: 'task', title: 'Morning walk', local_date: '2026-10-05', source_id: null, meal_slot: null, plan_id: null, scheduled_at: null, status: 'completed', revision: 3, unplanned: true, occurred_at: '2026-10-05T08:45:00-04:00', recorded_at: '2026-10-05T12:46:00Z', updated_at: '2026-10-05T12:46:00Z', notes: 'Around the block', portion: null, last_action: 'reported' }],
  recent_entries: [],
};
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
    expect(screen.getByText('Review this item and update it when you are ready.')).toBeInTheDocument();
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

  it('uses client-facing suggestion copy and accepted task overrides', async () => {
    const acceptedTask = { ...day.tasks[0], scheduled_time: '12:45', urgency: 'low' as const, duration_minutes: 35 };
    const accepted = {
      id: '99999999-9999-4999-8999-999999999999', version: 1, task_ids: [acceptedTask.id], tasks: [acceptedTask],
      meals: [
        { slot: 'breakfast' as const, option_id: day.meal_options[0].id, name: 'Oatmeal' },
        { slot: 'lunch' as const, option_id: day.meal_options[1].id, name: 'Soup' },
        { slot: 'dinner' as const, option_id: day.meal_options[2].id, name: 'Pasta' },
      ], created_at: '2026-10-05T12:00:00Z', accepted_at: '2026-10-05T12:01:00Z',
    };
    mockRequests({ ...day, checkin: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', local_date: day.local_date, revision: 2, proposal: null, accepted },
      priority_context: { greeting: 'Hello, Pat.', period: 'afternoon', local_time: '12:30', local_date: day.local_date,
        suggestions: [{ kind: 'task', label: 'Fold laundry', reason: 'Planned for 12:45; ask about its current status.' }] } });
    render(<App />);
    expect(await screen.findByText('Review this item and update it when you are ready.')).toBeInTheDocument();
    expect(screen.queryByText(/ask about its current status/i)).not.toBeInTheDocument();
    expect(screen.getByText('12:45 · low urgency')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(screen.getByText('12:45 · 35 min')).toBeInTheDocument();
    expect(screen.getByText('low urgency')).toBeInTheDocument();
  });

  it('keeps one local conversation mounted while tabs and voice navigation change', async () => {
    mockRequests({ ...day, activity_ledger: activityLedger });
    let navigate: ((view: string) => void) | undefined;
    const stop = vi.fn(async () => undefined);
    vi.mocked(startLocalVoice).mockImplementation(async options => {
      navigate = options.onNavigate;
      options.onState('listening', 'Nancy is listening.');
      options.onTranscript('you', 'First question');
      options.onTranscript('nancy', 'First answer');
      options.onTranscript('you', 'Second question');
      options.onTranscript('nancy', 'Second answer');
      options.onTranscript('you', 'Last question');
      return { stop, sendText: vi.fn(async () => undefined), interrupt: vi.fn() };
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Talk to Nancy' }));
    expect(await screen.findByRole('button', { name: 'Stop voice' })).toBeInTheDocument();
    expect(screen.getByText('Earlier conversation (2)')).toBeInTheDocument();
    expect(screen.getByText('Last question')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Meals' }));
    navigate?.('activity');
    expect(await screen.findByRole('heading', { name: 'Recorded today' })).toBeInTheDocument();
    navigate?.('groceries');
    expect(await screen.findByRole('heading', { name: 'Groceries' })).toBeInTheDocument();
    expect(startLocalVoice).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Stop voice' })).toBeInTheDocument();
  });

  it('shows greeting startup honestly and lets the participant interrupt before it finishes', async () => {
    mockRequests();
    type Handle = Awaited<ReturnType<typeof startLocalVoice>>;
    let options: (Parameters<typeof startLocalVoice>[0] & { onReady?: (handle: Handle) => void }) | undefined;
    let finishGreeting!: (handle: Handle) => void;
    const interrupt = vi.fn();
    const handle = { stop: vi.fn(async () => undefined), sendText: vi.fn(async () => undefined), interrupt };
    vi.mocked(startLocalVoice).mockImplementation(request => {
      options = request;
      return new Promise(resolve => { finishGreeting = resolve; });
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Talk to Nancy' }));
    expect(await screen.findByRole('heading', { name: 'Starting Nancy' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Nancy is listening' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Interrupt Nancy' })).not.toBeInTheDocument();
    act(() => { options!.onReady?.(handle); options!.onState('speaking', 'Nancy is greeting you.'); });
    expect(await screen.findByRole('button', { name: 'Interrupt Nancy' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Interrupt Nancy' }));
    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Stop voice' })).toBeInTheDocument();
    act(() => { options!.onState('listening', 'Nancy is listening.'); finishGreeting(handle); });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Interrupt Nancy' })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(screen.getByRole('button', { name: 'Stop voice' })).toBeInTheDocument();
    expect(handle.stop).not.toHaveBeenCalled();
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
    fireEvent.click(await screen.findByText('Add an appointment'));
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
    expect(await screen.findByRole('heading', { name: 'Hello, Pat.' })).toBeInTheDocument();
    expect(screen.queryByText(/sample data/i)).not.toBeInTheDocument();
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

  it('shows a factual activity ledger before a plan is accepted', async () => {
    const fetchMock = vi.fn(async (path: string) => {
      if (path === '/api/config') return response({ configured: true, voice_available: false, assistant_name: 'Nancy', missing: [] });
      if (path === '/api/auth/session') return response({ authenticated: true });
      if (path === '/api/today') return response(day);
      if (path === '/api/activity?date=2026-10-05') return response(activityLedger);
      throw new Error(`Unexpected request ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock); render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Activity' }));
    expect(await screen.findByText('Plans are choices for the day. This list changes only when you report what happened.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark Fold laundry done' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark Oatmeal eaten' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark Clinic visit attended' })).toBeInTheDocument();
    expect(screen.getByText('Morning walk')).toBeInTheDocument();
    expect(screen.getByText(/Task done · Oct 5, 8:45 a.m./)).toBeInTheDocument();
    expect(screen.queryByText(/Rob/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Talk to Nancy' })).toBeInTheDocument();
  });

  it('records an actual meal time and portion against the exact planned activity', async () => {
    let posted: any;
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/config') return response({ configured: true, voice_available: false, assistant_name: 'Nancy', missing: [] });
      if (path === '/api/auth/session') return response({ authenticated: true });
      if (path === '/api/today') return response(day);
      if (path === '/api/activity?date=2026-10-05') return response(activityLedger);
      if (path === '/api/activity/commands' && init?.method === 'POST') {
        posted = JSON.parse(String(init.body));
        return response({ command_id: 'a1', result: 'reported', entry: activityLedger.options[1], replayed: false });
      }
      throw new Error(`Unexpected request ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock); render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Activity' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Mark Oatmeal eaten' }));
    fireEvent.change(screen.getByLabelText('Actual date and time'), { target: { value: '2026-10-05T09:15' } });
    fireEvent.change(screen.getByLabelText(/Portion or amount/), { target: { value: 'one bowl' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save actual activity' }));
    await waitFor(() => expect(posted).toBeDefined());
    expect(posted).toEqual({
      type: 'record_activity', idempotency_key: '66666666-6666-4666-8666-666666666666', local_date: '2026-10-05', expected_revision: 1,
      payload: { activity_id: activityLedger.options[1].id, status: 'completed', occurred_at: '2026-10-05T09:15:00-04:00', notes: '', portion: 'one bowl' },
    });
  });

  it('sends explicit deferral, reschedule and correction commands', async () => {
    const posted: any[] = [];
    const ledger = { ...activityLedger, options: [activityLedger.options[0]], entries: activityLedger.entries };
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/config') return response({ configured: true, voice_available: false, assistant_name: 'Nancy', missing: [] });
      if (path === '/api/auth/session') return response({ authenticated: true });
      if (path === '/api/today') return response(day);
      if (path === '/api/activity?date=2026-10-05') return response(ledger);
      if (path === '/api/activity/commands' && init?.method === 'POST') { posted.push(JSON.parse(String(init.body))); return response({ command_id: `a${posted.length}`, result: 'reported', entry: activityLedger.entries[0], replayed: false }); }
      throw new Error(`Unexpected request ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock); render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Activity' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Defer Fold laundry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save actual activity' }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ type: 'record_activity', expected_revision: 2, payload: { activity_id: activityLedger.options[0].id, status: 'deferred', occurred_at: null } });

    fireEvent.click(screen.getByRole('button', { name: 'Reschedule Fold laundry' }));
    fireEvent.change(screen.getByLabelText('New date and time'), { target: { value: '2026-10-06T11:00' } });
    fireEvent.change(screen.getByLabelText('Why are you changing this?'), { target: { value: 'More time tomorrow' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save new time' }));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]).toMatchObject({ type: 'reschedule_activity', expected_revision: 2, payload: { activity_id: activityLedger.options[0].id, scheduled_at: '2026-10-06T11:00:00-04:00', reason: 'More time tomorrow' } });

    fireEvent.click(screen.getByRole('button', { name: 'Correct Morning walk' }));
    fireEvent.change(screen.getByLabelText('Correct result'), { target: { value: 'voided' } });
    fireEvent.change(screen.getByLabelText('Why are you changing this?'), { target: { value: 'Added by mistake' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    await waitFor(() => expect(posted).toHaveLength(3));
    expect(posted[2]).toMatchObject({ type: 'correct_activity', expected_revision: 3, payload: { activity_id: activityLedger.entries[0].id, status: 'voided', occurred_at: null, reason: 'Added by mistake' } });
  });

  it('checks an uncertain activity receipt before retrying the same save', async () => {
    const posted: any[] = [];
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/config') return response({ configured: true, voice_available: false, assistant_name: 'Nancy', missing: [] });
      if (path === '/api/auth/session') return response({ authenticated: true });
      if (path === '/api/today') return response(day);
      if (path === '/api/activity?date=2026-10-05') return response(activityLedger);
      if (path === '/api/activity/commands' && init?.method === 'POST') {
        posted.push(JSON.parse(String(init.body)));
        return posted.length === 1 ? response({}, 503) : response({ command_id: 'a2', result: 'reported', entry: activityLedger.entries[0], replayed: false });
      }
      if (path === '/api/activity/receipts/66666666-6666-4666-8666-666666666666') return response({}, 404);
      throw new Error(`Unexpected request ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock); render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Activity' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Mark Fold laundry done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save actual activity' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Check saved activity' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry same save' }));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[0].idempotency_key).toBe('66666666-6666-4666-8666-666666666666');
    expect(posted[1]).toEqual(posted[0]);
  });

  it('uses effective activity state across My Day, Tasks, Meals and upcoming appointments', async () => {
    const plan = {
      id: '99999999-9999-4999-8999-999999999999', task_ids: [day.tasks[0].id], tasks: day.tasks,
      meals: [
        { slot: 'breakfast' as const, option_id: day.meal_options[0].id, name: 'Oatmeal' },
        { slot: 'lunch' as const, option_id: day.meal_options[1].id, name: 'Soup' },
        { slot: 'dinner' as const, option_id: day.meal_options[2].id, name: 'Pasta' },
      ], created_at: '2026-10-05T12:00:00Z',
    };
    const taskDone: ActivityEntry = { ...activityLedger.options[0], status: 'completed', occurred_at: '2026-10-05T14:00:00Z', recorded_at: '2026-10-05T14:01:00Z', updated_at: '2026-10-05T14:01:00Z', notes: '', portion: null, last_action: 'reported' };
    const mealEaten: ActivityEntry = { ...activityLedger.options[1], status: 'completed', occurred_at: '2026-10-05T13:15:00Z', recorded_at: '2026-10-05T13:16:00Z', updated_at: '2026-10-05T13:16:00Z', notes: '', portion: 'one bowl', last_action: 'reported' };
    const appointmentMoved: ActivityEntry = { ...activityLedger.options[2], source_id: 'a1', status: 'pending', scheduled_at: '2026-10-06T15:00:00Z', occurred_at: null, recorded_at: '2026-10-05T13:00:00Z', updated_at: '2026-10-05T13:00:00Z', notes: '', portion: null, last_action: 'rescheduled' };
    const ledger: ActivityLedger = { ...activityLedger, options: [taskDone, mealEaten, appointmentMoved], entries: [taskDone, mealEaten, appointmentMoved], summary: { tasks_completed: 1, meals_eaten: 1, appointments_attended: 0, deferred: 0 } };
    const current: Today = { ...day, checkin: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', local_date: day.local_date, revision: 2, proposal: plan, accepted: null }, activity_ledger: ledger,
      appointments: [
        { id: 'old', title: 'Old appointment', starts_at: '2026-09-20T14:00:00Z' },
        { id: 'a1', title: 'Clinic visit', starts_at: '2026-10-05T18:00:00Z' },
        { id: 'far', title: 'Later appointment', starts_at: '2026-10-30T14:00:00Z' },
      ] };
    mockRequests(current); render(<App />);
    const glance = (await screen.findByRole('heading', { name: 'Tasks to consider' })).closest('div')!;
    expect(within(glance).queryByText('Fold laundry')).not.toBeInTheDocument();
    expect(within(glance).getByText('No tasks are waiting for you.')).toBeInTheDocument();
    const appointments = screen.getByRole('heading', { name: 'Appointments' }).closest('div')!;
    expect(within(appointments).getByText(/Clinic visit/)).toHaveTextContent(/Oct 6/);
    expect(within(appointments).queryByText(/Old appointment/)).not.toBeInTheDocument();
    expect(within(appointments).queryByText(/Later appointment/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(screen.getByText(/Task done · Oct 5, 10:00 a.m./)).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Meals' }));
    expect(screen.getByText(/Oatmeal · Meal eaten · Oct 5, 9:15 a.m. · one bowl/)).toBeInTheDocument();
  });

  it('reopens a voided planned item and reads a prior activity date', async () => {
    const voided: ActivityEntry = { ...activityLedger.options[0], status: 'voided', occurred_at: null, recorded_at: '2026-10-05T14:01:00Z', updated_at: '2026-10-05T14:02:00Z', notes: '', portion: null, last_action: 'corrected' };
    const currentLedger: ActivityLedger = { ...activityLedger, options: [voided], entries: [voided], summary: { tasks_completed: 0, meals_eaten: 0, appointments_attended: 0, deferred: 0 } };
    const historyEntry: ActivityEntry = { ...activityLedger.entries[0], local_date: '2026-10-04', occurred_at: '2026-10-04T13:00:00Z', title: 'Sunday walk' };
    const historyLedger: ActivityLedger = { local_date: '2026-10-04', options: [historyEntry], entries: [historyEntry], recent_entries: [historyEntry], summary: { tasks_completed: 1, meals_eaten: 0, appointments_attended: 0, deferred: 0 } };
    const fetchMock = vi.fn(async (path: string) => {
      if (path === '/api/config') return response({ configured: true, voice_available: false, assistant_name: 'Nancy', missing: [] });
      if (path === '/api/auth/session') return response({ authenticated: true });
      if (path === '/api/today') return response({ ...day, activity_ledger: currentLedger });
      if (path === '/api/activity?date=2026-10-04') return response(historyLedger);
      throw new Error(`Unexpected request ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock); render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Activity' }));
    expect(screen.getAllByText('Mistaken report removed · ready to report again')).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Mark Fold laundry done' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Activity date'), { target: { value: '2026-10-04' } });
    expect(await screen.findByRole('heading', { name: /Recorded on/ })).toBeInTheDocument();
    expect(screen.getByText('Sunday walk')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/activity?date=2026-10-04', expect.anything());
  });
});
