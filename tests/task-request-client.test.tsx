// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskRequests, type TaskRequestService } from '../src/client/TaskRequests';
import { ApiError } from '../src/client/api';
import type { TaskRequestCommand, TaskRequestDraft, TaskRequestItem, TaskRequestReceipt, TaskRequestReview, TaskRequestWorkspace } from '../src/shared/task-request-contracts';

const draft: TaskRequestDraft = { task_name: 'Pick up groceries', priority: 'medium', requested_date: '2026-10-08', requested_time: '14:00', participant_time_zone: 'America/Toronto', estimated_duration_minutes: 30, travel_minutes: 15, notes: 'Ask for help carrying bags.' };
const request: TaskRequestItem = { id: '33333333-3333-4333-8333-333333333333', revision: 3, requester_id: '22222222-2222-4222-8222-222222222222', requester_role: 'family_friend', requester_label: 'Alex', draft, status: 'pending', requested_at: '2026-10-07T12:00:00Z', accepted_draft: null, accepted_at: null, task_id: null, activity_id: null, reason: null, created_at: '2026-10-07T12:00:00Z', updated_at: '2026-10-07T12:00:00Z', can_accept: false, can_reject: false, can_withdraw: true };
const workspace: TaskRequestWorkspace = { actor_id: request.requester_id, role: 'family_friend', participant: { id: '11111111-1111-4111-8111-111111111111', display_name: 'Pat', time_zone: 'America/Toronto' }, local_date: '2026-10-07', capabilities: ['request_tasks', 'read_requests'], requests: [request], help_requests: [], administrator_flags: [], capacity: null, sharing: [] };
const review = (value = draft): TaskRequestReview => ({ draft: value, review_token: 'a'.repeat(64), profile_revision: 2, day_revision: 4, capacity_revision: 1, warnings: [], blockers: [], can_accept: true, capacity_known: true, schedule_review_required: true, capacity: { local_date: value.requested_date, revision: 1, available_minutes: 180, rest_minutes: 20 } });
const receipt = (type: TaskRequestCommand['type'] = 'submit_request'): TaskRequestReceipt => ({ command_id: 'command-1', type, request_id: request.id, help_id: null, flag_id: null, task_id: null, activity_id: null, revision: 4, result: 'saved', replayed: false });
function service(view: TaskRequestWorkspace = workspace) {
  return {
    workspace: vi.fn<TaskRequestService['workspace']>().mockResolvedValue(structuredClone(view)),
    review: vi.fn<TaskRequestService['review']>().mockImplementation(async value => review(value)),
    command: vi.fn<TaskRequestService['command']>().mockImplementation(async command => receipt(command.type)),
    receipt: vi.fn<TaskRequestService['receipt']>().mockResolvedValue(receipt()),
  };
}
const clientView = (): TaskRequestWorkspace => ({ ...structuredClone(workspace), role: 'client', capabilities: [], requests: [{ ...request, can_accept: true, can_reject: true, can_withdraw: false }] });
function mount(adapter: TaskRequestService, props: Partial<React.ComponentProps<typeof TaskRequests>> = {}) { return render(<TaskRequests service={adapter} scopeKey="scope-1" onTalk={vi.fn()} voiceAvailable={false} {...props} />); }
async function fillRequest() {
  fireEvent.click(await screen.findByRole('button', { name: 'Request a task' }));
  fireEvent.change(screen.getByLabelText('Task name'), { target: { value: draft.task_name } });
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: draft.requested_date } });
  fireEvent.change(screen.getByLabelText('Time (America/Toronto)'), { target: { value: draft.requested_time } });
  fireEvent.change(screen.getByLabelText('Minutes needed (optional)'), { target: { value: '30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review timing' }));
  await screen.findByRole('button', { name: 'Send request' });
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('bounded task request UI', () => {
  it('requires a schedule review and an explicit send, and does not claim acceptance', async () => {
    const adapter = service(); mount(adapter); await fillRequest();
    expect(adapter.command).not.toHaveBeenCalled();
    expect(adapter.review).toHaveBeenCalledWith(expect.objectContaining({ task_name: draft.task_name, participant_time_zone: 'America/Toronto', estimated_duration_minutes: 30 }));
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByText('Request sent. It is waiting for the client’s decision.');
    expect(adapter.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'submit_request', confirmed: true, review_token: 'a'.repeat(64) }));
    expect(screen.queryByRole('button', { name: 'Accept this task' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Talk to Nancy' })).toBeDisabled();
    expect(screen.getByText(/Nancy voice is not available for this account yet/)).toBeInTheDocument();
  });

  it('blocks a known scheduling conflict and invalidates review when details change', async () => {
    const adapter = service(); adapter.review.mockImplementation(async value => ({ ...review(value), blockers: ['This time conflicts with an existing plan.'], can_accept: false }));
    mount(adapter); await fillRequest();
    expect(screen.getByRole('button', { name: 'Send request' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'high' } });
    expect(screen.queryByRole('button', { name: 'Send request' })).not.toBeInTheDocument();
    expect(adapter.command).not.toHaveBeenCalled();
  });

  it('permits a pending request with unknown capacity without making a clinical claim', async () => {
    const adapter = service(); adapter.review.mockImplementation(async value => ({ ...review(value), can_accept: false, capacity_known: false, capacity: null, warnings: ['Ask the client how much they can take on.'] }));
    mount(adapter); await fillRequest();
    expect(screen.getByText(/Free time does not tell us/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send request' })).toBeEnabled();
    expect(screen.queryByLabelText('Extra minutes I can take on')).not.toBeInTheDocument();
  });

  it('lets only the client explicitly accept the reviewed revision and amended timing', async () => {
    const adapter = service(clientView()); mount(adapter);
    fireEvent.click(await screen.findByRole('button', { name: 'Review and accept' }));
    fireEvent.change(screen.getByLabelText('Time (America/Toronto)'), { target: { value: '15:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review timing' }));
    const accept = await screen.findByRole('button', { name: 'Accept this task' });
    expect(accept).toBeDisabled();
    fireEvent.click(screen.getByLabelText('I have checked my plans and this fits what I can take on.'));
    fireEvent.click(accept);
    await screen.findByText('Task accepted and added to your plan. You can report it when it is done.');
    expect(adapter.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'accept_request', request_id: request.id, expected_revision: 3, confirmed: true, schedule_review_confirmed: true, draft: expect.objectContaining({ requested_time: '15:00' }) }));
  });

  it('saves client-stated capacity with its revision, then requires a fresh review', async () => {
    const adapter = service(clientView()); adapter.review.mockImplementation(async value => ({ ...review(value), capacity_known: false, capacity: null, capacity_revision: 0, can_accept: false }));
    mount(adapter); fireEvent.click(await screen.findByRole('button', { name: 'Review and accept' })); fireEvent.click(screen.getByRole('button', { name: 'Review timing' }));
    expect(await screen.findByRole('button', { name: 'Accept this task' })).toBeDisabled();
    fireEvent.click(screen.getByText('Set how much I can take on that day'));
    fireEvent.change(screen.getByLabelText('Extra minutes I can take on'), { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText('Rest minutes to leave between activities'), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save my available time' }));
    await screen.findByText('Your available time is saved. Review the request again before accepting.');
    expect(adapter.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'set_day_capacity', expected_revision: 0, local_date: draft.requested_date, available_minutes: 90, rest_minutes: 15, confirmed: true }));
    expect(screen.queryByRole('button', { name: 'Accept this task' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review timing' })).toBeInTheDocument();
  });

  it('requires a short reason and a separate confirmation before rejection', async () => {
    const adapter = service(clientView()); mount(adapter);
    fireEvent.click(await screen.findByRole('button', { name: 'Cannot do this' }));
    expect(screen.getByRole('button', { name: 'Review my reason' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'I cannot take this on today.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review my reason' }));
    expect(adapter.command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and ask for help' }));
    await screen.findByText('Your decision is saved. Help has been requested.');
    expect(adapter.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'reject_request', expected_revision: 3, reason: 'I cannot take this on today.', confirmed: true }));
  });

  it('leaves a request undecided when a client pauses the rejection flow', async () => {
    const adapter = service(clientView()); mount(adapter);
    fireEvent.click(await screen.findByRole('button', { name: 'Cannot do this' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep undecided' }));
    expect(adapter.command).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Reason')).not.toBeInTheDocument();
    expect(screen.getByText('Waiting for a decision')).toBeInTheDocument();
  });

  it('reconciles a lost write response by receipt and never repeats the command', async () => {
    const adapter = service(); adapter.command.mockRejectedValue(new ApiError(0, 'connection_unconfirmed', 'Unconfirmed'));
    mount(adapter); await fillRequest(); fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    const check = await screen.findByRole('button', { name: 'Check saved result' });
    expect(screen.getByRole('button', { name: 'Send request' })).toBeDisabled();
    const command = adapter.command.mock.calls[0][0];
    fireEvent.click(check);
    await screen.findByText('Request sent. It is waiting for the client’s decision.');
    expect(adapter.receipt).toHaveBeenCalledWith(command.idempotency_key);
    expect(adapter.command).toHaveBeenCalledTimes(1);
  });

  it('keeps an unknown save locked when a receipt is not yet available', async () => {
    const adapter = service(); adapter.command.mockRejectedValue(new Error('Network')); adapter.receipt.mockRejectedValue(new ApiError(404, 'not_found', 'No receipt'));
    mount(adapter); await fillRequest(); fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Check saved result' }));
    await screen.findByText(/There is no saved result yet/);
    expect(screen.getByRole('button', { name: 'Send request' })).toBeDisabled();
    expect(adapter.command).toHaveBeenCalledTimes(1);
  });

  it('offers an exact-key retry only after checking that no receipt is available', async () => {
    const adapter = service(); adapter.command.mockRejectedValueOnce(new Error('Network')).mockResolvedValue(receipt()); adapter.receipt.mockRejectedValue(new ApiError(404, 'not_found', 'No receipt'));
    mount(adapter); await fillRequest(); fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    const check = await screen.findByRole('button', { name: 'Check saved result' });
    expect(screen.queryByRole('button', { name: 'Try the same save again' })).not.toBeInTheDocument();
    fireEvent.click(check);
    fireEvent.click(await screen.findByRole('button', { name: 'Try the same save again' }));
    await screen.findByText('Request sent. It is waiting for the client’s decision.');
    expect(adapter.command).toHaveBeenCalledTimes(2);
    expect(adapter.command.mock.calls[1][0]).toEqual(adapter.command.mock.calls[0][0]);
  });

  it('keeps a confirmed save confirmed if refreshing the list fails', async () => {
    const adapter = service(); adapter.workspace.mockResolvedValueOnce(workspace).mockRejectedValue(new ApiError(503, 'connection_unavailable', 'List unavailable'));
    mount(adapter); await fillRequest(); fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByText('Request sent. It is waiting for the client’s decision.');
    expect(await screen.findByText('List unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check saved result' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request a task' })).toBeDisabled();
  });

  it('has no administrator approval bypass and uses the server flags for acknowledgements', async () => {
    const adapter = service({ ...workspace, role: 'administrator', requests: [{ ...request, can_accept: true, can_reject: true, can_withdraw: false }], administrator_flags: [{ id: 'flag-1', request_id: request.id, help_id: 'help-1', revision: 2, task_name: 'Collect supplies', draft, reason: 'I need help today.', status: 'open', can_acknowledge: true }] });
    mount(adapter); fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge review' }));
    await screen.findByText('Review acknowledged. The help request remains open until it is resolved.');
    expect(screen.queryByRole('button', { name: 'Review and accept' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cannot do this' })).not.toBeInTheDocument();
    expect(adapter.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'acknowledge_flag', flag_id: 'flag-1', expected_revision: 2 }));
  });

  it('shows help as voluntary and resolves only with an explicit outcome', async () => {
    const help = { id: 'help-1', request_id: request.id, revision: 1, task_name: 'Collect supplies', draft, reason: 'I cannot go today.', status: 'unassigned' as const, volunteer_id: null, resolution: null, eligible_helper_count: 1, can_volunteer: true, can_resolve: false };
    const adapter = service({ ...workspace, help_requests: [help] }); mount(adapter);
    fireEvent.click(await screen.findByRole('button', { name: 'I can help' }));
    await screen.findByText('Your offer to help is saved.');
    expect(adapter.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'volunteer_help', expected_revision: 1, confirmed: true }));
    expect(screen.queryByRole('button', { name: 'Resolve help' })).not.toBeInTheDocument();
  });

  it('records a helper’s resolution without treating it as the client completing the task', async () => {
    const help = { id: 'help-1', request_id: request.id, revision: 2, task_name: 'Collect supplies', draft, reason: 'I cannot go today.', status: 'volunteered' as const, volunteer_id: workspace.actor_id, resolution: null, eligible_helper_count: 1, can_volunteer: false, can_resolve: true };
    const adapter = service({ ...workspace, help_requests: [help] }); mount(adapter);
    fireEvent.click(await screen.findByRole('button', { name: 'Resolve help' }));
    expect(screen.getByRole('button', { name: 'Confirm resolution' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('What was arranged?'), { target: { value: 'I will collect the supplies tomorrow.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm resolution' }));
    await screen.findByText('Help marked as resolved.');
    expect(adapter.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'resolve_help', help_id: 'help-1', expected_revision: 2, resolution: 'I will collect the supplies tomorrow.' }));
    expect(adapter.command.mock.calls.every(([command]) => command.type === 'resolve_help')).toBe(true);
  });

  it('requires refreshing a stale request before offering another decision', async () => {
    const adapter = service(clientView()); adapter.command.mockRejectedValue(new ApiError(409, 'stale_revision', 'This request changed.'));
    mount(adapter); fireEvent.click(await screen.findByRole('button', { name: 'Cannot do this' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Not today.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review my reason' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm and ask for help' }));
    await screen.findByText('This request changed.');
    expect(screen.getByRole('button', { name: 'Confirm and ask for help' })).toBeDisabled();
    adapter.workspace.mockResolvedValue({ ...clientView(), requests: [{ ...request, status: 'withdrawn', revision: 4, can_accept: false, can_reject: false, can_withdraw: false }] });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh requests' })); await screen.findByText('Withdrawn');
    expect(screen.queryByRole('button', { name: 'Confirm and ask for help' })).not.toBeInTheDocument();
    expect(adapter.command).toHaveBeenCalledTimes(1);
  });

  it('saves client-selected sharing and does not offer family administrative flags', async () => {
    const adapter = service({ ...clientView(), sharing: [{ actor_id: request.requester_id, role: 'family_friend', label: 'Alex', revision: 3, capabilities: ['request_tasks', 'read_requests'] }] });
    mount(adapter); fireEvent.click(await screen.findByText('Who can request tasks and help'));
    fireEvent.click(screen.getByLabelText('Receive help requests and reasons'));
    expect(screen.queryByLabelText('Review administrator flags and reasons')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save access for Alex' }));
    await screen.findByText('Sharing choices saved.');
    expect(adapter.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'set_request_access', actor_id: request.requester_id, expected_revision: 3, capabilities: ['request_tasks', 'read_requests', 'help_requests'], confirmed: true }));
  });

  it('clears visible records after an authorization denial', async () => {
    const adapter = service(); adapter.command.mockRejectedValue(new ApiError(403, 'access_denied', 'Access has changed.'));
    mount(adapter); fireEvent.click(await screen.findByRole('button', { name: 'Withdraw request' }));
    await screen.findByText('Access has changed.');
    expect(screen.queryByText(draft.task_name)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request a task' })).not.toBeInTheDocument();
  });

  it('ignores a late review when authenticated scope changes', async () => {
    let finish!: (value: TaskRequestReview) => void;
    const adapter = service(); adapter.review.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const component = mount(adapter);
    fireEvent.click(await screen.findByRole('button', { name: 'Request a task' }));
    fireEvent.change(screen.getByLabelText('Task name'), { target: { value: 'Private draft' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-08' } });
    fireEvent.change(screen.getByLabelText('Time (America/Toronto)'), { target: { value: '14:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review timing' }));
    await waitFor(() => expect(finish).toBeDefined());
    const second = service({ ...workspace, participant: { ...workspace.participant, id: 'second-client', display_name: 'Morgan' }, requests: [] });
    component.rerender(<TaskRequests service={second} scopeKey="scope-2" onTalk={vi.fn()} voiceAvailable={false} />);
    await screen.findByText('Supporting Morgan');
    await act(async () => { finish(review({ ...draft, task_name: 'Private draft' })); });
    expect(screen.queryByText('Private draft')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send request' })).not.toBeInTheDocument();
    expect(second.command).not.toHaveBeenCalled();
  });

  it('uses the qualified voice callback without a model call from UI actions', async () => {
    const adapter = service(), talk = vi.fn(); mount(adapter, { onTalk: talk, voiceAvailable: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Talk to Nancy' }));
    expect(talk).toHaveBeenCalledTimes(1); expect(adapter.command).not.toHaveBeenCalled();
  });
});
