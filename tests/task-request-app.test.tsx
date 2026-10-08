// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/client/local-voice', () => ({ startLocalVoice: vi.fn() }));
import { App } from '../src/client/App';
import { startLocalVoice, type LocalVoiceOptions } from '../src/client/local-voice';
import type { SessionInfo } from '../src/client/api';
import type { Today } from '../src/shared/contracts';
import type { TaskRequestCommand, TaskRequestDraft, TaskRequestWorkspace } from '../src/shared/task-request-contracts';

const participant = { id: '11111111-1111-4111-8111-111111111111', display_name: 'Pat', time_zone: 'America/Toronto' };
const session: SessionInfo = { authenticated: true, role: 'family_friend', participant_id: participant.id, scope_key: 'family-1', voice_eligible: false, voice_unavailable_reason: 'Nancy voice is not connected for this account yet.', task_requests_available: true };
const workspace: TaskRequestWorkspace = { actor_id: '22222222-2222-4222-8222-222222222222', role: 'family_friend', participant, local_date: '2026-10-08', capabilities: ['request_tasks', 'read_requests'], requests: [], help_requests: [], administrator_flags: [], capacity: null, sharing: [] };
const day: Today = { profile: { ...participant, preferences: '', revision: 1 }, local_date: '2026-10-08', tasks: [], meal_options: [], checkin: null, groceries: [], appointments: [] };
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
function backend(info: SessionInfo = session, board: TaskRequestWorkspace = workspace, extra?: (path: string, init?: RequestInit) => Response | undefined) {
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    const custom = extra?.(path, init); if (custom) return custom;
    if (path === '/api/config') return response({ configured: true, assistant_name: 'Nancy', missing: [], voice_available: true, voice_transport: 'local' });
    if (path === '/api/auth/session') return response(info);
    if (path === '/api/today') return response(day);
    if (path === '/api/task-requests') return response(board);
    if (path === '/api/task-requests/review') { const draft = JSON.parse(String(init?.body)) as TaskRequestDraft; return response({ draft, review_token: 'a'.repeat(64), profile_revision: 1, day_revision: 0, capacity_revision: 0, warnings: [], blockers: [], can_accept: false, capacity_known: false, schedule_review_required: false, capacity: null }); }
    if (path === '/api/task-requests/commands') { const command = JSON.parse(String(init?.body)) as TaskRequestCommand; return response({ command_id: command.idempotency_key, type: command.type, request_id: 'request-1', help_id: null, flag_id: null, task_id: null, activity_id: null, revision: 1, result: 'saved', replayed: false }); }
    if (path === '/api/auth/logout') return response({ ok: true });
    throw new Error(`Unexpected request ${path}`);
  });
  vi.stubGlobal('fetch', fetch); return fetch;
}
function voiceMock() {
  let options!: LocalVoiceOptions;
  const handle = { stop: vi.fn(async () => undefined), sendText: vi.fn(async () => undefined), interrupt: vi.fn() };
  vi.mocked(startLocalVoice).mockImplementation(async supplied => { options = supplied; supplied.onReady?.(handle); supplied.onState('listening'); return handle; });
  return { handle, options: () => options };
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('role-bound request app integration', () => {
  it.each(['family_friend', 'administrator'] as const)('routes %s to requests without fetching private client day data', async role => {
    const fetch = backend({ ...session, role }, { ...workspace, role }); render(<App />);
    await screen.findByRole('button', { name: 'Request a task' });
    expect(screen.getByRole('heading', { level: 1, name: role === 'family_friend' ? 'Support Team' : 'Requests and help' })).toBeInTheDocument();
    expect(fetch.mock.calls.some(([path]) => path === '/api/today')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Edit choices' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Talk to Nancy' })).toBeDisabled();
    expect(startLocalVoice).not.toHaveBeenCalled();
  });

  it('posts a reviewed pending request through the real UI adapter without inference', async () => {
    const fetch = backend(); render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Request a task' }));
    fireEvent.change(screen.getByLabelText('Task name'), { target: { value: 'Collect apples' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-08' } });
    fireEvent.change(screen.getByLabelText('Time (America/Toronto)'), { target: { value: '15:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review timing' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send request' }));
    await screen.findByText('Request sent. It is waiting for the client’s decision.');
    const write = fetch.mock.calls.find(([path]) => path === '/api/task-requests/commands')!;
    expect(JSON.parse(String(write[1]?.body))).toMatchObject({ type: 'submit_request', draft: { task_name: 'Collect apples', requested_time: '15:00' }, confirmed: true });
    expect(fetch.mock.calls.some(([path]) => path.startsWith('/api/conversation'))).toBe(false);
    expect(startLocalVoice).not.toHaveBeenCalled();
  });

  it('keeps clinician routing separate from both client and family data', async () => {
    const fetch = backend({ ...session, role: 'clinician' }); render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Clinician Partners' });
    expect(screen.getByText('Clinical dashboards and exports are not available yet.')).toBeInTheDocument();
    expect(fetch.mock.calls.some(([path]) => path === '/api/today' || path === '/api/task-requests')).toBe(false);
  });

  it('fails closed when the server cannot identify an active role or scope', async () => {
    const fetch = backend({ authenticated: true } as SessionInfo); render(<App />);
    await screen.findByText('Your account view could not be confirmed. Please sign in again.');
    expect(fetch.mock.calls.some(([path]) => path === '/api/today' || path === '/api/task-requests')).toBe(false);
  });

  it('uses one ongoing client conversation across Requests and My Day, preserving request review state', async () => {
    const mocked = voiceMock(); const fetch = backend({ ...session, role: 'client', scope_key: 'client-1', voice_eligible: true }, { ...workspace, role: 'client' }); render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Talk to Nancy' }));
    await screen.findByRole('button', { name: 'Stop voice' });
    fireEvent.click(screen.getByRole('button', { name: 'Requests' })); await screen.findByText('No requests here.');
    expect(screen.queryByRole('button', { name: 'Talk to Nancy' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'My Day' }));
    fireEvent.click(screen.getByRole('button', { name: 'Requests' })); await screen.findByText('No requests here.');
    expect(fetch.mock.calls.filter(([path]) => path === '/api/task-requests')).toHaveLength(1);
    expect(startLocalVoice).toHaveBeenCalledTimes(1); expect(mocked.handle.stop).not.toHaveBeenCalled();
    await act(async () => mocked.options().onNavigate('requests'));
    expect(screen.getByRole('button', { name: 'Requests' })).toHaveAttribute('aria-current', 'page');
  });

  it('uses local voice and typed turns only on an eligible support route and closes them on sign-out', async () => {
    const mocked = voiceMock(), fetch = backend({ ...session, voice_eligible: true }); render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Talk to Nancy' }));
    await screen.findByRole('button', { name: 'Stop voice' });
    fireEvent.change(screen.getByLabelText('Type to Nancy'), { target: { value: 'Can you help me request a task?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(mocked.handle.sendText).toHaveBeenCalledWith('Can you help me request a task?');
    await act(async () => mocked.options().onState('speaking'));
    fireEvent.click(screen.getByRole('button', { name: 'Interrupt Nancy' })); expect(mocked.handle.interrupt).toHaveBeenCalledOnce();
    await act(async () => mocked.options().onNavigate('tasks'));
    expect(fetch.mock.calls.some(([path]) => path === '/api/today')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: 'Welcome back' }); expect(mocked.handle.stop).toHaveBeenCalled();
  });

  it('allows an eligible owner to check readiness while workers warm without granting eligibility to other accounts', async () => {
    const mocked = voiceMock(); let configs = 0;
    backend({ ...session, voice_eligible: true }, workspace, path => path === '/api/config' ? response({ configured: true, assistant_name: 'Nancy', missing: [], voice_available: ++configs > 1, voice_transport: 'local' }) : undefined);
    render(<App />); fireEvent.click(await screen.findByRole('button', { name: 'Talk to Nancy' }));
    await screen.findByRole('button', { name: 'Stop voice' }); expect(mocked.handle.stop).not.toHaveBeenCalled();
    expect(configs).toBe(2);
  });

  it('clears the support conversation and requests when its login expires', async () => {
    const mocked = voiceMock(); backend({ ...session, voice_eligible: true }); render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Talk to Nancy' })); await screen.findByRole('button', { name: 'Stop voice' });
    await act(async () => { mocked.options().onTranscript('you', 'A private draft'); });
    expect(screen.getByText('A private draft')).toBeInTheDocument();
    act(() => window.dispatchEvent(new Event('nancy:session-expired')));
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(screen.queryByText('A private draft')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request a task' })).not.toBeInTheDocument();
    await waitFor(() => expect(mocked.handle.stop).toHaveBeenCalled());
  });

  it('reauthorizes and clears conversation history when server scope changes', async () => {
    const mocked = voiceMock(); let role: SessionInfo['role'] = 'family_friend';
    const fetch = backend({ ...session, voice_eligible: true }, workspace, path => path === '/api/auth/session' ? response({ ...session, role, scope_key: role, voice_eligible: role === 'family_friend' }) : undefined);
    render(<App />); fireEvent.click(await screen.findByRole('button', { name: 'Talk to Nancy' })); await screen.findByRole('button', { name: 'Stop voice' });
    await act(async () => mocked.options().onTranscript('nancy', 'Earlier scoped conversation'));
    role = 'clinician'; act(() => window.dispatchEvent(new Event('nancy:scope-changed')));
    await screen.findByRole('heading', { level: 1, name: 'Clinician Partners' });
    expect(screen.queryByText('Earlier scoped conversation')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request a task' })).not.toBeInTheDocument();
    expect(fetch.mock.calls.some(([path]) => path === '/api/today')).toBe(false);
    expect(mocked.handle.stop).toHaveBeenCalled();
  });
});
