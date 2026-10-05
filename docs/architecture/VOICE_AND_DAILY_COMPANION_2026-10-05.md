# Nancy: conversational voice and ongoing day management

Decision date: 2026-10-05. The owner approved the smartphone preview's interface and requested the expanded behavior below. These are implementation requirements, not evidence that live conversation, wake-word detection, reminders or connectors are running. The canonical [roadmap](../roadmap/roadmap.json) assigns delivery and acceptance. This decision supersedes the earlier blanket deferral of wake-word listening and proactive reminders; it does not enable a microphone or a schedule by itself.

## Free voice choices

Use speech independently of the selected GPT-6 Sol/high reasoning route. Free here means no additional voice service subscription or per-character API charge on existing hardware; electricity, hardware capacity and the separately qualified GPT allowance still matter.

| Option | Recommendation | Cost and qualification |
|---|---|---|
| Kokoro-82M on the existing PC | First candidate for Nancy's consistent voice across phones. Audition `af_heart`, `af_bella` and `bf_emma`, then let the client choose. | Apache-2.0 model weights. No voice-service charge for local inference. Installation, runtime dependencies, real latency and the client's listening preference remain unqualified. |
| Installed phone/browser voices | Immediate, simple voice audition and possible fallback. Display actual available English voices and allow a slower pace. | Restrict the chooser to voices that the browser reports as `localService: true`. Availability and quality differ by phone; do not silently select a remote voice when a local choice is absent. |
| Piper on the existing PC | Alternative to benchmark for efficient local speech. | Current engine is GPL-3.0; voice model cards carry their own terms. Check the exact chosen model before distribution. No hosted service is required. |

Kokoro's published catalogue lists American and British voices and explicitly treats perceived quality as subjective. Its grades describe training data, not a guarantee that a particular voice will feel encouraging. Source: [Kokoro model card](https://huggingface.co/hexgrad/Kokoro-82M), [voice catalogue](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md), [implementation](https://github.com/hexgrad/kokoro).

Piper describes a local neural engine and links model-specific voice information: [engine](https://github.com/OHF-Voice/piper1-gpl), [voice terms](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/VOICES.md). Browser voice locality is available through the [Web Speech localService property](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService).

The preview's Windows Zira WAV remains a fixed synthetic sample, not the selected production voice. A local browser chooser auditions the same neutral, encouraging sentence without sending care text to a speech provider. Production preferences must eventually be stored per authorized client and include voice ID/provider, pace and conversational pacing. A voice cannot be classified as suitable without the client's feedback.

Encouragement is also conversational behavior: one question at a time, brief replies, adult and respectful wording, no guilt about missed tasks, and room to think or disagree. Do not substitute exaggerated cheerfulness for listening.

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

**Let's Plan the Day** and **Let's Plan Today** enter the same daily planning workflow. The preferred morning window is 09:00-11:00 in the participant's configured time zone; 10:00 remains the default. The command also works outside the window and resumes the current day's check-in rather than creating duplicate plans.

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
