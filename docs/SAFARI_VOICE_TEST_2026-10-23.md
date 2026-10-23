# Owner-copy Safari voice test — October 23, 2026

Status: awaiting_live_test. The engineering setup does not establish a successful phone session or faster conversation. The owner identified the test device as an iPhone 14 Pro Max; iOS version is unknown. Dad's instance is outside this test.

## Open the guide

Use the existing owner test HTTPS address, port 10000, with /safari-test.html appended. The normal test home remains at /. Sign in as tester@nancy.local with the existing private tester password. The local private login viewer can reveal that password interactively; do not put it in a URL, public document or captured tool output. This page uses the existing test cookie and 30-day device sign-in option. It starts no microphone or conversation until Talk to Nancy is tapped. The already-enabled foreground meal preload can use the existing Pro connection when the signed-in page opens, before that tap. Verification observed two such preparation calls after the two owner runtime starts; both are counted in the evidence.

The existing test address already has public Tailscale Funnel enabled and proxies only to owner port 8788. Ingress was inspected read-only. No Tailscale installation or new sharing change is required for this public address. Cellular reachability from the actual phone remains to be observed. [Funnel documentation](https://tailscale.com/docs/features/tailscale-funnel).

## Wi-Fi pass

1. Keep this computer awake and Nancy running. Stop any existing Nancy voice conversation before opening the guide. Use Safari on the iPhone, the phone speaker, a comfortable fixed volume and a quiet location. Keep the same audio device, volume and location for the second pass. Leave the phone's other network/VPN settings unchanged and report any such configuration when interpreting results.
2. Join Wi-Fi in Settings, return to Safari and open the test guide. Select Wi-Fi, Safari, Phone speaker and Just opened or reloaded the page. Network and browser labels are self-reported, not detected proof. Avoid judging a Wi-Fi run if its connection falls back to cellular.
3. Tap Start Wi-Fi pass, then Talk to Nancy. Allow the microphone prompt if Safari asks. The I hear her answer button stays at the top with Talk/Stop. Tap it as soon as the greeting is audible. Check the short ratings and save them.
4. Follow the eight displayed scenarios, saving a rating after each. Wait for Nancy is listening before speaking. These preserve the normal 900 ms silence rule and disabled acoustic interruption; speech while thinking/speaking is not captured. Do not accept a meal/task plan, report an activity, send mail or change preferences during this read-only study.
5. Use No reply / I can't hear her if needed. The two-second pause intentionally probes early submission. The lock test intentionally probes suspension and recovery; foreground wake lock does not prevent deliberate locking or guarantee background voice. Use Stop Nancy then Talk to Nancy if the old audio does not recover. A restarted conversation can lose previous conversational context; record that outcome rather than inventing continuity.
6. On the last scenario, save the rating and tap Finish this pass. Retain the displayed eight-character test code. Missing scenarios remain unmeasured; finishing is not a pass result. A failed timing save is recorded as timing_save_failed when the connection returns, so a partial pass can finish without inventing a successful observation. Timings/ratings save to the private test service. Download timing results is optional.

## Cellular pass

1. Finish and stop the Wi-Fi conversation first. In iPhone Settings > Wi-Fi turn Wi-Fi off. Leave Cellular Data enabled and check the cellular indicator. If the page cannot load, stop here and diagnose access; do not label an unperformed voice test successful.
2. Return to the same Safari URL and reload. Select Cellular, Safari, the same sound output and Just opened or reloaded the page. Start a new pass and repeat the same scenarios in the same order.
3. Save ratings and finish. Report both test codes and any noticeable difference. Turn Wi-Fi back on afterward if desired. [Apple's connection guidance](https://support.apple.com/guide/iphone/connect-to-the-internet-iphd1cf4268/ios).

One Wi-Fi and one cellular pass provide a diagnostic screen, not a reliable percentile or a causal network comparison. Model variability, network switching, resumed state, preparation, temperature and background load can differ. If the first pair shows a useful signal, repeat with reversed network order before attributing a gain or regression to the network. No paid provider tests or background model benchmark is scheduled.

## Scenarios and expected behaviour

| Scenario | What to check |
|---|---|
| Greeting | Startup, permission and first playback; this is a new conversation, not a demonstrated cold server. |
| Breakfast | Useful meal suggestion grounded in the synthetic test profile and available repository facts. |
| No eggs | Maintains meal context and respects the changed constraint. |
| Zipper question | Describes interlocking teeth and the slider without factual invention. |
| Explain more simply | Keeps the subject and reduces complexity. |
| Outlook next Wednesday | This copy has Outlook disconnected; clearly states the limitation and invents no appointments. This does not test a working Outlook connector. |
| Two-second pause | Detects an early turn, missed remainder or comfortable handling; it is not assumed to pass. |
| Lock and return | Audio lifecycle, manual recovery and actual context continuity. No locked-screen speech promise. |

## What the measurements mean

- endpointing_ms: last microphone block classified as speech to submission. This is detected speech end, not a physical acoustic ground truth.
- request_ms: browser submission to complete reply JSON, combining upload/network, server transcription, context/tools, reasoning and return transport.
- audio_headers_ms / audio_download_ms / audio_decode_ms: the separate first-WAV request through response headers, full download and browser decoding. Headers include server work and transport; they are not a pure network RTT.
- audio_preparation_server_ms: the owner-only Server-Timing value for authenticated first-audio preparation/access/cache delivery. It is not isolated Kokoro execution time and may overlap prepared work.
- speech_end_to_playback_start_ms: detected speech end to scheduled Web Audio playback. Input-to-playback is also recorded for the greeting, where no speech end exists.
- reported_output_latency_ms: the browser estimate if available; missing values remain null. audible_response_ms stays null.
- heard_after_detected_end_ms / heard_after_input_ms: the manual I hear her answer tap, including reaction time, device sound onset and any content before the useful answer. These are subjective observations, not a calibrated acoustic measurement.
- server_stages: allowlisted ASR, whole-turn/model duration, call counts and usage from existing numeric telemetry, correlated by the submitted turn ID rather than the different reply ID. Whole-turn duration contains other stages; do not sum overlapping values. Missing or unflushed telemetry stays unknown. Opening/model preparation runs are separate and are not fabricated from a zero-call foreground reply.

The page displays current transcription and answer text for immediate accuracy assessment but saves neither in its test sheet. Existing Nancy processing still sends the normal authorized input to its existing Pro route. The study does not change provider retention guarantees. It saves fixed scenario IDs, bounded numeric observations, fixed-choice ratings and lifecycle/failure events in ignored private owner storage. No audio recordings, transcript text, credentials, arbitrary notes or screenshots are retained by this feature. Records expire after 14 days, are cleaned hourly while running, and are bounded to 64 passes, 16 samples/pass and 48 events/pass. Current role, actor, client, login and grant revision are checked on every study request; audio sample ingestion also validates the retained reply's current authority.

## Isolation and rollback

Only the owner test process is restarted to load the new diagnostic routes. Sol-low, warm-v2, prepared context, Heart checkpoint/speed/thread settings and the normal test home are retained. Dad's process, supervisor, assets, selected Sol-high/Heart, care data and exact caregiver binding remain outside deployment. No API key, billing setting, model switch, paid service, consent or connector action is added. The guide uses the same conversation/ASR/Heart code with an optional numeric observer; the production client has no observer and is not rebuilt/deployed.

Private rollback includes the previous owner client and the four changed existing voice/server source files, with their baseline revision. Restoring the old diagnostic source and restarting only the verified owner child removes the new server routes; remove only the newly installed study HTML/assets if hiding the guide is needed. Preserve private observations for their authorized retention period. Never restart Dad to roll back this test page.

Engineering verification and actual deployment are recorded in docs/evidence/SAFARI-VOICE-STUDY-2026-10-23.json after checks run. The phone, network, intended-person and full-slice gates remain open until real observations arrive.
