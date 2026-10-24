# Read-only Asana connection in the owner test copy

October 24, 2026: the owner expressly extended the standalone sandbox into the separate Nancy test copy and approved the Asana API Terms and exactly `projects:read`, `tasks:read`, `users:read`. Actual OAuth and task ingestion are verified. This checkpoint does not connect the live client or complete S06.

Subsequent verification: [recorded-speech planning/reschedule/completion tests](ASANA_VOICE_TEST_2026-10-24.md) now include a reviewed practice plan and one synthetic completed task, plus owner-only source/history guidance and date-only display repairs. Asana remains read-only. Actual phone microphone/audibility acceptance is still pending.

## Review and use

Open `/asana-test.html` on the existing owner test HTTPS origin (port 10000). It uses the existing tester login, independent test cookie and synthetic participant. The normal Current home, Safari guide and Heart settings are preserved. The review page starts no microphone, conversation or meal preparation, and imports need no model call.

The connection is already authorized. Select **Import latest tasks** to read the selected project. Review a task and select **Add to my available tasks** to make that exact source version a planning choice. This does not accept a day plan or report a performed activity. Normal Nancy planning sees these choices through the existing authorized Today facts; the accepted-plan command remains separate.

Twelve synthetic sources are retained. Three were deliberately added for testing: both separately identified grocery tasks and the undated task. Their local IDs, receipts and exact provider references are private. One grocery source was temporarily rescheduled and completed, then restored and reopened. Nancy retains its local schedule and marks the changed source for separate review, including after the original date is restored. It does not silently rewrite the task or an accepted plan. The original standalone fixture is a historical seed, not an update script.

## Boundaries

- Only the owner runtime instantiates the adapter. The app refuses registration without the synthetic flag, separate test cookie and matching origin. Each service operation derives actor, login, client, role and grant on the server. Import/acceptance transactions recheck and lock the relevant SQL authority rows.
- Asana's resource read scopes apply to the authorized account; app distribution is limited to the existing sandbox workspace. Nancy independently pins the account email, workspace and project, reads only project IDs to validate workspace membership, and fetches task content only from the selected project. User/client/project IDs cannot be supplied to widen a sync request.
- PKCE, random single-use state, a short-lived browser binding and a same-login authenticated finish protect OAuth. The app secret is encrypted in ignored local configuration. Provider access/refresh tokens are encrypted in the owner database with connection/grant binding. They are absent from browser responses, public evidence and care backups. Expired-token renewal is serialized; an omitted replacement refresh token retains the existing bound token.
- Reads have fixed hosts, no redirects, bounded response sizes/timeouts/pages and validated references. Pagination follows offsets on the pinned endpoint, never a provider-supplied URL. A failed/partial import retains the previous complete snapshot. Duplicate titles are distinct by remote ID; repeat imports do not create another task.
- The import reads title, completion, dates, modification time and section/project references. Descriptions, comments, attachments, custom fields and other projects' task content are not fetched. Imported content cannot change policy or trigger a command. Missing or externally changed sources require review.
- A reviewed incomplete source can create one ordinary task with the existing medium-priority default and unknown duration. Date-only values retain no invented time; instants convert to the participant's timezone. Undated sources remain undated. Source completion creates no activity report, meal report, score or accepted plan.
- Reviewed additions atomically save the task, mapping, actor/grant-bound payload receipt and audit event. Reusing the same key/payload returns the receipt; changed payloads, stale/old snapshots and already-added/completed/removed sources are rejected. Current source updates are displayed for separate review rather than applied automatically.
- Disconnect removes the local encrypted credential and pending flows; user-added planning choices remain. It does not claim provider-side grant revocation. There is no task writeback, webhook, background Asana schedule or automatic provider lookup during conversation.

## Engineering and actual provider evidence

The final evidence file records the exact source revision and observed checks. Focused tests cover OAuth/browser binding, identity/workspace denial, grant changes during reads, pagination/failure, repeat import, source versions, reviewed receipts, dates, renewal and live-runtime exclusion. Actual PostgreSQL setup adds only three owner-specific tables and is idempotent; this migration is deliberately absent from live-care migrations.

The first browser authorization returned without finishing. Sanitized diagnostics isolated a project-read HTTP 403. Explicit nested workspace references and compact workspace fields still failed; using the documented workspace project collection for membership validation works with the original three scopes. No additional scope or full-permission grant was enabled. Historical failed attempts and intermediate test reports are retained privately.

Actual tests cover all twelve sources, repeat imports, the three deliberate local additions, same-command receipts, changed-command denial, completed-source denial, date-only/undated handling, completion/reopening/rescheduling and reload/restart persistence. Real OAuth renewal succeeds after forcing only local refresh eligibility; this is not evidence of actual provider expiry or revocation. Initial Vitest cache permission failure ran no tests; subsequent qualified runs and a corrected disposable test cleanup/date assertion are recorded honestly.

Preservation checks compare all original rows in 30 care tables across the two databases, allowing only the three new practice tasks and their three audit events. Dad's process, both supervisors, configuration, locked Current assets, owner selection and Safari guide are unchanged. Only owner child restarts were requested. Numeric owner telemetry contains no observed inference requests during this task; no API-funded reasoning, paid service, invitations or real-care records were introduced.

Actual Safari voice acceptance remains awaiting_live_test. Production integration identity/two-user arrangement, actual provider revocation/expiry, signed webhooks, broader recovery, reviewed writeback, genuine household/client acceptance and S02/full-S06 gates remain open. These are separate from this completed read-only test checkpoint.

See [sanitized checkpoint evidence](evidence/ASANA-OWNER-TEST-2026-10-24.json). Exact account/project identifiers, source rows, SQL deltas and screenshots remain in ignored private evidence.

Provider references: [OAuth and related-object scopes](https://developers.asana.com/docs/oauth), [project reads](https://developers.asana.com/reference/getproject), [workspace project collection](https://developers.asana.com/reference/getprojectsforworkspace), [paginated project tasks](https://developers.asana.com/reference/gettasksforproject), [app distribution](https://developers.asana.com/docs/share-your-app). These describe provider contracts; the local/live evidence establishes this checkpoint's observed behavior.
