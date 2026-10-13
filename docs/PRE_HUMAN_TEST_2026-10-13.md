# Browser rehearsal before the human test — October 13, 2026

Codex exercised the running web interface using computer use, with actual HTTP requests and a disposable PostgreSQL 17.11 database. The accounts, tasks, meals, program instructions, approvals and clinical-view configurations were synthetic. The fixture did not use an inference credential. Its database was removed after the checks. No test care records were inserted into the client database.

This is an engineering rehearsal. It does not establish participant acceptance, clinical suitability, physical iPhone/Safari behavior, or permission to share a subscription account. The existing owner-practice service was checked separately.

## Browser workflows exercised

- Client sign-in; a new day plan; explicit plan acceptance; independent Tasks, Meals and My Day views.
- Separate task completion, meal eaten with portion, and appointment attendance reports. Corrected a mistaken completion to deferred and verified the counts changed without rewriting the accepted plan.
- Rescheduled a task, checked its effective time across client/family views, then generated a repeat-day proposal using that time. The original accepted snapshot remained distinguishable until a new proposal was accepted.
- Proposed and accepted an alternative meal; reviewed its missing ingredient; added a grocery; changed quantity; checked duplicate suggestions; marked it acquired from family access.
- Reviewed a previous day's unfinished task and recorded a request for help. Saved repeat-day choices and used them for a reviewable proposal.
- Enabled a synthetic due meal reminder. The running scheduler delivered it in the foreground; its PostgreSQL record was `delivered` through `in_app`. Speech/OS notification delivery was not established by this check.
- Started an approved synthetic routine, paused, reloaded, resumed the saved step, completed the required step and skipped an optional step with a reason. Completed a separate synthetic rehab run and retested independent report fields after repair.
- Family submitted dated/timed requests. Acceptance remained disabled until the client supplied available capacity, reviewed timing and confirmed the task fit. Only the client accepted it.
- Client declined another request with a reason. A helper saw it, volunteered and resolved the help request. Administrator review showed the flag and resolution. No declined task was imposed on the client.
- Opted-in family completion notification appeared and could be marked read. Revoking tasks/meals/progress sharing removed those views and alerts; separately granted groceries remained accessible.
- Administrator operations showed factual plan/activity counts and an audit timeline. Connectors reported not connected, with no external send or retry action.
- Clinician loaded all five configured archetype views and exported a seven-day CSV with only the six selected permitted fields. Missing scores remained blank; the export receipt retained range, timezone and configuration version.
- An unrelated client saw an empty day and grocery list. Family had no export control or private rehab notes.
- Stopped the disposable server during a grocery save. The app showed an uncertain/pending result. After restart, receipt lookup reported no saved change; one explicit retry saved the item. Reload and a database count confirmed one item.
- Inspected the client layout at 390 pixels wide; document width remained 390 pixels, with no horizontal overflow. This is a browser layout check, not a physical Safari test.

## Defects repaired during the rehearsal

1. Plan review could show an old task time after a ledger reschedule. New proposals now carry the effective same-day time while preserving a distinct proposal's explicit changes; review labels distinguish historical plan time from current activity time.
2. Accepted requests appeared in recorded activity as “Mistaken report removed.” Planned/rescheduled occurrences now remain separate from actual reports and do not offer an inappropriate correction action.
3. Rehab report fields could carry into the next step; pause and end reasons shared a field. Inputs are scoped to the run/step, clear on confirmed save, and remain recoverable when a save is uncertain. Scope changes clear private input and ignore old responses.
4. Support Team contained a stale “Progress sharing is not available yet” message despite the working shared view. It was removed.
5. Shared schedules used the viewer's browser timezone. The server now supplies the client timezone, the UI uses it explicitly and names it; notification quiet hours retain their separate recipient preference.
6. An accepted-request history label continued saying “not completed” after actual completion elsewhere. It now describes the acceptance event: “Accepted · added to the plan.”
7. Browser microphone/audio permission could leave voice startup waiting indefinitely. Startup is now bounded and cancellable, reports a clear permission issue, and releases microphone resources even if permission resolves late.

The changes include regression tests. See the [machine-readable evidence](evidence/PRE-HUMAN-BROWSER-2026-10-13.json) for final suite counts, revision, service measurements and limitations.

## What tomorrow still needs to prove

- Rob's actual iPhone/Safari microphone permission, Heart playback quality and volume, natural turn-taking, interruption, foreground wake, and reconnection.
- The intended user's approved runtime/account binding. Owner-practice success does not qualify Rob, family or clinician inference accounts.
- A real, consented day with actual tasks, meals, portions, times and carryover; appropriate client-facing language and capacity decisions.
- Family use with real sharing preferences and separate account bindings, and reminder behavior under the phone's actual foreground/notification constraints.
- Human-reviewed routine, rehab, scoring and clinical content before those features are used for care.
- Microsoft 365 and Asana authorization and live connector behavior remain deferred.

No slice or human release gate was marked complete from this rehearsal. Physical-device, genuine multi-day and full canonical scenario matrices remain open in the roadmap.
