import {z} from 'zod';
import {preparedMealPolicy,PreparedMealError,validateMealSelection,renderPreparedMeals,mealSlots,type MealSlot, type mealPreparationMaterial} from './prepared-meals.js';
import type {NutritionRecipe,NutritionReference} from './nutrition-reference.js';
import {spokenReplyGuidance} from './spoken-replies.js';

const clean=(text:string)=>text.replaceAll('’',"'").toLowerCase().replace(/[.!?,]/g,' ').replace(/\s+/g,' ').trim();
export const dialogueChatReplies={
 greeting:'Hi, what would you like to talk about?',
 thanks:'You’re welcome. What would you like to talk about next?',
 lost:'That’s frustrating. Tell me one word or idea you remember, and we can pick it up from there.',
 bored:'We could talk about music or a favourite memory. What sounds good?',
 lonely:'I’m here with you. Would you like to tell me about someone or something you miss?',
} as const;
export function isSimpleGreeting(text:string){return /^(?:hi|hello|good morning|good evening)(?: nancy)?$/.test(clean(text));}
/** Exact whole messages only: additional facts, symptoms and care intent cannot be swallowed. */
export function dialogueChatReply(text:string){
 const question=clean(text);
 if(isSimpleGreeting(text))return dialogueChatReplies.greeting;
 if(/^(?:thanks|thank you)(?: nancy)?$/.test(question))return dialogueChatReplies.thanks;
 if(/^(?:i(?:'ve| have)? lost my train of thought|i lost what i was saying|i forgot what i was saying|these (?:long )?pauses are frustrating(?: i lose my train of thought while waiting(?: for you)?)?)$/.test(question))return dialogueChatReplies.lost;
 if(/^i(?:'m| am) bored(?: today)?$/.test(question))return dialogueChatReplies.bored;
 if(/^i(?:'m| am) lonely(?: today)?$/.test(question))return dialogueChatReplies.lonely;
}
/** Same Nancy agent/account, one no-tool preparation, with a bounded second choice. */
export const dialogueMealPreparationPolicy=preparedMealPolicy.replace('each a supplied matching-category ID or null if no supplied choice meets a stated constraint.','each an array of one or two distinct supplied matching-category IDs ranked by preference, or null if none meets a stated constraint.')+' Return two choices whenever two supplied recipes fit the stated constraints. Return only one if no second supplied recipe fits; never omit a fitting alternative merely to shorten the JSON. Do not force a second choice that violates a restriction.';
const candidate=z.array(z.string()).min(1).max(2).refine(ids=>new Set(ids).size===ids.length).nullable();
const selection=z.object({breakfast:candidate,lunch:candidate,dinner:candidate}).strict();
export function validateDialogueMeals(text:string,material:ReturnType<typeof mealPreparationMaterial>,facts:unknown){
 let parsed:z.infer<typeof selection>;try{parsed=selection.parse(JSON.parse(text));}catch{throw new PreparedMealError('invalid_selection');}
 const first=Object.fromEntries(mealSlots.map(slot=>[slot,parsed[slot]?.[0]??null]));
 const choices=validateMealSelection(JSON.stringify(first),material,facts),options={} as Record<MealSlot,NutritionRecipe[]>;
 for(const slot of mealSlots)options[slot]=parsed[slot]!.map(id=>validateMealSelection(JSON.stringify({...first,[slot]:id}),material,facts)[slot]);
 return {choices,options};
}
export interface MealThread {
 key:string;expires:number;reference:NutritionReference;choices:Record<MealSlot,NutritionRecipe>;
 options:Record<MealSlot,NutritionRecipe[]>;used:Record<MealSlot,string[]>;lastSlot?:MealSlot;
 pending?:MealFollowup['kind'];audio:Map<string,Buffer>;
}
export interface MealFollowup {kind:'repeat'|'alternative'|'why'|'ingredients'|'steps';slot?:MealSlot}
/** Anchored grammar. New restrictions, numbers, health/safety questions and actions miss. */
export function mealFollowup(text:string,thread:MealThread):MealFollowup|undefined{
 const q=clean(text).replace(/^please /,'');
 const slot='(breakfast|lunch|dinner)';let match:RegExpMatchArray|null;
 if((match=q.match(new RegExp('^'+slot+'$'))))return{kind:thread.pending??'repeat',slot:match[1] as MealSlot};
 if((match=q.match(new RegExp('^(?:what about|and|remind me about|what did you (?:suggest|recommend) for|what was (?:the|your) (?:suggestion|recommendation) for) (?:the )?'+slot+'$'))))return{kind:'repeat',slot:match[1] as MealSlot};
 if((match=q.match(new RegExp('^(?:suggest |recommend |can i have |could i have )?(?:another|a different|a second) '+slot+'(?: idea| option)?$'))))return{kind:'alternative',slot:match[1] as MealSlot};
 if(/^(?:something else|another one|a different one)$/.test(q))return{kind:'alternative',slot:thread.lastSlot};
 if((match=q.match(new RegExp('^why (?:did you )?(?:pick|choose|suggest|recommend) (?:that|this)(?: '+slot+')?$'))))return{kind:'why',slot:(match[1] as MealSlot|undefined)??thread.lastSlot};
 if((match=q.match(new RegExp('^(?:what are (?:the )?ingredients (?:in|for)|what is in|what goes into) (?:that |this |the )?'+slot+'(?: recipe| idea)?$'))))return{kind:'ingredients',slot:match[1] as MealSlot};
 if((match=q.match(new RegExp('^how do i (?:make|prepare) (?:that |this |the )?'+slot+'(?: recipe| idea)?$'))))return{kind:'steps',slot:match[1] as MealSlot};
 if(/^(?:what are (?:the )?ingredients|what is in it|what goes into it)$/.test(q))return{kind:'ingredients',slot:thread.lastSlot};
 if(/^(?:how do i (?:make|prepare) (?:it|that|this)|what are (?:the )?(?:steps|instructions))$/.test(q))return{kind:'steps',slot:thread.lastSlot};
}
export function mealFollowupReply(request:MealFollowup,thread:MealThread):{text:string;recipe?:NutritionRecipe;selected?:NutritionRecipe}|undefined{
 if(!request.slot){thread.pending=request.kind;return{text:'Which meal do you mean: breakfast, lunch, or dinner?'};}
 const slot=request.slot,recipe=thread.choices[slot];
 let answer:string,selected:NutritionRecipe|undefined;
 if(request.kind==='alternative'){
  selected=thread.options[slot].find(item=>!thread.used[slot].includes(item.id));
  if(!selected)return; // Discovery continues on the existing model/source route.
  answer=renderPreparedMeals({...thread.choices,[slot]:selected},[slot]);
 }else if(request.kind==='repeat')answer=renderPreparedMeals(thread.choices,[slot]);
 else if(request.kind==='why'){
  const rendered=renderPreparedMeals(thread.choices,[slot]);
  if(!rendered.includes(' These include '))return;
  answer=`${rendered} These are food ideas, not a prescribed diet.`;
 }else if(request.kind==='steps'){
  const section=recipe.recipeYaml.split('steps:\n')[1]?.split(/\n[a-z_]+:/)[0];
  const lines=section?.split('\n').filter(line=>line.trim());
  if(!lines?.length||lines.some(line=>!line.startsWith('  - ')))return;
  answer=`The recipe says: ${lines.map(line=>line.slice(4)).join(' ')} Check ingredient labels and cross-contact.`;
 }else{
  if(recipe.yieldServings!==1)return;
  const section=recipe.recipeYaml.split('ingredients:\n')[1]?.split(/\n[a-z_]+:/)[0];
  const lines=section?.split('\n').filter(line=>line.trim());
  if(!lines?.length)return;
  const ingredients=lines.map(line=>/^  ([a-z0-9_]+): \{qty: ([0-9.]+), unit: ([a-z_]+), state: ([a-z0-9_]+)\}$/.exec(line));
  if(ingredients.some(item=>!item))return;
  const units:Record<string,string>={g:'grams',ml:'millilitres',tsp:'teaspoons',tbsp:'tablespoons'};
  answer=`For one serving, ${recipe.title} lists: ${ingredients.map(item=>`${item![2]} ${units[item![3]]??item![3]} of ${item![4].replaceAll('_',' ')} ${item![1].replaceAll('_',' ')}`).join('; ')}. Check ingredient labels and cross-contact.`;
 }
 if(answer.length>1200)return;
 return{text:answer,recipe:selected??recipe,selected};
}
/** Short trusted read-only policy; preserve full history and fresh safety/identity facts. */
export const dialogueConversationGuidance=spokenReplyGuidance('conversation','')!+'\nBegin with a substantive first sentence of at most eight words and about 55 characters, then one short explanatory sentence or useful question if needed. The opening must answer the question or offer a concrete continuation. Never add filler, a stall or a generic acknowledgement just to speak early. Preserve needed safety information and explanation.';
