import type {NutritionReference} from './nutrition-reference.js';
/** Preserve the complete care/safety workflow; this classifier makes no diagnosis. */
export function requiresClinicalFoodContext(text:string){return /\b(hypoglyc\w*|hyperglyc\w*|low blood sugar|blood sugar is low|glucose is low|insulin|metformin|medic\w*|dos\w*|symptoms?|shak(?:y|ing)|faint\w*|dizz\w*|unconscious|chest pain|trouble breathing|shortness of breath)\b/i.test(text)||/\b(blood sugar|glucose)\b.{0,24}\d/i.test(text);}
/** Food/evidence questions need research, without forcing another recipe. */
export function isNutritionQuestion(text:string){
 return /\b(nutrition\w*|nutrients?|diet\w*|carbohydrat\w*|carbs?|fib(?:er|re)|glyc\w*|blood sugar|diabet\w*|whole grains?|whole fruit|resistant starch|fasting|ketogenic|keto|mediterranean|protein|portions?|rice|potatoes?|pasta|bread|oats?|lentils?|beans|vegetables?|fruit|juice|sugar|snacks?|meals?|breakfast|lunch|dinner|recipes?|ingredients?|eat|eating|drink|drinking|cheese|milk|dairy|yog(?:h)?urt|eggs?|chicken|fish|meat|nuts?|quinoa|salt|sodium|fats?|cholesterol|calories)\b/i.test(text)
  &&/\b(what|why|how|which|is|are|can|could|should|does|do|explain|tell me|healthy|healthier|better|safe|okay|ok|suitable|compare|suggest|recommend|ideas?)\b/i.test(text);
}
/** An unrecognized suitability question keeps full tools instead of losing food research in chat. */
export function isUnclearSuitabilityQuestion(text:string){return /\b(is|are|can|could|should|would|does|do|what|how|explain)\b/i.test(text)&&/\b(healthy|healthier|unhealthy|safe|suitable|okay|good for me|bad for me)\b/i.test(text);}
export function nutritionQuestionReferences(text:string,reference:NutritionReference){
 if(requiresClinicalFoodContext(text))return;
 if(!isNutritionQuestion(text))return;
 // A broad research/index question must not acquire arbitrary default claims.
 if(!/\b(fib(?:er|re)|carb\w*|grains?|rice|potatoes?|pasta|bread|oats?|lentils?|beans|vegetables?|fruit|juice|sugar|food|meals?|breakfast|lunch|dinner|snacks?|fast\w*|eating window|time restricted|keto\w*|ketosis|cool\w*|reheat\w*|resistant starch|meal order|psyllium|viscous|supplements?|mediterranean)\b/i.test(text))return;
 const ids=/\b(fast\w*|eating window|time restricted)\b/i.test(text)?['C08','C09']
  :/\b(keto\w*|ketosis)\b/i.test(text)?['C05','C06']
  :/\b(cool\w*|reheat\w*|resistant starch|meal order)\b/i.test(text)?['C11','C04']
  :/\b(fruit|juice)\b/i.test(text)?['C10','C02']
  :/\b(psyllium|viscous|supplements?)\b/i.test(text)?['C03','C02']
  :/\b(mediterranean)\b/i.test(text)?['C07','C02']:['C02','C04'];
 return reference.getClaims(ids);
}
export const nutritionQuestionPolicy='Answer the actual food or nutrition question using the supplied repository_nutrition_evidence, its allowed interpretation and limitations. Do not turn an explanation or suitability question into a new recipe unless requested. Consider fresh confirmed personal context and approved instructions; the reference scope does not establish this person’s diagnosis. Do not invent nutrient totals, prescribed portions or glucose targets, promise a recipe treats diabetes, change medicines or recommend unsupervised fasting. Unsupported details remain unknown; retrieve a missing claim if necessary. Keep source identifiers in response metadata rather than reciting them. Do not repeat a settled allergy question without a relevant conflict.';
