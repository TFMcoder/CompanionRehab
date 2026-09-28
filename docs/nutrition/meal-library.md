---
schema_version: "1.0"
document_id: CR_NUTRITION_MEALS_V1
updated: "2026-09-28"
status: reference_templates_not_approved_patient_protocols
scope: adult_meal_and_grocery_planning
recipe_count: 20
categories: {breakfast: 5, lunch: 5, snack: 5, dinner: 5}
recipe_version: "1.0"
companion_document: research-knowledge-base.md
nutrition_values_status: not_calculated
---

# Meal library: familiar food, practical portions

Twenty original recipes for planning and grocery drafts: five breakfasts, five lunches, five snacks and five dinners. These are options, not a mandatory rotation, a fixed-calorie diet or clinically tested recipes. Fiber-rich foods inform the pattern; no particular recipe is claimed to lower HbA1c or cause remission. See [research and decision rules](research-knowledge-base.md), especially C02-C05 and [R03](research-knowledge-base.md#r03).

## Agent contract

- Follow the current, privately stored, human-approved `MealProtocol` and permissions in [MVP](../MVP.md). This file is reference material, not approval to change care.
- Confirm the participant's own allergies, intolerances, swallowing/texture requirements, preferences, kitchen assistance and approved nutrition targets. Do not import a relative's health information or assume unknown means none.
- Offer two appealing choices at a time. Preserve familiar flavors and adequate food; do not make every substitution lower-calorie. Ask whether an option sounds good, and record taste feedback only in the authorized private system.
- A breakfast + lunch + dinner + optional snack is a menu draft, not proof of adequate daily calories, protein, fiber or carbohydrate. Calculate from actual labels/composition data when targets matter; otherwise mark totals `null`.
- Do not impose fasting, weight loss, new supplements or medication changes. A clinically required snack overrides an optional-snack label. See safety rules in the companion document.
- Known allergies and texture restrictions are hard filters. Listed allergens are screening hints, NOT an exhaustive guarantee: check every packaged ingredient, sauces and cross-contact warnings. Gluten-free is not carbohydrate-free; lactose-free dairy still contains milk proteins.
- Quantities below are starting recipes, not universal serving limits. Reduced appetite, ongoing bowel symptoms, frailty or unintended weight loss require review, not automatic smaller portions.

## Parse and quantity conventions

Each recipe is a standalone YAML mapping. `ingredients` maps a canonical ingredient key to `{qty, unit, state}`. Quantities are for the ENTIRE recipe; divide by `yield_servings` for one serving. All weights are edible food, not package weight. `raw` means before cooking; `dry` means uncooked grain/legume; `drained` excludes can liquid; `cooked` means already prepared. Units are `g`, `ml` or `item`. Water for boiling/steaming may be added as needed; it is not a grocery item. Minutes are kitchen estimates, not safety guarantees.

Shared defaults: `recipe_version: "1.0"`; nutrient totals and GL are `null`; no recipe is a swallowing-safe/texture-modified protocol. `carb_sources` identifies ingredients to count, not a complete carbohydrate calculation. `swap_notes` are alternatives requiring the same safety/label checks, not extra ingredients to buy.

## Grocery and batch logic

1. Load approved options, portions, pantry inventory and number of eaters. Select recipes with the participant; keep snacks conditional.
2. Resolve substitutions BEFORE summing ingredients. Never buy both alternatives by default.
3. For each unique planned batch: `scale = planned_batch_servings / yield_servings`; multiply every ingredient by `scale`. Count a reused leftover batch once, not again at each meal occurrence.
4. Aggregate by ingredient key AND compatible state/unit. Do not silently combine raw chicken with cooked chicken, dry rice with cooked rice, or grams with millilitres. Obtain a documented yield/density conversion or keep lines separate. A cooked ingredient can be sourced ready-cooked; preparing it from raw requires an explicit yield estimate.
5. Subtract usable pantry stock, then round purchases to verified package sizes. For cans, use the labelled drained yield. Expiry dates and safe storage determine whether stock is usable.
6. Draft grocery lines with `ingredient_key`, `required_qty`, `unit`, `state`, `pantry_qty`, `purchase_qty`, `package_size_if_known`, `meal_ids` and `batch_ids`. Unknown values stay `null`; never invent prices, package yields or stock.
7. A grocery proposal is not an order. Only an authorized actor/service may commit a list or purchase; do not place clinical details in household/Asana grocery text.

Example: two servings of D03 require half of its four-serving batch: 300 g raw turkey, 180 g drained kidney beans and 60 g dry rice, plus half of the other ingredients. A full D03 batch reserved for two dinners is purchased once. This is recipe arithmetic, not a nutrition claim.

## Food safety for all recipes

Use a thermometer, not the suggested minutes: poultry pieces/ground poultry and egg dishes 74 C; fish 70 C; ground beef 71 C; reheated leftovers 74 C. Keep raw animal foods separate from ready-to-eat food. Refrigerate perishable prepared food promptly in shallow containers at 4 C or colder; discard cooked food left at room temperature over two hours. Use refrigerated leftovers within 2-3 days or freeze; reheat only the portion needed. Fresh assembly and product use-by instructions may require a shorter interval. Sources: [R31](research-knowledge-base.md#r31), [R32](research-knowledge-base.md#r32). These are safety references, not dietary efficacy evidence.

## Breakfast

### B01 - Berry-vanilla yogurt crunch
```yaml
id: B01
category: breakfast
yield_servings: 1
active_minutes: 5
total_minutes: 5
allergens: [milk, oats_possible_gluten_cross_contact]
carb_sources: [rolled_oats, mixed_berries, plain_greek_yogurt]
ingredients:
  plain_greek_yogurt: {qty: 200, unit: g, state: ready_to_eat}
  rolled_oats: {qty: 35, unit: g, state: dry}
  mixed_berries: {qty: 100, unit: g, state: fresh_or_thawed}
  ground_flaxseed: {qty: 5, unit: g, state: ready_to_eat}
  vanilla_extract: {qty: 1, unit: ml, state: ready_to_use}
steps:
  - Mix yogurt and vanilla; fold in oats and flax.
  - Top with berries. Rest briefly for softer oats, or serve immediately for texture.
swap_notes:
  - Use a tolerated unsweetened high-protein soy yogurt if milk-free is required; check soy allergy and actual protein content.
  - Use certified gluten-free oats when required; soft cooked oats are a different preparation, not an automatic swallowing-safe substitute.
planning_notes: Assemble fresh; keep the components separate for batch shopping. Do not replace the protein-containing yogurt with a low-protein alternative without reviewing the meal.
```

### B02 - Cheddar-spinach eggs on toast
```yaml
id: B02
category: breakfast
yield_servings: 1
active_minutes: 10
total_minutes: 12
allergens: [egg, milk, wheat]
carb_sources: [wholegrain_bread, tomato]
ingredients:
  eggs: {qty: 2, unit: item, state: raw}
  spinach: {qty: 40, unit: g, state: raw}
  cheddar: {qty: 15, unit: g, state: ready_to_eat}
  wholegrain_bread: {qty: 60, unit: g, state: ready_to_eat}
  tomato: {qty: 100, unit: g, state: raw}
  olive_oil: {qty: 5, unit: ml, state: ready_to_use}
steps:
  - Wilt spinach in oil; add beaten eggs and cook to the safe egg-dish temperature.
  - Melt cheddar through the eggs and serve on toasted bread with sliced tomato.
swap_notes:
  - For egg allergy, an approved tofu scramble is an alternative; recheck soy and protein portions.
  - A gluten-free loaf requires label and portion recalculation. Omit cheese if milk-free; do not assume lactose-free cheese is milk-allergy safe.
planning_notes: Cook eggs fresh. Bread weight matters more than an assumed standard slice size.
```

### B03 - Apple-cinnamon overnight oats
```yaml
id: B03
category: breakfast
yield_servings: 1
active_minutes: 5
total_minutes: 485
allergens: [milk, oats_possible_gluten_cross_contact]
carb_sources: [rolled_oats, apple, milk, plain_greek_yogurt]
ingredients:
  rolled_oats: {qty: 40, unit: g, state: dry}
  milk: {qty: 100, unit: ml, state: ready_to_drink}
  plain_greek_yogurt: {qty: 100, unit: g, state: ready_to_eat}
  apple: {qty: 100, unit: g, state: raw_cored}
  ground_cinnamon: {qty: 1, unit: g, state: dry}
steps:
  - Mix oats, milk, yogurt and cinnamon in a covered container; refrigerate overnight.
  - Add chopped or grated apple before serving. Eat cold or warm gently if preferred.
swap_notes:
  - Tolerated unsweetened fortified soy drink and high-protein soy yogurt can replace dairy after label checks.
  - Use certified gluten-free oats when required.
planning_notes: Total time includes an eight-hour refrigerated soak. Cooling is for convenience, not a claim that carbohydrate has been cancelled.
```

### B04 - Peach cottage-cheese toast
```yaml
id: B04
category: breakfast
yield_servings: 1
active_minutes: 5
total_minutes: 5
allergens: [milk, wheat]
carb_sources: [wholegrain_bread, peach, cottage_cheese]
ingredients:
  cottage_cheese: {qty: 150, unit: g, state: ready_to_eat}
  wholegrain_bread: {qty: 60, unit: g, state: ready_to_eat}
  peach: {qty: 120, unit: g, state: raw_pitted}
  ground_cinnamon: {qty: 0.5, unit: g, state: dry}
steps:
  - Toast the bread and spread with cottage cheese.
  - Add sliced peach and cinnamon; serve any remaining peach alongside.
swap_notes:
  - Use drained peach canned without added sugar when fresh is unavailable; it still contains carbohydrate.
  - If milk-free, choose a different approved breakfast or recalculate an appropriate protein-containing replacement.
planning_notes: Assemble fresh. Cottage cheese brands differ in sodium; use the approved label if sodium is restricted.
```

### B05 - Banana-oat pancakes with berries
```yaml
id: B05
category: breakfast
yield_servings: 1
active_minutes: 15
total_minutes: 20
allergens: [egg, milk, oats_possible_gluten_cross_contact]
carb_sources: [rolled_oats, banana, mixed_berries, milk, plain_greek_yogurt]
ingredients:
  rolled_oats: {qty: 40, unit: g, state: dry}
  banana: {qty: 60, unit: g, state: raw_peeled}
  eggs: {qty: 1, unit: item, state: raw}
  milk: {qty: 50, unit: ml, state: ready_to_drink}
  baking_powder: {qty: 2, unit: g, state: dry}
  olive_oil: {qty: 2.5, unit: ml, state: ready_to_use}
  plain_greek_yogurt: {qty: 75, unit: g, state: ready_to_eat}
  mixed_berries: {qty: 80, unit: g, state: fresh_or_thawed}
steps:
  - Blend oats, banana, egg, milk and baking powder into a batter.
  - Lightly oil a pan and cook small pancakes thoroughly on both sides.
  - Serve with yogurt and berries instead of a large syrup topping.
swap_notes:
  - Use individually tolerated dairy alternatives and certified gluten-free oats where required.
planning_notes: Blended oats are not equivalent to intact oats in digestion. The measured recipe is an enjoyable option, not a low-GI claim. Refrigerate cooked extras under the shared safety rules.
```

## Lunch

### L01 - Lemon chicken and hummus wrap
```yaml
id: L01
category: lunch
yield_servings: 1
active_minutes: 10
total_minutes: 10
allergens: [wheat, sesame]
carb_sources: [wholegrain_wrap, hummus, tomato, cucumber]
ingredients:
  chicken_breast: {qty: 100, unit: g, state: cooked}
  wholegrain_wrap: {qty: 50, unit: g, state: ready_to_eat}
  hummus: {qty: 30, unit: g, state: ready_to_eat}
  spinach: {qty: 25, unit: g, state: raw}
  tomato: {qty: 60, unit: g, state: raw}
  cucumber: {qty: 60, unit: g, state: raw}
  lemon_juice: {qty: 10, unit: ml, state: ready_to_use}
steps:
  - Spread hummus over the wrap; add sliced cooked chicken and vegetables.
  - Add lemon juice, fold and serve. Keep the filling chilled until needed.
swap_notes:
  - Use an approved sesame-free bean spread instead of hummus when needed.
  - A gluten-free wrap requires label and portion checks; do not assume the same carbohydrate content.
planning_notes: Chicken is already cooked in this record. Source it ready-cooked or connect to a separately planned cooking batch; never treat 100 g cooked as 100 g raw.
```

### L02 - Tuna and white-bean toast
```yaml
id: L02
category: lunch
yield_servings: 1
active_minutes: 10
total_minutes: 10
allergens: [fish, milk, wheat, mustard]
carb_sources: [white_beans, wholegrain_bread, plain_greek_yogurt, tomato]
ingredients:
  canned_light_tuna: {qty: 90, unit: g, state: drained}
  white_beans: {qty: 60, unit: g, state: canned_drained}
  wholegrain_bread: {qty: 60, unit: g, state: ready_to_eat}
  plain_greek_yogurt: {qty: 20, unit: g, state: ready_to_eat}
  dijon_mustard: {qty: 5, unit: ml, state: ready_to_use}
  celery: {qty: 25, unit: g, state: raw}
  lemon_juice: {qty: 5, unit: ml, state: ready_to_use}
  tomato: {qty: 100, unit: g, state: raw}
steps:
  - Mix drained tuna and beans with yogurt, mustard, diced celery and lemon.
  - Spoon onto toast and serve with tomato.
swap_notes:
  - Cooked chicken can replace tuna only after recalculating the shopping state and checking preferences.
  - Omit mustard if unsafe; an appropriate milk-free dressing needs its own label check.
planning_notes: Keep the filling refrigerated and assemble toast at serving. Rotate lunch choices rather than defaulting to tuna every day.
```

### L03 - Tomato-lentil soup with cheddar toast
```yaml
id: L03
category: lunch
yield_servings: 4
active_minutes: 15
total_minutes: 40
allergens: [milk, wheat, broth_and_spice_label_check]
carb_sources: [red_lentils, wholegrain_bread, crushed_tomatoes, carrot, onion]
ingredients:
  red_lentils: {qty: 180, unit: g, state: dry}
  crushed_tomatoes: {qty: 400, unit: g, state: canned}
  lower_sodium_vegetable_broth: {qty: 800, unit: ml, state: ready_to_use}
  onion: {qty: 120, unit: g, state: raw_peeled}
  carrot: {qty: 160, unit: g, state: raw}
  olive_oil: {qty: 20, unit: ml, state: ready_to_use}
  paprika: {qty: 2, unit: g, state: dry}
  wholegrain_bread: {qty: 180, unit: g, state: ready_to_eat}
  cheddar: {qty: 80, unit: g, state: ready_to_eat}
steps:
  - Soften chopped onion and carrot in oil; stir in paprika.
  - Add rinsed lentils, tomatoes and broth; simmer until lentils are fully tender, adding water as needed.
  - Divide soup into four portions. Serve each with one-quarter of the bread and cheddar, toasted together.
swap_notes:
  - Start with a smaller lentil portion if tolerance is limited, but replace missing food with an approved alternative rather than simply shrinking lunch.
  - Use appropriate milk-free and gluten-free alternatives when required; recheck nutrition.
planning_notes: Freeze soup portions not planned within 2-3 days. Bread and cheese are batch quantities too; do not add the whole amount to each serving.
```

### L04 - Chicken-barley comfort soup
```yaml
id: L04
category: lunch
yield_servings: 4
active_minutes: 15
total_minutes: 50
allergens: [barley_gluten, broth_label_check]
carb_sources: [pearl_barley, carrot, onion]
ingredients:
  chicken_breast: {qty: 400, unit: g, state: cooked}
  pearl_barley: {qty: 140, unit: g, state: dry}
  lower_sodium_chicken_broth: {qty: 1200, unit: ml, state: ready_to_use}
  carrot: {qty: 200, unit: g, state: raw}
  celery: {qty: 120, unit: g, state: raw}
  onion: {qty: 120, unit: g, state: raw_peeled}
  spinach: {qty: 120, unit: g, state: raw}
  olive_oil: {qty: 10, unit: ml, state: ready_to_use}
  dried_thyme: {qty: 1, unit: g, state: dry}
steps:
  - Soften diced onion, carrot and celery in oil; add barley, broth and thyme.
  - Simmer until barley is tender, adding water if necessary.
  - Add cooked chicken and spinach, heat safely throughout, and divide into four portions.
swap_notes:
  - For gluten avoidance, use a separately checked rice or quinoa version; cooking time and nutrition will change.
planning_notes: A bowl alone may not meet the person's energy needs. Add an approved side when needed. Freeze unused portions; record the cooked chicken source batch.
```

### L05 - Warm egg, potato and green-bean bowl
```yaml
id: L05
category: lunch
yield_servings: 1
active_minutes: 15
total_minutes: 25
allergens: [egg, milk, mustard]
carb_sources: [potato, green_beans, plain_greek_yogurt]
ingredients:
  eggs: {qty: 2, unit: item, state: raw}
  potato: {qty: 150, unit: g, state: raw_trimmed}
  green_beans: {qty: 150, unit: g, state: raw_or_plain_frozen}
  plain_greek_yogurt: {qty: 40, unit: g, state: ready_to_eat}
  dijon_mustard: {qty: 5, unit: ml, state: ready_to_use}
  olive_oil: {qty: 5, unit: ml, state: ready_to_use}
  lemon_juice: {qty: 10, unit: ml, state: ready_to_use}
steps:
  - Boil eggs until yolks and whites are firm; cook potato chunks and green beans until tender.
  - Mix yogurt, mustard, oil and lemon into a dressing.
  - Toss vegetables with dressing and add quartered eggs. Serve warm or chill promptly.
swap_notes:
  - Use cooked chicken in an approved amount if eggs are unsuitable; adjust groceries and nutrition.
planning_notes: Potato is the planned starch, not a forbidden food and not carbohydrate-free after cooling. Mixed textures need separate approval where swallowing is impaired.
```

## Snack

Snacks are optional only when the approved medication and nutrition plan allows. These are NOT rapid hypoglycemia treatments; use the private rescue plan and [R23](research-knowledge-base.md#r23).

### S01 - Apple slices and almond butter
```yaml
id: S01
category: snack
yield_servings: 1
active_minutes: 3
total_minutes: 3
allergens: [tree_nut]
carb_sources: [apple, almond_butter]
ingredients:
  apple: {qty: 120, unit: g, state: raw_cored}
  almond_butter: {qty: 15, unit: g, state: unsweetened_ready_to_eat}
steps:
  - Slice apple and serve with the measured almond butter for dipping.
swap_notes:
  - A seed butter is an alternative only when the specific seed and cross-contact profile are safe; do not assume seeds are automatically safe for nut allergy.
planning_notes: Raw apple and sticky butter may be unsuitable for some texture plans. Choose an approved alternative rather than improvising a swallowing modification.
```

### S02 - Creamy berry yogurt
```yaml
id: S02
category: snack
yield_servings: 1
active_minutes: 3
total_minutes: 3
allergens: [milk]
carb_sources: [plain_greek_yogurt, mixed_berries]
ingredients:
  plain_greek_yogurt: {qty: 150, unit: g, state: ready_to_eat}
  mixed_berries: {qty: 80, unit: g, state: fresh_or_thawed}
  vanilla_extract: {qty: 0.5, unit: ml, state: ready_to_use}
steps:
  - Stir vanilla into yogurt and add berries. Mash the berries for flavor if preferred.
swap_notes:
  - Use a tolerated unsweetened high-protein alternative only after label and allergen review.
planning_notes: Keep chilled. A dairy-alternative label does not establish equivalent protein or carbohydrate.
```

### S03 - Savory popcorn and cheddar
```yaml
id: S03
category: snack
yield_servings: 1
active_minutes: 5
total_minutes: 8
allergens: [milk]
carb_sources: [popcorn_kernels]
ingredients:
  popcorn_kernels: {qty: 20, unit: g, state: dry}
  olive_oil: {qty: 2.5, unit: ml, state: ready_to_use}
  smoked_paprika: {qty: 0.3, unit: g, state: dry}
  cheddar: {qty: 20, unit: g, state: ready_to_eat}
steps:
  - Air-pop kernels using the appliance instructions; remove unpopped kernels.
  - Toss with measured oil and paprika; serve in a bowl with cheese alongside.
swap_notes:
  - Packaged microwave or ready-popped popcorn can replace the popcorn component only after selecting the exact product and portion from its current label. Do not equate 20 g dry kernels with 20 g prepared branded popcorn.
  - Do not add the oil above to a pre-oiled packaged replacement automatically. Recheck milk and other allergens.
planning_notes: Not for an unapproved dysphagia/texture plan. A bag is not necessarily one serving; no Orville's nutrition or GI value is hard-coded. Keep cheese refrigerated until serving.
```

### S04 - Hummus, carrots and crackers
```yaml
id: S04
category: snack
yield_servings: 1
active_minutes: 5
total_minutes: 5
allergens: [sesame, wheat]
carb_sources: [hummus, carrot, wholegrain_crackers]
ingredients:
  hummus: {qty: 40, unit: g, state: ready_to_eat}
  carrot: {qty: 100, unit: g, state: raw}
  wholegrain_crackers: {qty: 20, unit: g, state: ready_to_eat}
steps:
  - Serve carrot sticks and weighed crackers with hummus in a small bowl.
swap_notes:
  - Use an approved sesame-free spread or different snack when needed. Gluten-free crackers require label review.
planning_notes: Crisp and mixed textures are not automatically swallowing-safe. The cracker weight applies to the selected product, not an assumed number of crackers.
```

### S05 - Pineapple cottage-cheese cup
```yaml
id: S05
category: snack
yield_servings: 1
active_minutes: 3
total_minutes: 3
allergens: [milk]
carb_sources: [pineapple, cottage_cheese]
ingredients:
  cottage_cheese: {qty: 120, unit: g, state: ready_to_eat}
  pineapple: {qty: 60, unit: g, state: fresh_trimmed}
steps:
  - Spoon chopped pineapple over cottage cheese and serve chilled.
swap_notes:
  - Drained pineapple canned without added sugar is an alternative; it still contributes carbohydrate.
planning_notes: This is a portioned snack, not unlimited fruit. Select another approved protein-containing snack if dairy is unsuitable.
```

## Dinner

### D01 - Lemon-garlic chicken with roast potatoes
```yaml
id: D01
category: dinner
yield_servings: 1
active_minutes: 15
total_minutes: 40
allergens: [check_packaged_seasonings]
carb_sources: [potato, green_beans]
ingredients:
  chicken_breast: {qty: 180, unit: g, state: raw}
  potato: {qty: 180, unit: g, state: raw_trimmed}
  green_beans: {qty: 200, unit: g, state: raw_or_plain_frozen}
  olive_oil: {qty: 10, unit: ml, state: ready_to_use}
  lemon_juice: {qty: 15, unit: ml, state: ready_to_use}
  garlic: {qty: 5, unit: g, state: raw_peeled}
  dried_oregano: {qty: 1, unit: g, state: dry}
steps:
  - Heat the oven to 200 C. Toss potato chunks with half the oil; roast until tender.
  - Coat chicken with remaining oil, lemon, garlic and oregano; roast separately or safely alongside until its centre reaches the poultry temperature.
  - Steam green beans and serve with chicken and the measured potato portion.
swap_notes:
  - An approved tofu or fish version requires a revised protein quantity and cooking procedure.
planning_notes: Oven time depends on thickness; use a thermometer. Refrigerate or freeze extra cooked portions under the shared rules.
```

### D02 - Salmon, creamy mash and broccoli
```yaml
id: D02
category: dinner
yield_servings: 1
active_minutes: 15
total_minutes: 30
allergens: [fish, milk]
carb_sources: [potato, milk, broccoli]
ingredients:
  salmon_fillet: {qty: 170, unit: g, state: raw}
  potato: {qty: 180, unit: g, state: raw_trimmed}
  milk: {qty: 30, unit: ml, state: ready_to_drink}
  olive_oil: {qty: 5, unit: ml, state: ready_to_use}
  broccoli: {qty: 200, unit: g, state: raw_or_plain_frozen}
  lemon_juice: {qty: 10, unit: ml, state: ready_to_use}
  dried_dill: {qty: 1, unit: g, state: dry}
steps:
  - Boil potatoes until tender; drain and mash with warm milk and the oil.
  - Season salmon with lemon and dill; bake or pan-cook to the safe fish temperature.
  - Steam broccoli and serve with salmon and mash.
swap_notes:
  - Use a tolerated unsweetened milk alternative for mash if required; check allergens.
planning_notes: Mashed potatoes are allowed as a measured starch. The raw potato weight is not the final mash weight. Do not add bread or rice automatically, and do not assume added fat cancels carbohydrate.
```

### D03 - Mild turkey-bean chili with rice
```yaml
id: D03
category: dinner
yield_servings: 4
active_minutes: 20
total_minutes: 45
allergens: [broth_and_spice_label_check]
carb_sources: [kidney_beans, brown_rice, crushed_tomatoes, onion, red_bell_pepper]
ingredients:
  lean_ground_turkey: {qty: 600, unit: g, state: raw}
  kidney_beans: {qty: 360, unit: g, state: canned_drained}
  crushed_tomatoes: {qty: 600, unit: g, state: canned}
  onion: {qty: 150, unit: g, state: raw_peeled}
  red_bell_pepper: {qty: 200, unit: g, state: raw}
  brown_rice: {qty: 120, unit: g, state: dry}
  olive_oil: {qty: 15, unit: ml, state: ready_to_use}
  lower_sodium_vegetable_broth: {qty: 200, unit: ml, state: ready_to_use}
  mild_chili_powder: {qty: 4, unit: g, state: dry}
  ground_cumin: {qty: 3, unit: g, state: dry}
  dried_oregano: {qty: 2, unit: g, state: dry}
steps:
  - Cook rice according to its package, using water.
  - Soften chopped vegetables in oil; add turkey and cook thoroughly. Stir in spices, tomatoes, drained beans and broth.
  - Simmer until flavors combine and turkey reaches the safe temperature; divide chili and cooked rice into four portions.
swap_notes:
  - Keep spices mild initially; let the participant choose extra heat.
  - Replacing meat with more beans requires a new carbohydrate/protein calculation, not a one-for-one nutrition assumption.
planning_notes: Freeze servings not used within 2-3 days. Count each planned batch once even if it supplies multiple dinners.
```

### D04 - Ginger beef and broccoli rice bowl
```yaml
id: D04
category: dinner
yield_servings: 1
active_minutes: 20
total_minutes: 40
allergens: [soy, wheat_possible_in_soy_sauce]
carb_sources: [brown_rice, broccoli, red_bell_pepper, cornstarch]
ingredients:
  lean_beef_strips: {qty: 150, unit: g, state: raw}
  broccoli: {qty: 180, unit: g, state: raw_or_plain_frozen}
  red_bell_pepper: {qty: 100, unit: g, state: raw}
  brown_rice: {qty: 40, unit: g, state: dry}
  olive_oil: {qty: 5, unit: ml, state: ready_to_use}
  reduced_sodium_soy_sauce: {qty: 5, unit: ml, state: ready_to_use}
  ginger: {qty: 5, unit: g, state: raw_peeled}
  garlic: {qty: 3, unit: g, state: raw_peeled}
  cornstarch: {qty: 3, unit: g, state: dry}
  water: {qty: 40, unit: ml, state: potable}
steps:
  - Cook the rice according to its package.
  - Stir-fry beef safely in oil; add vegetables, ginger and garlic, cooking until vegetables are tender.
  - Mix sauce, water and cornstarch; add and simmer until thickened. Serve over the measured cooked-rice yield.
swap_notes:
  - Tofu is a possible alternative after protein, soy and portion review; keep a separate recipe variant.
  - For gluten avoidance, verify the specific sauce rather than assuming all soy sauces or tamari are gluten-free.
planning_notes: This is a small measured sauce, not a claim that reduced-sodium products are unrestricted. Beef cut-specific safety instructions apply; do not use color alone.
```

### D05 - Lentil-mushroom spaghetti with parmesan
```yaml
id: D05
category: dinner
yield_servings: 4
active_minutes: 20
total_minutes: 45
allergens: [wheat, milk]
carb_sources: [brown_lentils, wholewheat_spaghetti, crushed_tomatoes, carrot, onion]
ingredients:
  brown_lentils: {qty: 120, unit: g, state: dry}
  wholewheat_spaghetti: {qty: 160, unit: g, state: dry}
  crushed_tomatoes: {qty: 700, unit: g, state: canned}
  mushrooms: {qty: 250, unit: g, state: raw}
  carrot: {qty: 120, unit: g, state: raw}
  onion: {qty: 120, unit: g, state: raw_peeled}
  spinach: {qty: 120, unit: g, state: raw}
  olive_oil: {qty: 20, unit: ml, state: ready_to_use}
  parmesan: {qty: 40, unit: g, state: ready_to_eat}
  dried_basil: {qty: 3, unit: g, state: dry}
  garlic: {qty: 10, unit: g, state: raw_peeled}
steps:
  - Rinse and cook lentils until tender; cook pasta separately according to its package.
  - Soften finely chopped onion, carrot, mushrooms and garlic in oil. Add tomatoes and basil; simmer, then fold in lentils and spinach.
  - Divide sauce and pasta into four portions; top each with one-quarter of the parmesan.
swap_notes:
  - Use an approved gluten-free pasta if required; recalculate from its label.
  - Omit parmesan for a milk-free variant and reassess the full meal's protein/energy rather than assuming equivalence.
planning_notes: Lentils and pasta both contribute carbohydrate. Add an approved protein side if needed; this meal is not automatically equivalent to the meat dinners. Freeze extra sauce separately.
```

## Selection check

Before presenting an option as approved, validate: correct participant; current protocol; ingredient and cross-contact checks; texture approval; adequate food; preparation support; label-specific portions; safe storage; required snack/medication timing; and authorization for any state change. Store actual consumption separately from planned meals. No clinical inference follows merely from a meal being marked complete.
