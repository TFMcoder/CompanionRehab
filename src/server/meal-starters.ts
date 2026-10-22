import type {NutritionReference,MealCategory,NutritionReferenceResult,RecipeSummary,NutritionRecipe} from './nutrition-reference.js';
/** Deterministic repository retrieval before the first model round, never a clinical decision. */
export function mealStarterReferences(text:string,reference:NutritionReference,completeChoices=false){
 if(!/\b(recommend|suggest|ideas?|options?|choose|cook|make|plan|planning)\b|what\b.{0,45}\b(eat|have)\b/i.test(text)||!/\b(meals?|breakfast|lunch|dinner|snacks?|food|eat|recipes?)\b/i.test(text))return [];
 const categories=(['breakfast','lunch','dinner','snack'] as MealCategory[]).filter(slot=>new RegExp(`\\b${slot}s?\\b`,'i').test(text));
 const slots=categories.length?categories.slice(0,3):['breakfast','lunch','dinner'] as MealCategory[];
 return [reference.getClaims(['C02','C10']),...slots.flatMap<NutritionReferenceResult<RecipeSummary|NutritionRecipe>>(category=>completeChoices?
  reference.listRecipes({category,limit:5}).items.map(recipe=>reference.getRecipes([recipe.id])):[reference.recipeOptions({category,limit:2})])];
}
/** Supply choice facts, not three repeated source envelopes and full cooking instructions. */
export function mealStarterContext(results:ReturnType<typeof mealStarterReferences>,includeIngredients=false){
 return {sources:[...new Set(results.flatMap(result=>result.sources.map(source=>source.documentId)))],
  limitations:[...new Set(results.flatMap(result=>result.limitations))],
  items:results.flatMap(result=>result.items.map(item=>'category' in item?
   {id:item.id,title:item.title,category:item.category,active_minutes:item.activeMinutes,allergens:item.allergens,carb_sources:item.carbSources,status:item.status,...(includeIngredients&&'recipeYaml'in item?{ingredient_names:String(item.recipeYaml).split('ingredients:\n')[1]?.split('\nsteps:')[0].split('\n').flatMap(line=>/^  ([a-z0-9_]+): \{qty:/.exec(line)?.[1]??[])}:{})}:
   {id:item.id,title:item.title,interpretation:item.allowedInterpretation,limitation:item.limitation})),
  detail_policy:'These are repository choice summaries, not approved meals or a prescribed diet. Retrieve exact recipe details before giving quantities, nutrition numbers or cooking instructions. Client-specific allergies, portions and clinical instructions remain separate.',
 };
}
