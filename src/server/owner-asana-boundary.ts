import type {Today} from '../shared/contracts.js';

/** Capability wording only: it makes no claim about a past action or source read. */
export const ownerAsanaBoundaryReply = 'Changes you confirm for imported Asana tasks are saved in Nancy only. This sandbox connection is read-only, so Nancy does not change tasks in Asana.';

const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
const dayWords=['one|first','two|second','three|third','four|fourth','five|fifth','six|sixth','seven|seventh','eight|eighth','nine|ninth','ten|tenth','eleven|eleventh','twelve|twelfth','thirteen|thirteenth','fourteen|fourteenth','fifteen|fifteenth','sixteen|sixteenth','seventeen|seventeenth','eighteen|eighteenth','nineteen|nineteenth','twenty|twentieth','twenty one|twenty first','twenty two|twenty second','twenty three|twenty third','twenty four|twenty fourth','twenty five|twenty fifth','twenty six|twenty sixth','twenty seven|twenty seventh','twenty eight|twenty eighth','twenty nine|twenty ninth','thirty|thirtieth','thirty one|thirty first'];

function unchangedGroceryDates(phrase:string,today:Today):boolean {
  const tasks=today.tasks.filter(task=>/\bgrocer(?:y|ies)\b/i.test(task.title)),dates=tasks.map(task=>task.scheduled_date);
  if(dates.length!==2||dates.some(date=>!date||date.slice(0,4)!==today.local_date.slice(0,4)))return false;
  // Definitions alone cannot establish that keeping a date is a no-op. An
  // accepted/activity schedule may have changed independently. Conservatively
  // retain the full workflow whenever a matching task has any explicit timing,
  // or the fresh ledger is absent; the bare capability question still matches.
  const ledger=today.activity_ledger,ids=new Set(tasks.map(task=>task.id));
  if(!ledger||ledger.local_date!==today.local_date||tasks.some(task=>!!task.scheduled_time))return false;
  const planTasks=[...(today.checkin?.accepted?.tasks??[]),...(today.checkin?.proposal?.tasks??[])];
  if(planTasks.some(task=>ids.has(task.id)&&(!!task.scheduled_time||!!task.scheduled_date&&task.scheduled_date!==tasks.find(definition=>definition.id===task.id)?.scheduled_date)))return false;
  if([...ledger.options,...ledger.entries,...ledger.recent_entries].some(activity=>activity.kind==='task'&&activity.source_id!==null&&ids.has(activity.source_id)&&activity.scheduled_at!==null))return false;
  let value=phrase.replaceAll('-',' ').replaceAll(',','').replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/g,'$1');
  // Longest forms first: "twenty sixth" must not become "twenty 6".
  const forms=dayWords.flatMap((words,index)=>words.split('|').map(word=>({word,day:index+1}))).sort((a,b)=>b.word.length-a.word.length);
  for(const {word,day} of forms)value=value.replace(new RegExp('\\b'+word+'\\b','g'),String(day));
  value=value.replace(/\b(jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/g,short=>months.find(month=>month.startsWith(short==='sept'?'sep':short))!);
  const match=/^([a-z]+) (\d{1,2})(?: (\d{4}))? and (?:([a-z]+) )?(\d{1,2})(?: (\d{4}))?$/.exec(value);
  if(!match)return false;
  const year=today.local_date.slice(0,4);
  const makeDate=(month:string,day:string,explicitYear?:string)=>{
    const monthIndex=months.indexOf(month);
    if(monthIndex<0||Number(day)<1||Number(day)>31||explicitYear&&explicitYear!==year)return;
    const result=`${year}-${String(monthIndex+1).padStart(2,'0')}-${day.padStart(2,'0')}`;
    return new Date(result+'T12:00:00Z').toISOString().slice(0,10)===result?result:undefined;
  };
  const requested=[makeDate(match[1],match[2],match[3]),makeDate(match[4]??match[1],match[5],match[6])];
  return requested.every(Boolean)&&JSON.stringify(requested.sort())===JSON.stringify(dates.sort());
}

/** Whole-utterance, read-only capability questions. Unknown clauses retain Nancy's full workflow. */
export function ownerAsanaBoundaryQuestion(text:string,today:Today):boolean {
  if(text.length>500||/["“”`\r\n]/.test(text))return false;
  let question=text.normalize('NFKC').toLowerCase().replaceAll('’',"'").trim();
  if(question.startsWith("'")||question.endsWith("'"))return false;
  const keep=/^(?:please[, ]+)?(?:keep|leave) both (?:imported )?grocery tasks (?:on|dated) (.+?)(?:[.!]\s*|\s+)(?=(?:did|does|do|are|is|will)\b)(.+)$/.exec(question);
  if(keep){if(!unchangedGroceryDates(keep[1].trim(),today))return false;question=keep[2];}
  question=question.replaceAll(',','').replace(/[.!?]+$/,'').replace(/\s+/g,' ').trim();
  if(!/\basana\b/.test(question))return false;
  return [
    /^(?:did|do|will) (?:these|those|the|my|our) (?:task )?(?:changes|updates) (?:also )?(?:update|change|affect) asana(?: (?:or (?:only|just) nancy|or nancy only|too|as well))?$/,
    /^did (?:this|that) (?:update|change|affect) asana(?: or (?:(?:only|just) nancy|nancy only))?$/,
    /^are (?:these|those|the|my|our) (?:task )?(?:changes|updates) (?:saved |made )?(?:in|to) (?:only nancy|nancy only|nancy)(?: or (?:also )?asana)?$/,
    /^(?:does|will) nancy (?:also )?(?:update|change|write back to) (?:my )?asana(?: tasks)?(?: when i (?:complete|reschedule|finish|change) (?:a|my) task)?$/,
    /^is (?:this |the )?(?:asana (?:sandbox )?connection|connection to asana) read[ -]?only$/,
    /^are (?:nancy task changes|changes (?:made|saved) (?:here|in nancy)) (?:also )?(?:saved|sent|written) (?:back )?to asana$/,
    /^does (?:marking (?:a|my) task (?:done|complete)|rescheduling (?:a|my) task|completing (?:a|my) task) (?:here|in nancy) (?:also )?(?:update|change) asana$/,
    /^will changing (?:a|my) task (?:here|in nancy) (?:also )?change it in asana$/,
    /^what happens in asana when i (?:complete|reschedule|finish|change) (?:a|my) task (?:here|in nancy)$/,
  ].some(pattern=>pattern.test(question));
}
