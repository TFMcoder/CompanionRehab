# Companion Rehab: current roadmap

Read this overview, then [the canonical JSON](roadmap/roadmap.json). The JSON governs scope, dependencies, acceptance and human actions. After those files, read [the latest handoff](HANDOFF_LATEST.md). Earlier dated notes are historical checkpoints, including their owner-only, unchanged-client and unactivated-candidate statements.

## Current state — November 1, 2026

The client test copy selects `calendar-shared-v1-2026-11-01`; the separate owner practice copy remains `feedback-v3-2026-10-31`. The exact approved route retains Sol-low, Heart, Current and its existing caregiver/client/account/host/grants. Verify private release pointers, fresh running-entry proof and health rather than assuming checkout equals deployed code. Current evidence is in [the November 1 handoff](HANDOFF_2026-11-01.md).

The deployed calendar repair uses a fresh selected-source read and names the actual dates checked. An undated appointment question covers seven participant-local calendar days beginning today; explicit tomorrow stays one day. The earlier date-repair qualification inventory was 1,756 passes/2 optional skips across 143 files, reconciled from an earlier full run and verified final affected-file checks; typecheck/build and 87 overlapping actual disposable PostgreSQL assertions pass. Two deployed HTTPS typed turns pass with zero model calls, and preservation covers 1,739 files, all 131 care tables and 187 original sessions. See [the scoped repair and its qualification limits](OUTLOOK_CALENDAR_REPAIR_2026-11-01.md).

The primary selected/default calendar actually returned complete empty provider results for the requested week and Monday; no parser drop was found. The owner identified a second same-tenant calendar/account as the missing source. Its distinct directory identity is verified, but mailbox type remains unknown and an exact-source metadata GET under unchanged primary permissions returned HTTP 403. A **distinct read-only app registration** now exists with separate certificate/callback, required assignment and only the exact existing signer assigned. The owner separately approved the connection and organization-wide administrator consent; the portal confirms the five reviewed delegated scopes granted. Primary permissions remain unchanged. Microsoft cumulative consent still rules out the earlier same-app proposal. The secondary software is deployed and its isolated OAuth flow is open at the Microsoft-required password-update step for the exact approved signer; the displayed first-sign-in/expiry alternatives do not establish the cause, no password was changed, and the flow may expire before human completion; completed OAuth and target-event access remain unverified.

The deployed `calendar-shared-v1-2026-11-01` release has a reconciled inventory of 1,890 passes/2 optional skips across 154 files, with no remaining failures after affected-file rechecks and hash-bound source reconciliation; this is **not a new full run**. Historical v7 failures and nine v8 environment failures are retained. Final v9 typecheck on Node 24.22.2 and 25 actual disposable PostgreSQL plus 16 migration/backup checks now pass; all three fixtures were identity-verified and removed. Qualification admission verifies 597 package files and 186 dependencies. The live client schema 021 migration subsequently passed after encrypted backup/restore of 205,286 tuples, preserving care, owner and primary connection state. Its CPU-heavy preservation comparison held care-table locks for minutes and temporarily delayed some care requests. Corrected guarded promotion attempt2 and subsequent runtime/preservation checks pass, with both normal-TLS/local-voice endpoints ready after warmup, owner and speech paths unchanged. The first atomic-replace failure is retained; it changed neither environment nor pointer. Application OAuth and target-event visibility remain unqualified. Whole-workflow model/provider counts are unknown because existing browser preparation may run. Separately, both existing runtime trees restarted successfully on Node 24.22.2 while preserving releases, Heart, Current, CUDA configuration, exact bindings, all 131 care tables, 189 then-existing sessions and archive state. The separate replacement ASR now passes 18 baseline/patched CUDA/float16 checks with six matching synthetic phrase readings; both workers exited 0 and were verified absent, and read-only selector validation passes. No speech dependency candidate is activated. Native libvips is 8.18.7; its npm wrapper package is 1.3.4. Actual person/device qualification remains open. See [the current evidence and limits](OUTLOOK_CALENDAR_REPAIR_2026-11-01.md). The missing appointment and genuine workflow remain unverified. Full S01/S06 and intended-person/device acceptance remain open. There are **0 completed slices**.

The delivered repair includes optional typing, current-time/meal-aware next steps with Outlook, medical appointment administration, independent older Inbox search, quantified linked recipes, reviewed grocery/email handoff, empty-list suppression, one exact send confirmation, Save Suggestions and received-input acknowledgement. Broader food explanations use relevant supplied research without forcing recipes. Medication, symptoms and glucose readings retain full care safeguards. See [client repair](CLIENT_REPAIR_2026-10-31.md) and [archive/research evidence](CONVERSATION_ARCHIVE_2026-10-31.md).

The private encrypted conversation-text archive retains text until explicitly deleted, with no audio, automatic analysis upload or automatic model-memory extraction. Collection was freshly verified **off** during the November 1 repair, awaiting the client’s own informed choice. Never reset or infer consent if the client subsequently changes that choice. Confirmed preferences/context remain separate from archived dialogue and product feedback. The earlier audit found one retrievable saved product suggestion and missing confirmed personal context; reread current records before asking for any still-missing confirmation.

## Delivery order and acceptance

Prioritize useful S01-S04 experiences and complete their voice, touch, care-service, persistence, recovery and actual live acceptance together. Current user directions may authorize narrow later-slice increments; they do not waive full dependencies or gates. My Day stays small, with Talk to Nancy primary. Administrator/trend dashboards remain in their assigned later slices.

| Slice | Outcome | Dependencies |
|---|---|---|
| S01 | Talk to Nancy and plan the day | None |
| S02 | Track actual tasks, meals and appointments with grounded nutrition | S01 |
| S03 | Resume check-ins and tracking after interruptions | S02 |
| S04 | Return to a fresh day with reviewed carryover and timely prompts | S03 |
| S05 | Build and use groceries from the meal plan | S01, S02 |
| S06 | Connect Asana tasks and Outlook mail/calendar | S02 |
| S07 | Follow Morning Boot one step at a time | S02, S04 |
| S08 | Follow and report an approved rehab session | S02, S07 |
| S09 | See explainable daily progress and achievements | S02, S07, S08 |
| S10 | Use Support Team for client-approved task requests, shared progress and help | S02, S09 |
| S11 | Operate today's program from an administrator dashboard | S01, S02, S06, S07, S08, S10 |
| S12 | Review trends and exports in Clinician Partners | S09, S11 |

A suggestion or accepted plan is never proof of an activity. The client alone accepts care changes. Use current IDs/revisions, exact reviewed commands and durable receipts. Preserve refusal, ambiguity, uncertain delivery, correction/deletion and scoped access. Actual full-person/iPhone/Safari, genuine grocery/recipe-email, known full-message and medical appointment usefulness remain awaiting live test; generated clips and disposable fixtures cannot complete them.

## Engineering and human boundaries

- Read the selected slice’s outcome, tasks, contracts, criteria, tests, `reuse_refs` and `human_actions` in JSON. Inspect current fields without repeatedly dumping the long historical evidence strings.
- [HUMAN_ACTIONS.md](HUMAN_ACTIONS.md) is generated from JSON. S01-H01/H03/H04/H06/H08 and applicable S06 actions retain their recorded statuses; do not convert engineering success into client consent or person/device acceptance.
- Reuse existing access and the exact approved caregiver route. No API funding/fallback, broad account sharing, credential copying, new permissions, real care/provider writes or unnecessary reconnect. Calendar and ordinary Inbox snapshots have separate seven-day bounds; older selected-folder Inbox search has independent dates and caps. Unread does not mean unanswered.
- Keep real records, archived text, credentials and complete private evidence outside Git. Operational logs remain numeric/content-free with their existing14-day policy. The explicitly opted-in archive is a separate until-deleted store.
- Keep the existing stack and pinned release dependencies. Do not edit deployed releases, install root dependencies implicitly or run historical write helpers/closed Pro ledgers as fresh authorization.
- Follow [the Cerberus assessment](architecture/CERBERUS_REUSE_ASSESSMENT.md), canonical `reuse_plan` and slice `reuse_refs`; adapt small validated utilities/patterns without importing a monorepo, credentials or unqualified scheduler.
- Keep services at or below50 CAD/month excluding reasoning usage, preferring current resources/free tiers. Clinical-use, paid, daily-reliance and release gates block only their named activity; full slice-completion gates still apply.

The JSON retains G-EARLY-USE, G-FIRST-FOUR, G-DAILY-RELIANCE and G-FULL-MVP. None is completed by this engineering repair. The first-four trial does not replace the full observed seven-day loop.

## Validation and history

After JSON changes, run:

```powershell
pwsh -NoProfile -File ./scripts/render-human-actions.ps1
pwsh -NoProfile -File ./scripts/render-human-actions.ps1 -Check
pwsh -NoProfile -File ./scripts/validate-roadmap.ps1
```

Roadmap validation checks structure/evidence metadata, not real behaviour. Use the pinned dependencies and isolated fixtures described in the handoff for application checks; do not reinstall the running workspace.

The complete preceding roadmap narrative is preserved in [ROADMAP_HISTORY_2026-10-31.md](ROADMAP_HISTORY_2026-10-31.md). Its relative evidence links remain valid. Read dated reports when needed for a particular decision, failure or measurement; the latest handoff and JSON supply the current state.
