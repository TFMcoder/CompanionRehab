# Owner cold/foreground and full-message latency — October 27, 2026

The revised candidate is enabled only in owner release `outlook-speech-2026-10-26`, revision `sha256:ca93411966c54d8d0aee2f68ef4c2c5b6625652f951f54a285b9eb573280e7e3`. Full-message median first native Heart availability improves **12.295 → 4.146 seconds (66.3%)** across three samples per version. Foreground meal preparation becomes ready **9.045 → 2.950 seconds** in one comparison. The historical 18.483-second cold first-read outlier is **not proved eliminated**.

Dad's process, release, settings, care records and exact caregiver/account/host/grant route remain unchanged. Heart, speaking speed, CPU profile, Sol-low, account binding and locked Current bundles are retained. Only the owner's `outlook_mode` changes from `fixture-fast-v1` to `fixture-fast-v2`, with one verified owner child restart. The previous release is preserved for rollback. The owner source remains explicitly labelled **synthetic practice Outlook data**, without Microsoft credentials, network access or provider writes. Real Microsoft remains connected only on its existing approved route.

The [sanitized evidence](evidence/OUTLOOK-TAIL-LATENCY-2026-10-27.json) records numeric observations and private references. It supersedes the full-message implementation and owner pointer in the [previous activation checkpoint](OUTLOOK_OWNER_ENABLE_2026-10-26.md); that report's measurements remain historical evidence.

## Changes and authorization review

Strict full-message requests now resolve one unique message from a complete, current, selected Inbox snapshot and prefetch its body before one model call. Both selected folder and exact message ID are checked, including the returned provider ID. Authority is revalidated before disclosure and inference. The body remains lower-trust data; the model receives no action tools on this route. Missing, ambiguous, omitted/partial or unavailable results require truthful clarification rather than guessing. Mixed instructions retain the ordinary reviewed workflow. Long/truncated bodies must not be described as a complete reading.

Owner-v2 still prepares and validates bounded meal choices, but no longer queues speculative audio variants for them. Requested meal audio is synthesized on demand. Actual ASR can start while canceled background jobs drain; reasoning still waits for the drain and fresh authorization. Only an explicit authorized Talk action can start a bounded local recognition prelude after idle, using an already cached fixed public navigation WAV. This does not capture a microphone, call a remote model or retain a transcript. Existing defaults and Dad's deployed code are unchanged. Stale choices, revoked scopes and incompatible contexts remain guarded.

## Before/after observations

The full-message comparison uses three fresh conversations before and three after activation, the same recorded synthetic question, actual owner HTTPS endpoints, native ASR, established owner Pro reasoning and native 24 kHz Heart. Static connection preparation completes outside each timed request. Phases are sequential, not randomized; no regression suite runs alongside the audio measurements. These are server WAV-availability measurements, excluding physical microphone capture, playback and human audibility.

| Full-message reading | Before | After |
| --- | ---: | ---: |
| First Heart, three samples | 12.295 / 10.665 / 12.784 s | 4.146 / 4.289 / 3.849 s |
| Median | 12.295 s | 4.146 s |
| Reasoning rounds per answer | 3 | 1 |
| Model tool calls per answer | 2 | 0 |
| Total input tokens across answer rounds, median | 29,050 | 1,628 |
| ASR, median | 0.454 s | 0.400 s |

All six replies preserve the complete exact synthetic body, including its proposed date/time and explicit unconfirmed-booking wording. All are `changed=false`; reading a suggestion neither accepts a plan nor reports a performed activity. The three deployed revised turns record the detail-prefetch hit. No real mailbox timing is established.

The separate preparation comparison follows the ordinary foreground session endpoint, readiness polling, Talk/static preparation, then a typed breakfast question and first native Heart. It has **one sample per version**, no ASR, and retains the existing ten-minute preparation limit. Both versions reuse a validated prepared choice with no additional inference when answering; neither saves care data.

| Foreground meal workflow | Before | After |
| --- | ---: | ---: |
| Preparation ready | 9.045 s | 2.950 s |
| Requested meal to first Heart | 0.218 s | 1.095 s |
| Session entry to first meal Heart, including static preparation | 10.332 s | 6.129 s |

The tradeoff is explicit: removing speculative audio work improves readiness and session-entry timing here, while the later meal request waits for on-demand synthesis. This one comparison does not qualify every meal or cold-device response.

## Rejected startup experiment and remaining cold limit

Three alternating pairs of fresh native worker processes tested an extra startup ASR/speech warm-up with the same public files, fixed answer, selected Heart and device. It made median boot-to-WAV worse, **13.576 → 16.696 seconds**; request-to-WAV medians were 1.751 versus 1.676 seconds. Existing native startup already warms recognition. The extra warm-up was removed and is not deployed. There were zero model/network requests in this experiment. Fresh worker processes with cached model files are not a machine reboot or phone-idle trial.

The final implementation reduces avoidable foreground/background contention instead. The first revised message sample after voice readiness takes 4.146 seconds, but this does not reproduce the earlier 18.483-second idle/cold outlier or prove its elimination. Startup still waits for ordinary speech/navigation preparation. A premature post-restart benchmark correctly received `voice_unavailable`; its zero-request ledger was closed, readiness was checked, and the successful retry used a new ledger. Actual long-idle, host-cold and physical-phone tails remain open.

## Verification and preservation

The frozen final source passes **1,584 tests, two optional skips, across 136 files**, type checking and an isolated build. The 122 focused assertions are an overlapping subset. Actual owner PostgreSQL/HTTP passes **21 authorization/source checks**, using four mocked model calls and zero real inference calls. Revocation, exact returned-ID mismatch, ambiguity/partial results, mixed intent, stale prepared choices, foreground cancellation ordering and owner-v2 restrictions are covered. A revocation test initially deadlocked its own test transaction; corrected ordering passes in the full suite. A final read-only readiness helper's reserved variable name was corrected before its successful run.

All five fresh ledgers are closed: **12/24, 2/12, 0/24, 6/24 and 2/12**, totalling **22 existing-Pro requests**, with zero unknown request/core-usage events and no API billing. This includes 12 ordinary model rounds, eight connection preparations and two meal preparations. Observed usage totals **102,717 input / 498 output / 103,215 total tokens**. Historical closed allowances were not reopened. All six new engineering login sessions are closed.

Preservation passes **929 unchanged protected files**, plus exactly three expected owner control/proof changes. All records in **64 client and 67 owner tables**, and **153 original login sessions**, retain their hashes. The account/host binding and every other owner selection field are unchanged. Prior releases, dependencies and old generated dependency cache are unchanged. Both services are configured and voice-ready; normal and Safari owner pages retain practice notices and identical qualified UI bundles. No migrations, real care writes, provider writes, credential copying or root dependency installation occurred.

The actual intended-person microphone, audible Heart, Safari Wi-Fi/cellular, genuine-day/client approval, provider lifecycle and full S01/S06 gates stay **awaiting_live_test**. Mixed, successive-turn and long/partial-message latency remain separately qualified work. No human action or full slice is completed by this engineering benchmark.

The generated human-action view matches the canonical JSON. Roadmap validation passes (12 slices, 36 human actions, 89 automated checks, 42 live scenarios, zero completed features); public-boundary scanning passes across 541 files with zero findings, and the whitespace check passes. These structural checks do not replace actual device or full-slice acceptance.
