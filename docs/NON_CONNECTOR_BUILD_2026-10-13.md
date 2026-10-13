# Non-connector engineering build — 2026-10-13

The owner authorized independent implementation across S01–S05 and S07–S12 before connector qualification. The owner now reports Microsoft access available; exact Rob-account consent/resources remain unverified and Asana access remains unresolved. This permits engineering overlap, including work whose dependencies are unfinished. It does not change the [canonical dependency graph, acceptance criteria or human actions](roadmap/roadmap.json). S06 remains planned. No slice is complete merely because its code exists or synthetic tests pass.

The later [handoff audit](evidence/HANDOFF-AUDIT-2026-10-13.json) supersedes readiness claims below: seven defects were reproduced and two UI defects require focused reproduction. S02 returns to `in_progress`; authority races, uncertain spoken-save recovery, queue deactivation, speech authorization cleanup and effective scheduling require repair. The current unchanged implementation has 542 passing tests and matching Windows/Linux CI; those tests do not cover all newly found failures. The audit contains the repair order and remaining work for every slice.

## Implemented for engineering review

| Slice | Current implementation | What still controls acceptance |
| --- | --- | --- |
| S01 | Existing My Day/auth/local PostgreSQL, Heart/Sol-high conversation, task and meal planning; October 13 adds meal alternatives, portion and missing-ingredient flows and opted-in foreground wake controls. | Qualified intended-user inference route, consented iPhone/Safari conversation and wake, actual care content, full provider/device/HTTPS and restore checks. |
| S02 | Factual task, meal and appointment ledger with corrections, reschedules, receipts and bounded nutrition references. Status is `in_progress`. | Uncertain spoken-save recovery and authority repair, a genuine participant day and S01 completion. |
| S03 | Scoped IndexedDB typed-command queue, saved/unknown/device-only states, receipt-first reconciliation, explicit same-key retry and revocation/scope cleanup. | Physical device/connectivity and isolated encrypted restore trials; S02 completion. |
| S04 | Reviewed carryover decisions, participant-local repeat-day workspace, consented prompt preferences, durable due/claim/ack records, foreground speech and notification fallback. | Preference confirmation, three genuine dates and a real due prompt; S03 completion. |
| S05 | Reviewed meal-derived grocery suggestions, quantities/units, deduplication, shared access and acquired-state commands. | Real ingredient review, scoped household trial and S01/S02 completion. |
| S07–S08 | Versioned routine and rehab definitions, scoped grants, explicit approval references, one-step runs, pause/resume/skip/results and restricted rehab notes. | Human-approved content, consented guided trials and listed earlier-slice dependencies. No default clinical protocol or target was invented. |
| S09 | Versioned scoring and factual progress calculations with correction/recalculation plumbing. | Approved rule weights and thresholds, genuine results and S02/S07/S08 completion. |
| S10 | Client-controlled requests plus Support Team grants, selected sharing, voluntary help and notification preferences/delivery records. | Intended-person voice routes, real sharing/recipient consent, family/client/admin live workflow and S02/S09 completion. |
| S11 | Administrator day/exception/operator views and audited local commands. Connector health reports `not_connected`; it is not a live sync result. | Authorized operator, real-day investigation, S06 integration and all listed dependencies. |
| S12 | Scoped trend/archetype configuration and export contracts with field grants and audit receipts. | Clinical-partner definitions, permitted genuine multi-day/export review and S09/S11 completion. |

The typed command and receipt routes for these local modules are mounted behind the existing session authority. The client exposes supporting views while preserving the primary Talk to Nancy conversation. My Day, Tasks, Meals, Groceries and Progress remain primary; other views are under More. Ordinary successful saves clear their device recovery marker. Migration and encrypted backup scope include the new local tables and both bounded maintenance cursors.

## Verified build

The figures below describe the initial build checkpoint. The later [computer-use rehearsal and repairs](PRE_HUMAN_TEST_2026-10-13.md) supersede its browser coverage and current-revision validation. That rehearsal used actual disposable PostgreSQL, exercised client/family/helper/admin/clinician paths and server-outage recovery, and kept intended-person gates open.

- Full regression run: 525 passed, one optional integration test skipped, across 65 files; TypeScript and production build passed.
- Actual PostgreSQL 17.11: seven route/authorization/backup checks passed in three disposable databases, all removed afterward. The probe did not open the client database.
- Active local database upgrade: 44 checks passed, including encrypted backup, isolated restore, rehearsal, unchanged existing care rows, empty new feature tables and schema-definition comparison. A second inspection confirmed the complete installed schema, not merely table names.
- Existing owner-practice service route: 16 checks passed for Heart audio, local ASR, authorized navigation, repository nutrition provenance, session revocation and numeric model/turn logging. No care activity was invented. Greeting first audio was 534 ms; cached navigation audio 41 ms; generated-audio recognition/turn 5,431 ms; repository nutrition reply 8,296 ms. These are single observations, not latency percentiles or iPhone microphone measurements.
- Browser inspection used an isolated in-memory synthetic account: plan proposal/acceptance, accepted meal display, grocery create/acquire, current routine/progress empty states, clean successful-save recovery behavior and 390-pixel layout. No sample data entered the active client database.

See [sanitized initial-build evidence](evidence/NON-CONNECTOR-BUILD-2026-10-13.json) and [subsequent browser-rehearsal evidence](evidence/PRE-HUMAN-BROWSER-2026-10-13.json). Those earlier runs used localhost and did not create a tunnel. The later [demo deployment](DEMO_HOSTING.md) now uses the supervised stable HTTPS origin from ignored `.local/runtime/demo-host.json`; direct localhost access is subject to the configured Host guard. Heart voice remains restricted to the previously qualified owner-practice route. New users do not inherit that credential.

Engineering coverage is not full canonical acceptance. Test results marked `blocked` record a partially exercised contract and its remaining scenarios, even when every implemented regression passes. No slice is marked complete, and no human gate was waived.

## Remaining engineering and live work

- Expand scenario coverage during the planned slice trials: DST/multi-day reminder behavior, concurrent grocery acquisition, offline routine recovery, protected-time changes and complete role/export matrices. The subsequent browser rehearsal exercised server-restart receipt recovery and all five configured clinical archetypes; it did not exhaust their full contracts or establish intended-person acceptance.
- Qualify the intended participant, family, administrator and clinician runtime/account bindings before their actual voice tests. Preserve owner-only practice restrictions; no shared subscription credential or silent model/billing fallback is authorized.
- Obtain participant-approved actual tasks, meals, reminder preferences and recipient grants only when needed for live trials. Obtain human-approved routine, rehab, scoring and clinical archetype definitions before their respective real use. Keep real care records, transcripts, credentials and private observations out of this repository.
- Repair the open handoff findings, then run the slice-specific physical-device, genuine-day and consented household/operator/clinical tests recorded in the JSON. S01–S05 and S07–S12 remain `in_progress`; no release or daily-reliance gate is met.

## Operating and upgrading locally

Use `npm run check` for the engineering regression suite. `node --import tsx scripts/local-features-probe.ts` verifies the full schema and encrypted restore in newly created disposable loopback databases; its detailed evidence stays under ignored `.local/probes`. `node --import tsx scripts/upgrade-local-features.ts` inspects the established client database. Add `--apply` only to perform its backed-up, rehearsed atomic upgrade from revision `dbf7abe`; it refuses partial feature schemas. Historical backups require their pinned matching schema adapter. Do not rerun all migrations blindly against existing care data.

The later October 13 [demo hosting setup](DEMO_HOSTING.md) supersedes manual `npm start`: a Windows user-logon task now supervises the app and database, with the current origin supplied from ignored `.local/runtime/demo-host.json`. Do not start a second app while supervision is active. Public HTTPS is owner-approved, active and verified; the physical smartphone trial remains open. The local scheduler checks consented prompts and support notifications every 30 seconds in bounded rotating batches. Neither worker calls a model or external connector. Foreground wake consent is a server-issued, session/scope-bound token that expires after 30 minutes and is revoked on Stop or page exit; enabling it still requires an explicit user microphone action.

## Connector boundary

IT reported that the Microsoft app registration was created and its IDs delivered privately. On October 13 the owner reported Microsoft access available; verify that access and Rob's exact sign-in, delegated consent and resources before requesting more setup. Rob's existing Microsoft account is the sole intended mail/calendar identity. No Outlook or Asana connector, outbound message or live sync has been completed. See the [Microsoft checklist](MICROSOFT365_IT_CHECKLIST.md); a connector prerequisite cannot be inferred from this non-connector build.
