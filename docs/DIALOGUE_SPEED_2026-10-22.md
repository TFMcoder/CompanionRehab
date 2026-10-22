# Owner test: follow-up meals and ordinary conversation

The October 22 owner direction authorizes a further experiment in the separate synthetic test copy. Keep Heart and Dad’s runtime/data/configuration unchanged and use the existing owner Pro connection without API billing. This is an S01 engineering checkpoint; intended-person, physical-device, genuine-day and full-slice acceptance remain open.

## What changes

The private startup selection adds `continuation_mode: dialogue-v1` only to the exact existing Sol-low/prepared/Heart/quick-read/spoken/ahead-meal owner trial. The default is off. Main and the exact caregiver route do not read this selection. Actor/login/client/role/grants/policy/account/host binding and fresh authorization remain required.

The same bounded Nancy preparation request can select a primary and one alternative repository recipe per meal. Strict schema, category, ID, uniqueness and known-exclusion validation applies to both. The model must supply two when two fit, and may supply fewer when a restriction prevents another fit. No forced fit, approved meal, actual intake, clinical target or allergy clearance is implied. This changes the shape of one existing preparation response; it adds no parallel agent, new account or automatic provider retry.

After a prepared menu is delivered, an in-memory conversation thread retains selected recipes, used choices, the last meal discussed and prepared first Heart clips. Anchored, read-only follow-ups can repeat a meal, explain its actual ingredient groups, quote its one-serving ingredients/states/units or literal preparation steps, or offer the unused prepared alternative. An unclear pronoun asks which meal and retains that pending question. Exact returned source IDs remain attached. The care service is never called to accept, save or report a meal by these replies.

Every source follow-up rechecks the current authorized snapshot and source hashes against the original key and ten-minute validity window. New dietary restrictions, unsupported wording, safety/clinical questions, actions, dates, expired state or changed authority drop the thread and use the normal path. Exhausted alternatives also continue through normal discovery. Closed greetings and simple lost-thought/bored/thanks/lonely messages preserve the meal context; additional facts, symptoms or action words prevent that shortcut. Interrupt, logout and scope loss clear the thread. No conversation is shared with another login.

Simple whole-message conversation replies offer a useful continuation without inference. Only the first parts of five public replies are warmed in a separate, bounded Heart cache; arbitrary private speech is not added to it. Source-detail first parts can be reused within the same validated meal thread after they are generated. All speech still uses final reply IDs and fresh authorization before and after asynchronous preparation. Pinned Heart, normal speaking speed and the existing twelve-thread/72-character owner trial remain unchanged; Dad retains the prior speech configuration.

Broad conversation keeps the original trusted policy, fresh lower-trust facts and actual recent history. The selected refinement asks for a substantive short opening sentence, then a brief explanation or question. It adds no filler or early release of unvalidated model text. Full care/review/approval paths remain intact.

## Measured comparisons and accuracy

The first private phase contains 52 actual synthetic answers: two alternating repetitions of baseline and candidate meal/chat sequences. It uses 46 Responses requests, counting preparation separately. Both paths use the same existing owner Pro account, Sol-low, read-only test care authorization, fixed fictional type-2/peanut/no-yogurt context and pinned Heart. There is no microphone capture, physical listening or real-care write.

The initial compressed single-sentence conversation policy is rejected: its six broad-chat answers have 4.053s median first audio versus 3.468s baseline. One lunch alternative also falls back to model discovery because the initial selection policy allows a second fitting choice to be omitted. These results remain separate from the refinement.

The refined phase contains 26 additional answers and 14 additional Responses requests. Two complete prepared meal sequences have zero model calls on all 14 menu/follow-up answers. Both produce a distinct compatible lunch alternative. The following compares the two earlier fixed baseline samples per question with two refined samples; it is a small cross-phase comparison, not a production percentile:

| Follow-up | Earlier baseline median | Refined median |
|---|---:|---:|
| Repeat lunch | 5.688s | 0.097s |
| Explain lunch choice | 3.667s | 0.096s |
| First ingredient reading | 6.704s | 1.747s |
| First cooking-step reading | 6.019s | 1.455s |
| Another lunch | 5.975s | 0.098s |
| Repeat the cooking steps | Not paired | 0.109s |

Six closed greeting/frustration/bored replies in the first phase have 0.052s median first audio versus 3.263s baseline. The refined broad conversation comparison alternates six answers per path and improves 3.663→3.308s median. It remains variable and model-dependent; this experiment does not make arbitrary conversation instant. Preparation of the refined menu/alternatives takes 8.621s and 10.576s before the questions. First source-detail speech still needs native generation; its subsequent exact repetition can reuse the first clip.

All 14 final meal replies are manually checked against the selected source recipes: IDs, literal L01 quantities/states/steps, compatible unused L04 alternative, cross-contact caution and no save/consumption claim. Six final model-dependent conversation replies and six matched baseline replies meet the scoped relevance/continuity/factual criteria. Two further actual synthetic probes remain outside fast paths: medication-dose escalation is refused and urgent symptoms receive urgent-help guidance. These two calls bring controlled inference to 62 requests. This is a fixed synthetic review, not clinical validation or a general accuracy estimate.

The ordinary science checks are compared with primary sources on [rain-drop shape](https://gpm.nasa.gov/science/anatomy-of-a-raindrop), [rain-induced aerosols](https://news.mit.edu/2015/rainfall-can-release-aerosols-0114), [sleep and memory](https://www.nhlbi.nih.gov/health/sleep/why-sleep-important), and [long-distance dust transport/deposition](https://gmao.gsfc.nasa.gov/science-snapshots/july-august-2024-saharan-dust-transport/). These sources support the tested general explanations; no cure or personal diagnosis is claimed. The [official OpenAI latency guide](https://developers.openai.com/api/docs/guides/latency-optimization) supports reducing unnecessary inference and measuring output/preparation tradeoffs, but does not establish the latency or entitlement of this Pro route. Those are separately observed here.

## Preservation and review

The initial implementation revision is `sha256:faa6d9923903e6f04d5d30b86ce7f1c20a390e52b43d068044acce8a99d7f3fb`; the refined/final revision is `sha256:6834ddf8239955159dd25514cf2b885e339cc989c96267a4954118f4b7646a71`. Private manifests preserve both. No results are silently moved between phases. Numeric usage/latency and hit counters are whitelisted; missing usage remains null. No private transcript, audio, credential, actor ID or care record is published.

The test site stays on its independent port 10000 with the existing tester login and locked Current assets. The test-only label becomes “Sol / low (meal follow-ups + conversation, Heart)”. Preserve the preceding private selection and entry before a guarded test-child-only restart. The private dated rollback restores the previous prepared-meal trial and restarts only the verified test child; it never restores care data or credentials or stops the shared database/main process/supervisors.

The final revision passes 1,107 full regressions with zero failures and two existing optional skips across 116 files, plus 90 focused conversation/isolation/telemetry checks and a targeted speech-cache lifecycle test. Type checking and the private client build pass. The active Current JavaScript/CSS are byte-identical to the deployed build. All 340 source manifest entries match the tested revision; no implementation change follows this full regression.

Actual authenticated HTTP qualifies four baseline turns (49 checks) and thirteen final continuous turns (156 checks), including every returned 24 kHz WAV part. The final site's observed first-audio-ready times are:

| Case | Before | Final | Final model calls |
|---|---:|---:|---:|
| Repeat lunch | 5.200s | 0.198s | 0 |
| Explain lunch choice | Not paired | 0.172s | 0 |
| First ingredient reading | 4.748s | 1.529s | 0 |
| First cooking-step reading | Not paired | 1.398s | 0 |
| Repeat cooking steps | Not paired | 0.165s | 0 |
| Another lunch | Not paired | 0.159s | 0 |
| Lost-thought recovery | Not paired | 0.054s | 0 |
| Retained dinner after recovery | Not paired | 0.143s | 0 |
| General explanation | 4.265s | 2.807s | 1 |
| General explanation follow-up | Not paired | 5.108s | 1 |

These are individual typed-request-to-first-validated-WAV observations, not audible phone timings or production percentiles. Baseline login deliberately does not trigger foreground preparation, so its cold first-menu answer is not a matched warm-menu comparison. Final preparation takes 9.005s before the question; the authentication response itself returns in 28ms. The prepared menu then starts at 0.247s. The manual thirteen-reply source/continuity/no-write review passes. A new egg/milk restriction bypasses every fast path; Outlook remains truthfully unavailable in the test copy.

Forty-three preservation checks confirm unchanged hashes/counts for fifteen protected care tables per database, main settings/credentials/connector configuration, Current assets, Dad's app/run and both supervisors. Only the verified owner-test child is restarted. A further 358 readiness/source checks pass after resetting that successful measurement process for owner review. This reset clears the process's preparation allowance/cooldown without replaying requests or resetting the recorded experiment budget. The total is 62 controlled Responses requests plus nine observed runtime requests, 71 of the explicit 80-request cap. There are no failed-request replays, API-key requests, billing/model fallbacks or provider/care writes.

For review, open the existing test site and allow about ten seconds after authenticated page open for foreground meal preparation. Start a fresh conversation, ask for meal ideas, then try “What about lunch?”, “How do I make that?”, “Suggest another lunch” or “I lost my train of thought.” The existing tester login is unchanged. Preparation expires after ten minutes and remains bounded; a cold page or unsupported question may need normal reasoning.

Broader conversation remains variable: the actual follow-up above still takes 5.108s. First source-detail speech also needs native generation, and later audio parts are not all prebuilt. Preparation, cold/missed requests, actual Safari microphone-to-ear delay, subjective listening, clinical suitability and full-slice gates remain open. See [sanitized verification](evidence/DIALOGUE-SPEED-2026-10-22.json). No participant deployment is authorized by this test-copy experiment.
