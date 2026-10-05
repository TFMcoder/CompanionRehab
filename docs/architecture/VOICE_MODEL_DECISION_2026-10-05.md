# Nancy voice model decision — October 5, 2026

**Recommend Pocket TTS, English 2026-09, Alba, running warm on this PC with native audio chunks over WebSocket.** This is a provisional engineering selection for integration and human audition. We have not established that Alba is the most natural voice to the participant, or accepted it as the production voice. Keep Heart as the listening baseline. Do not change GPT-6 Sol/high or silently enable paid speech.

**Subsequent owner listening direction:** female voices only, with Kokoro Heart still preferred so far. The next matched alternatives are Pocket Anna and Qwen Serena. The Alba selection above records the engineering evaluation, not participant voice acceptance; it does not override this preference. Serena remains a hosted-demo audition with unqualified live latency.

## Configuration

| Setting | Selection |
|---|---|
| Runtime | Python 3.11.17; pocket-tts 3.3.0; PyTorch 2.10.0+cpu |
| Model | `kyutai/pocket-tts-without-voice-cloning`, `languages/english_2026-09/model.safetensors` |
| Weights revision | `e7205b6ee50e654a5ea19f0e9df2b0813b05e921` |
| Voice | Alba, derived from Alba MacKenna's `alba-mackenna/casual.wav`; official English 2026-09 embedding |
| Embedding revision | `4e1e0a3e611c51c0b4ed8174fc10f32a54644303` |
| Precision/compute | fp32 CPU; 2 intra-op threads, 1 inter-op thread |
| Generation | Temperature 0.3; sampler decode steps 1; EOS threshold -4; default EOS tail; copy voice state for each request |
| Delivery | Persistent same-origin WSS; 24 kHz mono float32 PCM; 160 ms initial audio buffer; 60-second hard audio bound; trace-specific cancellation |
| Warm lifetime | Model and two voice embeddings stay loaded in one preview worker; a discarded fixed phrase warms kernels before readiness |
| Spoken text | Normalize English curly apostrophes; explicitly verbalize the two known fixture clock values. Production times must be rendered from validated typed values, preserving known AM/PM. |
| Cost | No added speech subscription or metered API; existing machine and temporary free tunnel |
| Licences | Pocket code MIT; selected checkpoint CC BY 4.0; Alba reference CC BY 4.0, with attribution in the audition and runbook |

This configuration accepts complete coherent text, then generates waveform chunks before the utterance is complete. It does **not** accept an arbitrary stream of partial text tokens. Integrating Sol should submit complete sentences/phrases, preserve punctuation, bound the queued reply and cancel obsolete work.

## Findings

The verified host has an AMD Ryzen 7 8845HS (8 cores/16 threads), 15.29 GiB physical RAM and an RTX 4050 Laptop GPU with 6,141 MiB VRAM. Initially only 1.69 GiB RAM and about 4.1 GiB VRAM were free; disk headroom was 18.33 GiB. CUDA was subsequently tested successfully with Nano. These were measurements on a working personal computer, not an isolated benchmark machine. Models generated sequentially; software preparation and unrelated host activity were not frozen. Report observed outliers, not percentile or availability claims.

| Candidate | Measured here | Documented/source-inspected capability | Decision |
|---|---|---|---|
| Kokoro Heart, pinned JS fp32 CPU | Water median 843 ms, range 828–1,040 ms, n=3. Long median 8,978 ms, range 8,813–32,400 ms, n=3. First audio equals full waveform return. | JS sentence streaming synthesizes complete sentences; not native waveform streaming within a sentence. Speed and voice controls do not provide instruction-based emotion. | Retain as user's preferred baseline; prior human feedback was better but still robotic. |
| Pocket Alba, pinned CPU configuration | Final warm public-route repeats: water model first chunk median 150 ms, range 144–153 ms, n=3; long median 228 ms, range 168–248 ms, n=3. Browser rendered proxy: water 262 ms, long 338 ms median. Long full generation 8.59–9.52 seconds, while playback starts during generation. | Native waveform streaming and cooperative frame cancellation; complete-text input. The official ~200 ms claim is separate from our measurements. | Recommended for the first integration; human naturalness remains pending. |
| Chatterbox Nano / Alba, RTX 4050 fp32 | Water median 2,201 ms, range 2,012–2,951 ms, n=3. Long median 19,827 ms, range 18,230–20,100 ms, n=3. Peak PyTorch allocation about 2.74 GB. CPU water 4,406 ms; CPU long 38,346 ms, n=1 each. | Published wrapper returns full waveform. Nano/Turbo explicitly ignore `exaggeration`, CFG and min-p controls. Paralinguistic tags exist but were not inserted into matched text. | Keep the generated comparison; slower startup than Pocket even on available GPU. |
| Qwen3-TTS-12Hz-1.7B-CustomVoice / Serena | Two successful synthetic hosted-demo clips (water and long); output 1.177 and 22.297 seconds. Model/client latency unmeasured; deployed revision unpinned. | Instruction control belongs to the 1.7B variant; published wrapper returns full waveforms. Official demo uses BF16/SDPA and complete text. The 0.6B variant is not equivalent. | Cloud audition completed without a large local install. Local 4.52 GB repository/3.83 GB weights leave limited currently free VRAM headroom; no local Qwen inference was claimed. |
| Azure Speech F0 / en-US-JennyNeural | Not tested; no resource or credentials provisioned. | One additional cloud candidate: 500,000 neural characters/month free; expressive styles; audio streaming; 20 transactions/60 seconds. Account/resource setup is required. | Conditional next audition if an existing Azure subscription is available; no paid tier selected. |

The first Pocket request in the full catalogue run took 1,850 ms to yield audio despite model loading being finished. Subsequent first chunks were much shorter. This motivated the explicit startup warmup; loading weights alone is insufficient. Benchmark cold import/load, network downloads and first generation are recorded separately where available. Do not use a cached first-chunk number to promise cold-start responsiveness.

The initial raw-text Pocket screen flagged a substantive intelligibility problem: ASR disagreed with curly contractions and read `1:45` as `4.5`; Anna's reassurance was recognized as a different sentence. A narrow apostrophe normalization and explicit spoken clock values removed those flags in six retest clips. A fresh 22-clip Pocket catalogue then produced 19 normalized exact ASR matches; the remaining three differences were spelling/date formatting with correct time values. Keep this distinction: an ASR screen supports word checking, but does not establish naturalness, physical audibility or human acceptance. The raw runs remain archived; their timings are not presented as the final normalized configuration.

## Actual pipeline and latency limits

The old app `/api/voice` route uses OpenAI Realtime/WebRTC and its own reasoning model; it is **not** the selected Sol/high + local ASR/TTS pipeline. It was left intact. The app-specific ChatGPT-plan helper is separate and authenticated; local ASR was previously a file probe; the old phone audition served pinned prerecorded WAVs. Those facts do not establish integrated conversation.

Three live synthetic requests through Nancy's existing app-specific OAuth/Responses adapter completed on `gpt-6-sol` with `reasoning.effort=high`. First complete sentence-boundary timing was **3,585.2 / 3,860.2 / 4,277.6 ms** (median 3,860.2). Response completion was 4,025 / 4,469.7 / 4,601.9 ms. This is a text-boundary heuristic, not a physical audio observation or a tool-bearing care conversation. No model or billing fallback occurred.

The intended 1,200 ms endpointing silence is still a design setting. Genuine end-of-microphone-speech → first meaningful reply is unmeasured because the selected pipeline is not yet integrated. Sol alone exceeds the provisional 2–3 second whole-turn target; a TTS replacement cannot remove that delay. Whole-file ASR, network and care-tool work would add further time. Do not count an early generic filler phrase as the answer.

The minimal live test now generates only fixed public synthetic scripts: browser → existing Cloudflare Quick Tunnel → local preview Node server → warm Pocket worker → WSS → browser AudioWorklet. Every audio/cancel event shares a trace ID. Durations are monotonic within their own process; no Python/server/browser absolute timestamps are subtracted. First received, decoded, enqueued and worklet-rendered audio are distinct. Worklet messages are a main-thread receipt of rendered-frame progress, not physical speaker or iPhone measurements. The public evidence receipt records the actual remote tests and their limits.

Actual desktop browser measurements through that public route, with a persistent connection and warm worker:

| Milestone from fixed speakable-text dispatch | Water question, n=3: median [range] | Longer response, n=3: median [range] |
|---|---|---|
| First audio received | 211 [202–215] ms | 281 [223–401] ms |
| First audio decoded | 213 [202–215] ms | 281 [223–401] ms |
| First audio enqueued | 216 [203–216] ms | 282 [224–401] ms |
| First nonzero worklet output proxy | **262 [252–268] ms** | **338 [254–449] ms** |
| Generation-complete event received | 1,004 [954–1,015] ms | 9,278 [8,661–9,629] ms |

All six completed traces recorded zero audio-buffer underruns. Stop during a seventh, still-generating long response cleared the playback queue and acknowledged a zero-filled output quantum in **15.9 ms**, n=1. Its metrics remained unchanged afterward, and a new reply completed. A separate real WSS probe cancelled after ten audio chunks: the worker cancellation terminal arrived **71.88 ms** after the cancel command, n=1; a new request then completed. This is button cancellation, not microphone interruption detection or acoustic echo handling.

The first test server load/import took 7,619.86 ms plus 745.83 ms of discarded warmup. Connection setup separately measured audio-context unlock 42.3 ms, worklet module load 258.4 ms and WSS handshake 322.4 ms. Those are excluded from warm-request latency. A final rebuild verification rendered a short reply in 242.4 ms and confirmed no horizontal overflow at the requested 390×844 viewport. The desktop was on the host PC but traversed the public tunnel; Dad's separate iPhone/network is still untested. No physical speaker timing was measured.

Whole-file ASR screening kept Whisper small.en loaded on CPU/int8. The final Pocket clips took roughly 1.5–3.6 seconds each to transcribe. This is neither streaming ASR nor the remaining transcription after microphone endpointing. The 1.2-second intended silence setting, live ASR remainder, care-tool latency, actual phone rendering and total meaningful conversation delay remain unmeasured. The subsecond synthetic TTS target passed on the accessible desktop route; the full 2–3-second conversation target has not passed.

## Free cloud assessment

The official Qwen and Nano Spaces use shared ZeroGPU quotas and queues. Qwen successfully generated our two samples, but that does not make the demo a reliable application backend. Kyutai's official Pocket demo runs on a remote CPU; no supported public-service availability/queue/limit contract was established. Do not quietly depend on undocumented demo endpoints. Azure F0 is a recurring allowance, distinct from temporary new-account credit, and is the only additional model/service investigated. It remains untested without a configured resource.

## Acceptance and next step

The existing audition offers 46 matched saved samples: Pocket Alba/Anna and Heart/Nano across all 11 scripts, plus the two Qwen clips. Uniform RMS-targeted gain is peak-limited; pitch and playback rate are unchanged. Live Pocket uses a documented fixed gain separately. Listen for appropriate question contour, warm adult tone, clear instructions, repeated/missing words and consistency across sentence boundaries. Automated recognition can flag words for review; it cannot choose the voice for this family.

Next, the participant/tester should compare Pocket Alba with Heart on iPhone/Safari, try the long live sample and Stop, and report naturalness, audible gaps and preferred voice. Then integrate the chosen speech route around Sol/high and the authenticated care commands, with warm ASR, coherent first-sentence synthesis and measured microphone endpointing. Genuine phone conversation, voice-triggered interruption, foreground wake and both S01 live gates remain pending.

Reproduction, licences and official sources: [voice evaluation runbook](../VOICE_EVALUATION.md). Sanitized results: [evaluation evidence](../evidence/S01-VOICE-MODEL-EVALUATION-2026-10-05.json). Full synthetic receipts/audio stay under ignored `.local/probes/voice-eval/`.
