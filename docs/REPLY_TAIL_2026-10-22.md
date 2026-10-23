# Remaining reply delay and test repair — October 22, 2026

The exact owner test copy now runs warm-v2. It removes reasoning from known unavailable-Outlook replies and bounded requests to take the conversation one idea at a time. A fresh run of the previously failed HTTP contract passes. General-model latency remains variable: the experimental public-reference prefix did not reliably improve the slow end and was rejected.

Heart, its speaking speed, Dad’s running process/settings/data, the locked Current interface and the caregiver route are unchanged. Reasoning remains Sol-low through the existing owner-bound Pro connection. No API key, paid tier, purchase, new model, connector action or API billing was used.

## Selected changes

“Is my Outlook connected?” previously matched the broader question grammar but still failed the separate read-question condition. That sent it through the full model workflow even though this test service intentionally has no Microsoft connection. warm-v2 keeps this read-only question on the existing scoped schedule/source path. A known unavailable connection returns the existing fixed explanation. A configured source never receives this unavailable answer merely because the faster path exists. Unknown appointments remain unknown.

Whole-message requests such as “Please slow down” and “Can we take one idea at a time?” receive one concrete conversational response. The full dialogue is retained for the next turn. This is conversation pacing, not a speech-rate change, spoken interruption feature, saved care preference or protocol update. Additional symptoms, medication, actions and mixed requests cannot be swallowed by the pacing matcher; they retain their authorized workflow.

Both changes require the startup-only exact owner/client/origin warm-v2 selection and its existing trial dependencies. Previous warm-v1 behavior remains available for rollback. Main defaults remain off. Final scope checks and validated reply/audio delivery stay in place.

## Speed and accuracy

The final source revision is `sha256:d4f38eb5fed5bca4f43f688847b3907bbca1eba6ad6272b91bcc65ba27a350d3`, with 348 complete manifest entries. The matched service test uses the same synthetic facts, owner binding, Sol-low and Heart settings on both paths. Model calls, care authorization and native WAV validation run normally; tests/builds are stopped during timing.

| Matched service interaction | warm-v1 | warm-v2 | Selected foreground model calls |
|---|---:|---:|---:|
| Known disconnected Outlook status | 4.741 s | 0.056 s | 0 |
| Request to take the conversation one idea at a time | 2.204 s | 0.051 s | 0 |

Both selected replies passed manual factual/product-capability review, with zero care writes. The pacing reply offers one idea at a time without promising a spoken pause or interruption command.

The actual deployed owner-test HTTP run produced:

| Interaction | First validated Heart audio | Foreground model calls |
|---|---:|---:|
| Fresh compass explanation | 2.455 s | 1 |
| Conversation pacing request | 0.066 s | 0 |
| Known disconnected Outlook status | 0.073 s | 0 |
| Compound sunlight/blue-sky/violet question | 2.088 s | 1 |

All four actual answers passed manual review. The compass reply distinguishes magnetic north from the geographic North Pole. The color reply preserves ordinarily white sunlight, blue scattering more than red, violet scattering still more, and the role of eye sensitivity. The unavailable-source answer claims no calendar access or absence of appointments.

These are typed-request-to-first-ready-WAV timings after local speech warmup. Microphone endpointing, ASR, device networking/playback and actual listening are unmeasured. Separately, a loaded Heart worker took 0.813/0.816 seconds to synthesize the two target replies before their audio was cached. Those are speech-component timings, not cold end-to-end response times.

## General-chat experiment rejected

The [official prompt-caching guide](https://developers.openai.com/api/docs/guides/prompt-caching) describes reuse of stable prefixes and a minimum cacheable visible prefix length for current models. The [ChatGPT plan preview requirements](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) continue to govern the existing subscription route. The experiment used normal supported request fields and automatic cache reuse; it selected no separately billed API service.

A private direct-model screen compared the existing policy warmup with useful reviewed public facts from the existing fourteen-card packet, supplied as lower-trust data ahead of fresh synthetic context. It added no answer types. Eight unfamiliar questions ran twice per path, with reverse path order in the second repetition and the same Sol-low/Heart settings.

| Thirty-two-answer screen | Existing warm path | Public-reference prefix |
|---|---:|---:|
| Answers per path | 16 | 16 |
| Median first audio | 2.4165 s | 2.3765 s |
| Slowest reply | 3.567 s | 5.441 s |

The 40 ms median gain is insufficient, and the slow end worsened. The candidate showed 1,664 cached input tokens, so cache hits alone did not resolve long waits. The slowest sample waited 4.201 seconds for its first model text. Internal provider queue timings were not observed; the measurements do not isolate the cause of that wait.

Subject-matter checks passed, but generated pacing answers also included unqualified spoken-pause claims. The selected fixed pacing response avoids that claim for its bounded whole-message requests. The public-prefix integration prototype was not executed or deployed; its source was retained privately and restored before final qualification. General model-generated answers and differently worded requests still need review, and occasional longer waits remain open.

## Failed probe repaired in a fresh run

The [previous HTTP failure](WARM_CONVERSATION_2026-10-22.md) remains recorded: one legitimate Outlook-status model call violated a zero-call assertion and made 65 attempts against the planned 64. Its saved result is unchanged.

The new run repairs both causes. The status question now follows its proven zero-inference source route. The test also reserves the entire permitted upper bound before starting: four turns × five model/tool rounds, plus six continuation-preparation attempts and one connection warmup, for **27 reserved attempts**. Counting no longer assumes a factual-sounding question is free. A regression fixture reproduces the previous four actual stages, excludes duplicate turn summaries and preserves missing observations as unknown.

Warmup telemetry now carries the server-generated conversation ID. The actual counter uses that conversation directly, including warmup, foreground and continuation stages. The fresh probe passes **all 31 checks**, with **five observed attempts within the 27-attempt reservation**. All request counts are known; token use for an interrupted continuation remains unknown rather than being estimated as zero.

The five actual attempts consist of one context-only warmup, two foreground answers and two continuation attempts. The warmup took 0.984 seconds, with 411 reported input tokens and zero output tokens. A continuation took 7.172 seconds separately; another was interrupted after 1.970 seconds and is still counted. These preparation costs are separate from foreground reply latency.

Across this new experiment, **73 of 96 permitted Pro attempts** were used: 64 in the rejected screen, four in the final matched service test and five in actual HTTP. The ledger is closed with 23 unused. S01-AUTO27 records a new current-revision pass; the historical failed result is preserved. S01-AUTO28 covers the bounded source/pacing changes and rejected latency experiment. Neither result completes S01 or real-person acceptance.

## Preservation and review

- Full final suite: **1,233 passed, zero failed, two existing optional skips**, 120 files. Focused final checks: 140 passed, zero failed. Typecheck passes.
- The private client build has the identical Current JavaScript/CSS assets; Focus stays disabled.
- All 43 protected configuration/care checks pass, including 30 unchanged care tables across the two databases.
- All 366 deployed source/readiness checks pass. Dad’s process/run and both supervisors are unchanged. Only the verified owner-test child restarted.
- Previous exact warm-v1 selection and UI entry are backed up. The prepared rollback restores only those test files and restarts only the verified test child; it restores no care database or credential.
- No push, merge, client rollout, migration, clinical protocol change or person/device/audibility/genuine-day acceptance is claimed.

[Sanitized evidence](evidence/REPLY-TAIL-2026-10-22.json). Full synthetic responses, audio details, actor bindings, process identities, rejected prototype and rollback material remain in ignored private evidence under `.local/reply-tail-2026-10-22/`.
