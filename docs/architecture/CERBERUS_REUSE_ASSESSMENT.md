# CerberusOS reuse assessment for CompanionRehab

**October 3 update:** Reuse findings remain applicable, but the [current decisions](PRODUCT_DECISIONS_2026-10-03.md) supersede this assessment's cloud-hosting and role assumptions: initial durable data is local, access has four scoped roles, and Nancy uses GPT-6 Sol high reasoning with separate speech. Keep the independent care service and the documented utility/proposal/receipt/recovery patterns.

Date: 2026-09-29. Decision: borrow selected utilities, validation patterns and regression scenarios; keep CompanionRehab an independent application.

## October 4 addendum: MCP tunnel and subscription reasoning

The original scan did not adequately distinguish two reusable connection patterns. A focused October 4 source review found:

- `docs/lifecore-chatgpt.md` defines ChatGPT as the LifeCore conversation surface and Secure MCP Tunnel as transport to the local protected stdio MCP server. This is a local-tool/data connection. No protected data, credentials or runtime configuration were opened or copied.
- `services/api/cerberus_api/mission_control/planning_provider.py::CodexPlanningProvider` implements a separate `codex-app-server/chatgpt` reasoning route. It requires ChatGPT authentication, verifies the selected model/runtime, disables inherited tools, bounds work and reports `separately_billed_api: false`. `docs/director-execution.md` records historical completed subscription-backed requests. Those results do not establish current Nancy access.
- The inspected October 4 Cerberus handoff retains an unqualified current native Daily Brief pilot. Reusing a pattern is not evidence that the current runtime, Nancy's selected `gpt-6-sol` high, remote client access or two-way speech already works.

[Official Secure MCP Tunnel documentation](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) describes outbound local MCP transport to supported OpenAI products. It does not provide a general public web origin for My Day or turn an API-key inference request into subscription usage.

[Official ChatGPT plan integration documentation](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt) describes eligible plan usage for local open-source/personal tools, with separate access requirements for paid or remotely hosted apps. [Codex app-server integration](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server) requires the app's own authorized token/session flow and actual completed inference to prove model access. Do not copy Cerberus credentials or infer unlimited/shared multi-user entitlement.

Next qualification: evaluate a small supported subscription reasoning adapter for the local pilot before asking for API funding; preserve the exact Sol-high selection, independent care service, four roles and typed commands. Separately qualify speech, account ownership for each intended user and the intended local/remote deployment. This is a research candidate, not an adopted change to the canonical runtime contract or a completed live gate.

The current [ChatGPT plan preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) exclude audio/video input, transcription and hosted Responses MCP/connectors. Local MCP and function tools through app-server are a separate supported mechanism. Therefore an MCP tunnel plus plan usage must not be represented as a complete Nancy voice integration; the speech path remains an independent qualification.

## Scope and evidence

The target first MVP is a participant's daily 10:00 check-in with Nancy: hear a brief, review real tasks, discuss and accept meals, and retrieve the saved day by voice or touch. This takes precedence over the older roadmap sequence that separates meal logging, planning and the tracker.

Reviewed the current Cerberus engineering worktree identified by its AGENTS.md and CURRENT_HANDOFF.md, at commit `e605a660c745f610a477ab45bbfcc53ca9fdcbfc` in the private repository `TFMcoder/CerberusLifeCore`. The default Cerberus OS directory hosts an older runtime checkout and was not treated as the current implementation.

The development worktree also contained unrelated uncommitted OpenClaw continuity changes. This recommendation does not depend on those edits. Inspection covered source, tests, package manifests and delivery documentation. No application, provider call or test suite was run; historical test reports were not treated as fresh verification. Runtime databases, credentials and protected personal records were not opened.

Source paths below are relative to that Cerberus commit. This report is an assessment, not a transfer of source code, data, account grants or runtime configuration.

## Recommended reuse

| Component | Decision | Application to Nancy | Source evidence |
|---|---|---|---|
| Small HTTP request wrapper | Extract and adapt | Bounded reads/writes, useful error messages and explicit unconfirmed outcomes after timeouts; avoid automatic retries of uncertain writes. Add Companion auth and response validation. | `apps/web/components/dashboard/requests.ts`: `requestContent`, `requestJson`, `requestText` |
| Structured model proposals | Adapt the design and tests | Nancy can propose a meal or task change; the server checks the actual target, allowed fields and current state. A suggested plan remains distinct from an accepted plan. | `services/api/cerberus_api/daily_brief_assessment.py`: `validate_assessment`, proposal/context contracts; `daily_brief_contracts.py`: `BriefMutation`, `TaskDecision` |
| Transaction receipts and revision checks | Port a small domain-specific implementation | A repeated submission cannot create duplicate meals/tasks; a stale tablet cannot silently overwrite a newer plan. Save the command result with the state change. Add actor/resource scoping for Companion's permissions. | `services/api/cerberus_api/mission_control/board.py`: `mutate_board`, `replay_board_change`; `daily_brief_workflow.py`: `_replay`, `_persist`, `_receipt` |
| Recovery and truthful save state | Adapt | After a lost connection, refresh or restart, read what committed before retrying. Preserve draft choices; make unknown outcomes visible rather than announcing success or repeating the action. | `daily_brief_workflow.py`: `recover_daily_briefs`; `apps/web/components/dashboard/board.ts`: `verifyBoardSave`; `dailyBrief.ts` and its recovery tests |
| Briefing context and local-day behavior | Adapt a smaller version | Keep today's tasks, accepted meals and unresolved choices available to Nancy. Use the configured participant time zone; preserve future intent without making a one-day deferral permanent. | `daily_brief_workflow.py`: `assessment_context`, `rebase_brief`; timezone and next-day tests |
| Browser interaction details | Extract selected behavior | Preserve focus, Escape handling, accessible status messages and text/touch fallback. Rebuild the visible screen for a simple participant check-in. | `apps/web/components/dashboard/Dashboard.tsx`: `ReadDialog`, `dictate` |
| HTTP boundary and failure tests | Port relevant test cases | Verify exact origin/host, cross-site write rejection, failed login handling and non-sensitive error responses around the selected Companion authentication system. | `access.py`, `http_authority.py`, `test_dashboard_access.py`, `test_browser_login.py` |

The best immediately reusable source is the small TypeScript request utility. Most other value is in tested behavior and contracts: Cerberus's Python/FastAPI domain implementation is tightly connected to its own business entities, Notion and agent runtime. It is not a drop-in module for the planned Node application.

Do not copy `mergeBoardSnapshot` unchanged. Its documented assumption is that records are archived, never deleted; Companion also needs correct deletion, access revocation and user-switch behavior so an old client cannot preserve data it should no longer display.

## What the scan did not find ready for reuse

- **Two-way Nancy voice:** `Dashboard.tsx::dictate` uses browser `SpeechRecognition` / `webkitSpeechRecognition`, adds a transcript to the composer and asks the user to review it. It does not implement assistant audio replies, a live audio conversation or a server voice session. Its speech test uses a stub. Keep it only as a possible fallback, subject to actual target-browser testing.
- **Nutrition and meals:** The reviewed brief is task/project oriented. Companion still needs its own meal choices, day/meal slots, proposed and accepted plans, revisions, factual meal reports and approved dietary constraints.
- **An active daily schedule:** `docs/daily-brief-workflow.md` explicitly describes M53's 08:00 America/Toronto preparation as planned. It is not evidence of a working 10:00 service or reminder. Start the MVP with the requested user-initiated check-in; automatic reminders/preparation, if selected, need their own implementation and missed-run tests.
- **Participant and family authorization:** Cerberus's browser login is a shared configured password with process-local sessions. Useful origin/session defenses do not supply Companion's participant/caregiver/family identities and database permissions. Retain the planned dedicated authentication and cloud database boundary.
- **A ready participant interface:** The dashboard supports business/project work and many stages and controls. Borrow interaction behavior; design a separate large-type Today screen with a prominent Talk to Nancy control and concise tasks/meals.
- **A cloud care-data model:** SQLAlchemy supports PostgreSQL as well as SQLite, but its operational schema is not a Supabase care schema with the required ownership, row policies, retention and plan history.

## Leave out of the first MVP

Do not import the Cerberus monorepo, business dashboard, Notion/Gmail/Calendar qualification workflows, general OpenClaw agent orchestration, private LifeCore memory store, production credentials or deployment configuration.

The existing launcher deliberately selects offline model mode and removes the API key from its child environment. It cannot be copied as the live-voice launcher without changing that design. Its useful ideas are a simple local launch, honest health checks and stopping only the process it owns.

The Render deployment manifest selects a web service, database and disk. It is not the local-compute deployment selected for CompanionRehab. No provider prices or account eligibility were rechecked in this source-only assessment, and no paid service was selected. Extracting small utilities adds no service subscription by itself; the existing $50/month service ceiling excluding GPT remains authoritative.

Keep the currently planned application stack unless implementation evidence supplies a concrete reason to change it. The inspected reuse opportunities do not justify introducing Cerberus's entire Python/runtime dependency tree just to obtain the daily brief.

## Regression scenarios to bring across

Adapt scenarios to Companion's own API and persistence model, rather than copying Cerberus-specific fixtures:

- Same request key and payload returns the saved result; a changed payload with the same key conflicts.
- A stale revision cannot overwrite another device's changes.
- A model cannot target an unknown task or silently redirect a reference to the selected task.
- Proposed changes do not become accepted plans until the intended acceptance action.
- A lost response followed by restart reads the existing receipt and does not replay the action.
- A late HTTP response cannot overwrite a newer screen/session.
- A day-boundary refresh preserves future plans and expires only the appropriate daily choices.
- Date interpretation remains correct around UTC midnight in the configured local time zone.
- An unauthorized participant/family account cannot read or mutate another person's records (Companion-specific addition).

Concrete Cerberus test pointers:
- `services/api/tests/test_mission_board.py::test_idempotency_and_independent_receipt_readback`
- `services/api/tests/test_mission_board.py::test_stale_edit_does_not_overwrite_or_create_receipt`
- `services/api/tests/test_daily_brief_workflow.py::test_proposed_completion_and_reschedule_do_not_modify_source_or_board`
- `services/api/tests/test_daily_brief_workflow.py::test_create_and_mutation_reconcile_exact_old_key_without_replay`
- `services/api/tests/test_daily_brief_workflow.py::test_next_day_refresh_does_not_make_daily_defer_or_skip_permanent`
- `services/api/tests/test_daily_brief_workflow.py::test_assessment_relative_dates_use_toronto_even_after_utc_midnight`
- `services/api/tests/test_notion_task_commands.py::test_lost_response_is_never_replayed_after_restart`
- `apps/web/tests/daily-brief-workflow.test.tsx`
- `apps/web/tests/dashboard-requests.test.ts`

These tests were inspected, not executed in this scan. Any extracted or ported implementation needs fresh tests, and the real Nancy conversation still needs live acceptance on the participant's device.

## Consequence for the first development slice

Build one end-to-end outcome: at 10:00 the participant opens Nancy, hears today's brief, reviews tasks, chooses meals, accepts the day and later retrieves or corrects it. Voice and touch call the same authenticated care-service commands.

Begin by extracting the small request/error utility and implementing Companion-specific proposal, command-receipt and version contracts. Connect real auth/database/voice inside this same slice. Use a simple participant screen and real task/meal inputs; defer Asana, general agent orchestration and dashboards.

The assessment is complete. The 2026-09-29 roadmap revision now applies these findings to S01-S04: combined voice day planning, actual reporting, interruption recovery and repeat-day use. Application implementation and live acceptance remain unstarted; see ../ROADMAP.md and ../roadmap/roadmap.json for the authoritative sequence.
