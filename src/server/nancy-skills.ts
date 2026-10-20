import { readFileSync } from 'node:fs';

export const nancySkillIds = ['planning', 'meals', 'tasks', 'preferences', 'continuity'] as const;
export type NancySkillId = typeof nancySkillIds[number];
export interface NancyGuidance { skills: readonly NancySkillId[]; nutrition: boolean }

function trustedFile(path: string, header: string) {
  const text = readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n').trim();
  if (!text.startsWith(header + '\n') || text.length > 4000) throw new Error('Nancy trusted guidance is missing or invalid.');
  return text;
}
// Fixed application-owned files, loaded once. Human/tool text can never supply a path.
const core = trustedFile('./nancy-policy/core.md', '# Nancy core v2');
const skills: Readonly<Record<NancySkillId, string>> = Object.freeze({
  planning: trustedFile('./nancy-policy/planning.md', '# Nancy skill: planning v1'),
  meals: trustedFile('./nancy-policy/meals.md', '# Nancy skill: meals v2'),
  tasks: trustedFile('./nancy-policy/tasks.md', '# Nancy skill: tasks v1'),
  preferences: trustedFile('./nancy-policy/preferences.md', '# Nancy skill: preferences v1'),
  continuity: trustedFile('./nancy-policy/continuity.md', '# Nancy skill: continuity v1'),
});
const ordered = (ids: Iterable<NancySkillId>) => { const chosen = new Set(ids); return nancySkillIds.filter(id => chosen.has(id)); };

/** Select instruction expansions only. This does not select tools or confer authority. */
export function selectNancyGuidance(text: string): NancyGuidance {
  const input = text.toLowerCase().slice(0, 2000), selected = new Set<NancySkillId>();
  if (/\b(plan|planning|schedule|morning routine|dinner preparation|what(?:'s| is) next|do next)\b/.test(input)) selected.add('planning');
  if (/\b(meal|meals|breakfast|lunch|dinner|snack|snacks|food|ate|eaten|eating|portion|recipe|recipes|grocery|groceries|ingredients?)\b/.test(input)) selected.add('meals');
  if (/\b(tasks?|requests?|work|working|focus|pause|resume|finish|break|exercise|rehab|capacity|routine|snooze|decline|check-in)\b/.test(input)) selected.add('tasks');
  if (/\b(prefer|prefers|preference|preferences|call me|call you|call myself)\b/.test(input)) selected.add('preferences');
  if (/\b(remember|remembered|handoff|important event|significant|carry forward|unresolved|context note)\b/.test(input)) selected.add('continuity');
  // Follow-ups such as “yes”, “that one” and unexpected phrasing retain broad guidance.
  if (!selected.size) return { skills: [...nancySkillIds], nutrition: true };
  const nutrition = /\b(nutrition|nutrients?|healthy|protein|carbohydrates?|recipes?|ingredients?|substitut\w*|allerg\w*)\b/.test(input)
    || selected.has('meals') && /\b(suggest|recommend|choose|choices|options|cook|make|ideas)\b/.test(input);
  return { skills: ordered(selected), nutrition };
}

/** Enrich the next already-required round after an authorized tool family is observed. */
export function addNancyToolGuidance(current: NancyGuidance, name: string, args: unknown): NancyGuidance {
  const selected = new Set(current.skills);
  let nutrition = current.nutrition;
  const input = args && typeof args === 'object' ? args as Record<string, unknown> : {};
  if (['propose_day_plan', 'revise_day_plan', 'review_day_plan', 'get_daily_brief', 'get_day_plan', 'get_priority_context'].includes(name)) selected.add('planning');
  if (name === 'prepare_preference') selected.add('preferences');
  if (name === 'prepare_significant_handoff') selected.add('continuity');
  if (['prepare_activity_record', 'prepare_activity_correction', 'prepare_activity_reschedule', 'get_activity_ledger', 'get_activity_receipt'].includes(name)) { selected.add('meals'); selected.add('tasks'); }
  if (['suggest_grocery', 'get_grocery_list', 'get_nutrition_reference'].includes(name)) selected.add('meals');
  if (name === 'get_nutrition_reference') nutrition = true;
  if (['get_task_requests', 'review_task_request', 'prepare_request_action'].includes(name)) selected.add('tasks');
  if (['get_local_workflow', 'get_local_action_schema', 'prepare_local_action'].includes(name)) {
    const family = name === 'get_local_workflow' ? input.section : input.family;
    if (family === 'meals') selected.add('meals');
    if (family === 'programs') selected.add('tasks');
    if (family === 'day') {
      selected.add('planning'); selected.add('continuity');
      const command = input.command && typeof input.command === 'object' ? input.command as Record<string, unknown> : {};
      const action = name === 'get_local_action_schema' ? input.action : command.type;
      if (action === 'set_intake_timing') selected.add('meals');
      if (name === 'get_local_workflow' || ['start_task_focus', 'pause_task_focus', 'resume_task_focus', 'finish_task_focus', 'respond_prompt'].includes(String(action))) selected.add('tasks');
    }
  }
  return { skills: ordered(selected), nutrition };
}

/** Pure composition after the fixed trusted files have loaded; no care reads or model routing. */
export function composeNancyGuidance(selection: NancyGuidance, nutritionAuthority: string) {
  return [core, ...ordered(selection.skills).map(id => skills[id]), ...(selection.nutrition ? [nutritionAuthority] : [])].join('\n\n');
}
