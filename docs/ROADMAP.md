# Companion Rehab: agent implementation roadmap

Updated: 2026-10-05. **S01 is in progress. My Day now runs with local PostgreSQL/auth, the selected GPT-6 Sol high/Heart conversation, task/meal proposals and exact reviewed acceptance. Real-service synthetic checks have passed; actual participant/iPhone acceptance and the remaining S01 contracts are still open.** See the [local My Day runbook](LOCAL_MY_DAY.md) and [current implementation evidence](evidence/S01-MY-DAY-2026-10-05.json).

Current build: one Talk to Nancy session survives My Day/Tasks/Meals/Groceries navigation; button paths work independently; local-time suggestions, appointment entry, grocery confirmation and task urgency/time/duration proposals share the authorized care service. Four roles are represented in local grants; this increment enables client care actions, while other role experiences and meal task-occurrence unification remain incomplete. Heart now plays coherent chunks and local ASR feeds the selected Sol-high model. No household facts or microphone recordings were used in the engineering checks. The owner subsequently approved temporary HTTPS exposure of the authenticated sample-data app. [HTTPS evidence](evidence/S01-MY-DAY-HTTPS-2026-10-05.json) records successful sign-in, access denial, session revocation and Heart greeting delivery; the owner subsequently reported an initial trial and requested the voice refinements recorded below. The existing sample-preview URL is unchanged.

**Current voice refinement:** Talk to Nancy now gives only the brief preferred-name greeting, with accurate startup/playback/listening states. Mid-reply speech interruption uses confirmed browser echo cancellation plus playback-reference checks, with an Interrupt Nancy button; interrupted reviews cannot be accepted by late playback. Heart pronunciation and warm-worker cancellation are corrected, with measured latency improvements. [Voice-feedback evidence](evidence/S01-VOICE-FEEDBACK-2026-10-05.json) keeps actual revised iPhone acceptance open. Contextual suggestions follow the client’s response.

The following dated paragraphs retain earlier connection and voice-evaluation history. Their open implementation claims are superseded by the current evidence above; they do not reopen the finalized Heart voice choice.

The canonical [roadmap.json](roadmap/roadmap.json), schema version 1.4.0, defines feature order, product contracts, scope, dependencies, human actions and acceptance. [HUMAN_ACTIONS.md](HUMAN_ACTIONS.md) is generated from its human-action records. Current user instructions take precedence; reflect agreed changes in the JSON. The [October 3 decisions](architecture/PRODUCT_DECISIONS_2026-10-03.md) record roles, hosting and model selection; the [October 4 decisions](architecture/PRODUCT_DECISIONS_2026-10-04.md) prioritize existing-subscription reasoning qualification. The [October 5 voice and daily companion decision](architecture/VOICE_AND_DAILY_COMPANION_2026-10-05.md) records free voice candidates, conversation timing, foreground wake limits, current-time context, meal choice and prompted-day behavior.

Current account-setup step: [qualify the supported ChatGPT-plan route](S01_FIRST_CONNECTION.md). The private API key is saved and model visibility passed; bounded API reasoning/speech probes returned HTTP 429. Do not repeat key creation or require API funding before subscription qualification. The requested October 5 supervised S01/S02 pilot is a stretch target; current acceptance gates still apply.

October 4 implementation progress: the owner approved Nancy's app-specific OAuth connection. Actual GPT-6 Sol high reasoning and a two-request, read-only synthetic function round trip succeeded through the owner's ChatGPT plan. Installed Windows speech generated a synthetic sample and local faster-whisper recognized it correctly. [Connection evidence](evidence/S01-CHATGPT-PLAN-CONNECTION-2026-10-04.json) records usage, the streaming adapter repair and separate speech results. Intended-user/deployment eligibility, live credential lifecycle, genuine microphone/audible conversation, local PostgreSQL/auth and My Day integration remain unqualified; neither S01 live gate is passed.

October 5 device direction: the owner will test from a **smartphone browser** and requested a web URL first. The [My Day device preview](DEVICE_PREVIEW.md) exposes only synthetic tasks/meals, fixed voice playback and a browser-only microphone check over a temporary HTTPS route. Phone recordings are not uploaded. [Preview evidence](evidence/S01-DEVICE-PREVIEW-2026-10-05.json) records 79 passing tests, actual HTTPS/browser checks and the limits of those checks. This preview supports immediate device feedback within S01; it does not replace the authenticated care service, select the production route, or complete either live gate. The owner subsequently confirmed **iPhone with Safari** and **Outlook calendar**. Target selection is resolved; actual audio results and Outlook account authorization remain pending. Existing Tailscale/MCP routes are unchanged.

The owner approved the preview's **interface layout**, then specified the next behavior: choose a free natural voice, converse after one tap with a delayed close, optionally say **Hey Nancy** while My Day is awake, and receive timely help around appointments/meals. The voice, wake listener and reminders have not been accepted on the actual phone. The provisional voice defaults (1.2-second end-of-turn silence, 30-second idle, 10-second closure grace) are adjustable and require real-device measurement. An explicit End closes immediately; thinking/speaking does not count as idle. A browser cannot promise Alexa-like listening when the phone is locked or the page is closed.

The public preview now exposes a **browser-local voice chooser** and sample audition. [Voice-audition evidence](evidence/S01-VOICE-AUDITION-2026-10-05.json) records 83 passing automated tests, a production build and an actual public-browser chooser check. The owner subsequently auditioned and rejected the current preview voices as robotic, with inadequate intonation, pacing and inflection. Improved neural voice quality, the preferred production voice, natural conversation and full S01 live acceptance remain unverified. See the recorded [quality feedback](architecture/VOICE_AND_DAILY_COMPANION_2026-10-05.md#owner-quality-feedback-current-samples-rejected); successful playback is not voice acceptance.

## Immediate delivery goal: S01-S04

The owner then requested a **Kokoro trial**. Nine synthetic local neural samples—Heart, Bella and Emma across morning planning, meal choice and task carryover—are available in the same public preview. [Kokoro evidence](evidence/S01-KOKORO-AUDITION-2026-10-05.json) records 92 passing tests, real CPU synthesis and public desktop-browser playback. Subsequent owner listening feedback is **better, but still somewhat robotic**. [Naturalness remains unresolved](architecture/VOICE_AND_DAILY_COMPANION_2026-10-05.md#kokoro-listening-feedback-improved-still-robotic); production voice choice and integrated iPhone/Safari acceptance remain pending. This trial has no speech API cost and does not complete live conversation or either S01 gate.

**Final voice decision: Kokoro Heart (`af_heart`) is selected by the owner; comparison is closed.** The [decision record](architecture/VOICE_MODEL_DECISION_2026-10-05.md#final-owner-decision-heart) supersedes the earlier provisional Pocket recommendation. Use the existing free local Kokoro runtime, keep the model warm, and integrate coherent sentence playback/cancellation with Sol-high, the daily planner and nutrition conversation. Do not request another voice audition or extend the shortlist. Actual iPhone/Safari conversation testing remains required. Pocket native-chunk results are historical comparison evidence, not Heart delivery measurements.

**The primary UX is one master Talk to Nancy button**, available from home/My Day and every shipped client view. Nancy opens with only “Hi <preferred name>, what can I help with?” and listens. After the client responds, she can offer relevant suggestions from current local time, appointments and outstanding tasks. Voice can complete supported workflows without opening a task/meal screen first. My Day, tasks, meals and groceries remain independently accessible by buttons or voice; changing a supporting view preserves the conversation.

**The morning window is 08:00-11:00 in the participant's time zone:** breakfast, planning the day, post-breakfast exercise and rehab. Nancy checks what is actually pending, asks when completion is unknown, and allows the client to redirect. Existing approved exercise/rehab tasks can be scheduled and surfaced in S01; step-by-step Morning Boot and protocol guidance remain S07/S08. The 10:00 check-in remains a preference, not a gate. **Let's Plan the Day/Today** are optional conversational shortcuts.

| Slice | Completed feature | What the participant can do | Dependencies |
|---|---|---|---|
| S01 | Talk to Nancy and plan the day | Open a continuous conversation by button or opted-in foreground wake; hear real tasks and local appointments, choose among meals, capture a confirmed missing ingredient, accept the reviewed day plan and retrieve or revise it | None |
| S02 | Track actual meals and tasks through the day | Report what was eaten or done and when, defer tasks, correct mistakes and hear a factual ledger and summary | S01 |
| S03 | Resume check-ins and tracking after interruptions | See what is pending or saved, reconnect and resolve conflicts without duplicate actions | S02 |
| S04 | Return to a fresh day with reviewed carryover and timely prompts | Ask whether yesterday's unfinished tasks still matter, need a new priority or help; accept a fresh plan and receive opted-in meal/appointment prompts | S03 |

**S01 delivers a useful combined feature.** It includes My Day, minimum real authentication with four scoped roles, a local PostgreSQL deployment, HTTPS route, task/meal and local appointment setup, and two-way speech with GPT-6 Sol high reasoning. The master Talk to Nancy button opens a general continuous conversation with the short preferred-name greeting, then listens before time-aware suggestions; a qualified opted-in foreground **Hey Nancy** path opens the same authorized session. The owner has selected Heart; implement and test that voice without another comparison. Voice and buttons open task, meal and minimal grocery views. Tasks expose what, urgency, proposed duration and scheduled date/time; meals share task occurrence identities. Nancy proposes several feasible meals, asks what to change when none appeals, discusses ordinary portions within approved constraints and confirms a missing ingredient before saving one grocery item. Minimal authorized setup supplies local calendar context; Asana and full dashboards are not prerequisites.

Within S01, first qualify the intended account/deployment for existing ChatGPT-plan usage and prove a bounded **GPT-6 Sol high** turn with authorized tools. Next qualify speech input/output independently. Integrate those connections with My Day and local care state, then run disposable S01-LIVE2 before the consented S01-LIVE1 conversation. Database/auth and UI work can proceed while independent account checks are pending. This is an execution order inside the feature, not a new infrastructure slice.

Keep four concerns separate: reasoning/auth/billing, speech, care-tool transport and the browser's HTTPS origin. Prefer server-owned functions or local MCP; a **Secure MCP Tunnel is optional** for a supported OpenAI caller that needs local tools. It supplies neither speech nor My Day web hosting. Any API-key fallback requires a documented qualification result and explicit owner route/cost decision; quota failure must not silently switch billing or model. A successful catalog lookup is not completed inference, and a completed text turn is not voice acceptance.

**S02 separates intentions from actual events.** Accepting a plan never marks tasks complete or meals eaten. Factual reporting includes actual occurrence times, delays/deferrals, unplanned activity and corrections; each new conversation uses the latest committed ledger rather than repeating a completed item as pending.

**S03 expands reliability already required in S01.** Basic durable local database saves, receipt lookup and honest failure messages are required from the first write. S03 adds persistent device-pending commands, offline touch behavior, conflict handling and revocation-safe recovery. It does not promise offline GPT voice.

**S04 proves repeat-day use.** Extend S01's existing DailyCheckIn record and start/resume contract; do not create a second session ledger. Reuse current task definitions and meal choices; preserve prior-day facts, show gaps and ask whether each missed task still needs doing, has changed urgency or needs help before reviewed carryover. Add a durable local scheduler for explicitly enabled meal/appointment prompts, quiet hours, delivery receipts and missed-run handling. Nancy may speak while the browser is active; a permitted browser notification invites the participant back when speech is unavailable. The live gate spans three genuine local dates and at least one genuine prompt. Synthetic time travel does not satisfy it.

The check-in is **user initiated**, preferably at 10:00 within 08:00-11:00 in the participant's configured time zone. America/Toronto is a planning default to confirm once during setup. S04 prompts are opt-in and separately scheduled. Outbound calls, closed-browser speech, background phone wake, automatic microphone activation and model/connector preparation remain deferred; Cerberus has no qualified scheduler to import.

## Later feature order

| Slice | Completed feature | Dependencies |
|---|---|---|
| S05 | Expand minimal grocery capture into a shared shopping list | S01, S02 |
| S06 | Connect Asana tasks and the Outlook calendar | S02 |
| S07 | Follow Morning Boot one step at a time | S02, S04 |
| S08 | Follow and report an approved rehab session | S02, S07 |
| S09 | See explainable daily progress and achievements | S02, S07, S08 |
| S10 | Use Support Team for shared tasks, achievements, optional completion/reschedule notifications and help | S02, S09 |
| S11 | Operate today's program from an administrator dashboard | S01, S02, S06, S07, S08, S10 |
| S12 | Review trends and data exports in Clinician Partners, with five clinical archetype configurations | S09, S11 |

The narrow client **My Day** home ships in S01. **Support Team** is the family/friend home; **Clinician Partners** is the clinician home. S01 establishes their role and navigation boundaries, with full features in S10/S12. Client achievements are designed in S09; administrator and trend dashboards stay in S11/S12. Client, family/friend and administrator interactions are principally voice, and every user has a UI path. Morning Boot remains later step-by-step routine guidance.

## Cerberus reuse decisions

The [source assessment](architecture/CERBERUS_REUSE_ASSESSMENT.md) is the evidence for the canonical `reuse_plan`. Each early slice names applicable `reuse_refs`.

- **Extract/adapt:** the small TypeScript request/error utility and selected focus/status/fallback interaction behavior.
- **Port patterns and tests:** exact-target model proposals, explicit reviewed-plan acceptance, transactional receipts, stale-version refusal, truthful save/recovery state and local-day handling.
- **Reference security tests:** adapt origin/host and session-boundary cases to administrator/client/family-friend/clinician authentication with client-scoped grants.
- **Qualify subscription reasoning:** adapt the small Cerberus ChatGPT-authenticated adapter pattern, with exact Sol/high binding, bounded usage, restricted tools, visible quota/auth failure and app-specific credentials. Historical Cerberus runs do not prove current Nancy access or multi-user eligibility.
- **Reuse MCP conditionally:** expose narrow local care tools only for an identified supported caller. Preserve independent My Day HTTPS and care-service authorization; keep protected LifeCore data and credentials out.
- **Build for Companion:** two-way Nancy voice, the care/task/meal data model, database permissions and the simple participant screen.
- **Leave out:** the Cerberus monorepo, business dashboard, general OpenClaw orchestration, private LifeCore data, shared-password authorization and its deployment configuration.

Cerberus dictation adds text to a composer; it is not proof of the required spoken conversation. Its planned M53 morning preparation is not an active scheduler. Historical tests are design evidence, not current Companion test results. Do not import archive-only snapshot merging that would retain deleted or revoked participant data.

Retain React/TypeScript/Vite, Node/Fastify, PostgreSQL and the independent care-service command boundary. Host durable data on this computer first; qualify compatible local authentication and preserve migration to another local server or cloud. Prefer supported ChatGPT-plan reasoning through a minimal local Codex app-server or Responses adapter, retaining the explicitly selected GPT-6 Sol high and a separate speech layer. Verify intended-user/deployment eligibility, actual completed inference, usage limits, speech and My Day HTTPS during S01. The documented plan flow excludes audio input/transcription and hosted Responses MCP; local MCP/function tools are separate. No new subscription or paid API fallback is selected by this roadmap.

## Agent execution contract

1. Read this guide and the canonical JSON. Focus delivery on S01-S04, selecting the lowest-priority unfinished slice with completed dependencies.
2. Read its outcome, exclusions, inputs, human actions, reuse references, tasks, contracts, criteria and tests. Apply shared requirements from their introduction slice onward.
3. Deliver the complete feature, including only its necessary setup. Keep services at or below $50/month excluding GPT backend usage; currency remains unconfirmed, so plan conservatively in CAD with free tiers and existing resources first.
4. Prepare concrete work before asking for human decisions or live participation. Reuse valid access, consent and supplied task/meal choices. Continue independent authorized preparation when an input blocks live execution.
5. Run synthetic regressions and the actual live tests with their stated data policies. S01 must exercise microphone input, audible Nancy replies and accepted-plan state on the intended device. Run S01-LIVE2's disposable safety/restore checks before S01-LIVE1 retains meaningful participant data; numeric IDs are not execution order.
6. Record actual outcomes, revision, time, observer, environment, data origin and sanitized/private evidence references. Keep real care data, transcripts and credentials out of this repository.
7. Use `awaiting_live_test` when code is ready but live evidence is missing. Mark `done` only after dependencies, required inputs, applicable slice-completion human actions and current-revision automated/live evidence are complete.
8. Conditional paid-spending, clinical-use, daily-reliance and release-gate actions block only their named activity. Reassess applicability when the trigger changes; do not invent signoffs.
9. Regenerate the human checklist after changing its JSON records, then run both validators below before handoff.

Writing this plan does not provision accounts, run live tests or activate a recurring schedule.

## Release gates

- **G-EARLY-USE:** S01 proves one useful real two-way-voice daily brief and accepted meal/day plan.
- **G-FIRST-FOUR:** S01-S04 prove planning, a genuine tracked day, actual-device recovery and three real-date check-ins.
- **G-DAILY-RELIANCE:** before unattended reliance, complete the applicable operating-arrangement action S03-H02 and review availability, recovery, restoration and costs.
- **G-FULL-MVP:** all later features and the existing observed seven-day full-loop pilot remain required. The early three-day trial does not replace this gate.

## Machine-readable contents

| JSON field | Purpose |
|---|---|
| `delivery_focus` | Ordered S01-S04 target, Nancy identity, 10:00 routine, timezone input and first-four gate |
| `product_contract` | Four roles/homes, navigation, task/meal model, family notifications, clinical archetypes, local hosting, exact Sol model and explicit reasoning-route qualification/tool-connection policy |
| `reuse_plan`, `slices[].reuse_refs` | Cerberus source pinned per component, exact reuse decisions, limits and per-slice mapping |
| `constraints`, `execution_policy` | Budget, runtime, data handling and execution/evidence rules |
| `shared_requirements` | Cross-cutting behavior and the first slice that requires it |
| `operator_inputs`, `human_action_policy` | Input resolution, human responsibilities, timing and reused decisions |
| `service_defaults` | Existing low-cost choices; unknown expenses remain null |
| `slices` | Stable IDs, priority, dependencies, scope, tasks, contracts and criteria |
| `slices[].human_actions` | Owner role, timing, blocking scope, linked tests/inputs, status and actual evidence |
| `automated_tests`, `live_tests`, `test_results` | Both acceptance lanes and actual current-revision evidence |
| `release_gates`, `deferred` | Delivery outcomes, daily reliance and deliberately postponed scope |

Every result requires `test_id`, `outcome`, `implementation_revision`, `executed_at`, `environment`, `data_origin`, `observed_by`, `evidence_ref` and `notes`. Do not populate illustrative passing results in the canonical JSON.

## Revision from the earlier roadmap

S01-S04 retain their agreed order. September 29 produced a local code baseline with 43 passing synthetic tests, preserved in its historical evidence file. October 3 changes require adaptation, so S01 is back in progress with no current-contract results or implementation fingerprint asserted. S02-S04 remain planned. S02 includes actual reporting and explicit rescheduling; S03 handles interruptions; S04 proves repeat-day use and reviewed carryover. S10 now explicitly includes Support Team task visibility and optional notifications; S12 includes clinical archetype dashboards and data exports. Ownership, local initial storage and the exact GPT-6 Sol high selection are resolved inputs; actual access and live evidence remain outstanding.

Stable queryable IDs, actors, sources, UTC instants plus local-day context, accepted plan versions, corrections, command receipts and authorized projections start in S01. S02 adds actual reports. Later dashboards consume these records rather than creating a competing ledger.

## Validation

From the repository root with PowerShell 7.4 or later:

~~~powershell
pwsh -NoProfile -File ./scripts/validate-roadmap.ps1
pwsh -NoProfile -File ./scripts/render-human-actions.ps1 -Check
~~~

After human-action edits, first run the renderer without `-Check`. The roadmap validator checks schema, unique IDs, dependencies, focus/reuse references, test coverage in both lanes and completion metadata. The renderer checks that the human reading view matches the JSON. Neither proves application behavior or private live evidence.

Current inventory: **12 feature slices, 34 human actions, 34 automated acceptance groups and 19 live scenarios; S01 in progress; 0 completed features.** The September 29 baseline's 43 passing tests across six suites are [historical evidence](evidence/S01-2026-09-29.json), not validation of the revised contracts. The [setup guide](S01_SETUP.md) and [live run sheet](S01_LIVE_TEST.md) explicitly flag the deployment adaptation still required. The JSON is authoritative as this changes.

The [October 3 publication checks](evidence/SYNC-2026-10-03.json) record 43 passing baseline regressions, type checking and a production build after a task/meal input-state repair. They also preserve the initial failed attempts. Revised-contract and live acceptance remain outstanding.

[TECHNICAL_RESEARCH.md](architecture/TECHNICAL_RESEARCH.md) retains the provider and cost background. The feature sequence here and in the JSON supersedes its historical planning context.
