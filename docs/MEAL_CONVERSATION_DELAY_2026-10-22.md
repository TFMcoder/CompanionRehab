# Owner-copy meal and conversation response trial

The October 22 owner request is to improve meal recommendations and ordinary conversation in the separate practice copy, compare speed and accuracy, retain Heart, leave Dad's setup unchanged and use no API billing. This is an owner-practice experiment, not a live-client rollout or a full-slice completion.

## Scope and method

The initial comparison runs seven fixed synthetic cases twice across the existing Sol-low path, a shorter spoken-response policy on Sol-low, and the same policy on Luna-low. It covers three-meal recommendations, breakfast preferences, empathy, education, ordinary activity suggestions, medication boundaries and hostile instructions. All 42 answers complete on the existing immutable owner Pro binding, using 47 actual Responses requests. That phase has its own 64-request cap and recorded source hashes; it predates the final refinement.

The refined comparison retains Sol-low. Six fixed cases run twice on each path: three meals, breakfast, empathy, ordinary rain conversation, a music conversation and allergy/nutrient uncertainty. All 24 answers complete using 28 additional requests. The refinement has a separate maximum of 32 added requests; the combined task budget, including normal-service verification, is bounded to 96. The original 47 requests are retained in the cumulative counter, never reset or replayed.

Both comparisons rotate candidate order, run sequentially, use deterministic fictional preferences and real care authorization with a read-only database connection after synthetic login. The fixture reports type 2 diabetes, a peanut allergy and disliked yogurt, without a prescribed carbohydrate target. Care writes are blocked. The actual owner identity and exact separate synthetic participant remain bound. Public recipe data is preloaded locally; no personal background inference, provider token copy or API key is used.

Heart remains `af_heart`, normal speed, the pinned fp32 checkpoint, and the existing owner-copy CPU12/72-character path. Timing ends at validated first audio availability after a typed turn. Microphone capture, remote Safari transport, audible onset and actual-person listening are excluded. Small repeated samples do not establish percentiles, clinical accuracy or reliable speed under other provider load.

## Bounded implementation

An exact private `reply_mode: spoken-v1` selection is default-off and requires the existing prepared Sol-low/Heart/quick-read owner copy. Main never reads it. The mode is included in inference binding and numeric runtime metadata; normal fresh authority/account/model/cancellation/final speech-release checks remain active.

Two read-only modes use shorter trusted policy: meal ideas and ordinary conversation. The policy requires useful answers, familiar language and a concrete continuation after frustration. Fresh profile, reviewed preferences, health context and source limitations remain data, with embedded instructions unable to change policy or authorize a write. Medication changes, clinical targets, false saves, allergy clearance and invented nutrients remain prohibited. Full planning, approval/readback, ambiguous follow-ups and care changes retain their existing instructions and tools. Detailed recipe and schedule routes retain the previous path.

A narrow ordinary-chat recognizer covers requests such as talking about music or hearing an interesting fact. Food, calendar, task and action vocabulary prevent that expansion. It cannot grant tools or care authority.

For a plain menu-idea question, preload up to five public recipes per requested category, at most three categories, with names, allergens, carbohydrate sources and canonical ingredient names. Quantities and cooking steps are not included. The complete supplied choices let this bounded answer withhold the recipe lookup tool. Suitability, nutrient amounts, substitutions, details, a fourth requested category, mixed intents and full care workflows retain necessary lookup capability. If no supplied choice fits, Nancy must say so or ask one clarification. Preloading is retrieval, not clinical screening, approval or proof that an ingredient is safe.

[Official OpenAI latency guidance](https://developers.openai.com/api/docs/guides/latency-optimization) supports measuring shorter answers and fewer unnecessary model/tool rounds; it does not guarantee a latency reduction from a smaller prompt. Actual completed requests establish admission for this existing route. No unsupported request options, paid processing tier, provider fallback or voice change are introduced.

## Accuracy and limits

Codex manually reviews each answer against the fixed core criteria, separately from timing. These checks cover supplied facts and preferences, actual recipe identity, unknown nutrient totals, allergy/cross-contact limits, medication boundaries, injected data and truthful save state. They are not a general accuracy score or clinical validation. Refined conversational helpfulness is also reviewed: empathy should offer a way to resume, while education should answer the question and music conversation should invite an easy continuation.

General rain examples are checked against [UCAR's explanation of raindrop shape](https://scied.ucar.edu/video/shape-raindrops) and [MIT's account of its raindrop aerosol experiments](https://meche.mit.edu/news-media/rainfall-can-release-aerosols-study-finds). These support the broad examples; they do not validate every possible educational answer.

## Preservation and rollback

Preserve the previous private test selection and entry before activation, and verify source hashes, all 30 protected care tables, main configuration/assets and both supervisors. Restart only the verified owner-test child with its exact executable, parent, listener and run marker. Rollback restores the saved selection/entry and restarts that same scoped test child; it requires no database reset, live restart, credential transfer or Current UI replacement. Physical-device, subjective listening/usefulness, intended-person, genuine-day and full-slice acceptance remain open.

The first full regression run found one pre-existing synthetic HTTP session-renewal test using a fixed care clock while its supporting services used wall time. The test now sets the same synthetic Date for cookie, feature and care checks, with real timers restored during cleanup. Authentication implementation, session lifetime and expiry/overlap assertions are unchanged. Its first failed report is retained privately; the final full suite is rerun after the repair. The final acceptance revision also shortens an owner-test diagnostic label that exceeded the existing metadata whitelist by one character. The measured one/three-meal and chat policies, inference and speech remain unchanged from the refined benchmark. An additional guard keeps lookup available for a fourth meal category beyond the preloaded bound; a new service regression catches an escaping error in its first draft, and the corrected guard passes focused checks. Final service acceptance uses the repaired diagnostic label and guard.

## Measured results and review deployment

[Sanitized evidence](evidence/MEAL-CONVERSATION-DELAY-2026-10-22.json) preserves separate initial/refined populations and source scopes. Initial median first audio is 3.00 seconds existing Sol, 2.91 shorter Sol and 3.82 Luna. Luna uses 19 requests versus 14 per Sol candidate, with a less relevant allergy caution in one answer; it is not selected.

In the final repeated comparison, all 12/12 scoped core checks pass per path. Median first audio is 3.24→3.04 seconds overall (about 6%); final reply median 2.98→2.74. Per-case first-audio medians, two answers per case per variant:

| Case | Existing | Refined |
|---|---:|---:|
| meals | 3.72 s | 4.36 s |
| empathy | 3.21 s | 3.04 s |
| chat | 3.31 s | 2.76 s |
| bored | 2.58 s | 2.44 s |
| breakfast | 3.36 s | 3.41 s |
| meal_safety | 6.78 s | 5.88 s |

This is a modest conversation improvement, not a reliable meal-speed improvement. Three-meal median is slower and breakfast is essentially unchanged. Allergy/nutrient interpretation still uses two model rounds. In one matched ordinary-chat case, input falls from 7952 to 535 tokens and 24 tools to none. The complete meal choices increase input from 2455 to 3069 tokens; their purpose is source-informed selection without extra lookup, not an assumption that more preloading always reduces latency. Refined meal answers use vegetables/pulses/whole-grain reasons, avoid disliked yogurt and retain peanut cross-contact caution. Refined empathy offers a concrete keyword-based continuation.

Actual authenticated service, one sample per case per phase:

| Case | Before first audio | After first audio |
|---|---:|---:|
| meals-1 | 5.78 s | not paired; see note |
| empathy-1 | 3.22 s | 3.33 s |
| education-1 | 4.66 s | 3.12 s |
| breakfast-1 | 4.62 s | 3.24 s |
| chat-1 | 3.96 s | 3.34 s |
| bored-1 | 2.27 s | 2.31 s |

The final distinct vegetarian meal sample has first audio ready in 4.98 seconds; it has no paired baseline. The dinner maps to the source lentil-mushroom spaghetti with parmesan; vegetarian cheese-label suitability remains unverified. These actual-site samples do not override the repeated controlled regression. Independently generated wording, provider/cache/load and speech work vary. Every audio part passes WAV checks; no response claims a care save. Full verification: 1053 tests pass, 2 optional skips across 114 files; 75 focused checks, typecheck, private build, preservation and deployed readiness pass. All 30 protected care tables and main configuration/Current assets are unchanged; both supervisors and Dad’s app/run are unchanged. Only the verified owner-test child restarts. The test label is “Sol / low (meal + conversation trial, Heart)”; the earlier private selection/entry are saved for rollback.

A successful first meal request exposed an overlong diagnostic label. Its numeric record reconciles one completed inference; the missing timing remains unknown and the response is not replayed. The bounded label is repaired without changing the privacy filter. A distinct vegetarian meal question and the five remaining conversation/breakfast questions qualify the final service; the vegetarian meal is not paired with the earlier non-vegetarian example. The task uses 75 actual benchmark Responses requests plus 13 observed runtime model rounds, 88 combined under the 96 cap. No API key billing, new paid service, credential copy, provider-care write, care write or live rollout occurs. Reliable meal latency, physical-device/listening/genuine-day and full-slice acceptance remain open.
