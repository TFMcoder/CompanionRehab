# Human actions by implementation stage

Updated: 10/26/2026 20:53:54. Generated from the canonical roadmap; all statuses below come from that file.

Source: [roadmap.json](roadmap/roadmap.json), in each slice's human_actions array. Edit the JSON, then run the renderer; do not maintain a separate checklist here. See [ROADMAP.md](ROADMAP.md) for feature scope and live tests.

## How to use this list

- Build, configure, debug, migrate, test and prepare concrete reviewable outputs within existing authorization. Do not turn routine technical work into human chores.
- Reuse existing access, consent, decisions and valid evidence. Never request the same authorization again merely because another slice needs it.
- Ask only when the action is needed; continue independent authorized work while waiting. A list entry is a future requirement, not an immediate request.
- Apply a conditional item only when its condition is true. Record not_applicable with a specific reason when false; an agent may establish this from evidence without asking the user. Reassess the status when the trigger changes.
- A slice cannot be done while an applicable slice_completion human action is unfinished. Paid-commitment, daily-reliance, clinical-use and release-gate items block only that named operation/gate, not unrelated free or supervised feature work.
- Done requires an actual completion reference and timestamp; record private or sanitized references, not names, credentials, clinical records or invented signoffs.
- Human-action owner labels describe responsibilities, not application permissions. The application has exactly four roles: administrator, client, family/friend and clinician. One person may hold several responsibilities; the project owner is confirmed as both administrator and technical lead. Keep account identities private.
- Asana remains deferred until access. October 8 scopes Microsoft 365 mail/calendar read/write for S06; IT handoff is prepared, but registration/consent, connector implementation and actual live trials remain pending. These do not block the existing local client trial.

Routine coding, technical service configuration, database work, synthetic tests and evidence collection belong to the agent. The human supplies real-world decisions, restricted account interactions and participation that the agent cannot substitute for.

## Role labels

| Role | Meaning |
|---|---|
| participant_or_tester | The person using the feature or a consenting early tester. |
| account_owner | The person able to complete account login, MFA, ownership and consent steps. |
| product_owner | The person choosing product scope, operating arrangements and budget decisions. |
| household_manager | The person maintaining real meals, groceries and household tasks. |
| protocol_owner | The person authorized to supply or approve the applicable routine or care instructions. |
| scoring_owner | The person authorized to choose progress and achievement rules. |
| family_recipient | A designated consenting recipient of the planned family test. |
| operator | A person authorized to operate the program and review its records. |

## Stage index

| Stage | Feature | Human action IDs |
|---|---|---|
| S01 | Talk to Nancy and plan the day | S01-H01, S01-H02, S01-H03, S01-H04, S01-H05, S01-H06, S01-H07, S01-H08 |
| S02 | Track actual tasks, meals and appointments with grounded nutrition | S02-H01, S02-H02 |
| S03 | Resume check-ins and tracking after interruptions | S03-H01, S03-H02 |
| S04 | Return to a fresh day with reviewed carryover and timely prompts | S04-H01, S04-H02, S04-H03 |
| S05 | Build and use groceries from the meal plan | S05-H01, S05-H02 |
| S06 | Connect Asana tasks and Outlook mail/calendar | S06-H01, S06-H02, S06-H03 |
| S07 | Follow Morning Boot one step at a time | S07-H01, S07-H02 |
| S08 | Follow and report an approved rehab session | S08-H01, S08-H02 |
| S09 | See explainable daily progress and achievements | S09-H01, S09-H02 |
| S10 | Use Support Team for client-approved task requests, shared progress and help | S10-H01, S10-H02, S10-H03, S10-H04 |
| S11 | Operate today's program from an administrator dashboard | S11-H01, S11-H02 |
| S12 | Review trends and exports in Clinician Partners | S12-H01, S12-H02, S12-H03, S12-H04 |

## S01: Talk to Nancy and plan the day

- [ ] **S01-H01: Test on the selected smartphone**

  Owner: **participant_or_tester**. Status: **in_progress**. Requirement: **required**.

  **When:** Before the first actual two-way Nancy conversation.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - iPhone/Safari is confirmed. Open the supplied HTTPS preview on that device, check audible samples and microphone playback, and record the iOS version during the trial. Interface layout feedback is already approved.
  - When ready, complete the smartphone browser microphone prompt and speak/listen during the local playback check. The integrated two-way Nancy conversation still needs a later actual-device trial.
  - The owner separately approved the interface layout and selected Kokoro Heart. Check phone conversation timing, interruption and wake behavior when integrated; do not request another voice choice.

  **Agent prepares or handles:** Prepare and test the HTTPS page for iPhone/Safari; separately qualify Safari tab and Home Screen web-app audio/lifecycle behavior before relying on either. Configure and debug microphone/audio code; provide short test prompts.

  **Completion evidence:** Device/browser and actual microphone plus audible observations, first for the sample device preview and then linked to the integrated S01 live evidence. A desktop phone-sized viewport, generated audio or dictated-text mock is insufficient. The owner reported hearing the integrated conversation and identified opening-state confusion, pronunciation and latency issues. The fixes need a repeat actual-device trial, including speech interruption and false-trigger checks; no full acceptance is claimed. See docs/evidence/S01-VOICE-FEEDBACK-2026-10-05.json. The diagnosed routing/ASR/first-part improvements are deployed and measured in docs/evidence/S01-LATENCY-IMPLEMENTATION-2026-10-05.json. The owner subsequently accepted the faster response for advancing the MVP, while general GPT responses remain variable. Repeat actual iPhone/Safari timing and interruption checks on this revision; generated audio and service estimates do not pass the device gate. No further voice audition is required. October 19 client simplification is desktop-browser and engineering-qualified only; actual intended-person/iPhone/Safari acceptance remains awaiting_live_test while the intended client is unavailable. See docs/evidence/CLIENT-INTERFACE-2026-10-19.json. October 19 owner comparison is complete: Current with its top Talk banner is selected and locked; Focus review is disabled. Remaining actual-device sessions qualify the selected Current conversation, including voice state and stopping/recovery. The source/build/desktop restore checks in docs/evidence/FOCUS-UI-2026-10-19.json do not complete this human gate. October 23: the owner reports an iPhone 14 Pro Max for the separate owner Safari study. The guided Wi-Fi/cellular page is deployed and engineering-verified; actual microphone/listening/network results and iOS version remain awaiting_live_test under S01-LIVE4. This is not Dad or full-slice acceptance. See docs/SAFARI_VOICE_TEST_2026-10-23.md. October 24: recorded synthetic speech qualifies imported-task server workflows and native Heart output; in-app microphone/audio startup timed out after 20 seconds. No human-audible or physical iPhone acceptance is inferred. See docs/ASANA_VOICE_TEST_2026-10-24.md. October 24 startup follow-up: owner-only readiness/recovery code is engineering-qualified; the actual browser microphone grant remains pending, so physical capture and audible Heart delivery remain awaiting_live_test. See docs/VOICE_STARTUP_2026-10-24.md. October 26: the owner-selected exact client Sol-low/warm-v2/Heart release is deployed and engineering-qualified, with Current preserved. Actual intended-device/person speech and Safari/network responsiveness remain awaiting_live_test; no new voice choice is needed. See docs/CLIENT_SPEED_ROLLOUT_2026-10-26.md. October 26: actual desktop microphone capture started but its uncontrolled unknown-speaker turns are not participant acceptance. Seven controlled recorded-ASR/Pro/Heart Outlook cases pass with214 preservation checks; no controlled physical-phone or human-audible result is claimed. Connected-workflow latency remains high. See docs/OUTLOOK_VOICE_TEST_2026-10-26.md.

  **Linked inputs/tests:** I-DEVICE, S01-LIVE1, S01-LIVE2, S01-LIVE4.

- [ ] **S01-H02: Complete missing private provider and HTTPS access**

  Owner: **account_owner**. Status: **in_progress**. Requirement: **required**.

  **When:** When the agent has prepared the specific intended-user route, before that user invokes live reasoning.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Private OpenAI project/key setup, ownership and the owner's Nancy OAuth/ChatGPT-plan consent are complete. Identify the intended participant account/device and complete only additional sign-in or ownership steps required for that deployment. Do not recreate keys or repeat the completed owner consent, and do not assume the administrator subscription covers every client.
  - Review an explicit API fallback/cost proposal only if subscription qualification fails or the selected speech path needs separately billed GPT access. Funding remains an owner choice, not an automatic prerequisite or silent fallback.
  - Complete only missing HTTPS/domain ownership and, if actually selected, Secure MCP Tunnel workspace/access steps. Keep credentials private; routine installation/configuration is agent work.
  - Temporary public exposure of the password-protected sample-data My Day app is explicitly owner-approved on 2026-10-05. The HTTPS practice route is verified; do not ask for this same approval again. This does not approve real care-data use, a paid service or another participant account binding.
  - For your own intended reasoning use, complete only missing personal sign-in/consent and confirm who controls the proposed runtime and token storage. Do not lend the owner subscription or credentials to other clients/family members.

  **Agent prepares or handles:** First prepare and qualify the lowest-cost supported ChatGPT-plan adapter for exact gpt-6-sol high, with app-specific auth, allowance/error handling and actual completed inference evidence. Preserve independent care-service authorization and user/account boundaries. Qualify speech input/output independently; disclose any new costs before a paid step. Do not claim a tunnel or subscription text call proves voice support. Configure local database/auth, shared care commands and My Day HTTPS. Add local MCP or Secure MCP Tunnel only for a concrete supported caller; preserve per-client grants and test revocation. Reuse docs/evidence/S01-OPENAI-CONNECTION-2026-10-04.json and the saved key. Prepare a concrete fallback proposal if needed; no repeated sign-in, key setup or funding requests without a remaining technical need. Prepare the actor/account/runtime eligibility assessment and concrete binding/storage design first; test isolation, renewal, revocation and allowance failure. Continue reversible UI/database/server work while intended-user access is pending. Use the prepared distinct-client provisioning flow only after the real identity/participant linkage is verified; preserve existing records and historical actors, and qualify the intended-client inference binding without sharing the owner Pro route.

  **Completion evidence:** Owner app-specific OAuth consent and exact Sol-high inference remain evidenced by the October 4 connection record. docs/evidence/S01-MY-DAY-2026-10-05.json adds actual owner-bound authorized care planning, local PostgreSQL/auth, encrypted disposable restore, Heart and ASR integration using synthetic records. Completion still needs intended-user/deployment eligibility, remaining live credential lifecycle/allowance checks, the actual device conversation and HTTPS route. The owner subsequently approved the new authenticated sample-data test tunnel; docs/evidence/S01-MY-DAY-HTTPS-2026-10-05.json records successful HTTPS sign-in, access denial, session revocation and Heart audio delivery. Actual iPhone acceptance and stable deployment remain open. Credentials and private evidence remain local; S01-H02 and both full live gates remain incomplete. Required intended-route evidence also identifies runtime control, local token custody and per-user usage isolation; separate logins are not sufficient. October 13 local demo startup/recovery is verified; the persistent Tailscale destination is explicitly owner-approved; provider sign-in, activation and actual public HTTPS verification remain pending in docs/evidence/DEMO-HOSTING-2026-10-13.json. Existing intended-user/account gates remain unchanged. October 13 completion update: specific persistent HTTPS approval, Tailscale provider sign-in and public verification are complete (19 public checks plus 16 speech/nutrition/logging checks). The preceding pending HTTPS statements are historical. Do not repeat approval or sign-in unless actual account state requires it. Intended-user/account eligibility and remaining live gates still keep this human action in progress. October 18: independent engineering gap repairs, actual disposable PostgreSQL/HTTP and desktop-browser recovery/reminder checks, and code-only HTTPS deployment are recorded in docs/evidence/DAILY-LOOP-GAPS-2026-10-18.json. Intended-person/device/genuine-day requirements remain open; no human action is completed from synthetic evidence. October 18 personal-connection request: docs/PERSONAL_REASONING_CONNECTION.md prepares the deployment assessment and activation contract; 37 synthetic checks pass in docs/evidence/PERSONAL-REASONING-PREFLIGHT-2026-10-18.json. Owner follow-up: the personal plan is not available yet and migration is for later. Retain current local hosting and defer immediate personal sign-in/purchase/migration; account entitlement and runtime/token control still need qualification when resumed. Human action and intended-user route remain in progress/unqualified. Subsequent clarification: intended-client voice is wanted now on the current host, before later migration. The existing-project API proposal and illustrative cost are prepared in docs/PERSONAL_REASONING_CONNECTION.md. Current funded inference, route/budget approval and actual-device acceptance remain unverified; migration does not block independent preparation. Latest owner preference retains no API billing. Directly verified SIWC sections 2 and 4 explain why temporary owner-plan use cannot qualify the client. Personal entitlement/runtime or separately provider-authorized alternatives remain open; no exception, account purchase or new route is assumed. Final caregiver continuation: explicit informed owner approval and the permitted resubmitted review cover this exact route. docs/evidence/CAREGIVER-VOICE-2026-10-18.json records 900 regression passes (one optional skip), one completed real Sol/high request within 16 actual service checks, exact activation, 7 HTTPS checks and enabled Talk in the existing authenticated client browser. Reuse completed action approval; remaining provider-contract, credential lifecycle, person/device and full-slice requirements keep this action in progress.

  **Linked inputs/tests:** I-ACCOUNTS, I-DOMAIN, I-MODEL, S01-LIVE1, S01-LIVE2.

- [ ] **S01-H03: Agree the first real-data test boundary**

  Owner: **product_owner**. Status: **pending**. Requirement: **required**.

  **When:** Before retaining the participant's real task and meal-plan data.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Identify the consenting participant/tester and confirm use and visibility of their real tasks, meal choices and accepted plans.
  - Initial storage on this machine is decided. Review remaining remote GPT/speech processing, routing, backup and retention boundaries from concrete options; record participant consent privately.

  **Agent prepares or handles:** Present the data flow, provider options and minimal retention proposal for review. Configure the chosen boundaries and private consent record; keep public evidence sanitized. Prepare a purpose-specific minimum outbound-field inventory, role/client sharing examples and provider/local/backup retention boundaries. Explain that store:false and local care storage do not establish zero remote retention or residency.

  **Completion evidence:** Private tester-consent and data-handling decision references, with I-DATA and I-REGION resolved.

  **Linked inputs/tests:** I-DATA, I-REGION, S01-LIVE1.

- [ ] **S01-H04: Try Talk to Nancy and the morning planning conversation**

  Owner: **participant_or_tester**. Status: **in_progress**. Requirement: **required**.

  **When:** After S01-LIVE2's disposable safety/restore checks pass and the working S01 feature is ready.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Use Talk to Nancy during a genuine preferred or delayed morning; answer or redirect, discuss actual tasks/meals and explicitly accept the reviewed plan. No prior workflow screen, exact time or mandatory questionnaire is required.
  - Complete the supported planning flow by voice, then independently open My Day/tasks/meals through buttons and verify matching records. Check that switching views does not discard the active conversation.
  - Try Lets Plan the Day/Today during the preferred or delayed morning; review genuine available appointments, meals and missing ingredients, and compare task duration, urgency and placement with what is practical. The agent covers absent branches using disposable records.
  - Confirm one genuine lasting preference through the prepared short review and check it in a later session; distinguish it from a one-day choice. Report perceived response delay while the agent measures stages.

  **Agent prepares or handles:** Prepare the working combined voice/task/meal feature before asking for a session. Verify committed plan versions, permissions, duplicate/stale protection and restore behavior; collect sanitized technical observations.

  **Completion evidence:** Observed actual two-way voice, accepted plan and revision/readback evidence on the intended device; do not substitute a dictated-text mock. October 21 caregiver reports actual intended-client conversation and specific usability failures. This begins the real trial but does not pass accepted-plan/revision, genuine-morning, device or full-slice acceptance. Repair and follow-up are recorded in docs/evidence/LIVE-TEST-REPAIRS-2026-10-21.json. October 26: the owner-selected exact client Sol-low/warm-v2/Heart release is deployed and engineering-qualified, with Current preserved. Actual intended-device/person speech and Safari/network responsiveness remain awaiting_live_test; no new voice choice is needed. See docs/CLIENT_SPEED_ROLLOUT_2026-10-26.md. October 26: actual desktop microphone capture started but its uncontrolled unknown-speaker turns are not participant acceptance. Seven controlled recorded-ASR/Pro/Heart Outlook cases pass with214 preservation checks; no controlled physical-phone or human-audible result is claimed. Connected-workflow latency remains high. See docs/OUTLOOK_VOICE_TEST_2026-10-26.md.

  **Linked inputs/tests:** S01-LIVE1, S01-LIVE3.

- [x] **S01-H05: Clarify currency before paid spending**

  Owner: **product_owner**. Status: **not_applicable**. Requirement: **conditional**.

  **When:** Only before a paid service commitment or currency-dependent forecast.
  **Blocks:** The proposed paid commitment only.
  **Applies if:** A nonzero service purchase, subscription, paid upgrade or currency-dependent budget commitment is proposed.

  **Human action:**

  - Confirm whether the $50 service ceiling is CAD or USD.
  - If the complete forecast would exceed $50, choose a lower-cost option or explicitly revise the budget.

  **Agent prepares or handles:** Proceed with free-tier development under the CAD planning default. Prepare an exact total including tax, conversion, renewal timing and add-ons; keep GPT costs separate.

  **Completion evidence:** Recorded currency decision and in-budget cost calculation, or a documented no-paid-services reason for not applying this action.

  **Linked inputs/tests:** I-CURRENCY.

  **Not applicable because:** No paid subscription, upgrade, domain purchase or currency-dependent commitment was made. Free-tier/account eligibility is unverified; CAD remains the planning default. Reassess before any paid action.

- [ ] **S01-H06: Supply a small real task list and practical meal choices**

  Owner: **household_manager**. Status: **pending**. Requirement: **required**.

  **When:** Before testing the useful combined S01 check-in.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Provide only missing genuine task details, meal choices, known restrictions and existing approved exercise/rehab content. Reuse supplied choices. The agreed preferred/delayed morning and later daily rhythm are recorded in product_contract.daily_companion; do not ask the owner to decide this UX again.
  - Confirm or correct the participant time zone once and reuse it; there is no fixed 10:00 check-in requirement.
  - Provide known pantry ingredients, portion preferences and a small genuine local appointment where available; S01 can use manual entry without external calendar OAuth.

  **Agent prepares or handles:** Prepare minimal setup forms and a concrete task/meal proposal; do not require an administrator dashboard. Record private input references and configure ownership, options and local-time behavior.

  **Completion evidence:** Private real task/meal-choice, ownership and participant-timezone references; I-DAY-CONTENT resolved and the profile's zone recorded.

  **Linked inputs/tests:** I-DAY-CONTENT, I-TIMEZONE, I-CALENDAR, S01-LIVE1.

- [x] **S01-H07: Supply approved clinical dietary instructions if used**

  Owner: **protocol_owner**. Status: **not_applicable**. Requirement: **conditional**.

  **When:** Before including clinical dietary constraints.
  **Blocks:** Using the relevant clinical instructions only.
  **Applies if:** The feature will use a prescribed diet, clinical nutrition targets or other clinical meal instructions.

  **Human action:**

  - Provide the existing approved instructions and identify the person authorized to change them.
  - Resolve ambiguous clinical restrictions; the agent must not infer a treatment plan.

  **Agent prepares or handles:** Prepare an accurate versioned representation for the owner to review. Enforce supplied constraints and prevent agent edits; use ordinary meals while clinical use is out of scope.

  **Completion evidence:** Private approved-instruction/version reference, or explicit record that clinical meal constraints are not being used.

  **Linked inputs/tests:** I-PROTOCOL.

  **Not applicable because:** Reassessed October 21 after reported type 2 meal-personalization needs: the increment uses general repository meal examples and explicitly reviewed self-reported context/preferences, not prescribed diets, numeric clinical targets, medication advice or an approved clinical protocol. No such instructions were supplied or inferred. Reassess before adding clinical constraints.

- [ ] **S01-H08: Verify selected Heart delivery and foreground wake preference**

  Owner: **participant_or_tester**. Status: **in_progress**. Requirement: **required**.

  **When:** Before S01 actual-device voice acceptance.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Voice selection is complete: the owner chose Kokoro Heart (af_heart) and closed comparison. When the integrated conversation is ready, check audible delivery and usability on iPhone/Safari; no further audition or preferred-voice decision is required.
  - If foreground Hey Nancy is offered again, decide whether to opt in only after its processing location, microphone state and stop control are explained. The October 19 simplified client removes its control and never enables it implicitly; do not request this decision while no reviewed voice-first opt-in is available.

  **Agent prepares or handles:** Integrate the selected Heart voice with warm local synthesis, coherent sentence delivery, cancellation and the Sol-high/care-command flow. Finish the working day-planning and nutrition conversation before asking for its actual-device trial. Archive alternative-model experiments; do not extend the voice search. Save only the selected preference and consent state; keep raw samples/audio private or synthetic.

  **Completion evidence:** Owner Heart-selection decision is recorded at docs/architecture/VOICE_MODEL_DECISION_2026-10-05.md#final-owner-decision-heart. Remaining evidence: actual-device conversation delivery and foreground-wake consent references; neither is a new voice-choice gate. The owner reported hearing the integrated conversation and identified opening-state confusion, pronunciation and latency issues. The fixes need a repeat actual-device trial, including speech interruption and false-trigger checks; no full acceptance is claimed. See docs/evidence/S01-VOICE-FEEDBACK-2026-10-05.json. The diagnosed routing/ASR/first-part improvements are deployed and measured in docs/evidence/S01-LATENCY-IMPLEMENTATION-2026-10-05.json. The owner subsequently accepted the faster response for advancing the MVP, while general GPT responses remain variable. Repeat actual iPhone/Safari timing and interruption checks on this revision; generated audio and service estimates do not pass the device gate. No further voice audition is required. The October 19 client simplification removes the foreground wake control; no new wake consent or activation is inferred. Current voice-only interface acceptance remains awaiting_live_test. See docs/evidence/CLIENT-INTERFACE-2026-10-19.json. October 23: the owner reports an iPhone 14 Pro Max for the separate owner Safari study. The guided Wi-Fi/cellular page is deployed and engineering-verified; actual microphone/listening/network results and iOS version remain awaiting_live_test under S01-LIVE4. This is not Dad or full-slice acceptance. See docs/SAFARI_VOICE_TEST_2026-10-23.md. October 24: recorded synthetic speech qualifies imported-task server workflows and native Heart output; in-app microphone/audio startup timed out after 20 seconds. No human-audible or physical iPhone acceptance is inferred. See docs/ASANA_VOICE_TEST_2026-10-24.md. October 24 startup follow-up: owner-only readiness/recovery code is engineering-qualified; the actual browser microphone grant remains pending, so physical capture and audible Heart delivery remain awaiting_live_test. See docs/VOICE_STARTUP_2026-10-24.md. October 25 retest: reviewed synthetic speech writes and152 preservation checks are verified, but unsupported-history wording and post-completion schedule display fail; normal browser microphone is not granted. No live-person/device/full-slice completion is inferred. See docs/ASANA_VOICE_RETEST_2026-10-25.md. October 26 scoped owner repair: schedule retention and fixed source/history reply pass final automated, recorded-speech/SQL and actual Current UI checks, with Dad/Heart preserved. Physical microphone/human audibility/Safari/person/full-slice acceptance remains open. See docs/ASANA_VOICE_REPAIR_2026-10-26.md. October 26: the owner-selected exact client Sol-low/warm-v2/Heart release is deployed and engineering-qualified, with Current preserved. Actual intended-device/person speech and Safari/network responsiveness remain awaiting_live_test; no new voice choice is needed. See docs/CLIENT_SPEED_ROLLOUT_2026-10-26.md. October 26: actual desktop microphone capture started but its uncontrolled unknown-speaker turns are not participant acceptance. Seven controlled recorded-ASR/Pro/Heart Outlook cases pass with214 preservation checks; no controlled physical-phone or human-audible result is claimed. Connected-workflow latency remains high. See docs/OUTLOOK_VOICE_TEST_2026-10-26.md.

  **Linked inputs/tests:** I-VOICE-CHOICE, I-WAKE-CONSENT, S01-LIVE1, S01-LIVE2, S01-LIVE4.

## S02: Track actual tasks, meals and appointments with grounded nutrition

- [ ] **S02-H01: Report a genuine day of tasks, meals and appointments**

  Owner: **participant_or_tester**. Status: **pending**. Requirement: **required**.

  **When:** When the S02 reporting feature is ready.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - During an ordinary day, report tasks actually completed, meals actually eaten and any appointment actually attended; do not invent an appointment or completion for testing.
  - Defer or reschedule an actual pending item when appropriate and distinguish unplanned activity from the original plan.

  **Agent prepares or handles:** Prepare working voice/touch reporting and a short trial flow covering task, meal and appointment actuals. Run duplicate, unknown-target, stale-device, correction/void, reschedule and unauthorized-access checks with disposable records.

  **Completion evidence:** Observed genuine-day reports and pending/current-next behavior linked to database readback; branches that did not naturally occur are explicitly identified as disposable-only evidence. October 18: independent engineering gap repairs, actual disposable PostgreSQL/HTTP and desktop-browser recovery/reminder checks, and code-only HTTPS deployment are recorded in docs/evidence/DAILY-LOOP-GAPS-2026-10-18.json. Intended-person/device/genuine-day requirements remain open; no human action is completed from synthetic evidence.

  **Linked inputs/tests:** S02-LIVE1.

- [ ] **S02-H02: Review the factual ledger and grounded nutrition behavior**

  Owner: **participant_or_tester**. Status: **pending**. Requirement: **required**.

  **When:** At the end of the real tracked day.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Compare Nancy's ledger and summary with what actually happened and identify any mistaken report.
  - Ask a normal meal or nutrition question and confirm that repository reference guidance is clearly limited and respects the participant's preferences and safety.
  - Correct a real mistake if one exists; otherwise the agent exercises correction and void behavior on disposable records.
  - Check that suggestions reflect the time and kind of genuinely reported food; do not alter eating or invent gaps for testing. The agent covers missing/corrected/late-report branches with disposable records as needed.

  **Agent prepares or handles:** Reconcile reports, effective reschedules, correction history, nutrition provenance and plan versions; the human need not do database checks. Collect concise usability observations and keep detailed evidence private.

  **Completion evidence:** Participant observations of the factual readback, pending suggestions, clean UI and bounded nutrition response; corrections are evidenced honestly in the appropriate live lane.

  **Linked inputs/tests:** S02-LIVE1, S02-LIVE2, S02-LIVE3.

## S03: Resume check-ins and tracking after interruptions

- [ ] **S03-H01: Participate in the interruption and recovery trial**

  Owner: **participant_or_tester**. Status: **pending**. Requirement: **required**.

  **When:** During a prepared disposable-data S03 trial.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Make the smartphone available and toggle its connection or refresh when the agent cannot do so remotely.
  - Confirm that pending, unknown, saved and conflict messages are understandable; complete any account/device interaction the agent cannot perform.

  **Agent prepares or handles:** Prepare disposable live records and a step-by-step test before asking. Stop/restart only task-owned services, inspect queued commands and verify recovery; avoid disrupting unrelated work.

  **Completion evidence:** Observed actual-device interruption, reconnect and fallback observations linked to S03 live evidence. October 18: independent engineering gap repairs, actual disposable PostgreSQL/HTTP and desktop-browser recovery/reminder checks, and code-only HTTPS deployment are recorded in docs/evidence/DAILY-LOOP-GAPS-2026-10-18.json. Intended-person/device/genuine-day requirements remain open; no human action is completed from synthetic evidence.

  **Linked inputs/tests:** S03-LIVE1, S03-LIVE2.

- [ ] **S03-H02: Choose the ongoing operating arrangement**

  Owner: **product_owner**. Status: **pending**. Requirement: **conditional**.

  **When:** Before relying on unattended daily operation.
  **Blocks:** Unattended daily reliance only.
  **Applies if:** The system is moving from supervised tests to unattended daily reliance.

  **Human action:**

  - Name the person responsible for keeping the computer available and responding to failures.
  - Choose acceptable downtime/recovery and maintenance times from tested options; decide whether local hosting remains suitable within budget.

  **Agent prepares or handles:** Measure interruption/recovery, explain local-host limitations and prepare startup/backup procedures. Recommend the least-cost viable arrangement and implement it within the authorized scope.

  **Completion evidence:** Recorded operator role, availability/recovery targets and operating procedure for G-DAILY-RELIANCE; this conditional action does not block supervised feature trials.

## S04: Return to a fresh day with reviewed carryover and timely prompts

- [ ] **S04-H01: Choose reusable routine content and review carryover rules**

  Owner: **household_manager**. Status: **pending**. Requirement: **required**.

  **When:** Before the repeated-day live trial.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Identify which existing tasks and meal choices are reusable and on which days; reuse S01 inputs rather than creating a second list.
  - Review the agent's concrete rule for unfinished tasks, one-day deferrals and meal-plan carryover; the participant still accepts each day's plan.
  - Review the exact missed-task questions: still needed, urgency changed, help needed and where it belongs today; no automatic carryover acceptance.

  **Agent prepares or handles:** Prepare minimal versioned routine setup and clear examples using existing choices. Implement profile-local dates, edit ownership and explicit carryover with S04 opted-in prompt scheduling and without a dashboard.

  **Completion evidence:** Private routine version and reviewed carryover choices, with existing input/authority reused.

  **Linked inputs/tests:** I-DAY-CONTENT, I-TIMEZONE, S04-LIVE1.

- [ ] **S04-H02: Use Nancy across three genuine daily check-ins**

  Owner: **participant_or_tester**. Status: **pending**. Requirement: **required**.

  **When:** Across three real local dates when S01-S04 are ready for the trial.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Return across three genuine local dates, preferably in the agreed morning or delayed window, review actual history and explicitly choose today's tasks/meals. No exact-time attendance is required.
  - Review genuine unfinished work or an explicit choice not to carry it, reopen a same-day session, and report usefulness or friction. Use existing genuine history where suitable.
  - During the genuine multi-day trial, opt into a limited reminder window if comfortable and observe one real meal or appointment prompt; review the visible reminder/notification behavior and whether timing helps.
  - Check remembered preferences and relevant carryover; review a significant-event handoff only if one naturally exists. Never manufacture an injury or other incident.
  - When comfortable with opt-in, observe a useful food-related prompt and then a focus check during a real task at an agreed interval; report whether either interrupted unnecessarily. Do not deliberately skip food or work four hours for a test.

  **Agent prepares or handles:** Prepare the complete working loop and independently verify one check-in per local day, plan versions and report history. Exercise synthetic DST/midnight cases and disposable service scenarios separately; never manufacture elapsed days or real-life activity.

  **Completion evidence:** Three real-date check-in observations, accepted plans, actual reports and participant feedback; supports G-FIRST-FOUR.

  **Linked inputs/tests:** S04-LIVE1.

- [ ] **S04-H03: Choose reminder windows and notification permission**

  Owner: **participant_or_tester**. Status: **pending**. Requirement: **required**.

  **When:** Before S04 scheduled-prompt live acceptance.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Choose which prepared food/appointment/focus prompts to enable, waking/quiet hours, an individual focus interval, preferred supported delivery and actual-device notification permission. Quiet preparation is separate and never starts the microphone or authorizes outreach.
  - Observe or report one actual scheduled prompt and whether its timing/content was helpful.

  **Agent prepares or handles:** Prepare the concise consent controls, existing scheduler extension and durable snooze/decline with truthful active-page fallback; qualify broader delivery separately. Test duplicate, restart, missed-run, changed-schedule and closed-browser cases using disposable records before the genuine prompt.

  **Completion evidence:** Private consent/preference reference and observed actual prompt or explicit declined permission, with disposable service evidence for denied/closed paths. October 18: independent engineering gap repairs, actual disposable PostgreSQL/HTTP and desktop-browser recovery/reminder checks, and code-only HTTPS deployment are recorded in docs/evidence/DAILY-LOOP-GAPS-2026-10-18.json. Intended-person/device/genuine-day requirements remain open; no human action is completed from synthetic evidence.

  **Linked inputs/tests:** I-REMINDER-PREF, S04-LIVE1, S04-LIVE2, S04-LIVE3.

## S05: Build and use groceries from the meal plan

- [ ] **S05-H01: Review the actual shopping list**

  Owner: **household_manager**. Status: **pending**. Requirement: **required**.

  **When:** During the meal-to-grocery live test.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Review proposed ingredients against what is already available and what the household needs.
  - Resolve real-world quantity/unit choices and accept the intended shared list.

  **Agent prepares or handles:** Generate a concrete proposal, normalize items and flag ambiguous units. Test deduplication and household permissions.

  **Completion evidence:** Reviewed real grocery choices and accepted-list evidence.

  **Linked inputs/tests:** S05-LIVE1.

- [ ] **S05-H02: Report a real acquisition**

  Owner: **participant_or_tester**. Status: **pending**. Requirement: **required**.

  **When:** When an ordinary shopping item has actually been acquired.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Add a genuinely needed item by voice and mark an item that was actually acquired.
  - Use an ordinary purchase or an already acquired item; do not buy something solely to satisfy a software test.

  **Agent prepares or handles:** Prepare the shared-list flow and verify the second authorized account sees the result. Run concurrent-update and unauthorized-access tests.

  **Completion evidence:** Actual acquired-state report and shared-view evidence; no automated purchasing.

  **Linked inputs/tests:** S05-LIVE1.

## S06: Connect Asana tasks and Outlook mail/calendar

- [ ] **S06-H01: Authorize the dedicated Asana connection**

  Owner: **account_owner**. Status: **in_progress**. Requirement: **required**.

  **When:** Before live Asana reads/writes.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Identify the dedicated household project and integration identity, with the intended two-user arrangement.
  - Complete interactive Asana login/MFA and scoped OAuth consent when required; do not grant unrelated workspaces to simplify setup.

  **Agent prepares or handles:** Prepare exact account/project/scopes and confirm free-plan capability. Configure mappings, allowlists, webhooks, renewal and reconciliation using existing authorized access.

  **Completion evidence:** Private identity/project/consent references and working scoped authorization. October 24 owner-only sandbox OAuth and ingestion are actually verified after explicit API Terms/read-scope approval. Production intended two-user identity/project and broader S06 acceptance remain unresolved; do not repeat completed sandbox sign-in/consent. See docs/ASANA_OWNER_TEST_2026-10-24.md. October 25 retest: reviewed synthetic speech writes and152 preservation checks are verified, but unsupported-history wording and post-completion schedule display fail; normal browser microphone is not granted. No live-person/device/full-slice completion is inferred. See docs/ASANA_VOICE_RETEST_2026-10-25.md. October 26 scoped owner repair: schedule retention and fixed source/history reply pass final automated, recorded-speech/SQL and actual Current UI checks, with Dad/Heart preserved. Physical microphone/human audibility/Safari/person/full-slice acceptance remains open. See docs/ASANA_VOICE_REPAIR_2026-10-26.md.

  **Linked inputs/tests:** I-ASANA, S06-LIVE1, S06-LIVE2, S06-LIVE11.

- [ ] **S06-H02: Use a genuine household task end to end**

  Owner: **household_manager**. Status: **pending**. Requirement: **required**.

  **When:** During S06 live acceptance.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Add a real household task and identify the person who will perform it.
  - Have that person actually complete the task and report through the companion; verify that Asana reflects the intended result.

  **Agent prepares or handles:** Prepare the integration before asking for the household trial. Verify both ledgers; run restart, missed-webhook, token-refresh and conflict drills on disposable tasks.

  **Completion evidence:** Observed real household-task round trip plus the agent's separate recovery evidence.

  **Linked inputs/tests:** S06-LIVE1.

- [ ] **S06-H03: Authorize and try the selected Outlook mail/calendar account**

  Owner: **account_owner**. Status: **in_progress**. Requirement: **required**.

  **When:** Before live Microsoft 365 access, then during the consenting read/write trial.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Identify the intended account/calendar/mailbox privately and confirm consent, Conditional Access and local/AI-data-use decisions in docs/MICROSOFT365_IT_CHECKLIST.md. Microsoft 365 work/school, read/write scope and the intended client's existing account are decided. IT confirmed the technical lead's Cloud Application Administrator assignment October 15; do not request it again. the intended client-account sign-in, delegated consent and approved resources remain separate.
  - Complete the prepared sign-in/MFA and delegated consent when required; identify approved test resources/recipients and review a genuine low-stakes mail/calendar action after the disposable safety checks.

  **Agent prepares or handles:** Verify the existing app registration and newly reported Microsoft access first. Prepare the exact Web callback on the established HTTPS origin, protected credential setup and delegated scopes; reuse prior decisions and request only missing tenant decisions or interactive personal sign-in. No new subscription is assumed. Build bounded retrieval and reviewed external action commands, ledger/provider mappings, renewal/revocation and reconciliation; test safe failure and duplicate prevention on isolated/provider test records before the genuine trial.

  **Completion evidence:** Reuse completed exact-account setup, sole-user assignment, assignment requirement, seven-scope consent and client OAuth. The October 19 owner-authorized selected-resource reasoning use and exact disposable email/15-minute invitation tests are deployed and provider-verified; receipts persist and Nancy retrieves the live event time. See docs/evidence/OUTLOOK-CONVERSATIONS-2026-10-19.json. No repeated sign-in, password, IT role or access decision is needed. Genuine intended-person/device/workflow acceptance, broader edits/cancellation and real revocation/disconnect recovery remain open; this action stays in_progress. October 21 inspection found reconnect_required with previously erased token/resource selections. The repair preserves existing Microsoft administrator consent/assignment/scopes and fixes expiry erasure. One interactive intended-client reconnect and selected-resource live read are now required; do not repeat tenant approval or the earlier provider writes. See docs/evidence/LIVE-TEST-REPAIRS-2026-10-21.json. October 26: the human completed the existing approved client Microsoft sign-in and only main Calendar/Inbox were restored; seven controlled Outlook voice cases and guarded own-engineering-login renewal pass with unchanged original grants/permissions. Reconnect is no longer pending; do not repeat consent or outbound email/invitation tests. Real provider OAuth refresh/revocation and genuine person/device/full-slice acceptance remain open, so this action stays in_progress. See docs/OUTLOOK_VOICE_TEST_2026-10-26.md.

  **Linked inputs/tests:** I-CALENDAR-EXTERNAL, S06-LIVE3, S06-LIVE4, S06-LIVE5, S06-LIVE6.

## S07: Follow Morning Boot one step at a time

- [ ] **S07-H01: Define the morning routine and interruption choices**

  Owner: **protocol_owner**. Status: **pending**. Requirement: **required**.

  **When:** Before running the real Morning Boot sequence.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Supply or approve the participant's routine, rest/skip choices and who can edit it.
  - Provide real timing/appointment constraints and any already-approved care steps.

  **Agent prepares or handles:** Prepare a concrete versioned sequence using supplied instructions. Implement dependencies, protected windows and minimal configuration without a dashboard.

  **Completion evidence:** Private approved routine version and interruption policy.

  **Linked inputs/tests:** S07-LIVE1.

- [ ] **S07-H02: Follow the morning sequence on the device**

  Owner: **participant_or_tester**. Status: **pending**. Requirement: **required**.

  **When:** During a real morning or suitable supervised routine session.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Follow the ordinary approved steps, intentionally pause/rest, then resume.
  - Review the proposed day and accept or change it; skip only an eligible optional/test step.

  **Agent prepares or handles:** Guide the usable sequence and capture resume/plan evidence. Verify state and simulate technical conflicts with disposable data.

  **Completion evidence:** Observed routine/resume and accepted-day evidence reflecting real actions.

  **Linked inputs/tests:** S07-LIVE1.

## S08: Follow and report an approved rehab session

- [ ] **S08-H01: Provide the applicable approved rehab protocol**

  Owner: **protocol_owner**. Status: **pending**. Requirement: **required**.

  **When:** Before presenting real rehab instructions.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Supply the current approved protocol, applicable version and any required assistance/supervision instructions.
  - Identify who can authorize changes and resolve any ambiguity before use.

  **Agent prepares or handles:** Prepare a versioned representation and minimal authorized approval form. Check that the app presents those instructions faithfully and denies autonomous changes.

  **Completion evidence:** Private protocol-owner approval and version reference; no new treatment is generated by the agent.

  **Linked inputs/tests:** I-PROTOCOL, S08-LIVE1.

- [ ] **S08-H02: Participate in an approved supervised session**

  Owner: **participant_or_tester**. Status: **pending**. Requirement: **required**.

  **When:** When the approved S08 feature is ready.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Use the feature during an appropriate approved session with required assistance/supervision.
  - Report a real result/difficulty and whether spoken/touch instructions are clear.

  **Agent prepares or handles:** Prepare the app and denied-access tests before the session. Verify recorded results/version and collect evidence without changing treatment.

  **Completion evidence:** Consented supervised-session evidence and protocol version; restricted notes remain private.

  **Linked inputs/tests:** S08-LIVE1.

## S09: See explainable daily progress and achievements

- [ ] **S09-H01: Set the scoring and achievement rules**

  Owner: **scoring_owner**. Status: **pending**. Requirement: **required**.

  **When:** Before calculating real scores.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Choose the eligible activities, weights, exclusions and treatment of deferrals/corrections.
  - Approve supportive achievements and wording; do not treat illustrative numbers as already-approved care targets.

  **Agent prepares or handles:** Present explicit rule examples and their consequences on a sample day. Implement deterministic calculations and independent checks against the selected rules.

  **Completion evidence:** Approved scoring-rule version and owner reference.

  **Linked inputs/tests:** I-SCORING, S09-LIVE1.

- [ ] **S09-H02: Review progress against the real day**

  Owner: **participant_or_tester**. Status: **pending**. Requirement: **required**.

  **When:** During the first real progress review.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Review the board and spoken explanation against what you actually reported.
  - Identify missing/mistaken real-world information and whether the encouragement feels appropriate.

  **Agent prepares or handles:** Calculate and cross-check the score; humans do not need to do the arithmetic. Prepare any correction through existing validated commands and test deduplicated awards.

  **Completion evidence:** Participant feedback and real-day evidence alongside the independently checked score.

  **Linked inputs/tests:** S09-LIVE1.

## S10: Use Support Team for client-approved task requests, shared progress and help

- [ ] **S10-H01: Choose what family may see and who receives help**

  Owner: **participant_or_tester**. Status: **pending**. Requirement: **required**.

  **When:** Before enabling actual family access or delivery.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Choose family/friend recipients and consented task/meal and achievement visibility; record client-scoped sharing consent.
  - Agree a non-urgent test with designated recipients and choose any quiet-hour/help routing preferences.
  - Choose who may request tasks, which other family members may receive declined-task help and reason details, and which scoped administrators may review the resulting flags.

  **Agent prepares or handles:** Prepare a concrete access/notification matrix and demonstrate its effect. Configure grants and consent, generic message content and revocation; reuse prior valid choices.

  **Completion evidence:** Private participant consent, recipient/grant and notification-rule references.

  **Linked inputs/tests:** I-FAMILY, S10-LIVE1, S10-LIVE2.

- [ ] **S10-H02: Acknowledge the planned family test**

  Owner: **family_recipient**. Status: **pending**. Requirement: **required**.

  **When:** During the agreed live family test.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Expect the designated test request, acknowledge/resolve it and view the selected shared win.
  - Confirm that the view is appropriate and check access after the participant revokes sharing.
  - Use Support Team by voice and UI; choose completion/reschedule notification preferences and verify opt-in, opt-out and revoked access during the agreed test.
  - Submit a genuine task request through Nancy and the UI with agreed date/time/priority; another designated family member volunteers for a declined request and verifies its visible help state.
  - After engineering prepares your eligible reasoning route, complete only missing personal sign-in/consent and the actual voice trial. UI-only practice may proceed first but does not complete the voice requirement.

  **Agent prepares or handles:** Have the participant initiate the agreed request in the app; do not send unsolicited messages. Verify delivery, duplicate handling, audit state and revocation. Qualify this intended account/runtime and bind it to the authenticated role/client scope; do not use owner credentials or ask the person to perform engineering setup.

  **Completion evidence:** Observed acknowledgement and revocation evidence from the designated consenting participants. Include private intended-account/runtime qualification and actual microphone/spoken request-workflow evidence with equivalent UI outcomes.

  **Linked inputs/tests:** I-ACCOUNTS, S10-LIVE1, S10-LIVE2.

- [ ] **S10-H03: Review task requests against actual daily capacity**

  Owner: **participant_or_tester**. Status: **pending**. Requirement: **required**.

  **When:** After the request workflow is implemented, during the agreed consenting live trial.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Describe current practical capacity and preferences as needed; review one genuine request and decide whether its timing/effort is reasonable.
  - Accept one suitable request and decline an unsuitable request with a short reason in your own words; verify that Nancy asks rather than pressures and that help replaces the declined request.

  **Agent prepares or handles:** Prepare the working scoped interface, role-specific voice tools and a concrete trial sequence. Verify saved request/task/help/flag linkage, receipts, access and privacy; store sanitized evidence references only.

  **Completion evidence:** Private evidence of actual client decisions, capacity discussion and review of resulting task/help records.

  **Linked inputs/tests:** I-FAMILY, S10-LIVE2.

- [ ] **S10-H04: Verify administrator review of declined requests**

  Owner: **operator**. Status: **pending**. Requirement: **required**.

  **When:** After the request workflow is implemented, during the agreed consenting live trial.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Use the scoped administrator account to review a genuine rejection flag, its permitted reason and linked family help status.
  - Verify that the flag supports arranging help and does not let the administrator approve the request on the client behalf.
  - After engineering prepares your eligible reasoning route, complete only missing personal sign-in/consent and the actual voice trial. UI-only practice may proceed first but does not complete the voice requirement.

  **Agent prepares or handles:** Prepare the working scoped interface, role-specific voice tools and a concrete trial sequence. Verify saved request/task/help/flag linkage, receipts, access and privacy; store sanitized evidence references only. Qualify this intended account/runtime and bind it to the authenticated role/client scope; do not use owner credentials or ask the person to perform engineering setup.

  **Completion evidence:** Private observed administrator flag/help review and authorization evidence. Include private intended-account/runtime qualification and actual microphone/spoken request-workflow evidence with equivalent UI outcomes.

  **Linked inputs/tests:** I-FAMILY, I-ACCOUNTS, S10-LIVE2.

## S11: Operate today's program from an administrator dashboard

- [ ] **S11-H01: Identify authorized program operators**

  Owner: **product_owner**. Status: **pending**. Requirement: **required**.

  **When:** Before granting administrator dashboard access.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Identify which people hold program/configuration, correction, permission and sensitive-audit authority.
  - Confirm the actual role assignments where existing grants do not already answer this; reuse valid earlier assignments.

  **Agent prepares or handles:** Prepare the smallest role/action matrix from existing protocols, consent and scoring decisions. Implement role enforcement and configure technical MFA support; do not ask for a blanket admin grant.

  **Completion evidence:** Recorded operator grants with a private or sanitized authorization reference.

  **Linked inputs/tests:** S11-LIVE1.

- [ ] **S11-H02: Use the dashboard to investigate a real day**

  Owner: **operator**. Status: **pending**. Requirement: **required**.

  **When:** During S11 live acceptance.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Sign in with the intended operator account, including any human MFA prompt.
  - Review today's actual state and work through the prepared issue; report whether the controls support the operator's work.

  **Agent prepares or handles:** Prepare a concrete reviewable dashboard and a disposable sync problem. Reconcile totals and run access/retry checks; use an actual configuration change only when it is needed and already authorized.

  **Completion evidence:** Observed operator workflow and issue-resolution evidence with audited access.

  **Linked inputs/tests:** S11-LIVE1.

## S12: Review trends and exports in Clinician Partners

- [ ] **S12-H01: Provide genuine multi-day history and context**

  Owner: **participant_or_tester**. Status: **pending**. Requirement: **required**.

  **When:** Before the live trend review.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Continue ordinary tracking until several real days are available, or identify already-recorded days that satisfy the test.
  - Identify known missing or mistaken reports without inventing history for the chart.

  **Agent prepares or handles:** Reuse existing consented records and prepare the trend view. Check aggregates, permissions and missing-data/version handling independently; do not require a new data-entry exercise if history already exists.

  **Completion evidence:** Private genuine-history range and relevant real-world context for S12-LIVE1.

  **Linked inputs/tests:** S12-LIVE1.

- [ ] **S12-H02: Review whether the trend view answers the operator's questions**

  Owner: **operator**. Status: **pending**. Requirement: **required**.

  **When:** During S12 live acceptance.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Review the selected real period and its missing-data/correction indicators.
  - Report discrepancies or unclear interpretation; only review information within existing grants.

  **Agent prepares or handles:** Prepare concise metrics and drill-down, calculate independent totals and demonstrate access boundaries. Reuse established reporting scope rather than requesting new blanket permission.

  **Completion evidence:** Authorized operator feedback on actual multi-day results, linked to technical verification.

  **Linked inputs/tests:** S12-LIVE1.

- [ ] **S12-H03: Complete and assess the full observed pilot**

  Owner: **product_owner**. Status: **pending**. Requirement: **required**.

  **When:** Before declaring the full MVP pilot successful.
  **Blocks:** The named release gate only (G-FULL-MVP).

  **Human action:**

  - Arrange the seven-day observed pilot with the participant/household and appropriate care support.
  - Review usability, actual failures/repairs and the proposed usable-day target, then decide whether to continue or change the pilot.

  **Agent prepares or handles:** Prepare the complete working loop and a concrete evidence report. Run authorized technical recovery checks, summarize costs and unresolved issues; do not equate a schema pass with pilot success.

  **Completion evidence:** Private pilot observation record and product-owner decision grounded in real evidence.

- [ ] **S12-H04: Review clinical dashboard definitions and export scope**

  Owner: **protocol_owner**. Status: **pending**. Requirement: **required**.

  **When:** When S12 supplies concrete configurations and before its live acceptance.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Clinical partners review the proposed measures and presentation for Diabetes, Neurorehab, Psychologist/Psychiatrist, Family doctor and OT/PSW/DSW; resolve domain ambiguities without inventing data or clinical targets.
  - Review permitted export fields, date ranges and formats and inspect actual authorized dashboard/export results during the trial.

  **Agent prepares or handles:** Prepare concrete definitions, representative views and export samples for review; implement queries, access controls, formatting and audit records. Verify aggregates and exports against source records and keep real data and clinical review evidence private.

  **Completion evidence:** Private clinical-partner review and selected export-scope references, with observed S12-LIVE1 results and I-CLINICAL-VIEWS resolved.

  **Linked inputs/tests:** I-CLINICAL-VIEWS, S12-LIVE1.

## Updating and checking

Use pending, in_progress, done or not_applicable in the canonical JSON. Done requires an actual completion reference and timestamp. Only conditional actions can be not_applicable, with a specific reason. Do not put real names, credentials, clinical details or invented evidence in either file.

From the repository root:

~~~powershell
pwsh -NoProfile -File ./scripts/render-human-actions.ps1
pwsh -NoProfile -File ./scripts/validate-roadmap.ps1
pwsh -NoProfile -File ./scripts/render-human-actions.ps1 -Check
~~~
