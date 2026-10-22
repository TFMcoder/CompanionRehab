# Owner-copy context preparation and bounded lookups

The owner requested another latency pass on October 22: prepare relevant context and reduce unnecessary lookups in the separate practice copy, test again, retain the live client's setup and incur no API billing. Sol/low and Kokoro Heart remain fixed for the comparison. Only the existing immutable owner-practice Pro connection is used.

## Changes under evaluation

- Warm a bounded index of the public repository recipes at practice startup. Retrieve at most two explicitly named recipes before the first model call, including exact ingredients, quantities, source versions and limitations. An immediate, unambiguous recipe follow-up can reuse that reference identity; another source revision or topic cannot supply stale recipe details.
- Assemble a smaller request for read-only questions. Keep fresh profile, confirmed preferences and active health/context notes. Include relevant meal/intake or schedule facts, and intersect the existing allowed tools with the tools needed for that question. Ordinary conversation uses the trusted core rather than all five workflow expansions and nutrition instructions. Changes, broad planning, ambiguous answers and mixed workflows keep the full existing review/command path.
- Quote narrow exact facts locally: a uniquely identified local appointment's saved time/duration, explicit ingredient quantities from a named recipe, or the test copy's known disconnected Outlook state. These answers do not require a model. Wrong titles/dates, ambiguous or omitted appointments, scaling, unknown ingredients and clinical suitability questions fall through to the bounded model path. A local time lookup never claims an Outlook read. A recipe quote is not meal approval or evidence of eating.
- Prepare the matching first speech part while final authority checks complete. Existing reply IDs, scope rechecks, cancellation and validated-audio release remain enforced. There is no interruption feature, automatic microphone, placeholder speech or release of unvalidated model output.

The care service still reads current facts and permissions on every turn. This is not a durable cache of personal data, a second day ledger, a background model job or a new connector. The only warmed shared index contains repository references. No real health note, clinical target, care report, provider write, Outlook token or consent is created.

## Isolation and operation

Preparation defaults off. Only the exact private owner-test selection can set `context_mode: prepared-v1`; it must match the existing owner, synthetic participant and separate origin. Main never reads this file, and prepared conversations are refused for a non-owner actor or caregiver route even when the requested model is Sol/high. The model/effort and prepared mode are part of the inference scope; test telemetry labels the mode without recording speech, transcript or credentials.

Before activation, preserve the practice selection, entry page and source hashes. Restart only the test app child after verifying executable, launch marker, parent supervisor, loopback port and synthetic HTTPS configuration. Retain both supervisors, the live app, existing credentials, database and network routes. Restore the saved selection and test entry and perform the same guarded test-only restart to return to the prior Sol/low trial.

## Measurement

The first pass compares baseline and preparation with eight fixed synthetic scenarios, three repetitions each, on the same Sol/low/Heart route. Numeric input/tool sizes expose remaining redundant work. A final pass repeats baseline versus the refined preparation with two repetitions, retaining the first pass and sharing the original 100-response budget. The scenarios add exact repository quantities to the earlier seven meal, calendar, unavailable-source, empathy, medication, actual-report/approval and injection checks.

Both variants use the actual conversation/care/speech code with the restricted owner database, read-only care connections after synthetic login, fixed fictional facts and rotated candidate order. Timing starts with a typed turn and ends with first validated audio available; actual microphone, remote browser transport and audible playback are separate. Provider load and cache differences are uncontrolled, and the samples do not establish clinical accuracy or a guaranteed response time.

[Official latency guidance](https://developers.openai.com/api/docs/guides/latency-optimization) supports reducing repeated requests and using direct application logic when a model is unnecessary. No paid priority tier, unsupported plan-route field, model fallback or API key is introduced. Full results and any remaining latency limits are recorded after verification; intended-person/device and full-slice gates remain open.

## Results and review deployment

The prepared-context trial is deployed only in the practice copy, labelled “Sol / low (prepared context trial)”. Dad’s existing process, model/settings, assets and care data remain unchanged. [Sanitized evidence](evidence/CONTEXT-PREPARATION-2026-10-22.json) records all phases and exact revision scope.

| Matched test | Baseline first audio | Prepared first audio |
|---|---:|---:|
| Overall median, eight scenarios/two repetitions | 4.6 s | 3.1 s |
| Exact local appointment time | 6.4 s | 1.9 s |
| Exact recipe quantities | 8.5 s | 2.6 s |
| Separate final meal retest, three repetitions | 5.2 s | 4.6 s |

The final matched pass used 18 model requests for 16 baseline answers and 10 for 16 prepared answers. Provider-reported input totals were 134,512 versus 36,540 tokens across actual calls. Exact local lookups made no inference requests; unknown usage fields remain unknown in runtime telemetry. The initial preparation pass did not improve the overall median and made three time-conversion mistakes; it was not deployed. Explicit saved-instant/local-zone formatting repaired the unambiguous time queries, and final core checks pass 16/16 plus 3/3 meal replies. Unknown or ambiguous questions retain the model path.

Both controlled passes precede the final conservative fallback refinements for unknown questions and possible actions. The matched pass also precedes the shorter meal wording, which the separate meal retest measures. The measured meal request retains that wording and route in the deployed version. Full regression and normal HTTP checks cover the final source revision; the phase hashes preserve each measured version. These phases must not be combined into a new overall median.

**Conversation latency is still unresolved.** On the actual test-site route, the meal sample was 6.4 seconds, empathy 4.0, exact recipe quantities 4.1, recipe cooking follow-up 8.5 and unavailable Outlook 2.4. The reply bodies for direct recipe/availability facts finished in under 0.2 seconds; their remaining time was largely speech generation/delivery. Four additional identical local-only speech tests found no meaningful priority effect (roughly 1.8 seconds under both settings); original worker priority was restored and no persistent scheduling change was made. Small sample/provider/cache/hardware variation prevents treating the controlled median as a phone guarantee.

Final validation passes 1,027 tests with two optional skips across 112 files, typecheck, a build into a private directory, 35 normal HTTP checks, 27 local-only diagnostic checks and 56 final preservation/readiness checks. All 15 protected care tables in each database are unchanged. Across all phases, 88 Pro response requests were used within the single 100-request cap; no API key, provider write or real care write occurred. Actual iPhone/Safari speaking/listening and full-slice gates remain open.
