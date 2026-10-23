# New general-question trials — October 22–23, 2026

No candidate qualified, and neither running app’s selection was changed. The owner test copy remains warm-v2 with Sol-low and Heart; Dad’s original settings/data and Current are preserved. Faster local output failed accuracy checks. The general-question delay remains unresolved.

| Trial | Answers | Median first validated Heart audio | Slowest | Decision |
|---|---:|---:|---:|---|
| Current Sol-low, existing Pro | 18 | 1.9245 s | 3.090 s | Retain |
| Luna-none, same Pro/context/cases | 18 | 1.9805 s | 2.938 s | Reject: no median gain |
| Local 0.8B Q8, full synthetic context | 18 | 0.9305 s | 1.296 s | Reject: accuracy |
| Local 2B Q5, 64-token thinking budget | 18 | 1.584 s | 4.220 s | Reject: accuracy |
| Local 2B Q5, standalone public protocol | 24 | 1.473 s | 1.772 s | Reject: accuracy |
| Pro Fast compatibility | 0 Fast answers | Not qualified | Not qualified | Preparation failed; direct HTTP 400 |

The first two rows are matched: nine questions, two repetitions, reversed profile order on the second repetition, identical trusted policy and synthetic facts. All 36 matched Pro answers pass manual core factual/unknown-information checks. Six supplemental standard answers before the Fast preparation failure also pass. Local raw-context probes use the same nine questions. The standalone-public probe uses twelve different questions; its aggregate is not an apples-to-apples Pro comparison. No tests/builds run during latency measurement.

Timing is typed input to the first completed, validated native Heart WAV, with the same af_heart voice, speed 1, 12 speech CPU threads and 72-character parts. It excludes microphone transcription, phone networking and audible playback. Static preparation, speech priming and local model startup are separate work. Local startup took 6.684, 10.736 and 5.133 seconds respectively. Every output must complete and satisfy model, scope and audio validation before release; these checks do not establish factual accuracy, which was reviewed separately.

## Accuracy and decisions

The 0.8B model repeats the eclipse question instead of answering, miscalculates the bat-and-ball example, answers about the assistant’s favourite song instead of the user’s unknown song, and invents that it did not rain at the user’s house. The larger raw-context model also gives ten cents where five cents is required and confuses the assistant with the participant. These are observed failures, not hypothetical cautions.

The narrower public prototype strips private context and keeps personal, current, clinical, action and quantitative questions on the existing route. It is still rejected: its salt answer adds an incorrect explanation about ice getting too cold to freeze, and its flask explanation overstates radiation as the only remaining heat path. The policy/selector prototype is archived privately and removed from shipped source. No extra prepared FAQ answer types or silent model fallback were added. Additional larger models were not assumed safe for the host: the public 2B trial had only 1,610 MiB free RAM and 2,292 MiB free GPU memory before timing.

The official [ChatGPT speed documentation](https://learn.chatgpt.com/docs/agent-configuration/speed) describes Fast with ChatGPT sign-in and a 2.5x included-usage rate. The [plan-integration UI guidance](https://developers.openai.com/siwc/ui-ux-guidelines) also shows Fast. Neither establishes that Nancy’s registration accepts the parameter. Its actual WebSocket context-preparation attempt failed; one separate direct HTTP qualification request returned HTTP 400. No Fast tier was confirmed. The provider cause remains unknown where the mapped error had no usable diagnostic; it is not relabeled as a working Fast route. No OpenAI API key, purchase, billing setting or separately billed API fallback was used.

## Isolation, cleanup and source

Local artifacts are pinned/hash-verified: llama.cpp b11669 at 620d2225c, 0.8B Q8 maintainer conversion, and the documented publisher’s 2B Q5 conversion. They run as temporary authenticated loopback-only helpers with offline mode, no web UI, disabled logging, two low-priority CPU threads and a pinned NVIDIA device. No Pro credentials enter child environments. All three helpers are stopped and port 8792 is closed; no service/task is installed. [Runtime source](https://github.com/ggml-org/llama.cpp/tree/620d2225cc436ab0b001e3200e590e3b286ef9ab), [small-model provenance](https://huggingface.co/ggml-org/Qwen3.5-0.8B-GGUF/tree/807dfd9a6fadbf703207aac3bfb0b2b3040d077c), [2B conversion/provenance](https://huggingface.co/bartowski/Qwen_Qwen3.5-2B-GGUF/tree/7d26695454df6de5fbcce2e58681e62dae06ce43).

Final source sha256:a78f74c8be2ea1831f7899dd37cbf352990a164d627576caad7f8ee251490379, 349 complete manifest entries: retain only a reproducible comparison-only Luna/none profile and tests that production remains Sol-high and whole-owner care selection rejects Luna/none. No runtime selector, care/auth route, speech setting or client UI changes. Final typecheck and 1255 regressions pass; 2 existing optional skips across 121 files. The initial negative-test TypeScript literal error was fixed before these final checks. Private Current assets are byte-identical.

Thirty care tables and all protected configuration/assets match the original baseline. Process continuity does not pass across the interrupted session: the computer booted at 09:39 Toronto on October 23, followed by both supervisors around 09:40, after the overnight comparisons had ended. No experiment restarted either Nancy app. The original three guard failures and four readiness identity failures are retained. Current functional readiness passes; both apps, Heart and Current are ready. The 373-check report is not described as an all-pass report because those four identities changed.

## Accounting and open gates

Both ledgers are closed: 49 of 80 Pro attempts and 63 of 80 local attempts, leaving 31 and 17 unused respectively. Pro includes failed preparation/direct qualification; unknown token consumption for two failures stays unknown, never zero. Local aggregate usage is also unknown where preparation counts were not captured. No provider requests remain reserved, and no further model tests are run. Personal raw evidence/bindings remain in ignored private storage; only sanitized results are published here.

This is a failed optimization qualification with successful code regressions, not an accepted latency improvement. No slice or human live action is marked complete. Intended-person/device listening, genuine-day, clinical and full-slice gates remain open. [Sanitized evidence](evidence/ORDINARY-QUESTION-TRIAL-2026-10-23.json).
