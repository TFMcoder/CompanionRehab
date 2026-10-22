# Owner-copy Heart speech latency trial

The owner authorized reducing speech delay in the separate practice copy on October 22, preserving the selected Heart voice, Dad’s running setup and no API billing. This trial retains Kokoro `af_heart`, normal speed, the pinned fp32 checkpoint and the existing independent speech layer. It does not change reasoning models, speech providers or clinical/care permissions.

## Measurement and implementation

The baseline measures the warm line-oriented worker, including pronunciation preparation, neural waveform generation and WAV encoding. Fixed synthetic phrases include ingredient quantities, times, negation, meal ideas, cooking and the existing cyclic/rehab pronunciation aliases. CPU configurations run sequentially, with repeated four-thread controls. A separate native comparison measures the final worker and first speech piece at both 120 and 72 characters, followed by local transcription diagnostics. Normal authenticated HTTP checks measure the actual practice service before and after deployment; model time is recorded separately from remaining audio wait.

[ONNX Runtime’s thread documentation](https://onnxruntime.ai/docs/performance/tune-performance/threading.html) describes CPU thread controls; the selected setting depends on measured behavior on this computer. The existing graphics backend was also probed with the same fp32 model and both local adapters, using [DirectML’s required sequential execution and disabled memory patterns](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html). It failed during the model’s ConvTranspose operation and is not enabled. No driver, runtime upgrade, alternate checkpoint or device fallback is introduced.

The trial is default-off and selected only by `speech_mode: heart-latency-v1` in the existing exact owner/participant/origin practice selection. It requires the prepared Sol/low trial. Main never reads this selection and retains its original CPU settings, 120-character speech pieces and cache policy. The test worker uses twelve CPU threads; unknown runtime profiles fail closed. Heart, fp32, checkpoint revision and speed remain pinned.

The trial sends smaller, word-bounded speech pieces, up to 72 characters, through the existing validated reply path. It preserves every source character and uses the same split for speculative preparation, finalized reply counts and authenticated audio delivery. Final model/authority checks and cancellation still govern release; scope changes also refuse cached audio. It adds no acoustic interruption or microphone behavior.

The fixed public “Outlook isn’t connected here” clip is prepared during test startup. Eligibility to say it is still checked from fresh scoped state. The existing bounded process-memory cache holds only this additional allowlisted phrase; arbitrary personal replies are not added to that cache. Audio generation for dynamic replies remains local and transient under the existing bounded conversation/reply behavior.

## Isolation, rollback and acceptance

The prior private selection, test entry and source hashes are preserved before activation. Rollback restores those two private test files and restarts only the verified owner-test child. There is no database migration, credential copy, shared global setting, live restart or change to the Current design’s JavaScript/CSS. The existing test login and separate database remain in use.

Synthetic waveform validity and local transcription checks are engineering diagnostics. They do not prove naturalness, actual iPhone/Safari capture/playback, intended-client usefulness or full-slice completion. Those gates remain open. Results are recorded after verification in the accompanying sanitized evidence; private clips, text, login material and raw receipts remain ignored outside the public repository.

## Verified results

[Sanitized evidence](evidence/HEART-SPEECH-DELAY-2026-10-22.json) preserves all timing phases and limits. The broad CPU sweep used fixed full phrases; four-thread medians repeat near 2.1 seconds, versus 1.3 seconds with twelve threads. The final comparison below uses the actual final speech code, identical source text and every speech part, with no cached availability clip or model request.

| Profile / maximum characters | Answers | Median first piece | Slowest first piece |
|---|---:|---:|---:|
| cpu4-120 | 14 | 1.73 s | 3.17 s |
| cpu12-120 | 14 | 1.26 s | 2.26 s |
| cpu12-72 | 14 | 1.13 s | 1.64 s |
| cpu4-confirm | 7 | 1.67 s | 3.06 s |

All generated parts passed waveform bounds/non-silence/peak checks. Every following part in this local sample was generated within the previous part’s audio duration; this does not measure browser playback gaps. Of 28 complete local-ASR clips, 16 were normalized-string exact and twelve differed only in food hyphenation or equivalent time representation. Review preserved the quantities, times, negation and instructions in all 28; this is neither a general accuracy estimate nor human listening acceptance.

The actual normal test-service route measured these typed-turn-to-first-WAV samples:

| Scenario | Before | After |
|---|---:|---:|
| recipe-1 | 4.54 s | 1.63 s |
| recipe_followup | 6.53 s | 5.25 s |
| meal | 4.98 s | 3.30 s |
| recipe-2 | 3.08 s | 1.72 s |
| outlook-1 | 1.82 s | 0.12 s |
| recipe-3 | 3.07 s | 1.60 s |
| outlook-2 | 1.78 s | 0.11 s |

These are seven turns per phase. Recipe quantities have three samples and known unavailable Outlook two; the cooking follow-up and meal recommendation have one each and separately generated model wording. Read the model durations and remaining audio waits in the evidence rather than attributing all variation to synthesis. Microphone capture, remote Safari transport and audible onset remain unmeasured.

Final validation: 1034 full regressions pass with 2 optional skips across 112 files; 64 focused checks, typecheck, private client build, native/ASR diagnostics, both HTTP phases and final preservation/readiness pass. The active Current JavaScript/CSS are byte-identical, all 30 protected care tables are unchanged, and only the verified test child restarted. HTTP telemetry reports 4 model rounds within the shared 12-round reservation cap through the existing Pro connection; raw provider transport attempts are not independently counted by this probe. Native timing and ASR diagnostics made zero model calls. No API billing, paid service, provider write, care write, credential copy or live deployment occurred.
