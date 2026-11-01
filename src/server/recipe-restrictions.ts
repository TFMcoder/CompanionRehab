import type {NutritionRecipe} from './nutrition-reference.js';
import {ApiError} from './errors.js';
/** Conservative checks supplement selection; they never certify clinical suitability. */
export function assertRecipeRestrictions(recipes:NutritionRecipe[],facts:unknown){
 const preferences=JSON.stringify(facts).toLowerCase();
 for(const recipe of recipes){
  const ingredients=recipe.recipeYaml.split('ingredients:\n')[1]?.split('\nsteps:')[0]??'';
  const avoid=new Set<string>();
  for(const food of ['peanut','yogurt','milk','egg','fish','shellfish','soy','sesame','wheat','gluten','almond','walnut']){
   if(new RegExp(`\\b${food}s?\\b`).test(preferences)&&(food==='peanut'||new RegExp(`(?:no|avoid|dislikes?|allerg\\w* to) ${food}|${food} allerg`).test(preferences)))avoid.add(food);
  }
  if(/\b(vegetarian|vegan)\b/.test(preferences))for(const food of ['beef','chicken','turkey','pork','salmon','tuna','fish','shrimp','gelatin','parmesan'])avoid.add(food);
  if(/\bvegan\b/.test(preferences))for(const food of ['egg','milk','yogurt','cheese','butter','honey'])avoid.add(food);
  const foodText=(recipe.title+' '+ingredients+' '+recipe.allergens.join(' ')).toLowerCase().replaceAll('_',' ');
  for(const food of avoid)if(new RegExp(`\\b${food}s?\\b`).test(foodText))throw new ApiError(400,'conflicting_selection','That recipe conflicts with the saved food restrictions.');
 }
}
