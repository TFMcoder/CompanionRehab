import { dateInZone, type MealSlot, type Today } from './contracts.js';
import type { ActivityEntry, ActivityOption, IntakeKind } from './activity-contracts.js';
import { localDateTimeWithOffset } from './local-time.js';
import { defaultIntakeTiming } from './intake-timing.js';

/** Application planning defaults, not clinical rules or permission to send prompts. */
export const dailyRhythm = {
  morning_start: '06:00', morning_end: '09:00', delayed_morning_end: '11:00',
  evening_start: '16:00', task_finish_target: '20:00',
  full_meal_spacing_minutes: 60, intake_report_check_minutes: 360,
} as const;
export type { IntakeKind } from './activity-contracts.js';
export type DayPeriod = 'before_morning' | 'morning_routine' | 'morning_catchup' | 'daytime' | 'evening';
export interface IntakeObservation {
  activity_id: string; occurred_at: string; recorded_at: string | null;
  intake_kind: IntakeKind; meal_slot: MealSlot | null; elapsed_minutes: number;
}
export interface DailyContext {
  current_instant: string; time_zone: string; local_date: string; local_time: string;
  facts_local_date: string; facts_are_current_day: boolean; period: DayPeriod;
  rhythm: Omit<typeof dailyRhythm, 'full_meal_spacing_minutes' | 'intake_report_check_minutes'> & { full_meal_spacing_minutes: number; intake_report_check_minutes: number };
  morning: { catchup_available: boolean; unfinished: boolean; breakfast_status: 'reported' | 'deferred' | 'unknown' };
  intake: {
    latest_report: IntakeObservation | null; latest_full_meal: IntakeObservation | null;
    automatic_full_meal: 'eligible' | 'suppress_recent_full_meal' | 'clarify_recent_unknown_intake';
    meal_spacing_until: string | null; intake_since_latest_report: 'unknown';
    check_needed: boolean; check_basis: 'preferred_day_window_not_observed_awake';
    minutes_in_day_window_without_report: number; awake_state: 'unknown';
  };
  task_window: { finish_target_at: string | null; minutes_remaining: number; after_finish_target: boolean; preparation_travel_rest: 'unknown' };
  task_timing: { task_id: string; scheduled_at: string | null; duration_minutes: number | null; duration_fits_before_finish_target: boolean | null }[];
}

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const timeInZone = (now: Date, zone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(now);
const instantAt = (date: string, time: string, zone: string) => {
  const converted = localDateTimeWithOffset(`${date}T${time}`, zone);
  return converted.ok ? new Date(converted.value).toISOString() : null;
};

/** Current rows override older copies and legacy reports, including corrections/voids. */
function currentActivity(today: Today): ActivityOption[] {
  const rows = new Map<string, ActivityOption>();
  for (const row of [...(today.activity_ledger?.recent_entries ?? []), ...(today.activity_ledger?.entries ?? []), ...(today.activity_ledger?.options ?? [])]) {
    const existing = rows.get(row.id);
    if (!existing || row.revision > existing.revision || row.revision === existing.revision && ('occurred_at' in row || !('occurred_at' in existing))) rows.set(row.id, row);
  }
  return [...rows.values()];
}

/** Pure bounded calculation. Callers supply freshly authorized care facts and server time. */
export function dailyContext(today: Today, now: Date): DailyContext {
  const zone = today.profile?.time_zone ?? 'America/Toronto';
  const timing = today.intake_timing ?? defaultIntakeTiming;
  const local_date = dateInZone(now, zone), local_time = timeInZone(now, zone), clockMinutes = minutes(local_time);
  const rows = currentActivity(today);
  const observations: IntakeObservation[] = [];
  for (const row of rows) {
    if (row.kind !== 'meal' || row.status !== 'completed' || !('occurred_at' in row)) continue;
    const entry = row as ActivityEntry;
    const occurred = entry.occurred_at ? Date.parse(entry.occurred_at) : NaN;
    if (!Number.isFinite(occurred) || occurred > now.getTime()) continue;
    observations.push({ activity_id: entry.id, occurred_at: new Date(occurred).toISOString(), recorded_at: entry.recorded_at ?? null,
      intake_kind: entry.intake_kind ?? 'unknown', meal_slot: entry.meal_slot, elapsed_minutes: (now.getTime() - occurred) / 60_000 });
  }
  for (const report of today.activity_reports ?? []) {
    if (!report.meal_slot || report.status !== 'completed') continue;
    // A newer saved correction must not be undone by a legacy projection.
    if (rows.some(row => row.kind === 'meal' && row.revision > 0 && (row.id === report.target_id
      || row.source_id === report.target_id && row.meal_slot === report.meal_slot && row.local_date === report.local_date))) continue;
    const occurred = Date.parse(report.occurred_at);
    if (!Number.isFinite(occurred) || occurred > now.getTime() || dateInZone(new Date(occurred), zone) !== report.local_date) continue;
    observations.push({ activity_id: report.target_id, occurred_at: new Date(occurred).toISOString(), recorded_at: null,
      intake_kind: 'unknown', meal_slot: report.meal_slot, elapsed_minutes: (now.getTime() - occurred) / 60_000 });
  }
  observations.sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at) || a.activity_id.localeCompare(b.activity_id));
  const latest = observations[0] ?? null, fullMeal = observations.find(item => item.intake_kind === 'full_meal') ?? null;
  const recentFull = fullMeal && fullMeal.elapsed_minutes < timing.full_meal_spacing_minutes ? fullMeal : null;
  const recentUnknown = observations.find(item => item.intake_kind === 'unknown' && item.elapsed_minutes < timing.full_meal_spacing_minutes) ?? null;
  const spacingSource = recentFull ?? recentUnknown;
  const breakfastReported = observations.some(item => item.meal_slot === 'breakfast' && dateInZone(new Date(item.occurred_at), zone) === local_date);
  const breakfastDeferred = rows.some(row => row.kind === 'meal' && row.meal_slot === 'breakfast' && row.local_date === local_date && row.status === 'deferred')
    || (today.activity_reports ?? []).some(report => report.meal_slot === 'breakfast' && report.local_date === local_date && report.status === 'deferred');
  const breakfast_status = breakfastReported ? 'reported' : breakfastDeferred ? 'deferred' : 'unknown';
  const pendingRoutine = (today.checkin?.accepted?.tasks ?? today.tasks).some(task => {
    if (!['exercise', 'rehab'].includes(task.category ?? '') || (!today.checkin?.accepted && task.scheduled_date && task.scheduled_date !== local_date)) return false;
    const actual = today.activity_ledger?.options.find(row => row.kind === 'task' && row.source_id === task.id);
    if (actual?.status === 'completed' || actual?.status === 'deferred') return false;
    if (actual?.scheduled_at && dateInZone(new Date(actual.scheduled_at), zone) !== local_date) return false;
    return !(today.activity_reports ?? []).some(report => report.target_id === task.id && report.local_date === local_date && ['completed', 'deferred'].includes(report.status));
  });
  const unfinished = breakfast_status === 'unknown' || !today.checkin?.accepted || pendingRoutine;
  const catchup_available = clockMinutes >= minutes(dailyRhythm.morning_end) && clockMinutes < minutes(dailyRhythm.delayed_morning_end);
  const period: DayPeriod = clockMinutes < minutes(dailyRhythm.morning_start) ? 'before_morning'
    : clockMinutes < minutes(dailyRhythm.morning_end) ? 'morning_routine'
    : catchup_available && unfinished ? 'morning_catchup'
    : clockMinutes < minutes(dailyRhythm.evening_start) ? 'daytime' : 'evening';
  const dayStart = instantAt(local_date, dailyRhythm.morning_start, zone), finish = instantAt(local_date, dailyRhythm.task_finish_target, zone);
  // The task finish preference is not a bedtime. A late active conversation still
  // gets current intake uncertainty; quiet-time outreach is decided separately.
  const inDayWindow = clockMinutes >= minutes(dailyRhythm.morning_start);
  const since = Math.max(dayStart ? Date.parse(dayStart) : now.getTime(), latest ? Date.parse(latest.occurred_at) : -Infinity);
  const windowMinutes = Math.max(0, (now.getTime() - since) / 60_000);
  const task_timing = (today.checkin?.accepted?.tasks ?? today.tasks).slice(0, 20).map(task => {
    const actual = today.activity_ledger?.options.find(row => row.kind === 'task' && !row.unplanned && row.source_id === task.id);
    const scheduled_at = actual?.scheduled_at ?? (task.scheduled_time ? instantAt(task.scheduled_date ?? local_date, task.scheduled_time, zone) : null);
    const duration = task.duration_minutes ?? null;
    const start = Math.max(now.getTime(), scheduled_at ? Date.parse(scheduled_at) : now.getTime());
    return { task_id: task.id, scheduled_at, duration_minutes: duration,
      duration_fits_before_finish_target: duration === null || !finish ? null : start + duration * 60_000 <= Date.parse(finish) };
  });
  return {
    current_instant: now.toISOString(), time_zone: zone, local_date, local_time, facts_local_date: today.local_date,
    facts_are_current_day: today.local_date === local_date, period, rhythm: { ...dailyRhythm, full_meal_spacing_minutes: timing.full_meal_spacing_minutes, intake_report_check_minutes: timing.intake_report_check_minutes },
    morning: { catchup_available, unfinished, breakfast_status },
    intake: { latest_report: latest, latest_full_meal: fullMeal,
      automatic_full_meal: recentFull ? 'suppress_recent_full_meal' : recentUnknown ? 'clarify_recent_unknown_intake' : 'eligible',
      meal_spacing_until: spacingSource ? new Date(Date.parse(spacingSource.occurred_at) + timing.full_meal_spacing_minutes * 60_000).toISOString() : null,
      intake_since_latest_report: 'unknown', check_needed: inDayWindow && windowMinutes >= timing.intake_report_check_minutes,
      check_basis: 'preferred_day_window_not_observed_awake', minutes_in_day_window_without_report: windowMinutes, awake_state: 'unknown' },
    task_window: { finish_target_at: finish, minutes_remaining: finish ? Math.max(0, (Date.parse(finish) - now.getTime()) / 60_000) : 0,
      after_finish_target: clockMinutes >= minutes(dailyRhythm.task_finish_target), preparation_travel_rest: 'unknown' },
    task_timing,
  };
}
