# Human actions by implementation stage

Updated: 2026-10-05. Generated from the canonical roadmap; all statuses below come from that file.

Source: [roadmap.json](roadmap/roadmap.json), in each slice's human_actions array. Edit the JSON, then run the renderer; do not maintain a separate checklist here. See [ROADMAP.md](ROADMAP.md) for feature scope and live tests.

## How to use this list

- Build, configure, debug, migrate, test and prepare concrete reviewable outputs within existing authorization. Do not turn routine technical work into human chores.
- Reuse existing access, consent, decisions and valid evidence. Never request the same authorization again merely because another slice needs it.
- Ask only when the action is needed; continue independent authorized work while waiting. A list entry is a future requirement, not an immediate request.
- Apply a conditional item only when its condition is true. Record not_applicable with a specific reason when false; an agent may establish this from evidence without asking the user. Reassess the status when the trigger changes.
- A slice cannot be done while an applicable slice_completion human action is unfinished. Paid-commitment, daily-reliance, clinical-use and release-gate items block only that named operation/gate, not unrelated free or supervised feature work.
- Done requires an actual completion reference and timestamp; record private or sanitized references, not names, credentials, clinical records or invented signoffs.
- Human-action owner labels describe responsibilities, not application permissions. The application has exactly four roles: administrator, client, family/friend and clinician. One person may hold several responsibilities; the project owner is confirmed as both administrator and technical lead. Keep account identities private.
- Company Outlook/IT consent is required only for the deferred Outlook integration; it is not a prerequisite for these MVP slices.

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
| S01 | Plan the day with Nancy at 10 AM | S01-H01, S01-H02, S01-H03, S01-H04, S01-H05, S01-H06, S01-H07 |
| S02 | Track actual meals and tasks through the day | S02-H01, S02-H02 |
| S03 | Resume check-ins and tracking after interruptions | S03-H01, S03-H02 |
| S04 | Return to a fresh 10 AM brief each day | S04-H01, S04-H02 |
| S05 | Build and use groceries from the meal plan | S05-H01, S05-H02 |
| S06 | Bring Asana household tasks into the daily tracker | S06-H01, S06-H02 |
| S07 | Follow Morning Boot one step at a time | S07-H01, S07-H02 |
| S08 | Follow and report an approved rehab session | S08-H01, S08-H02 |
| S09 | See explainable daily progress and achievements | S09-H01, S09-H02 |
| S10 | Use Support Team for shared tasks, achievements and help | S10-H01, S10-H02 |
| S11 | Operate today's program from an administrator dashboard | S11-H01, S11-H02 |
| S12 | Review trends and exports in Clinician Partners | S12-H01, S12-H02, S12-H03, S12-H04 |

## S01: Plan the day with Nancy at 10 AM

- [ ] **S01-H01: Test on the selected smartphone**

  Owner: **participant_or_tester**. Status: **in_progress**. Requirement: **required**.

  **When:** Before the first actual two-way Nancy conversation.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Smartphone testing is selected. Identify its OS/browser, open the supplied HTTPS preview and check task/meal navigation and audible sample playback.
  - When ready, complete the smartphone browser microphone prompt and speak/listen during the local playback check. The integrated two-way Nancy conversation still needs a later actual-device trial.

  **Agent prepares or handles:** Check supported browser behavior and prepare the HTTPS test page. Configure and debug microphone/audio code; provide short test prompts.

  **Completion evidence:** Device/browser and actual microphone plus audible observations, first for the sample device preview and then linked to the integrated S01 live evidence. A desktop phone-sized viewport, generated audio or dictated-text mock is insufficient.

  **Linked inputs/tests:** I-DEVICE, S01-LIVE1, S01-LIVE2.

- [ ] **S01-H02: Complete missing private provider and HTTPS access**

  Owner: **account_owner**. Status: **in_progress**. Requirement: **required**.

  **When:** Before the agent connects the real services.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Private OpenAI project/key setup, ownership and the owner's Nancy OAuth/ChatGPT-plan consent are complete. Identify the intended participant account/device and complete only additional sign-in or ownership steps required for that deployment. Do not recreate keys or repeat the completed owner consent, and do not assume the administrator subscription covers every client.
  - Review an explicit API fallback/cost proposal only if subscription qualification fails or the selected speech path needs separately billed GPT access. Funding remains an owner choice, not an automatic prerequisite or silent fallback.
  - Complete only missing HTTPS/domain ownership and, if actually selected, Secure MCP Tunnel workspace/access steps. Keep credentials private; routine installation/configuration is agent work.

  **Agent prepares or handles:** First prepare and qualify the lowest-cost supported ChatGPT-plan adapter for exact gpt-6-sol high, with app-specific auth, allowance/error handling and actual completed inference evidence. Preserve independent care-service authorization and user/account boundaries. Qualify speech input/output independently; disclose any new costs before a paid step. Do not claim a tunnel or subscription text call proves voice support. Configure local database/auth, shared care commands and My Day HTTPS. Add local MCP or Secure MCP Tunnel only for a concrete supported caller; preserve per-client grants and test revocation. Reuse docs/evidence/S01-OPENAI-CONNECTION-2026-10-04.json and the saved key. Prepare a concrete fallback proposal if needed; no repeated sign-in, key setup or funding requests without a remaining technical need.

  **Completion evidence:** Partial API-key and preparation records remain historical. docs/evidence/S01-CHATGPT-PLAN-CONNECTION-2026-10-04.json records completed owner OAuth consent, exact Sol-high plan inference, a fixed synthetic tool round trip and separate local speech probes. Completion still needs intended-user/deployment eligibility, live credential lifecycle/allowance behavior, authorized care-tool integration and genuine two-way speech/HTTPS evidence, plus conditional tunnel access. Keep credentials and full account evidence private; these probes do not complete S01-H02 or either live gate.

  **Linked inputs/tests:** I-ACCOUNTS, I-DOMAIN, I-MODEL, S01-LIVE1.

- [ ] **S01-H03: Agree the first real-data test boundary**

  Owner: **product_owner**. Status: **pending**. Requirement: **required**.

  **When:** Before retaining the participant's real task and meal-plan data.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Identify the consenting participant/tester and confirm use and visibility of their real tasks, meal choices and accepted plans.
  - Initial storage on this machine is decided. Review remaining remote GPT/speech processing, routing, backup and retention boundaries from concrete options; record participant consent privately.

  **Agent prepares or handles:** Present the data flow, provider options and minimal retention proposal for review. Configure the chosen boundaries and private consent record; keep public evidence sanitized.

  **Completion evidence:** Private tester-consent and data-handling decision references, with I-DATA and I-REGION resolved.

  **Linked inputs/tests:** I-DATA, I-REGION, S01-LIVE1.

- [ ] **S01-H04: Try the real 10 AM brief and meal-planning conversation**

  Owner: **participant_or_tester**. Status: **pending**. Requirement: **required**.

  **When:** After S01-LIVE2's disposable safety/restore checks pass and the working S01 feature is ready.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - At the intended 10:00 local routine, hear today's actual tasks, discuss available meals with Nancy and explicitly accept the reviewed day plan.
  - Retrieve and revise the plan by voice/touch. Navigate from My Day to tasks/meals using both speech and buttons; assess urgency, scheduled times, speech pace, text and controls.

  **Agent prepares or handles:** Prepare the working combined voice/task/meal feature before asking for a session. Verify committed plan versions, permissions, duplicate/stale protection and restore behavior; collect sanitized technical observations.

  **Completion evidence:** Observed actual two-way voice, accepted plan and revision/readback evidence on the intended device; do not substitute a dictated-text mock.

  **Linked inputs/tests:** S01-LIVE1.

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

  - Provide genuine tasks with urgency and scheduled date/time where known, available/preferred meals, known restrictions and who maintains these choices. Meals appear as tasks.
  - Confirm or correct the participant's time zone once; 10:00 refers to that local zone. Reuse choices and decisions already supplied.

  **Agent prepares or handles:** Prepare minimal setup forms and a concrete task/meal proposal; do not require an administrator dashboard. Record private input references and configure ownership, options and local-time behavior.

  **Completion evidence:** Private real task/meal-choice, ownership and participant-timezone references; I-DAY-CONTENT resolved and the profile's zone recorded.

  **Linked inputs/tests:** I-DAY-CONTENT, I-TIMEZONE, S01-LIVE1.

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

  **Not applicable because:** This implementation supports ordinary household meal choices only; no clinical nutrition targets or prescribed-diet protocol has been supplied, retained or implemented. Reassess before adding clinical constraints.

## S02: Track actual meals and tasks through the day

- [ ] **S02-H01: Report a genuine day of meals and tasks**

  Owner: **participant_or_tester**. Status: **pending**. Requirement: **required**.

  **When:** When the S02 reporting feature is ready.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Use the accepted plan during an ordinary day and report tasks actually performed and meals actually eaten.
  - Defer an actual item when appropriate and distinguish unplanned activity from the original plan; no invented completion is needed for testing.

  **Agent prepares or handles:** Prepare working voice/touch reporting and a short trial flow using the S01 plan. Run duplicate, unknown-target, stale-device and unauthorized-access checks with disposable records.

  **Completion evidence:** Observed real-day reports and deferral/current-next evidence linked to database readback.

  **Linked inputs/tests:** S02-LIVE1.

- [ ] **S02-H02: Review the factual daily summary**

  Owner: **participant_or_tester**. Status: **pending**. Requirement: **required**.

  **When:** At the end of the real tracked day.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Compare Nancy's summary with what actually happened and identify any mistaken report.
  - Correct a real mistake if one exists; otherwise the agent exercises correction on disposable records.

  **Agent prepares or handles:** Reconcile reports, correction history and plan versions; the human need not do database checks. Collect concise usability observations and keep detailed evidence private.

  **Completion evidence:** Participant observations and factual summary readback; corrections are evidenced honestly in the appropriate live lane.

  **Linked inputs/tests:** S02-LIVE1, S02-LIVE2.

## S03: Resume check-ins and tracking after interruptions

- [ ] **S03-H01: Participate in the interruption and recovery trial**

  Owner: **participant_or_tester**. Status: **pending**. Requirement: **required**.

  **When:** During a prepared disposable-data S03 trial.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Make the tablet available and toggle its connection or refresh when the agent cannot do so remotely.
  - Confirm that pending, unknown, saved and conflict messages are understandable; complete any account/device interaction the agent cannot perform.

  **Agent prepares or handles:** Prepare disposable live records and a step-by-step test before asking. Stop/restart only task-owned services, inspect queued commands and verify recovery; avoid disrupting unrelated work.

  **Completion evidence:** Observed actual-device interruption, reconnect and fallback observations linked to S03 live evidence.

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

## S04: Return to a fresh 10 AM brief each day

- [ ] **S04-H01: Choose reusable routine content and review carryover rules**

  Owner: **household_manager**. Status: **pending**. Requirement: **required**.

  **When:** Before the repeated-day live trial.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Identify which existing tasks and meal choices are reusable and on which days; reuse S01 inputs rather than creating a second list.
  - Review the agent's concrete rule for unfinished tasks, one-day deferrals and meal-plan carryover; the participant still accepts each day's plan.

  **Agent prepares or handles:** Prepare minimal versioned routine setup and clear examples using existing choices. Implement profile-local dates, edit ownership and explicit carryover without adding a background reminder or dashboard.

  **Completion evidence:** Private routine version and reviewed carryover choices, with existing input/authority reused.

  **Linked inputs/tests:** I-DAY-CONTENT, I-TIMEZONE, S04-LIVE1.

- [ ] **S04-H02: Use Nancy across three genuine daily check-ins**

  Owner: **participant_or_tester**. Status: **pending**. Requirement: **required**.

  **When:** Across three real local dates when S01-S04 are ready for the trial.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Return at the intended 10:00 routine, review actual prior-day history and explicitly choose today's tasks/meals.
  - Review genuine unfinished work or an explicit choice not to carry it, reopen a same-day session, and report usefulness or friction. Use existing genuine history where suitable.

  **Agent prepares or handles:** Prepare the complete working loop and independently verify one check-in per local day, plan versions and report history. Exercise synthetic DST/midnight cases and disposable service scenarios separately; never manufacture elapsed days or real-life activity.

  **Completion evidence:** Three real-date check-in observations, accepted plans, actual reports and participant feedback; supports G-FIRST-FOUR.

  **Linked inputs/tests:** S04-LIVE1.

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

## S06: Bring Asana household tasks into the daily tracker

- [ ] **S06-H01: Authorize the dedicated Asana connection**

  Owner: **account_owner**. Status: **pending**. Requirement: **required**.

  **When:** Before live Asana reads/writes.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Identify the dedicated household project and integration identity, with the intended two-user arrangement.
  - Complete interactive Asana login/MFA and scoped OAuth consent when required; do not grant unrelated workspaces to simplify setup.

  **Agent prepares or handles:** Prepare exact account/project/scopes and confirm free-plan capability. Configure mappings, allowlists, webhooks, renewal and reconciliation using existing authorized access.

  **Completion evidence:** Private Asana project/identity/consent references and working scoped authorization.

  **Linked inputs/tests:** I-ASANA, S06-LIVE1, S06-LIVE2.

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

## S10: Use Support Team for shared tasks, achievements and help

- [ ] **S10-H01: Choose what family may see and who receives help**

  Owner: **participant_or_tester**. Status: **pending**. Requirement: **required**.

  **When:** Before enabling actual family access or delivery.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Choose family/friend recipients and consented task/meal and achievement visibility; record client-scoped sharing consent.
  - Agree a non-urgent test with designated recipients and choose any quiet-hour/help routing preferences.

  **Agent prepares or handles:** Prepare a concrete access/notification matrix and demonstrate its effect. Configure grants and consent, generic message content and revocation; reuse prior valid choices.

  **Completion evidence:** Private participant consent, recipient/grant and notification-rule references.

  **Linked inputs/tests:** I-FAMILY, S10-LIVE1.

- [ ] **S10-H02: Acknowledge the planned family test**

  Owner: **family_recipient**. Status: **pending**. Requirement: **required**.

  **When:** During the agreed live family test.
  **Blocks:** Completing this feature slice.

  **Human action:**

  - Expect the designated test request, acknowledge/resolve it and view the selected shared win.
  - Confirm that the view is appropriate and check access after the participant revokes sharing.
  - Use Support Team by voice and UI; choose completion/reschedule notification preferences and verify opt-in, opt-out and revoked access during the agreed test.

  **Agent prepares or handles:** Have the participant initiate the agreed request in the app; do not send unsolicited messages. Verify delivery, duplicate handling, audit state and revocation.

  **Completion evidence:** Observed acknowledgement and revocation evidence from the designated consenting participants.

  **Linked inputs/tests:** S10-LIVE1.

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
