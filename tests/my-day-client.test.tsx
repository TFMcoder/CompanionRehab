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
function mockRequests(data: Today = day, caregiver = false) {
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/config') return response({ configured: true, voice_available: true, voice_transport: 'local', assistant_name: 'Nancy', missing: [] });
    if (path === '/api/auth/session') return response({ authenticated: true, role: 'client', participant_id: '11111111-1111-4111-8111-111111111111', scope_key: 'client-test-scope', voice_eligible: true, voice_connection: caregiver ? 'caregiver_authorized' : 'owner_practice', task_requests_available: true });
    if (path === '/api/today') return response(data);
    if (path === '/api/groceries' && !init?.method) return response({ items: [{ id: 'g1', name: 'Apples', quantity: '2' }] });
    if (path === '/api/groceries' && init?.method === 'POST') return response({ id: 'g2', name: 'Milk' });
    throw new Error(`Unexpected request ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('My Day client workflow', () => {
  beforeEach(() => { vi.mocked(startLocalVoice).mockReset().mockImplementation(async options=>{const handle={stop:vi.fn(async()=>{}),interrupt:vi.fn(),sendText:vi.fn(async()=>{})};options.onReady?.(handle);options.onState('listening');return handle;});vi.stubGlobal('crypto', { randomUUID: () => '66666666-6666-4666-8666-666666666666' }); });
  afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

  it('shows tasks and meals independently before the check-in and keeps Talk in every view', async () => {
    mockRequests(); render(<App />);
    expect(await screen.findByRole('heading', { name: 'Your day' })).toBeInTheDocument();
    expect(screen.getByText('10:30 a.m.')).toBeInTheDocument();
    expect(screen.getByText('high urgency · 20 min')).toBeInTheDocument();
    expect(screen.getAllByText(/No meal chosen/)).toHaveLength(3);
    expect(screen.getByText('Fold laundry')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    const taskView = screen.getByRole('heading', { name: 'Tasks' }).closest('section')!;
    expect(taskView).toBeInTheDocument();
    expect(within(taskView).getByText('Fold laundry')).toBeInTheDocument();
    expect(screen.getByText('high urgency')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Talk to Nancy' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Meals' }));
    expect(screen.getByRole('heading', { name: 'Meals' })).toBeInTheDocument();
    expect(screen.getAllByText('No meal chosen')).toHaveLength(3);
    expect(screen.queryByText('Oatmeal')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Talk to Nancy' })).toBeInTheDocument();
  });

  it('shows accepted task timing and only saved meal choices', async () => {
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
    expect(await screen.findByText('12:45 p.m.')).toBeInTheDocument();
    expect(screen.queryByText(/ask about its current status/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(screen.getByText('Today at 12:45 · 35 min')).toBeInTheDocument();
    expect(screen.getByText('low urgency')).toBeInTheDocument();
    expect(screen.getByText('Breakfast · Oatmeal')).toBeInTheDocument();
  });

  it('keeps an accepted plan visible while a different revision waits for review', async () => {
    const accepted = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', version: 1, task_ids: [day.tasks[0].id], tasks: day.tasks,
      meals: [
        { slot: 'breakfast' as const, option_id: day.meal_options[0].id, name: 'Oatmeal' },
        { slot: 'lunch' as const, option_id: day.meal_options[1].id, name: 'Soup' },
        { slot: 'dinner' as const, option_id: day.meal_options[2].id, name: 'Pasta' },
      ], created_at: '2026-10-05T12:00:00Z', accepted_at: '2026-10-05T12:01:00Z',
    };
    const revised = { ...accepted, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', tasks: [{ ...day.tasks[0], scheduled_time: '15:00' }], meals: [{ slot: 'breakfast' as const, option_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Toast' }, ...accepted.meals.slice(1)] };
    mockRequests({ ...day, meal_options: [...day.meal_options, { id: revised.meals[0].option_id, name: 'Toast', slots: ['breakfast'] }], checkin: { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', local_date: day.local_date, revision: 3, accepted, proposal: revised } });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Meals' }));
    expect(screen.getByText('Oatmeal')).toBeInTheDocument();
    expect(screen.queryByText('Toast')).not.toBeInTheDocument();
    expect(screen.getByText('A new plan is ready for review. Your accepted plan is still shown here.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review new plan' }));
    await waitFor(()=>expect(startLocalVoice).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button',{name:'Accept this plan'})).not.toBeInTheDocument();
    expect(screen.getByText('Oatmeal')).toBeInTheDocument();
  });

  it('keeps an unplanned eaten meal separate from a different planned meal in the same slot', async () => {
    const accepted = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', version: 1, task_ids: [], tasks: [],
      meals: [
        { slot: 'breakfast' as const, option_id: day.meal_options[0].id, name: 'Oatmeal' },
        { slot: 'lunch' as const, option_id: day.meal_options[1].id, name: 'Soup' },
        { slot: 'dinner' as const, option_id: day.meal_options[2].id, name: 'Pasta' },
      ], created_at: '2026-10-05T12:00:00Z', accepted_at: '2026-10-05T12:01:00Z',
    };
    const toast: ActivityEntry = { ...activityLedger.options[1], id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', title: 'Toast', source_id: null, unplanned: true, status: 'completed', occurred_at: '2026-10-05T13:15:00Z', recorded_at: '2026-10-05T13:16:00Z', updated_at: '2026-10-05T13:16:00Z', notes: '', portion: null, last_action: 'reported' };
    mockRequests({ ...day, checkin: { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', local_date: day.local_date, revision: 2, accepted, proposal: null }, activity_ledger: { ...activityLedger, options: [toast], entries: [toast], recent_entries: [] } });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Meals' }));
    const breakfast = screen.getByRole('heading', { name: 'Breakfast' }).closest('section')!;
    expect(within(breakfast).getByText('Oatmeal')).toBeInTheDocument();
    expect(within(breakfast).getByText('In accepted plan · No time set')).toBeInTheDocument();
    expect(screen.getByText('Toast')).toBeInTheDocument();
    expect(screen.getByText('Meal eaten · Oct 5, 9:15 a.m.')).toBeInTheDocument();
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
    expect(screen.getByText('Earlier conversation')).toBeInTheDocument();
    expect(screen.getByText('Last question')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Meals' }));
    await act(async()=>navigate?.('activity'));
    expect(screen.getByRole('heading', { name: 'Your day' })).toBeInTheDocument();
    await act(async()=>navigate?.('groceries'));
    expect(await screen.findByRole('heading', { name: 'Groceries' })).toBeInTheDocument();
    expect(startLocalVoice).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Stop voice' })).toBeInTheDocument();
  });

  it('keeps a specific local voice startup error after its promise rejects, with a generic fallback otherwise', async () => {
    mockRequests();
    const timeoutMessage = 'Microphone or audio startup timed out after 20 seconds. Try again.';
    vi.mocked(startLocalVoice).mockImplementationOnce(async options => {
      options.onState('error', timeoutMessage);
      throw new Error('internal startup details');
    }).mockRejectedValueOnce(new Error('other internal details'));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Talk to Nancy' }));
    expect(await screen.findByText(timeoutMessage)).toBeInTheDocument();
    expect(screen.queryByText(/internal startup details/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Talk to Nancy' }));
    expect(await screen.findByText('Nancy could not start. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(/other internal details/)).not.toBeInTheDocument();
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
});
