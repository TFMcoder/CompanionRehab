import type { PriorityContext, Today } from './contracts.js';
import type { ActivityKind, ActivityOption } from './activity-contracts.js';
import { dailyContext } from './daily-context.js';

function localDate(instant: string, zone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant));
}

function localTime(instant: string, zone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date(instant));
}

/** Uses facts, never inferred completion. Shared by the screen and Nancy's tools. */
export function priorityContext(today: Today, now = new Date()): PriorityContext {
  const temporal = dailyContext(today, now);
  const { time_zone: zone, local_time, period } = temporal;
  const hour = Number(local_time.slice(0, 2));
  const morning = period === 'morning_routine' || period === 'morning_catchup';
  const greeting = hour < 12 ? 'Good morning' : period === 'evening' ? 'Good evening' : 'Good afternoon';
  if (!temporal.facts_are_current_day) return { greeting, period, local_time, local_date: temporal.local_date, temporal,
    suggestions: [{ kind: 'refresh', label: 'Review the current day', reason: 'These care facts belong to another local date. Refresh before making a time-sensitive suggestion.' }] };
  const suggestions: PriorityContext['suggestions'] = [];
  const ledger = today.activity_ledger;
  const activity = (kind: ActivityKind, source?: string, mealSlot?: 'breakfast' | 'lunch' | 'dinner'): ActivityOption | undefined => {
    const candidates = ledger?.options.filter(option => option.kind === kind && !option.unplanned) ?? [];
    if (kind === 'meal' && mealSlot) return candidates.find(option => option.meal_slot === mealSlot);
    return candidates.find(option => option.source_id === source);
  };
  const pending = (option: ActivityOption | undefined) => {
    if (!option) return true;
    if (option.status === 'completed' || option.status === 'deferred') return false;
    // A voided factual report no longer resolves the planned occurrence.
    return option.scheduled_at ? localDate(option.scheduled_at, zone) === today.local_date : option.local_date === today.local_date;
  };
  const reports = (today.activity_reports || []).filter(report => report.local_date === today.local_date);
  const resolved = new Set(reports.filter(report => report.status === 'completed' || report.status === 'deferred').map(report => report.target_id));
  const mealResolved = (slot: 'breakfast' | 'lunch' | 'dinner') => reports.some(report => report.meal_slot === slot && (report.status === 'completed' || report.status === 'deferred'));
  const breakfastEaten = temporal.morning.breakfast_status === 'reported';
  const appointmentCandidates = (today.appointments || []).flatMap(appointment => {
    const option = activity('appointment', appointment.id);
    if (!pending(option) || resolved.has(appointment.id)) return [];
    const startsAt = option?.scheduled_at ?? appointment.starts_at;
    const delta = Date.parse(startsAt) - now.getTime();
    return delta >= 0 && delta <= 90 * 60000 ? [{ key: option?.id ?? `appointment:${appointment.id}`, title: appointment.title, startsAt, delta }] : [];
  });
  const knownAppointmentKeys = new Set(appointmentCandidates.map(candidate => candidate.key));
  for (const option of ledger?.options ?? []) {
    if (option.kind !== 'appointment' || option.unplanned || !option.scheduled_at || !pending(option) || knownAppointmentKeys.has(option.id)
      || (!!option.source_id && resolved.has(option.source_id))) continue;
    const delta = Date.parse(option.scheduled_at) - now.getTime();
    if (delta >= 0 && delta <= 90 * 60000) appointmentCandidates.push({ key: option.id, title: option.title, startsAt: option.scheduled_at, delta });
  }
  const appointments = appointmentCandidates.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const appointment = appointments[0];
  if (appointment) suggestions.push({ kind: 'appointment', label: appointment.title, reason: `Starts in ${Math.ceil(appointment.delta / 60000)} minutes. Check preparation and travel time together.` });
  if (temporal.intake.check_needed) suggestions.push({ kind: 'intake_check', label: 'Check recent food',
    reason: 'There has been no recent food report during the preferred day window. Ask whether and when food was eaten; missing reports do not prove fasting or that the person was awake.' });
  const canSuggestMeal = temporal.intake.automatic_full_meal === 'eligible' && !temporal.intake.check_needed;
  let mealNeedsReview = false;
  const mealSlot = hour >= 11 && hour < 14 ? 'lunch' : hour >= 17 && hour < 20 ? 'dinner' : undefined;
  if (mealSlot) {
    const meal = today.checkin?.accepted?.meals.find(m => m.slot === mealSlot);
    if (!mealResolved(mealSlot) && pending(activity('meal', meal?.option_id, mealSlot))) {
      mealNeedsReview = true;
      if (canSuggestMeal) suggestions.push({ kind: mealSlot, label: meal ? `${mealSlot}: ${meal.name}` : `Choose ${mealSlot}`, reason: 'Ask whether this meal has been eaten and what sounds appealing.' });
    }
  }
  if (morning) {
    const planned = today.checkin?.accepted?.meals.find(m => m.slot === 'breakfast');
    if (!breakfastEaten && !mealResolved('breakfast') && pending(activity('meal', planned?.option_id, 'breakfast'))) {
      mealNeedsReview = true;
      if (canSuggestMeal) suggestions.push({ kind: 'breakfast', label: planned ? `Breakfast: ${planned.name}` : 'Choose breakfast', reason: 'Ask whether breakfast has been eaten; a planned meal is not a meal report.' });
    }
    if (breakfastEaten) {
      for (const category of ['exercise', 'rehab'] as const) {
        const task = (today.checkin?.accepted?.tasks || today.tasks).find(t => t.category === category
          && (!!today.checkin?.accepted || !t.scheduled_date || t.scheduled_date === today.local_date)
          && !resolved.has(t.id) && pending(activity('task', t.id)));
        if (task) suggestions.push({ kind: category, label: task.title, reason: 'An existing routine task. Ask about readiness; do not prescribe or mark it completed.' });
      }
    }
  }
  if (mealNeedsReview && temporal.intake.automatic_full_meal === 'clarify_recent_unknown_intake') suggestions.push({
    kind: 'intake_check', label: 'Check recent food', reason: 'Food was reported recently, but whether it was a full meal or a snack is unknown. Ask before suggesting another full meal.' });
  if (hour === 16 && !mealResolved('dinner')) suggestions.push({ kind: 'dinner_preparation', label: 'Review dinner preparation',
    reason: 'Check the preferred dinner time and known preparation duration. This is an evening planning checkpoint, not a meal deadline or an instruction to eat now.' });
  const scheduled = (today.checkin?.accepted?.tasks || []).flatMap(task => {
    const option = activity('task', task.id);
    return !resolved.has(task.id) && pending(option) ? [{ key: option?.id ?? `task:${task.id}`, title: task.title, urgency: task.urgency, scheduledAt: option?.scheduled_at, fallbackTime: task.scheduled_time, ledgerOnly: false }] : [];
  }).sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    const aTime = a.scheduledAt ? localTime(a.scheduledAt, zone) : a.fallbackTime;
    const bTime = b.scheduledAt ? localTime(b.scheduledAt, zone) : b.fallbackTime;
    return (aTime || '99:99').localeCompare(bTime || '99:99') || rank[a.urgency || 'medium'] - rank[b.urgency || 'medium'];
  });
  const knownTaskKeys = new Set(scheduled.map(candidate => candidate.key));
  for (const option of ledger?.options ?? []) {
    if (option.kind !== 'task' || option.unplanned || !pending(option) || knownTaskKeys.has(option.id)
      || (!!option.source_id && resolved.has(option.source_id))) continue;
    scheduled.push({ key: option.id, title: option.title, urgency: undefined, scheduledAt: option.scheduled_at, fallbackTime: null, ledgerOnly: true });
  }
  scheduled.sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    const aTime = a.scheduledAt ? localTime(a.scheduledAt, zone) : a.fallbackTime;
    const bTime = b.scheduledAt ? localTime(b.scheduledAt, zone) : b.fallbackTime;
    return (aTime || '99:99').localeCompare(bTime || '99:99') || rank[a.urgency || 'medium'] - rank[b.urgency || 'medium'];
  });
  const quietTaskWindow = temporal.task_window.after_finish_target || period === 'before_morning';
  const feasibleTask = quietTaskWindow ? undefined : scheduled.find(candidate => {
    const option = ledger?.options.find(item => item.id === candidate.key);
    const source = option?.source_id ?? (candidate.key.startsWith('task:') ? candidate.key.slice(5) : null);
    return temporal.task_timing.find(item => item.task_id === source)?.duration_fits_before_finish_target !== false;
  });
  if (feasibleTask) {
    const { title, scheduledAt, fallbackTime, ledgerOnly } = feasibleTask;
    const time = scheduledAt ? localTime(scheduledAt, zone) : fallbackTime;
    const suggestion = { kind: 'task', label: title, reason: time ? `Planned for ${time}; ask about its current status.` : 'From the accepted plan; check timing and readiness.' };
    if (!suggestions.some(existing => existing.label === title)) {
      if (ledgerOnly) {
        const firstRoutine = suggestions.findIndex(existing => !['appointment', 'breakfast', 'lunch', 'dinner'].includes(existing.kind));
        suggestions.splice(firstRoutine < 0 ? suggestions.length : firstRoutine, 0, suggestion);
      } else suggestions.push(suggestion);
    }
  }
  if (morning && !today.checkin?.accepted && suggestions.length < 2) suggestions.push({ kind: 'planning', label: 'Plan the day', reason: 'Review today’s tasks and meal choices together.' });
  if (!suggestions.length && quietTaskWindow) suggestions.push({ kind: 'conversation', label: 'Talk to Nancy', reason: 'Conversation and support remain available. Review remaining work only if you want to; the daily rhythm is a preference, not an access restriction.' });
  if (!suggestions.length) suggestions.push({ kind: 'planning', label: today.checkin?.accepted ? 'Review today’s plan' : 'Plan the day', reason: scheduled.length && !feasibleTask ? 'The known task duration does not fit before the preferred evening finish. Review a smaller step or another time together.' : 'You can choose tasks, meals, or the grocery list.' });
  return { greeting, period, local_time, local_date: temporal.local_date, temporal, suggestions: suggestions.slice(0, 2) };
}
