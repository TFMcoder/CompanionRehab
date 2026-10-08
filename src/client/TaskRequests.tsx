import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { RequestAccessItem, RequestCapability, TaskRequestCommand, TaskRequestDraft, TaskRequestItem, TaskRequestReceipt, TaskRequestReview, TaskRequestWorkspace } from '../shared/task-request-contracts';
import { localDateTimeWithOffset } from '../shared/local-time';
import { ApiError } from './api';
import './task-requests.css';

export interface TaskRequestService {
  workspace(): Promise<TaskRequestWorkspace>;
  review(draft: TaskRequestDraft): Promise<TaskRequestReview>;
  command(command: TaskRequestCommand): Promise<TaskRequestReceipt>;
  receipt(key: string): Promise<TaskRequestReceipt>;
}
export interface TaskRequestsProps {
  service: TaskRequestService;
  /** Changes whenever the authenticated login, active role or selected client changes. */
  scopeKey: string;
  onTalk(): void;
  voiceAvailable: boolean;
  voiceUnavailableReason?: string;
  onChanged?(): void;
  showTalk?: boolean;
  refreshVersion?: number;
  onPendingChange?(pending: boolean): void;
}
type Editor = { mode: 'submit' | 'accept'; draft: TaskRequestDraft; request?: TaskRequestItem };
type Pending = { command: TaskRequestCommand; message: string; receiptMissing?: boolean };
const priorityLabel = { high: 'High', medium: 'Medium', low: 'Low' };
const statusLabel = { pending: 'Waiting for a decision', accepted: 'Accepted · planned, not completed', rejected: 'Help requested', withdrawn: 'Withdrawn' };
const accessLabels: Record<RequestCapability, string> = { request_tasks: 'Request tasks', read_requests: 'View requests', help_requests: 'Receive help requests and reasons', review_request_flags: 'Review administrator flags and reasons' };
const blank = (view: TaskRequestWorkspace): TaskRequestDraft => ({ task_name: '', priority: 'medium', requested_date: view.local_date, requested_time: '', participant_time_zone: view.participant.time_zone, estimated_duration_minutes: null, travel_minutes: 0, notes: '' });
const errorText = (error: unknown) => error instanceof ApiError ? error.message : 'The connection was interrupted. Please check again.';
const unknownSave = (error: unknown) => !(error instanceof ApiError) || error.code === 'connection_unconfirmed' || error.status === 0 || error.status >= 500;
function when(draft: TaskRequestDraft) {
  const date = new Date(`${draft.requested_date}T12:00:00Z`);
  return `${new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date)} at ${draft.requested_time}`;
}
function DraftSummary({ draft }: { draft: TaskRequestDraft }) {
  return <dl><dt>Task</dt><dd>{draft.task_name}</dd><dt>When</dt><dd>{when(draft)} ({draft.participant_time_zone})</dd><dt>Priority</dt><dd>{priorityLabel[draft.priority]}</dd><dt>Time needed</dt><dd>{draft.estimated_duration_minutes === null ? 'To be discussed' : `${draft.estimated_duration_minutes} minutes`}{draft.travel_minutes > 0 ? ` + ${draft.travel_minutes} minutes travel` : ''}</dd>{draft.notes && <><dt>Notes</dt><dd>{draft.notes}</dd></>}</dl>;
}
function RequestDetails({ draft }: { draft: TaskRequestDraft }) {
  return <><p className="request-meta">Requested: {when(draft)} ({draft.participant_time_zone}) · {priorityLabel[draft.priority]} priority</p><p className="request-hint">{draft.estimated_duration_minutes === null ? 'Time needed is not set' : `${draft.estimated_duration_minutes} minutes`}{draft.travel_minutes > 0 ? ` + ${draft.travel_minutes} minutes travel` : ''}</p>{draft.notes && <p>{draft.notes}</p>}</>;
}

export function TaskRequests({ service, scopeKey, onTalk, voiceAvailable, voiceUnavailableReason, onChanged, showTalk = true, refreshVersion = 0, onPendingChange }: TaskRequestsProps) {
  const [loaded, setLoaded] = useState<{ scope: string; view: TaskRequestWorkspace } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [message, setMessage] = useState('');
  const [issue, setIssue] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [review, setReview] = useState<TaskRequestReview | null>(null);
  const [scheduleChecked, setScheduleChecked] = useState(false);
  const [decline, setDecline] = useState<{ request: TaskRequestItem; reason: string; confirming: boolean } | null>(null);
  const [resolve, setResolve] = useState<{ id: string; revision: number; text: string } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [capacity, setCapacity] = useState({ available: '', rest: '' });
  const epoch = useRef(0);
  const readId = useRef(0);
  const mounted = useRef(true);
  const working = useRef(false);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const valid = (stamp: number, scope: string) => mounted.current && epoch.current === stamp && currentScope.current === scope;
  const view = loaded?.scope === scopeKey ? loaded.view : null;
  const locked = busy || !!pending || !fresh;

  async function load(stamp = epoch.current, scope = scopeKey) {
    const read = ++readId.current;
    setLoading(true);
    try {
      const next = await service.workspace();
      if (!valid(stamp, scope) || read !== readId.current) return;
      setLoaded({ scope, view: next }); setFresh(true); setIssue('');
      setReview(null); setScheduleChecked(false);
      setEditor(current => current?.request && !next.requests.some(item => item.id === current.request!.id && item.revision === current.request!.revision && item.can_accept) ? null : current);
      setDecline(current => current && !next.requests.some(item => item.id === current.request.id && item.revision === current.request.revision && item.can_reject) ? null : current);
      setResolve(current => current && !next.help_requests.some(item => item.id === current.id && item.revision === current.revision && item.can_resolve) ? null : current);
    } catch (error) {
      if (!valid(stamp, scope) || read !== readId.current) return;
      setFresh(false); setIssue(errorText(error));
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setLoaded(null); setEditor(null); setReview(null); setDecline(null); setResolve(null);
      }
    } finally { if (valid(stamp, scope) && read === readId.current) setLoading(false); }
  }
  useEffect(() => {
    mounted.current = true;
    const stamp = ++epoch.current;
    working.current = false; setBusy(false); setFresh(false); setLoaded(null); setMessage(''); setIssue(''); setEditor(null); setReview(null); setDecline(null); setResolve(null); setPending(null); setScheduleChecked(false); setCapacity({ available: '', rest: '' });
    void load(stamp, scopeKey);
    return () => { mounted.current = false; epoch.current += 1; };
  }, [scopeKey, service]);
  useEffect(() => { onPendingChange?.(!!pending); }, [!!pending, onPendingChange]);
  useEffect(() => { if (refreshVersion > 0 && !pending && !working.current) void load(); }, [refreshVersion]);

  function edit(next: Editor | null) { setEditor(next); setReview(null); setScheduleChecked(false); setDecline(null); setResolve(null); setIssue(''); setCapacity({ available: '', rest: '' }); }
  async function saved(receipt: TaskRequestReceipt, text: string, stamp: number, scope: string) {
    if (!valid(stamp, scope)) return;
    setPending(null); setMessage(text); setIssue(''); setFresh(false); setReview(null); setScheduleChecked(false);
    if (receipt.type !== 'set_day_capacity') setEditor(null);
    setDecline(null); setResolve(null);
    // Parent refresh failures must never turn a confirmed receipt into an unknown save.
    try { onChanged?.(); } catch { /* The request list has its own refresh and status. */ }
    await load(stamp, scope);
  }
  async function run(command: TaskRequestCommand, text: string) {
    if (working.current || pending || !fresh) return;
    const stamp = epoch.current, scope = scopeKey;
    working.current = true; setBusy(true); setMessage(''); setIssue('');
    try { await saved(await service.command(command), text, stamp, scope); }
    catch (error) {
      if (!valid(stamp, scope)) return;
      if (unknownSave(error)) { setPending({ command, message: text }); setIssue('We could not confirm whether that was saved. Check the saved result before doing anything else.'); }
      else {
        setIssue(errorText(error)); setReview(null); setScheduleChecked(false);
        if (error instanceof ApiError && [401, 403, 409].includes(error.status)) {
          setFresh(false);
          if ([401, 403].includes(error.status)) { setLoaded(null); setEditor(null); setDecline(null); setResolve(null); }
        }
      }
    } finally { if (valid(stamp, scope)) { working.current = false; setBusy(false); } }
  }
  async function checkSaved(retrySame = false) {
    if (!pending || working.current || (retrySame && !pending.receiptMissing)) return;
    const stamp = epoch.current, scope = scopeKey;
    working.current = true; setBusy(true); setPending({ ...pending, receiptMissing: false });
    try { await saved(await (retrySame ? service.command(pending.command) : service.receipt(pending.command.idempotency_key)), pending.message, stamp, scope); }
    catch (error) {
      if (!valid(stamp, scope)) return;
      if (error instanceof ApiError && [401, 403].includes(error.status)) { setLoaded(null); setEditor(null); setDecline(null); setResolve(null); setFresh(false); }
      if (!retrySame && error instanceof ApiError && error.status === 404) setPending({ ...pending, receiptMissing: true });
      setIssue(!retrySame && error instanceof ApiError && error.status === 404 ? 'There is no saved result yet. You can check again or retry this same save. It will not create a duplicate.' : errorText(error));
    } finally { if (valid(stamp, scope)) { working.current = false; setBusy(false); } }
  }
  async function reviewDraft(event: FormEvent) {
    event.preventDefault();
    if (!editor || locked || working.current) return;
    const draft = { ...editor.draft, task_name: editor.draft.task_name.trim(), notes: editor.draft.notes.trim() };
    const local = localDateTimeWithOffset(`${draft.requested_date}T${draft.requested_time}`, draft.participant_time_zone);
    if (!local.ok) { setIssue('Choose a valid, unambiguous date and time in the client’s time zone.'); return; }
    if (!draft.task_name) { setIssue('Please give this task a name.'); return; }
    const stamp = epoch.current, scope = scopeKey;
    working.current = true; setBusy(true); setReview(null); setIssue(''); setScheduleChecked(false);
    try {
      const next = await service.review(draft);
      if (valid(stamp, scope)) { setEditor({ ...editor, draft: next.draft }); setReview(next); setCapacity({ available: next.capacity ? String(next.capacity.available_minutes) : '', rest: next.capacity ? String(next.capacity.rest_minutes) : '' }); }
    } catch (error) {
      if (valid(stamp, scope)) {
        setIssue(errorText(error));
        if (error instanceof ApiError && [401, 403].includes(error.status)) { setLoaded(null); setEditor(null); setFresh(false); }
      }
    } finally { if (valid(stamp, scope)) { working.current = false; setBusy(false); } }
  }
  function changeDraft(patch: Partial<TaskRequestDraft>) { if (editor) { setEditor({ ...editor, draft: { ...editor.draft, ...patch } }); setReview(null); setScheduleChecked(false); } }
  function confirmReview() {
    if (!editor || !review || locked || review.blockers.length > 0) return;
    if (editor.mode === 'submit') void run({ type: 'submit_request', idempotency_key: crypto.randomUUID(), draft: review.draft, review_token: review.review_token, confirmed: true }, 'Request sent. It is waiting for the client’s decision.');
    else if (editor.request && review.can_accept && scheduleChecked) void run({ type: 'accept_request', idempotency_key: crypto.randomUUID(), request_id: editor.request.id, expected_revision: editor.request.revision, draft: review.draft, review_token: review.review_token, confirmed: true, schedule_review_confirmed: true }, 'Task accepted and added to your plan. You can report it when it is done.');
  }

  return <section className="task-requests" aria-label="Task requests">
    <header className="request-header"><div><h2>{!showTalk || view?.role === 'client' ? 'Requests' : view?.role === 'administrator' ? 'Requests and help' : 'Support Team'}</h2>{view && <p>{view.role === 'client' ? 'You decide what you can take on.' : `Supporting ${view.participant.display_name}`}</p>}</div>
      {showTalk && <button type="button" className="talk-button" onClick={onTalk} disabled={!voiceAvailable}>Talk to Nancy</button>}
    </header>
    {showTalk && !voiceAvailable && <p className="request-hint">{voiceUnavailableReason ?? 'Nancy voice is not available for this account yet. You can use the buttons below.'}</p>}
    {message && <div role="status" className="request-status">{message}</div>}
    {issue && <div role="alert" className="request-warning"><p>{issue}</p>{pending ? <div className="request-actions"><button className="secondary-button" disabled={busy} onClick={() => void checkSaved()}>Check saved result</button>{pending.receiptMissing && <button className="secondary-button" disabled={busy} onClick={() => void checkSaved(true)}>Try the same save again</button>}</div> : <button className="secondary-button" disabled={busy || loading} onClick={() => { setReview(null); setScheduleChecked(false); void load(); }}>Refresh requests</button>}</div>}
    {loading && <p role="status">Loading requests…</p>}
    {view && <>
      {!fresh && !loading && <p className="request-hint">Refresh before making another change.</p>}
      {(view.role === 'family_friend' || view.role === 'administrator') && view.capabilities.includes('request_tasks') && !editor && <button className="primary-button" disabled={locked} onClick={() => edit({ mode: 'submit', draft: blank(view) })}>Request a task</button>}
      {editor && <section className="request-panel" aria-label={editor.mode === 'submit' ? 'Request a task' : 'Review request'}><h3>{editor.mode === 'submit' ? `Request a task for ${view.participant.display_name}` : 'Review this request'}</h3>
        <p className="request-hint">{editor.mode === 'submit' ? 'This sends a request. The client decides whether to accept it.' : 'You can choose another time or priority. Review the changes before accepting.'}</p>
        <form className="request-form" onSubmit={reviewDraft}><fieldset disabled={locked} className="request-form">
          <label>Task name<input required maxLength={160} value={editor.draft.task_name} readOnly={editor.mode === 'accept'} onChange={e => changeDraft({ task_name: e.target.value })} /></label>
          <div className="request-fields"><label>Priority<select value={editor.draft.priority} onChange={e => changeDraft({ priority: e.target.value as TaskRequestDraft['priority'] })}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
            <label>Date<input type="date" required value={editor.draft.requested_date} onChange={e => { if (!e.currentTarget.validity.badInput) changeDraft({ requested_date: e.target.value }); }} /></label>
            <label>Time ({view.participant.time_zone})<input type="time" required value={editor.draft.requested_time} onChange={e => { if (!e.currentTarget.validity.badInput) changeDraft({ requested_time: e.target.value }); }} /></label>
            <label>Minutes needed (optional)<input type="number" min={1} max={480} value={editor.draft.estimated_duration_minutes ?? ''} onChange={e => changeDraft({ estimated_duration_minutes: e.target.value === '' ? null : Number(e.target.value) })} /></label>
            <label>Travel minutes<input type="number" min={0} max={480} required value={editor.draft.travel_minutes} onChange={e => changeDraft({ travel_minutes: Number(e.target.value) })} /></label></div>
          <label>Notes or help needed (optional)<textarea maxLength={500} value={editor.draft.notes} onChange={e => changeDraft({ notes: e.target.value })} /></label>
          <div className="request-actions"><button className="primary-button" type="submit">Review timing</button><button className="secondary-button" type="button" onClick={() => edit(null)}>Cancel</button></div>
        </fieldset></form>
        {review && <div className="request-review"><h3>{editor.mode === 'submit' ? 'Ready to request?' : 'Does this work for you?'}</h3><DraftSummary draft={review.draft} />
          {review.warnings.map((warning, index) => <p key={`warning-${index}`} className="request-hint">{warning}</p>)}
          {review.blockers.map((blocker, index) => <p key={`blocker-${index}`} className="request-warning">{blocker}</p>)}
          {!review.capacity_known && <p className="request-hint">Daily capacity has not been confirmed. Free time does not tell us how much someone can take on.</p>}
          {editor.mode === 'accept' && <>
            <form className="request-form" onSubmit={e => { e.preventDefault(); if (capacity.available === '' || capacity.rest === '') return; void run({ type: 'set_day_capacity', idempotency_key: crypto.randomUUID(), local_date: review.draft.requested_date, expected_revision: review.capacity_revision, available_minutes: Number(capacity.available), rest_minutes: Number(capacity.rest), confirmed: true }, 'Your available time is saved. Review the request again before accepting.'); }}>
              <details><summary>Set how much I can take on that day</summary><p className="request-hint">After considering your existing plans, estimate the extra time you can take on for {review.draft.requested_date}. This does not change any approved limits.</p><fieldset disabled={locked} className="request-form"><label>Extra minutes I can take on<input type="number" required min={0} max={960} value={capacity.available} onChange={e => setCapacity({ ...capacity, available: e.target.value })} /></label><label>Rest minutes to leave between activities<input type="number" required min={0} max={240} value={capacity.rest} onChange={e => setCapacity({ ...capacity, rest: e.target.value })} /></label><button className="secondary-button" type="submit">Save my available time</button></fieldset></details>
            </form>
            <label className="request-check"><input type="checkbox" checked={scheduleChecked} disabled={locked || !review.can_accept} onChange={e => setScheduleChecked(e.target.checked)} /> I have checked my plans and this fits what I can take on.</label>
          </>}
          <div className="request-actions"><button className="primary-button" disabled={locked || review.blockers.length > 0 || (editor.mode === 'accept' && (!review.can_accept || !scheduleChecked))} onClick={confirmReview}>{editor.mode === 'submit' ? 'Send request' : 'Accept this task'}</button></div>
        </div>}
      </section>}
      <section className="request-panel"><h3>{view.role === 'client' ? 'Your requests' : 'Sent requests'}</h3><p className="request-hint">Times are in {view.participant.time_zone}.</p>{view.requests.length === 0 ? <p className="request-hint">No requests here.</p> : <ul className="request-list">{view.requests.map(request => <li key={request.id}>
        <h3>{request.draft.task_name}</h3><p className="request-meta">From {request.requester_label} · {priorityLabel[request.draft.priority]} priority</p><p>Requested: {when(request.draft)}</p>{request.accepted_draft && <p>Accepted: {when(request.accepted_draft)} · {priorityLabel[request.accepted_draft.priority]} priority</p>}<p>{statusLabel[request.status]}</p>{request.reason && <p>Reason: {request.reason}</p>}
        <div className="request-actions">{view.role === 'client' && request.can_accept && <button className="primary-button" disabled={locked} onClick={() => edit({ mode: 'accept', request, draft: { ...request.draft } })}>Review and accept</button>}{view.role === 'client' && request.can_reject && <button className="secondary-button" disabled={locked} onClick={() => { edit(null); setDecline({ request, reason: '', confirming: false }); }}>Cannot do this</button>}{request.can_withdraw && <button className="secondary-button" disabled={locked} onClick={() => void run({ type: 'withdraw_request', request_id: request.id, expected_revision: request.revision, idempotency_key: crypto.randomUUID(), confirmed: true }, 'Request withdrawn.')}>Withdraw request</button>}</div>
        {decline?.request.id === request.id && <form className="request-review request-form" onSubmit={e => { e.preventDefault(); if (!decline.reason.trim()) return; if (!decline.confirming) { setDecline({ ...decline, reason: decline.reason.trim(), confirming: true }); return; } void run({ type: 'reject_request', request_id: request.id, expected_revision: decline.request.revision, reason: decline.reason.trim(), confirmed: true, idempotency_key: crypto.randomUUID() }, 'Your decision is saved. Help has been requested.'); }}>
          <p>A short reason is enough. It will be shared with the people allowed to arrange help.</p>{decline.confirming ? <p>Reason: {decline.reason}</p> : <label>Reason<textarea maxLength={500} required disabled={locked} value={decline.reason} onChange={e => setDecline({ ...decline, reason: e.target.value })} placeholder="For example: I cannot take this on today." /></label>}
          <div className="request-actions"><button className="primary-button" disabled={locked || !decline.reason.trim()} type="submit">{decline.confirming ? 'Confirm and ask for help' : 'Review my reason'}</button><button className="secondary-button" type="button" disabled={locked} onClick={() => setDecline(null)}>Keep undecided</button>{decline.confirming && <button className="secondary-button" type="button" disabled={locked} onClick={() => setDecline({ ...decline, confirming: false })}>Edit reason</button>}</div>
        </form>}
      </li>)}</ul>}</section>
      {view.role !== 'client' && <section className="request-panel"><h3>Help needed</h3>{view.help_requests.length === 0 ? <p className="request-hint">No help requests here.</p> : <ul className="request-list">{view.help_requests.map(help => <li key={help.id}><h3>{help.task_name}</h3><RequestDetails draft={help.draft} /><p>{help.reason}</p><p>{help.status === 'unassigned' ? 'Waiting for someone to help' : help.status === 'volunteered' ? 'Someone has offered to help' : 'Help resolved'}</p>{help.eligible_helper_count === 0 && help.status === 'unassigned' && <p className="request-hint">No other family helper has access yet. An administrator can review this.</p>}{help.resolution && <p>{help.resolution}</p>}<div className="request-actions">{help.can_volunteer && <button className="primary-button" disabled={locked} onClick={() => void run({ type: 'volunteer_help', help_id: help.id, expected_revision: help.revision, confirmed: true, idempotency_key: crypto.randomUUID() }, 'Your offer to help is saved.')}>I can help</button>}{help.can_resolve && <button className="secondary-button" disabled={locked} onClick={() => setResolve({ id: help.id, revision: help.revision, text: '' })}>Resolve help</button>}</div>{resolve?.id === help.id && <form className="request-form request-review" onSubmit={e => { e.preventDefault(); if (resolve.text.trim()) void run({ type: 'resolve_help', help_id: help.id, expected_revision: resolve.revision, resolution: resolve.text.trim(), confirmed: true, idempotency_key: crypto.randomUUID() }, 'Help marked as resolved.'); }}><label>What was arranged?<textarea required maxLength={500} value={resolve.text} disabled={locked} onChange={e => setResolve({ ...resolve, text: e.target.value })} /></label><div className="request-actions"><button type="submit" className="primary-button" disabled={locked || !resolve.text.trim()}>Confirm resolution</button><button type="button" className="secondary-button" disabled={locked} onClick={() => setResolve(null)}>Cancel</button></div></form>}</li>)}</ul>}</section>}
      {view.role === 'administrator' && <section className="request-panel"><h3>Administrator review</h3>{view.administrator_flags.length === 0 ? <p className="request-hint">Nothing to review.</p> : <ul className="request-list">{view.administrator_flags.map(flag => <li key={flag.id}><h3>{flag.task_name}</h3><RequestDetails draft={flag.draft} /><p>{flag.reason}</p><p>{flag.status === 'open' ? 'Needs review' : flag.status === 'acknowledged' ? 'Reviewed · help still open' : 'Help resolved'}</p>{flag.can_acknowledge && <button className="secondary-button" disabled={locked} onClick={() => void run({ type: 'acknowledge_flag', flag_id: flag.id, expected_revision: flag.revision, confirmed: true, idempotency_key: crypto.randomUUID() }, 'Review acknowledged. The help request remains open until it is resolved.')}>Acknowledge review</button>}</li>)}</ul>}</section>}
      {view.role === 'client' && view.sharing.length > 0 && <details className="request-panel"><summary>Who can request tasks and help</summary><p>You choose what each person can do and see.</p>{view.sharing.map(person => <AccessEditor key={`${person.actor_id}:${person.revision}`} person={person} locked={locked} save={capabilities => void run({ type: 'set_request_access', actor_id: person.actor_id, role: person.role, expected_revision: person.revision, capabilities, confirmed: true, idempotency_key: crypto.randomUUID() }, 'Sharing choices saved.')} />)}</details>}
    </>}
  </section>;
}

function AccessEditor({ person, locked, save }: { person: RequestAccessItem; locked: boolean; save(capabilities: RequestCapability[]): void }) {
  const [selected, setSelected] = useState(person.capabilities);
  const options: RequestCapability[] = person.role === 'administrator' ? ['request_tasks', 'read_requests', 'review_request_flags'] : ['request_tasks', 'read_requests', 'help_requests'];
  return <form className="request-form request-review" onSubmit={e => { e.preventDefault(); save(selected); }}><h3>{person.label}</h3><fieldset disabled={locked} className="request-form">{options.map(capability => <label key={capability} className="request-check"><input type="checkbox" checked={selected.includes(capability)} onChange={e => setSelected(e.target.checked ? [...selected, capability] : selected.filter(item => item !== capability))} />{accessLabels[capability]}</label>)}<button className="secondary-button" type="submit">Save access for {person.label}</button></fieldset></form>;
}
