import { dateInZone } from '../shared/contracts.js';
import { dailyRhythm } from '../shared/daily-context.js';
import { localDateTimeWithOffset } from '../shared/local-time.js';
import { defaultIntakeTiming, type IntakeTiming } from '../shared/intake-timing.js';

export interface IntakePromptFact {id:string;revision:number;occurred_at:Date|string;intake_kind:string}
export interface PromptSource {key:string;version:string;due:Date;text:string}

/** Missing reports are uncertainty. The preferred day window is not observed wakefulness. */
export function foodCheckSource(now:Date,zone:string,intakes:IntakePromptFact[],timing:IntakeTiming=defaultIntakeTiming):PromptSource|null {
 const day=dateInZone(now,zone),start=localDateTimeWithOffset(`${day}T${dailyRhythm.morning_start}`,zone);
 if(!start.ok||now.getTime()<Date.parse(start.value))return null;
 const latest=intakes.filter(row=>new Date(row.occurred_at)<=now).sort((a,b)=>+new Date(b.occurred_at)-+new Date(a.occurred_at)||a.id.localeCompare(b.id))[0];
 const baseline=Math.max(Date.parse(start.value),latest?+new Date(latest.occurred_at):0);
 return {key:`food:${day}`,version:`${latest?`${latest.id}:${latest.revision}:${new Date(latest.occurred_at).toISOString()}`:`unknown:${day}`}:interval:${timing.intake_report_check_minutes}`,
  due:new Date(baseline+timing.intake_report_check_minutes*60_000),
  text:'I do not have a recent food report. Have you eaten anything since we last checked?'};
}

/** A plan is never intake; only an actual full meal or unclear recent intake blocks another meal suggestion. */
export function suppressMealPrompt(now:Date,intakes:IntakePromptFact[],timing:IntakeTiming=defaultIntakeTiming):boolean {
 return intakes.some(row=>['full_meal','unknown'].includes(row.intake_kind)&&+new Date(row.occurred_at)<=+now&&+now-+new Date(row.occurred_at)<timing.full_meal_spacing_minutes*60_000);
}
