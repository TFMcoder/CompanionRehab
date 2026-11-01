# Outlook latency candidate — October 26, 2026

**Subsequent review and owner activation:** This is the earlier candidate record. The candidate has since been reviewed, repaired and enabled with labelled synthetic sources in the owner copy; see [the current review/activation report](OUTLOOK_OWNER_ENABLE_2026-10-26.md). Earlier measured results and limitations below are retained as historical evidence.

The default-off owner candidate reduces the quiet seven-case median from **6.406 to 4.338 seconds** to first native Heart WAV, a **32.28% reduction**. It uses the existing Sol-low/account route and unchanged Heart. Both deployed releases remain selected as before; the candidate has not been activated. This qualifies an engineering candidate for review, not a phone or live-mailbox speed gain.

The [sanitized evidence](evidence/OUTLOOK-LATENCY-2026-10-26.json) records current revision `sha256:a9b0e25652af91344c169be359115d76ab3c224ad37288729878b387d29dde3b`. The current full suite passes **1,549 tests with two optional skips**, plus type checking and an isolated locked-Current build. The 37 new read-path tests are part of that full total; the earlier 64-test focused run overlaps it.

The new constructor option is owner-only and requires prepared Sol-low. It is incompatible with the client rollout authorizer and has no persisted/browser switch. The ordinary owner runtime is unchanged. Only whole, explicit calendar or Inbox questions use the candidate: named weekdays, tomorrow, next week, seven local days or exact ISO dates. Ambiguous dates, multiple intentions, care actions and planning keep the existing path. Voice selection is unchanged.

The service prefetches the exact participant-local range and selected source, preserving DST and independent recent-Inbox semantics. Calendar-only questions avoid Inbox retrieval; Inbox-only questions avoid calendar retrieval. Encrypted snapshots now distinguish source scope, so a calendar-only cache cannot masquerade as an empty Inbox. The model receives the existing core policy, fresh safety/identity context, history and exact source metadata, with unrelated care records and tool schemas omitted. Calendar prefetch removes the redundant read tool; Inbox retains exact-message retrieval for missing details. Current authority and final audio authorization checks remain in place. Fresh partial/unavailable results stay uncertain.

## Measured results

The primary repeat uses actual local ASR, existing owner Pro reasoning and native 24 kHz Heart through the authenticated application audio/speech HTTP handlers, with actual disposable PostgreSQL. HTTP requests are injected into the real handlers; no public HTTPS or phone network is measured. Graph is simulated at MicrosoftService with synthetic appointments and email, and no Microsoft credentials are copied or live care databases opened by the trial.

Seven scenarios were run once per arm in each of two HTTP batches. Order alternates, then reverses in the repeat. The first batch overlapped regression work; its median is 7.460 → 4.356 seconds. The repeat below ran with regressions stopped. Native speech workers were warm, static connection preparation was awaited outside the timed turn and counted, and connector snapshots were cleared between arms.

| Quiet-repeat question | Original path | Candidate |
| --- | ---: | ---: |
| tomorrow | 4.096 s | 4.845 s |
| weekday | 7.452 s | 4.871 s |
| next_week | 6.150 s | 5.325 s |
| dst_week | 4.462 s | 4.338 s |
| inbox | 7.478 s | 3.928 s |
| empty | 6.406 s | 3.628 s |
| partial | 6.507 s | 4.026 s |

The quiet repeat's slowest observed sample is 7.478 → 5.325 seconds. Across the seven turns, model requests fall **12 → 7**. Median actual input per model request falls **2,981 → 1,280 tokens**; median total input per turn falls **5,578 → 1,280 tokens**. Median model duration per turn is **4.844 → 3.225 seconds**. ASR medians are about 0.671/0.664 seconds; simulated-source/service read medians are 29/28 ms. These independent stage medians are not additive, and speech synthesis can overlap generation.

The gain is concentrated in removing date/retrieval rounds and unrelated context. Tomorrow regressed by 0.749 seconds in the quiet repeat; single-round replies remain variable. Mixed planning/advice retains the original reasoning path. Scoped snapshots share the existing cache slot, so a later mixed-source question may need a fresh combined read; successive-turn latency is not yet qualified. These samples do not support statistical significance or percentile claims. The previous 9.977-second connected-client result used real Microsoft and different recorded wording; it is not a matched baseline for this fixture.

## Accuracy, safety and accounting

All **34 scored HTTP turns pass**: 17 candidate and 17 baseline. Independent source/range checks and manual comparison against known fixture facts cover tomorrow, Wednesday, November 2–8, the 169-hour DST week, unread-versus-unanswered uncertainty, complete empty results and partial results. Three additional matched pairs preserve appointment-email ambiguity, the 14:30 task overlap with a known 14:00–15:00 appointment and unsaved planning advice. Every response is changed=false and produces a native first Heart part. No accepted plan or actual activity is created in any fixture. Malicious synthetic provider text is kept lower trust and does not cause a write.

Regressions cover stale/source-incompatible caches, absent disclosure consent, resource changes and grant revocation during reasoning, invented write calls, exact retries, DST/year boundaries and mixed-action exclusions. Review added an explicit connected/eligible/disclosure gate, retaining the prior path when any prerequisite is absent. That guard was added after the first HTTP batch and during the repeat; the measured connected branch, payload, policy and tools are unchanged, and the final frozen regression run includes the guard.

Three new ledgers are closed at **48/80 preliminary + 47/80 HTTP + 33/40 repeat = 128 requests**, comprising 74 model and 54 static-preparation requests. All core numeric usage is known: **238,227 input / 3,090 output / 241,317 total tokens**. Optional usage unknowns remain unknown. No historical ledger was reopened, no real Microsoft request was made and no separately billed API route was used.

The preliminary 20-turn screen is excluded from final accuracy and speed scoring but fully counted. Its older synthetic email said “tomorrow” relative to an uncertain author date; final fixtures use an explicit appointment date. Its earlier policy/tools and concurrent regression load also differ. Initial type/staging/import/runner failures, the interrupted suite and a 1,548-pass/one-failure run with an incorrect no-disclosure tool expectation remain in private evidence; they are not presented as passes. The earlier 1,545-pass run changed source during execution and is not final-revision qualification.

## Preservation and remaining gates

All **354 protected runtime source, asset, configuration and release-pointer checks pass**. Both original application/supervisor identities remain, and both existing readiness endpoints report configured/voice ready. No runtime restart, live-data migration, root install, provider write or live care/session write was initiated. All three owned fixture databases were removed. This operation did not perform a new row-by-row live care audit.

There is one explicit isolation exception: Vitest wrote its generated `node_modules/.vite/vitest/.../results.json` through the link to the owner release's pinned dependencies. No runtime source, settings, assets or package file change was observed. Only the verified own test process tree was stopped; the final full run uses `--no-cache`, and the cache digest is unchanged after that run. No original cache digest was captured, so exact byte-for-byte release-directory preservation is not claimed. The cache is not served application code.

Dad's selected release, caregiver/account/host/grant binding, locked Current, selected Heart, Outlook resource selections and permissions remain unchanged. The owner Asana runtime is also unchanged. Neither reconnect nor a broader account route is authorized or needed for this experiment.

Actual person/Safari/Wi-Fi/cellular capture and audible playback, genuine-day planning, nonempty live Outlook reasoning, provider refresh/revocation/recovery and full S01/S06 acceptance remain **awaiting_live_test**. The candidate stays default-off and owner-only pending review; any client promotion requires a separately prepared exact-route candidate and qualification, reusing existing approval and sign-in without expanding access.
