import type { PriorityContext, Today } from './contracts.js';

/** Uses facts, never inferred completion. Shared by the screen and Nancy's tools. */
export function priorityContext(today: Today, now = new Date()): PriorityContext {
  const zone = today.profile?.time_zone || 'America/Toronto';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(now);
  const hour = Number(parts.find(p => p.type === 'hour')!.value);
  const minute = Number(parts.find(p => p.type === 'minute')!.value);
  const local_time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const period = hour >= 8 && hour < 11 ? 'morning_routine' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const suggestions: PriorityContext['suggestions'] = [];
  const done = new Set((today.activity_reports || []).filter(r => r.local_date === today.local_date && r.status === 'completed').map(r => r.target_id));
  const breakfastEaten = (today.activity_reports || []).some(r => r.local_date === today.local_date && r.status === 'completed' && r.meal_slot === 'breakfast');
  const appointment = (today.appointments || []).filter(a => {
    const delta = new Date(a.starts_at).getTime() - now.getTime();
    return delta >= 0 && delta <= 90 * 60000;
  }).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0];
  if (appointment) suggestions.push({ kind: 'appointment', label: appointment.title, reason: `Starts in ${Math.ceil((Date.parse(appointment.starts_at) - now.getTime()) / 60000)} minutes. Check preparation and travel time together.` });
  const mealSlot = hour >= 11 && hour < 14 ? 'lunch' : hour >= 17 && hour < 20 ? 'dinner' : undefined;
  if (mealSlot && !(today.activity_reports || []).some(r => r.local_date === today.local_date && r.meal_slot === mealSlot && r.status === 'completed')) {
    const meal = today.checkin?.accepted?.meals.find(m => m.slot === mealSlot);
    suggestions.push({ kind: mealSlot, label: meal ? `${mealSlot}: ${meal.name}` : `Choose ${mealSlot}`, reason: 'Ask whether this meal has been eaten and what sounds appealing.' });
  }
  if (period === 'morning_routine') {
    if (!breakfastEaten) {
      const planned = today.checkin?.accepted?.meals.find(m => m.slot === 'breakfast');
      suggestions.push({ kind: 'breakfast', label: planned ? `Breakfast: ${planned.name}` : 'Choose breakfast', reason: 'Ask whether breakfast has been eaten; a planned meal is not a meal report.' });
    }
    if (!today.checkin?.accepted) suggestions.push({ kind: 'planning', label: 'Plan the day', reason: 'Review today’s tasks and meal choices together.' });
    if (breakfastEaten) {
      for (const category of ['exercise', 'rehab'] as const) {
        const task = (today.checkin?.accepted?.tasks || today.tasks).find(t => t.category === category && !done.has(t.id));
        if (task) suggestions.push({ kind: category, label: task.title, reason: 'An existing routine task. Ask about readiness; do not prescribe or mark it completed.' });
      }
    }
  }
  const scheduled = (today.checkin?.accepted?.tasks || []).filter(t => !done.has(t.id)).sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    return (a.scheduled_time || '99:99').localeCompare(b.scheduled_time || '99:99') || rank[a.urgency || 'medium'] - rank[b.urgency || 'medium'];
  });
  if (scheduled[0]) suggestions.push({ kind: 'task', label: scheduled[0].title, reason: scheduled[0].scheduled_time ? `Planned for ${scheduled[0].scheduled_time}; ask about its current status.` : 'From the accepted plan; check timing and readiness.' });
  if (!suggestions.length) suggestions.push({ kind: 'planning', label: today.checkin?.accepted ? 'Review today’s plan' : 'Plan the day', reason: 'You can choose tasks, meals, or the grocery list.' });
  return { greeting, period, local_time, local_date: today.local_date, suggestions: suggestions.slice(0, 2) };
}
