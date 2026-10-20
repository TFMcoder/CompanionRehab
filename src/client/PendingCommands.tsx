import { useEffect, useState } from 'react';
import { PendingCommands as PendingController, type PendingCommand, type PendingFamily } from './pending-commands';

const labels: Record<PendingCommand['family'], string> = { care: 'Day plan', activity: 'Activity', task_request: 'Task request',
  meal_grocery:'Meal or grocery',local_day:'Day review',program:'Routine or rehab',support:'Support Team',progress:'Progress',operations:'Operations' };
const messages: Record<PendingCommand['status'], string> = {
  queued: 'Pending on this device. This change has not been sent.',
  unknown: 'Save unconfirmed. Check the receipt when connected.',
  ready_retry: 'No saved receipt was found. Review the latest day before retrying.',
  needs_review: 'This change needs review. It was not applied automatically.',
  saved: 'Saved.',
};

/** Compact status surface; parent activates/deactivates the controller with server session scope. */
export function PendingCommandsPanel({ controller, onSaved, onReview, readOnly=false }: {
  controller: PendingController;
  onSaved?: (receipt: unknown) => void | Promise<void>;
  onReview?: (family:PendingFamily) => Promise<void>;
  readOnly?:boolean;
}) {
  const [items, setItems] = useState<PendingCommand[]>(controller.snapshot);
  const [busy, setBusy] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => controller.subscribe(setItems), [controller]);
  if (!items.length) return null;
  const run = async (key: string, action: () => Promise<unknown | null>) => {
    setBusy(key); setError('');
    try { const receipt = await action(); if (receipt) await onSaved?.(receipt); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not check this change.'); }
    finally { setBusy(null); }
  };
  return <section className="pending-commands" aria-label="Pending changes">
    <h2>Pending changes</h2>
    <p>{readOnly?'A previous change needs checking. Your saved records will not be changed automatically.':'Voice needs a connection. Typed changes saved here can be checked when you reconnect.'}</p>
    <ul>{items.map(item => <li key={item.key}>
      <strong>{labels[item.family]}</strong> <span role="status">{messages[item.status]}</span>
      {item.reason && <p>{item.reason}</p>}
      <div className="request-actions">
        {!readOnly&&item.status === 'queued' && <button type="button" disabled={busy !== null} onClick={() => void run(item.key, () => controller.submit(item.key))}>Send pending change</button>}
        {item.status === 'unknown' && <button type="button" disabled={busy !== null} onClick={() => void run(item.key, () => controller.reconcile(item.key))}>Check saved receipt</button>}
        {!readOnly&&item.status === 'ready_retry' && <>
          {onReview && <button type="button" disabled={busy !== null} onClick={() => void run(item.key, async () => { await onReview(item.family); setReviewed(item.key); return null; })}>Review latest {labels[item.family].toLowerCase()}</button>}
          <button type="button" disabled={busy !== null || reviewed !== item.key} onClick={() => void run(item.key, () => controller.retry(item.key))}>Retry same change</button>
        </>}
        {!readOnly&&<button type="button" disabled={busy !== null} onClick={() => void run(item.key, async () => { await controller.discard(item.key); return null; })}>{item.status === 'saved' ? 'Dismiss' : 'Discard device copy'}</button>}
      </div>
    </li>)}</ul>
    {error && <p role="alert">{error}</p>}
  </section>;
}
