import { useEffect, useState } from 'react';
import { defaultIntakeTiming, intakeTimingSchema, type IntakeTiming } from '../shared/intake-timing';
import type { LocalDayCommand } from '../shared/local-day-contracts';

export function IntakeTimingControls({ value = defaultIntakeTiming, busy, onSave }: {
  value?: IntakeTiming; busy: boolean; onSave(command: LocalDayCommand): Promise<boolean>;
}) {
  const [spacing, setSpacing] = useState(value.full_meal_spacing_minutes);
  const [interval, setInterval] = useState(value.intake_report_check_minutes);
  const [review, setReview] = useState<Extract<LocalDayCommand, { type: 'set_intake_timing' }> | null>(null);
  const [issue, setIssue] = useState('');
  useEffect(() => {
    setSpacing(value.full_meal_spacing_minutes);setInterval(value.intake_report_check_minutes);setReview(null);setIssue('');
  }, [value.revision]);
  return <details><summary>Food timing choices</summary>
    <p>Choose the spacing Nancy uses for suggestions. You can eat or talk at any time. Food check-ins also need your reminder consent and follow quiet hours.</p>
    {review ? <div role="group" aria-label="Review food timing">
      <p>Wait at least {review.preferences.full_meal_spacing_minutes} minutes after a reported full meal before automatically suggesting another. If food check-ins are enabled, check after {review.preferences.intake_report_check_minutes} minutes without a report during your day window. These are planning preferences, not clinical instructions.</p>
      <button disabled={busy} onClick={() => { void onSave(review).then(saved => { if (saved) setReview(null); }); }}>Save food timing</button>
      <button disabled={busy} onClick={() => setReview(null)}>Go back</button>
    </div> : <form onSubmit={event => {
      event.preventDefault();setIssue('');
      const parsed = intakeTimingSchema.safeParse({ full_meal_spacing_minutes: spacing, intake_report_check_minutes: interval });
      if (!parsed.success) { setIssue('Choose whole minutes within the shown ranges.');return; }
      setReview({ type: 'set_intake_timing', idempotency_key: crypto.randomUUID(), confirmed: true, expected_revision: value.revision, preferences: parsed.data });
    }}>
      <label>Minutes between automatic full-meal suggestions<input required type="number" min="15" max="720" value={spacing} onChange={event => setSpacing(Number(event.target.value))}/></label>
      <label>Minutes without a food report before an opted-in check<input required type="number" min="30" max="960" value={interval} onChange={event => setInterval(Number(event.target.value))}/></label>
      <button disabled={busy}>Review food timing</button>
    </form>}
    {issue && <p role="alert">{issue}</p>}
  </details>;
}
