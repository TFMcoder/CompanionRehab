# Owner-copy unfamiliar-question latency — October 22, 2026

**Follow-up:** The active owner candidate is now warm-v2. A fresh S01-AUTO27 HTTP run passes 31 checks within its conservative reservation; the failed run below remains historical and unchanged. See [remaining-reply repair](REPLY_TAIL_2026-10-22.md).

The separate owner test copy now uses an opt-in warm Pro connection and a broader read-only conversation route. This accelerates unfamiliar questions without extending the fourteen-answer reference pack. Sol-low, the selected Heart voice and speaking speed, the locked Current interface, Dad’s running process/settings/data and the exact caregiver route are preserved. No API key, paid service tier, new subscription, local model installation or API billing was used.

The candidate is active at the existing owner test URL on port 10000. It is an engineering review candidate, not a completed slice or a Dad rollout. The original actual-HTTP probe remains **failed** for its status-call expectation and request reservation; the accurate recorded replies were reviewed separately. S01-AUTO27 retains that failure.

## Change and boundaries

Official [ChatGPT plan preview requirements](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) permit WebSocket continuation on the same authenticated connection. The [WebSocket guide](https://developers.openai.com/api/docs/guides/websocket-mode) documents a `generate:false` preparation that produces no model output. These are transport capabilities; neither promises a particular latency gain.

On authenticated foreground Talk startup, warm-v1 prepares only the known trusted ordinary-conversation instructions. It sends no human question, care facts or predicted answer. The first generated request may use the empty-input warm response once. Later generated turns send complete fresh dialogue and authorized facts without reusing that response ID. The same completed-response parser and before/after account checks remain mandatory before audio delivery.

Common read-only question forms such as “Could you explain…”, “Is…”, “Does…” and short story requests can use the short conversation policy. This is general question routing, not another list of answered topics. Existing action, meal, calendar, clinical and ambiguous workflows keep their scoped paths. Ordinary conversation has no care-write tools; care/tool inference retains the existing HTTP route and model profile. There is no error-triggered provider or model fallback.

The startup-only selection requires the exact owner/client/origin and existing reference/chat/meal/Heart trial. Main defaults remain off. Preparation is limited to eighteen attempts per runtime, a twelve-second preparation timeout, a two-minute connection lifetime and bounded response size/time. Ending the conversation, logout and incompatible scope/account changes clear the connection. No response IDs or private context are persisted by this transport. Preparation is foreground-only; no recurring job or background speech was added.

## Measured results

All timings below start at a typed synthetic request and end at the first validated native Heart WAV. They exclude microphone endpointing, ASR, physical-device networking/playback and actual listening. Tests/builds were stopped during timing. Preparation time is measured separately.

| Controlled direct-model screen | Existing HTTP | Warm Pro |
|---|---:|---:|
| Answers per path | 16 | 16 |
| Median first audio | 2.904 s | 2.480 s |
| Fastest | 2.492 s | 1.910 s |
| Slowest | 17.579 s | 4.118 s |

Eight fixed unfamiliar questions were repeated twice per path, with reverse path order on the second repetition. They cover heat transfer, floating ice, soap, independent coin tosses, a compound sunlight/sky question, an unknown personal favorite, conversational pacing and a short fictional story. None matches a whole-question reference answer. Policies, model, effort and Heart settings were held fixed. Static-policy warmup took 0.835–3.745 seconds before the question. The median gain is 14.6%; the slow HTTP outlier is retained and is not evidence of a general tail-latency guarantee. All 32 completed answers passed the fixed manual factual/helpfulness review.

The final service comparison includes care authorization, fresh context, conversation history and the broader opt-in routing:

| Fresh service question | Existing path | Final candidate |
|---|---:|---:|
| How a zipper works | 2.477 s | 1.992 s |
| Tomato: botanical fruit versus culinary vegetable | 3.679 s | 2.494 s |
| Two-case median | 3.078 s | 2.243 s |

Both answers per path were reviewed as correct, with zero care writes. The second new question succeeds within the same conversation. This small two-case comparison supports the candidate; it does not establish the same improvement for all questions.

The deployed test service then returned a fresh compass explanation in **2.493 seconds**, correctly distinguishing magnetic north from the geographic North Pole. The unchanged reference path returned thunder in 1.001 seconds and its immediate why-follow-up in 1.711 seconds, both with zero inference. The Outlook status answer accurately stated that the test account is disconnected, but used its existing model-dependent route and took 3.659 seconds. Heart first-part readiness remains variable.

The actual static-policy warmup took 1.014 seconds, with provider-reported 411 input tokens and zero output tokens. Existing continuation preparation after the compass answer took 8.620 seconds separately, including one model call. It is not included in the new-question latency result or presented as free computation.

## Retained failures and accounting

An initial private streaming adapter had a terminal cleanup race after eight completed HTTP baselines. Those completed samples are retained; the context-only warmup attempt was counted. The adapter was corrected before the remaining screen.

An intermediate service candidate answered its first unfamiliar question but failed on a later turn. Reusing the static warm response after the connection cache advanced is the likely cause; the provider error code was not retained, so this diagnosis is an inference. The implementation now consumes that parent once, then sends full fresh input without it. The failed question was not automatically replayed. The final successive-turn test passes.

The deployed HTTP probe incorrectly asserted that its Outlook-status wording must use zero inference. Its answer was honest and used one legitimate existing-route Pro call. That failed the assertion and increased actual runtime requests from the reserved three to four. Total experiment use was **65 Pro requests against a planned cap of 64**. Further provider testing stopped; the ledger is closed. No API billing occurred.

The original failed probe is preserved. A read-only review of its saved responses confirms 27 other functional checks and all four actual factual answers. That review is not a rerun and does not retrospectively turn the probe or cap check into a pass. S01-AUTO27 is recorded as failed for this bounded-probe contract, separately from the passing source regressions. A corrected harness is prepared with the one-call status expectation and four-request reservation; its counter is checked against the saved events, without executing another provider request. A future bounded execution remains unrun.

## Verification and review limits

Final implementation: `sha256:3eabbcc1fbb50d84847839e41320e6aac0adde56f22d533dc3acab3047e141eb`, with 346 source/configuration/policy/launcher manifest entries.

- Full final suite: **1,209 passed, zero failed, two existing optional skips**, 119 files. Focused final tests: 134 passed, zero failed. Typecheck passes.
- Private client build retains the identical Current JavaScript/CSS assets. Focus remains disabled.
- Thirty protected care tables and protected configuration remain unchanged across both databases. All 43 preservation checks pass.
- All 364 deployed source/readiness checks pass. Dad’s app process/run and both supervisors are unchanged. Only the verified test child was restarted.
- Owner login and existing Pro-store file hashes are unchanged. No credential copy, rebind, Microsoft action, care mutation, push or merge occurred.
- The previous exact test selection and entry are backed up. A guarded rollback is prepared; it restores only those test files and restarts only the verified test child.

General latency, physical-device listening, real-person use, clinical correctness, genuine-day acceptance and full-slice gates remain open. Some unfamiliar answers still exceed four seconds in the wider screen. The small final comparison is not a universal sub-two-second result. Dad’s setup remains unchanged pending review.

[Sanitized numeric evidence](evidence/WARM-CONVERSATION-2026-10-22.json). Full synthetic responses, audio, actor bindings, process details, failed probes and rollback material remain in ignored private evidence under `.local/novel-questions-2026-10-22/`.
