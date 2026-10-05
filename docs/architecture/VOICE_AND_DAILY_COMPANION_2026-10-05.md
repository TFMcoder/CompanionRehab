# Nancy: conversational voice and ongoing day management

Decision date: 2026-10-05. The owner approved the smartphone preview's interface and requested the expanded behavior below. These are implementation requirements, not evidence that live conversation, wake-word detection, reminders or connectors are running. The canonical [roadmap](../roadmap/roadmap.json) assigns delivery and acceptance. This decision supersedes the earlier blanket deferral of wake-word listening and proactive reminders; it does not enable a microphone or a schedule by itself.

## Latest owner direction: one master conversation

**Talk to Nancy** is the primary client entry from home/My Day and every shipped client view. Tapping it opens a general conversation: Nancy asks what the client wants to do and offers one or two suggestions grounded in current participant-local time and outstanding records. A workflow picker, My Day task screen or special planning phrase is never required. The client can redirect freely. Optional voice-driven screen transitions and direct buttons expose the same records and commands; opening My Day does not discard the active conversation.

The **08:00-11:00 morning window** covers breakfast, planning the day, post-breakfast exercise and rehab. This is a flexible context window, not four invented appointment times. Use actual known completion and accepted schedule state; ask when it is unknown. Suggest post-breakfast exercise only in the appropriate meal context. Use existing approved exercise/rehab tasks; S01 schedules/surfaces them, while S07/S08 retain step-by-step routine and approved-protocol execution. At other times the same button offers relevant help. These in-session suggestions do not require or imply background reminders or automatic microphone activation.

**Heart is selected and voice comparison is closed.** The owner’s final decision supersedes the historical audition sections below. The remaining work is integrating Heart with this conversational flow and the authorized care service, then actual-device testing.

## Confirmed device and calendar

The owner subsequently confirmed **iPhone**, **Safari** and **Outlook calendar** in the October 5 conversation. These selections are resolved and must not be requested again. Heart is selected. The iOS version, actual microphone/conversation delivery and live wake behavior remain unqualified. Safari-tab and installed Home Screen web-app behavior need separate real-device testing. A stable authenticated origin is required before relying on a Home Screen installation or push subscriptions; the temporary public preview is not that deployment.

For the Outlook connection, confirm whether the calendar belongs to a personal Microsoft account or a work/school account and identify the intended calendar privately. Microsoft Graph is the proposed route once hosting is verified. Start with delegated `Calendars.ReadBasic` and bounded `calendarView` reads, which include recurring occurrences and exceptions. This scope omits event bodies, attachments and extensions; collect only needed appointment fields. It is listed for personal and work/school delegated access. Broader calendar access is conditional on a demonstrated requirement, and organizational approval depends on the actual tenant. No email access, writeback or invitations are selected. Sources: [Graph calendarView](https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview?view=graph-rest-1.0), [permission reference](https://learn.microsoft.com/en-us/graph/permissions-reference#calendarsreadbasic).

The owner has selected Outlook, not completed its OAuth connection. S01 can still use explicitly entered local appointments; S06 supplies the external Outlook/Asana connections. The older deferred Outlook item now applies to email ingestion, invitations and writeback, not the selected read-only calendar work. No service purchase or calendar access occurred when recording this decision.

## Free voice choices

### Owner quality feedback: current samples rejected

After auditioning the preview, the owner reported robotic delivery with inadequate intonation, pacing and inflection, and set natural, responsive conversation comparable in feel to ChatGPT voice as the target. The rejection applies to the installed-browser/fixed-Windows samples. The owner then requested a Kokoro trial; its three voices are now prepared for listening as described below. Piper and expressive hosted speech remain untested here. Do not ask the owner to accept the rejected device voices as Nancy's production voice or mistake successful playback for quality acceptance.

Source inspection confirms the preview uses a fixed `SpeechSynthesisUtterance` with a selected installed voice and a rate setting, plus a fixed Windows Zira WAV. It has no contextual expressive speech instructions or live conversation pipeline. Changing rate alone cannot establish the requested quality. Production acceptance must separately assess voice naturalness (intonation, appropriate pauses, emphasis and respectful warmth) and interaction quality (reply latency, turn endings, interruption and contextual response). Test several new utterances and a real back-and-forth, not only a rehearsed greeting. Keep Sol/high as the selected reasoning model.

Next free qualification is a bounded local neural-voice audition on the same iPhone/Safari path, with Kokoro as the first existing candidate; no ChatGPT-quality equivalence is assumed. As a separately costed comparison, OpenAI `gpt-4o-mini-tts` supports instructions for intonation, tone and emotional range, and recommends `marin` or `cedar` for quality. Its Realtime API offers direct speech-to-speech handling with access to input tone/inflection and lower-latency interaction. These are different integration choices: expressive TTS can retain the existing Sol reasoning boundary, while a native speech-to-speech conversational model needs an explicit architecture decision. Neither is automatically a free speech benefit of the existing ChatGPT-plan adapter. No paid service, model switch or funding is authorized by this quality feedback. Sources: [expressive TTS](https://developers.openai.com/api/docs/guides/text-to-speech), [Realtime conversation](https://developers.openai.com/api/docs/guides/realtime-conversations), [plan-route limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

Use speech independently of the selected GPT-6 Sol/high reasoning route. Free here means no additional voice service subscription or per-character API charge on existing hardware; electricity, hardware capacity and the separately qualified GPT allowance still matter.

| Option | Recommendation | Cost and qualification |
|---|---|---|
| Kokoro-82M on the existing PC | First candidate for Nancy's consistent voice across phones. Audition `af_heart`, `af_bella` and `bf_emma`, then let the client choose. | Apache-2.0 model weights. Local installation and nine synthetic fp32 CPU clips are verified. No voice-service charge. Participant listening preference and end-to-end conversational latency remain unqualified. |
| Installed phone/browser voices | Immediate, simple voice audition and possible fallback. Display actual available English voices and allow a slower pace. | Restrict the chooser to voices that the browser reports as `localService: true`. Availability and quality differ by phone; do not silently select a remote voice when a local choice is absent. |
| Piper on the existing PC | Alternative to benchmark for efficient local speech. | Current engine is GPL-3.0; voice model cards carry their own terms. Check the exact chosen model before distribution. No hosted service is required. |

Kokoro's published catalogue lists American and British voices and explicitly treats perceived quality as subjective. Its grades describe training data, not a guarantee that a particular voice will feel encouraging. Source: [Kokoro model card](https://huggingface.co/hexgrad/Kokoro-82M), [voice catalogue](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md), [implementation](https://github.com/hexgrad/kokoro).

Piper describes a local neural engine and links model-specific voice information: [engine](https://github.com/OHF-Voice/piper1-gpl), [voice terms](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/VOICES.md). Browser voice locality is available through the [Web Speech localService property](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService).

The preview's Windows Zira WAV remains a fixed synthetic sample, not the selected production voice. A local browser chooser auditions the same neutral, encouraging sentence without sending care text to a speech provider. Production preferences must eventually be stored per authorized client and include voice ID/provider, pace and conversational pacing. A voice cannot be classified as suitable without the client's feedback.

### Kokoro trial prepared

On October 5 the owner said “Lets test out Kokoro.” The agent installed isolated `kokoro-js` 1.2.1 and pinned the ONNX model revision, preserving the existing ASR and reasoning runtimes. The public preview now leads with Heart, Bella and Emma, each reading identical morning, meal-choice and carryover scripts. Rejected device voices remain collapsed for optional comparison. Exact scripts are visible, and no participant data is used or uploaded.

Actual fp32 CPU synthesis produced nine 24 kHz clips lasting 8.85–10.425 seconds, each generated in 3.538–4.179 seconds after model load. These are full-clip synthesis measurements, not time to first streamed audio or end-to-end reply latency. A cached model load took 1.670 seconds. Local ASR recovered all nine scripts; seven matched after punctuation/case normalization and two differed only in the spelling “omelet” versus “omelette.” That checks content, not naturalness. Public desktop-browser playback decoded one sample per voice without a media error; actual iPhone/Safari audibility and participant preference are still pending.

See [reproduction steps](../DEVICE_PREVIEW.md#local-kokoro-audition) and [sanitized evidence](../evidence/S01-KOKORO-AUDITION-2026-10-05.json). Samples are generated ahead of time and served as pinned WAVs; no live synthesis endpoint, paid speech service, production voice preference, turn-taking or wake listener is enabled by this trial. Next assess the client's listening feedback, then integrate the chosen speech output with the authorized Sol/high conversation and measure real response timing and interruption.

Encouragement is also conversational behavior: one question at a time, brief replies, adult and respectful wording, no guilt about missed tasks, and room to think or disagree. Do not substitute exaggerated cheerfulness for listening.

### Kokoro listening feedback: improved, still robotic

After the prepared samples were delivered, the owner reported: “Its better, but still a tad robotic.” The owner then identified **Heart (`af_heart`)** as the closest candidate; use it as the baseline for subsequent comparisons without asking again. This is actual owner listening feedback and a comparative preference, not production approval or proof of a completed iPhone conversation. The participant's own acceptance and sufficient naturalness remain unresolved. Preserve the original generation/test receipt as historical evidence.

The installed `kokoro-js` 1.2.1 `GenerateOptions` exposes voice and speed, with no natural-language delivery instruction or explicit emotion control. The audition already uses fp32 and normal speed. Shorter spoken turns, conversational wording and deliberate punctuation are reasonable low-cost experiments, but their improvement must be heard; slowing the entire clip cannot establish expressive intonation. The likely remaining issue is speech prosody rather than Sol reasoning, since these fixed clips contain no live reasoning call.

The proposed next free comparison is **original English Chatterbox**, whose public API exposes exaggeration and pacing-related controls and supports CPU inference. Its 500M model is larger than Kokoro's 82M; actual Windows compatibility, local latency, voice suitability and dependency/model terms still need qualification. Its default voice avoids needing a personal voice recording. Chatterbox Turbo/Nano are distinct variants; do not assume the original model's exaggeration control applies to them. This is a research recommendation, not a new selected or installed provider. Source: [upstream Chatterbox documentation](https://github.com/resemble-ai/chatterbox/blob/master/README.md).

A documentation check also changes the earlier hosted comparison: OpenAI announced retirement of its listed `gpt-4o-mini-tts` snapshots and `tts-1` models for January 6, 2027, recommending `gpt-realtime-2.1-mini`. The older TTS guide still describes the retiring models. Do not start a new production dependency or repeat a historical per-minute price without checking the supported replacement, current pricing and a speech-only boundary around Sol/high. No hosted speech or paid test was enabled. Source: [official deprecation notice](https://developers.openai.com/api/docs/deprecations#2026-10-01-text-to-speech-models).

## Conversation lifecycle

One press of **Talk to Nancy** opens a conversation. The client then speaks normally without pressing a button for each turn. **End conversation** stops immediately. The transcript and equivalent touch controls remain available.

1. Authenticate and refresh current authorized day context before offering time-sensitive guidance.
2. Start microphone capture only following the user's action/previously enabled foreground wake mode and browser permission. Show the listening state.
3. Detect a completed turn, transcribe, dispatch to Sol/high and validate proposed tools in the care service.
4. Stream short speakable sentences as they become available. Playback should begin without waiting for a long final paragraph. Announce a save only after the command receipt confirms it.
5. Return to listening automatically. Support interruption: genuine client speech stops output, discards queued/late audio for that turn, and begins the next turn. Echo cancellation and own-voice suppression must prevent Nancy from interrupting or waking herself.
6. After a genuine conversational ending or an idle interval, show an expiring closure grace period. New speech cancels closure. Release tracks, buffers and in-flight speech work when the session closes or permission is revoked.

Provisional engineering defaults: 1.2 seconds of end-of-turn silence, 30 seconds of unanswered idle time, then a 10-second visible closure grace. These are separately configurable and require a real-device trial with the client. A pause to find a word must not be treated as a request to end the conversation. No idle countdown runs while the client is speaking or Nancy is reasoning, executing an authorized tool or speaking; stalled work has a separate bounded error path. An explicit goodbye may enter the grace period; the End button closes immediately.

Measure end-of-speech to first audible reply, false cutoffs and interruption latency on the actual phone. Sol/high response time and the local speech pipeline must be measured before promising a response-time guarantee. Text recognition and good TTS alone do not prove a natural conversational experience.

## “Hey Nancy” and smartphone limits

Wake-word detection is a separate opt-in mode with a persistent visible indicator and a Stop listening control. Detection can open a conversation; it cannot accept a plan, complete a task, expose another person's records or bypass login. The initial target is a visible, awake browser with microphone permission. Do not silently re-enable capture after refresh, account change or background suspension.

Evaluate a trained **Hey Nancy** model rather than pretending that recognizing arbitrary text is a dedicated wake-word detector. [openWakeWord](https://github.com/dscripka/openWakeWord) is a candidate: code is Apache-2.0, bundled models are CC BY-NC-SA 4.0, and the exact custom model/training data need review. Its official browser example streams microphone audio to a Python server; that would process audio on this PC, not solely on the phone. A genuinely browser-local detector requires a qualified port/runtime. Do not send an idle audio stream to GPT or retain raw audio by default.

Test positive calls, false wakes from television/conversation, different distances, Nancy's own playback, interruptions, permission revocation and wake-disable. A detected phrase should give a short listening cue; ambiguous speech cannot mutate durable data.

**A web URL does not supply Alexa-equivalent background operation.** Browsers can freeze or discard background pages; JavaScript and timers can stop. A screen wake lock applies to visible documents and can be released by the system. Therefore locked-phone and closed-browser wake detection are not promised. Sources: [Chrome page lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api), [Screen Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API).

For reliable always-available room interaction, assess an existing powered device kept in a supported listening mode or a separately qualified native application/device. A native wrapper alone does not prove background microphone privileges or reliability. No hardware purchase is selected now.

## Ongoing context and proactive prompts

At every conversation start, and before time-sensitive recommendations, construct a fresh authorized context with:

- Participant local time/time zone, last successful connector sync and stale/unavailable sources.
- Confirmed appointments, optional preparation/travel buffers and conflicts.
- Outstanding tasks with high/medium/low urgency, estimated duration and accepted schedule.
- Accepted meals, ingredient availability and actual reported meal times.
- Unresolved tasks from earlier dates and pending or failed writes.

Use confirmed deadlines/appointments and required preparation to constrain suggestions; consider due meals and overdue/high-priority work next, while allowing the client to redirect. Ask about unknown duration or travel time instead of inventing it. If an appointment is in one hour, propose something that fits the available time; do not silently move the appointment. If lunch is due, refer to the accepted menu and ask whether lunch has already been eaten when no report exists.

Proactive prompts use a durable local scheduler driven by saved schedules and explicit preferences, not repeated model polling or browser timers. Record reminder identity/version, due time, expiry, quiet hours, snooze, dismissal and delivery attempt. Recheck current task/meal state and access at delivery. Suppress obsolete/completed reminders and duplicates; restart and missed-run handling must not replay a day's worth of expired prompts.

When the app is visible, the client opted into spoken prompts, and browser audio is available, Nancy can speak a short context-aware invitation. A reminder does not open the microphone unless the client has separately enabled the relevant listening mode. Avoid interrupting an active conversation; queue or combine the useful prompt. When backgrounded, use a notification to invite the client back. iPhone web push requires a Home Screen web app and permission requested through user interaction: [WebKit documentation](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/). Push receipt is not evidence that a prompt was heard. PC sleep/offline and mobile notification restrictions must remain visible limitations.

## Morning planning, meals and groceries

**Let's Plan the Day** and **Let's Plan Today** enter the same daily planning workflow. The preferred morning window is 08:00-11:00 in the participant's configured time zone; 10:00 remains the default. The command also works outside the window and resumes the current day's check-in rather than creating duplicate plans.

Review the calendar, current tasks and factual meal reports. Ask about uncertain facts such as breakfast. Discuss each relevant task's duration, priority and calendar placement, including buffers and conflicts. The client reviews and accepts a concrete version. A calendar suggestion is not an appointment booking. Calendar and Asana integrations retain external IDs, source freshness and scoped access; until a connector is qualified, show locally entered appointments and explicitly say external information is unavailable.

Meal planning offers a small set of choices, normally two or three, using available ingredients, preferences and supplied dietary constraints. Ask rather than prescribe. If none appeals, ask one useful question and generate alternatives with the client. A missing ingredient supports two separate paths: substitute/use something already available, or add the needed ingredient to the grocery list. Confirm inferred quantities/units; merge compatible existing entries without duplicating them. Show and acknowledge the saved grocery action and make correction/removal easy. A reported shortage changes inventory knowledge explicitly, rather than silently declaring every related ingredient absent.

Offer portion choices and ordinary healthier substitutions within existing approved guidance. Do not invent calorie, carbohydrate or clinical dietary targets, change prescribed restrictions, or promise clinical outcomes. Meal choice, acceptance, ingredient availability and actual consumption are distinct facts.

## A ledger that survives each day

The care service maintains stable task identities and occurrences, accepted plan versions, actual meal/task reports, reported occurrence times, recording times, postponements, help requests and corrections. The UI is a projection of that ledger. Closing a conversation, rejecting a suggestion or reaching midnight never silently deletes outstanding work or marks it completed.

For a missed task, the next planning conversation asks whether it still needs doing, whether its priority changed and whether help is needed. The client may mark it done with the actual time, reschedule, explicitly cancel with a recorded decision, leave it unresolved or request help. Carryover references the original task and preserves yesterday's history. A help request is retained; sending it to family requires the appropriate later sharing/notification feature and grant.

Asana interoperability must distinguish local records from external task state, preserve identity and expose queued/failed sync. External completion writes require a durable outbox and reconciliation. An unavailable connector cannot cause tasks to disappear or be described as synchronized.

## Delivery and evidence

Preserve S01-S04: S01 conversational planning and minimal grocery capture; S02 factual day ledger; S03 interruption recovery; S04 repeat-day review and opted-in proactive prompts. S05 expands groceries; S06 connects external calendar/Asana sources. Local appointment context in S01 allows useful planning without assuming an external connector already exists.

The current public URL remains a synthetic preview. UI approval is recorded as feedback, not live voice or clinical acceptance. Browser voice audition is independently testable now. Production speech choice, natural turn-taking, custom wake model, scheduler, authenticated live workflow tools and real calendar/Asana access remain separate implementation/qualification work with actual live acceptance.
