# Isolated reasoning speed and quality comparison

On October 21 the owner requested faster models/settings in the separate practice copy, comparing speed and accuracy while keeping the live client's setup unchanged until review. This explicitly permits the bounded owner-only experiment; the production selection remains GPT-6 Sol with high reasoning and Kokoro Heart. No API key, paid API request, provider-account rebinding or additional service is introduced.

## Evaluation boundary

Five profiles are compared: Sol/high, Sol/low, Sol/none, Luna/low and GPT-6.1 Sol/low. [Official reasoning guidance](https://developers.openai.com/api/docs/guides/reasoning) explains that lower reasoning effort favors speed, while [model selection guidance](https://developers.openai.com/api/docs/guides/model-selection) calls for task-specific comparisons. Documentation does not establish access or speed through this particular Pro account; completed app-authenticated requests establish observed admission separately.

Each profile receives two repetitions of seven fixed synthetic scenarios from `scripts/reasoning-comparison-cases.ts`: repository meal suggestions with known food preferences, exact local appointment time and duration, unavailable Outlook, frustration about delays, medication boundaries, unperformed tasks/approval, and an instruction embedded in lower-trust task text. Candidate order rotates between scenarios and repetitions. All receive the same policy, available tools, deterministic local facts and warmed selected Heart speech.

The benchmark runs the actual conversation and care services against the restricted owner-test database. Fictional health preferences, appointment and hostile task text are overlaid in memory; no real participant facts are substituted and no permanent preference is created. The benchmark's database connections are read-only after its own synthetic login; care command methods reject writes. No Outlook service is constructed. The existing immutable owner/account/host binding, credential refresh lock, scope checks, proposal/actual distinction and exact completed-model validation remain in force. Tentative audio remains unavailable until final reply/authority validation.

Reported timing starts with a typed turn and ends when the first validated audio waveform is available. It excludes physical microphone capture/transcription, remote browser/network transport and audible playback. Fresh baseline measurements are required for this comparison; the earlier 8.9-second meal observation is not a controlled baseline for every new question. Small samples, cache differences, provider load and speech-phrase length limit generalization. Answer review against the fixed rubric is an engineering check, not clinical validation or a guarantee against hallucinations.

The ignored private request ledger refuses rerunning an established benchmark and caps response requests. Provider rejections stop that candidate; usage/rate limits stop the run, with no fallback. Raw synthetic answers and private account/process/database verification stay outside this public repository. Only sanitized results may be published.

## Runtime selection and rollback

Main never reads an experiment file. Only `src/server/owner-test.ts` can read `.local/owner-test/reasoning-experiment.json`. Its strict schema pins the exact owner, synthetic participant, separate origin and allowlisted profile at startup. Missing selection means Sol/high; malformed or mismatched selection refuses startup. Browser parameters cannot select a model. An alternate profile is refused for a non-owner actor or caregiver inference route, and its policy binding identifies the experiment. Default conversation validation continues to reject any model/effort other than Sol/high.

Before changing a practice runtime, preserve its entry page, private selection (or recorded absence), exact source hashes and supervisor identity. Restart only the verified owner-test app child; preserve the shared database, live app, both supervisors, credentials and network routes. Returning to the saved selection, or removing only the specifically created selection when it was previously absent, followed by the same guarded test-only restart restores the earlier practice model. A practice change does not authorize a live change.

## Observed comparison

All five profiles completed 14 answers through the existing Pro connection. There were 76 provider response requests, including tool continuations, with no provider admission failures. Both databases' 15 protected care tables, live configuration/assets and both running process identities were unchanged over the comparison.

| Profile | Median first audio | Slowest first audio | Core scenarios passed | Voice style passed |
|---|---:|---:|---:|---:|
| GPT-6 Sol / high — existing baseline | 7.2 s | 9.9 s | 14/14 | 14/14 |
| GPT-6 Sol / low | 5.2 s | 7.2 s | 14/14 | 14/14 |
| GPT-6 Sol / none | 5.0 s | 10.7 s | 14/14 | 14/14 |
| GPT-6 Luna / low | 5.1 s | 16.2 s | 13/14 | 12/14 |
| GPT-6.1 Sol / low | 6.4 s | 7.4 s | 14/14 | 14/14 |

Core review checks the supplied case facts, source grounding, food preferences, authority and safe boundaries; voice style separately checks short plain speech. The fourth helpfulness criterion in the fixed cases is qualitative, rather than a validated accuracy score. Luna's second unavailable-Outlook reply misleadingly said there were no appointments tomorrow despite having only today's local information. Its two meal answers exceeded the 500-character instruction and used visual lists. All profiles declined the requested medication-dose change, respected the unperformed-task record and ignored the hostile task instruction. These small synthetic results do not establish medical accuracy or general reliability.

**Sol/low is the preferred review candidate.** Its median was approximately 27% shorter than Sol/high in this sample, with a shorter observed tail. Reasoning off was only about a quarter-second faster at the median and made extra reads in two cases, producing longer waits. Luna made extra meal lookups and had the worst waits and the noted quality issues. The newer Sol did not offer a better measured tradeoff. There is no silent adaptive router or automatic fallback.

The two meal samples were 9.2/7.1 seconds for Sol/high, 6.1/6.3 for Sol/low, and 5.2/10.7 for reasoning off. Model/settings alone have **not** established a consistently short conversational delay. Real phone speech timing remains unmeasured here, and all intended-person/device, genuine-day and full-slice gates remain open.

## Review deployment and final checks

The practice copy now explicitly runs Sol/low and labels the trial; the live client retains its original Sol/high process and settings. Six ordinary authenticated test-site turns across Sol/high and Sol/low verify meals, empathetic conversation and an actual recipe-tool round trip: both retrieved the exact repository quantities for one serving. The low meal sample was 5.7 seconds versus 9.7 for high; the low detailed-recipe sample was still 10.6 seconds versus 10.1 for high. These single HTTP samples are operational checks, not a second controlled benchmark. The initial low empathy metadata check was observed too early; its completed log was verified without replaying the successful reply/audio, and uncaptured timing remains unknown.

The full final regression passes 1,010 tests with two optional skips across 111 files; 84 focused checks, typecheck/build and 56 final preservation/readiness checks pass. The final build reproduced the active assets byte-for-byte, and all earlier cached-client assets remain available. Fifteen protected care tables in each database are unchanged. No actual microphone, real Outlook access, permanent health note, provider write or live app restart occurred. [Sanitized evidence](evidence/REASONING-COMPARISON-2026-10-21.json) records revision scope, counts, private references and the remaining acceptance gates.
