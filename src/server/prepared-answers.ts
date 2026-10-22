import{dateInZone,type Today}from'../shared/contracts.js';
import type{TurnPreparation}from'./prepared-context.js';
const normalized=(text:string)=>text.toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
/** Quote only unambiguous saved/reference facts. No diagnosis, calculation of a diet or care write. */
export function preparedFactReply(text:string,preparation:TurnPreparation,today:Today,microsoftConfigured:boolean):string|undefined{
 if(preparation.mode==='full')return;
 if(preparation.mode==='schedule'){
  if(/\boutlook\b/i.test(text)&&!microsoftConfigured)return 'Outlook isn’t connected here, so I can’t check that calendar.';
  if(!/\b(what time|when)\b/i.test(text)||/\b(outlook|tomorrow|yesterday|next|last|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\d{4}-\d{2}-\d{2}/i.test(text)||!today.profile)return;
  if((today.appointment_context?.omitted_count??0)>0)return;
  const question=' '+normalized(text)+' ',all=today.appointments??[];
  if((today.appointment_context?.total_count??all.length)!==all.length)return;
  const named=all.filter(item=>question.includes(' '+normalized(item.title)+' '));
  const remaining=normalized(named.length===1?question.replace(' '+normalized(named[0].title)+' ',' '):question).split(' ');
  const allowed=new Set(['what','time','is','are','my','the','our','this','that','appointment','today','and','when','does','it','end','ends','start','starts','finish','until']);
  if(remaining.some(word=>!allowed.has(word)))return;
  const matches=named.length?named:all.length===1?all:[];
  if(matches.length!==1)return;
  const item=matches[0],start=new Date(item.starts_at),zone=today.profile.time_zone;
  if(!Number.isFinite(start.getTime())||dateInZone(start,zone)!==today.local_date)return;
  const format=(date:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,hour:'numeric',minute:'2-digit',hour12:true}).format(date);
  if(/\b(end|ends|until|finish)\b/i.test(text)){
   if(!item.duration_minutes)return `It starts today at ${format(start)}; the end time hasn’t been saved.`;
   if(!Number.isFinite(item.duration_minutes)||item.duration_minutes<1||item.duration_minutes>1440)return;
   const end=new Date(start.getTime()+item.duration_minutes*60000);if(dateInZone(end,zone)!==today.local_date)return;
   return `Today, from ${format(start)} to ${format(end)}, your local time.`;
  }
  return `Today at ${format(start)}, your local time.`;
 }
 if(preparation.mode!=='recipe'||preparation.details?.items.length!==1||/\b(diabet\w*|carbs?|calories?|protein|safe|allerg\w*|medicin\w*|dose|replace|swap|substitut\w*|instead|double|half|scale|adjust)\b/i.test(text))return;
 const recipe=preparation.details.items[0];if(recipe.yieldServings!==1||/\bfor (two|three|four|[2-9]\d*)\b/i.test(text))return;
 const query=/how (?:many|much) (grams?|g|millilit(?:er|re)s?|ml)(?: of)?\s+(.+?)(?:\s+(?:it\s+|the recipe\s+)?(?:uses?|used|does|are)\b|\s+for\b|\s+in\b|[?.!]|$)/i.exec(text);
 if(!query)return;
 const wanted=query[2].split(/\s*(?:,|\band\b|&)\s*/i).map(normalized);if(!wanted.length||wanted.length>3)return;
 const unit=/^(g|gram)/i.test(query[1])?'g':'ml';
 const section=recipe.recipeYaml.split('ingredients:\n')[1]?.split(/\n[a-z_]+:/)[0]??'';
 const items=[...section.matchAll(/^  ([a-z_]+):\s*\{qty:\s*([0-9]+(?:\.[0-9]+)?),\s*unit:\s*([a-z]+),\s*state:\s*([a-z_]+)\}/gm)].map(match=>({name:match[1].replaceAll('_',' '),amount:Number(match[2]),unit:match[3],state:match[4].replaceAll('_',' ')}));
 const chosen=wanted.map(name=>{const words=name.split(' ').filter(word=>word!=='the');const matches=items.filter(item=>item.unit===unit&&words.length&&words.every(word=>(' '+item.name+' '+item.state+' ').includes(' '+word+' ')));return matches.length===1?matches[0]:undefined;});
 if(chosen.some(item=>!item||!Number.isFinite(item.amount)||item.amount<=0)||new Set(chosen).size!==chosen.length)return;
 const answer=`For one serving: ${chosen.map(item=>`${item!.amount} ${unit==='g'?'grams':'millilitres'} of ${item!.state==='dry'?'dry ':''}${item!.name}`).join(' and ')}.`;
 return answer.length<=500?answer:undefined;
}
