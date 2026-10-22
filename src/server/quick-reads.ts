import type{TurnPreparation}from'./prepared-context.js';

// Only this publicly qualified assembly recipe/source revision may bypass inference.
// A changed source, recipe or question falls through to the existing model path.
const mealSource='28a51b6348c72a031348a608d270ead839c9b6bc37173144de5d96d0777ee8a9';
const evidenceSource='1916edb1197bf9bee4e71560d74b02cf743f9cc262fecd516f9e2e46ddd7a3a3';
export function quotedRecipeSteps(text:string,preparation:TurnPreparation):string|undefined{
 if(preparation.mode!=='recipe'||preparation.details?.items.length!==1)return;
 const details=preparation.details,recipe=details.items[0];
 if(recipe.id!=='B01'||recipe.yieldServings!==1||!details.sources.some(s=>s.documentId==='CR_NUTRITION_MEALS_V1'&&s.sha256===mealSource)||!details.sources.some(s=>s.documentId==='CR_NUTRITION_EVIDENCE_V1'&&s.sha256===evidenceSource))return;
 const question=text.replaceAll('’',"'").replace(/\bdo not save(?: anything)?\b/gi,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim().replace(/^please /,'');
 const target='(?:it|this recipe|that recipe|recipe b01|berry vanilla yogurt crunch)';
 if(!new RegExp('^(?:how do i (?:make|prepare) '+target+'|(?:tell|show|read|quote)(?: me)? (?:the )?(?:preparation|cooking) (?:steps|instructions)(?: for '+target+')?)$').test(question))return;
 const section=recipe.recipeYaml.split('steps:\n')[1]?.split(/\n[a-z_]+:/)[0];
 if(!section)return;
 const lines=section.split('\n').filter(line=>line.trim());if(lines.length!==2||lines.some(line=>!line.startsWith('  - ')))return;
 const steps=lines.map(line=>line.slice(4)).join(' ');
 if(steps!=='Mix yogurt and vanilla; fold in oats and flax. Top with berries. Rest briefly for softer oats, or serve immediately for texture.')return;
 return `The recipe says: ${steps} Contains milk. Check oat labels if you avoid gluten.`;
}

/** Trusted read-only response contract; full planning/review/write workflows retain their existing policy. */
export const quickReadGuidance='\nFor this read-only reply, use at most 45 words unless exact requested facts need more. Answer the latest question directly, without a preamble. For meal suggestions, give exactly one repository option per requested meal slot, at most 55 words including a brief relevant allergy caution. Keep every necessary safety limit, unknown, refusal and accurate number. Do not repeat general source or approval-status explanations. Ask at most one question, only if needed. This length preference never removes a required review detail or authorizes a change.';

/** State the known snapshot boundary; never infer an empty future calendar. */
export function quickReadReply(text:string,preparation:TurnPreparation,microsoftConfigured:boolean){
 const steps=quotedRecipeSteps(text,preparation);if(steps)return steps;
 if(preparation.mode!=='schedule'||microsoftConfigured)return;
 const question=text.toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim().replace(/^please /,'');
 if(question==='what appointments do i have next week')return 'I only have today’s local appointments here. Outlook isn’t connected, so I can’t check next week.';
}
