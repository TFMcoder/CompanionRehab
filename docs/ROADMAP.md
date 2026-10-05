# Companion Rehab: agent implementation roadmap

Updated: 2026-10-04. **S01 is in progress: adapt the existing baseline to local data hosting, four roles, My Day navigation, meals as tasks and GPT-6 Sol high reasoning. Historical automated checks do not establish acceptance of this revised scope; no live acceptance has run.**

The canonical [roadmap.json](roadmap/roadmap.json), schema version 1.4.0, defines feature order, product contracts, scope, dependencies, human actions and acceptance. [HUMAN_ACTIONS.md](HUMAN_ACTIONS.md) is generated from its human-action records. Current user instructions take precedence; reflect agreed changes in the JSON. The [October 3 decisions](architecture/PRODUCT_DECISIONS_2026-10-03.md) record roles, hosting and model selection; the [October 4 decisions](architecture/PRODUCT_DECISIONS_2026-10-04.md) prioritize existing-subscription reasoning qualification and distinguish it from MCP, speech and browser access.

Current account-setup step: [qualify the supported ChatGPT-plan route](S01_FIRST_CONNECTION.md). The private API key is saved and model visibility passed; bounded API reasoning/speech probes returned HTTP 429. Do not repeat key creation or require API funding before subscription qualification. The requested October 5 supervised S01/S02 pilot is a stretch target; current acceptance gates still apply.

October 4 implementation progress: the owner approved Nancy's app-specific OAuth connection. Actual GPT-6 Sol high reasoning and a two-request, read-only synthetic function round trip succeeded through the owner's ChatGPT plan. Installed Windows speech generated a synthetic sample and local faster-whisper recognized it correctly. [Connection evidence](evidence/S01-CHATGPT-PLAN-CONNECTION-2026-10-04.json) records usage, the streaming adapter repair and separate speech results. Intended-user/deployment eligibility, live credential lifecycle, genuine microphone/audible conversation, local PostgreSQL/auth and My Day integration remain unqualified; neither S01 live gate is passed.

## Immediate delivery goal: S01-S04

The first MVP is the participant's **10:00 local-time check-in with Nancy**, combining a daily task brief and meal planning through actual two-way voice. The first four slices make that experience useful through a real day, resilient to interruptions and repeatable across days.

| Slice | Completed feature | What the participant can do | Dependencies |
|---|---|---|---|
| S01 | Plan the day with Nancy at 10 AM | Hear real tasks, discuss meals, accept the reviewed day plan and retrieve or revise it by voice/touch | None |
| S02 | Track actual meals and tasks through the day | Report what was eaten or done, defer tasks, correct mistakes and hear a factual summary | S01 |
| S03 | Resume check-ins and tracking after interruptions | See what is pending or saved, reconnect and resolve conflicts without duplicate actions | S02 |
| S04 | Return to a fresh 10 AM brief each day | Review yesterday, explicitly carry unfinished work forward and accept a fresh plan across successive days | S03 |

**S01 delivers a useful combined feature.** It includes My Day, minimum real authentication with four scoped roles, a local PostgreSQL deployment, HTTPS route, task/meal setup and two-way speech with GPT-6 Sol high reasoning. Voice and buttons open the task and daily meal views. Tasks expose what, urgency and scheduled date/time; meals share task occurrence identities. Minimal authorized setup supplies the choices; Asana and full dashboards are not prerequisites.

Within S01, first qualify the intended account/deployment for existing ChatGPT-plan usage and prove a bounded **GPT-6 Sol high** turn with authorized tools. Next qualify speech input/output independently. Integrate those connections with My Day and local care state, then run disposable S01-LIVE2 before the consented S01-LIVE1 conversation. Database/auth and UI work can proceed while independent account checks are pending. This is an execution order inside the feature, not a new infrastructure slice.

Keep four concerns separate: reasoning/auth/billing, speech, care-tool transport and the browser's HTTPS origin. Prefer server-owned functions or local MCP; a **Secure MCP Tunnel is optional** for a supported OpenAI caller that needs local tools. It supplies neither speech nor My Day web hosting. Any API-key fallback requires a documented qualification result and explicit owner route/cost decision; quota failure must not silently switch billing or model. A successful catalog lookup is not completed inference, and a completed text turn is not voice acceptance.

**S02 separates intentions from actual events.** Accepting a plan never marks tasks complete or meals eaten. Factual reporting, unplanned activity and corrections preserve the accepted plan and event history.

**S03 expands reliability already required in S01.** Basic durable local database saves, receipt lookup and honest failure messages are required from the first write. S03 adds persistent device-pending commands, offline touch behavior, conflict handling and revocation-safe recovery. It does not promise offline GPT voice.

**S04 proves repeat-day use.** Extend S01's existing DailyCheckIn record and start/resume contract; do not create a second session ledger. Reuse current task definitions and meal choices; preserve prior-day facts, show gaps, review carryover and explicitly accept the current day's plan. The live gate spans three genuine local dates. Synthetic time travel does not satisfy it.

The check-in is **user initiated at 10:00 in the participant's configured time zone**. America/Toronto is a planning default to confirm once during setup. Automatic reminders, outbound calls, background preparation and microphone activation are separately deferred; Cerberus has no qualified scheduler to import for this requirement.

## Later feature order

| Slice | Completed feature | Dependencies |
|---|---|---|
| S05 | Build and use groceries from the meal plan | S01, S02 |
| S06 | Bring Asana household tasks into the daily tracker | S02 |
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

Current inventory: **12 feature slices, 31 human actions, 30 automated acceptance groups and 18 live scenarios; S01 in progress; 0 completed features.** The September 29 baseline's 43 passing tests across six suites are [historical evidence](evidence/S01-2026-09-29.json), not validation of the revised contracts. The [setup guide](S01_SETUP.md) and [live run sheet](S01_LIVE_TEST.md) explicitly flag the deployment adaptation still required. The JSON is authoritative as this changes.

The [October 3 publication checks](evidence/SYNC-2026-10-03.json) record 43 passing baseline regressions, type checking and a production build after a task/meal input-state repair. They also preserve the initial failed attempts. Revised-contract and live acceptance remain outstanding.

[TECHNICAL_RESEARCH.md](architecture/TECHNICAL_RESEARCH.md) retains the provider and cost background. The feature sequence here and in the JSON supersedes its historical planning context.
