# Requests, client choice and family help

The October 7 increment adds a Requests area to My Day, a Support Team home for family/friends, and a small Requests and help home for administrators. Clinician Partners remains a scoped landing screen; clinical dashboards and exports are later work. The authoritative feature order and live gates remain in [the roadmap](roadmap/roadmap.json).

## Working flow

1. A permitted family member or administrator reviews a task name, priority, local date/time, estimated duration, travel and optional notes. Sending creates a pending request in the client's inbox.
2. The client can review the request, change its time/priority, state how much additional activity feels manageable, and accept after checking the plan. Missing duration or capacity prevents acceptance. Known schedule or approved-limit conflicts require a different proposal. Travel, activity and rest must fit the reviewed local day; overnight requests need a different time rather than an inferred split of daily capacity.
3. Acceptance adds one pending occurrence and an accepted plan version, preserving existing meal/task choices. The occurrence survives a later plan edit. It is not an actual completion. Moving an accepted request rechecks constraints and transfers the capacity reservation when the day changes.
4. The client may instead choose **Cannot do this**, give a short reason, review it and confirm. One transaction saves the decline, linked help and an administrator flag. It creates no task or penalty.
5. Another authorized family member can volunteer. An authorized helper, client or scoped administrator can record what was arranged. Administrator acknowledgement leaves help open; resolution closes the linked help/flag. These actions do not assert that the client's activity occurred.

All delivery is in-app. This increment sends no email, calendar or project-management action and starts no recipient inference. No available helper leaves the help visibly unassigned. Requested and accepted times are shown separately; actual activity remains in the factual ledger.

## Access and voice

An application role alone is insufficient. A current client-specific role grant and explicit request permissions are checked at each service boundary. The client can adjust permissions for already-provisioned scoped accounts from **Who can request tasks and help**. Account creation is an operator setup action after the client identifies recipients and agrees sharing; development does not create real family accounts implicitly.

| Permission | Who may hold it | What is visible or allowed |
|---|---|---|
| `request_tasks` | Family/friend, administrator | Review feasibility, submit and withdraw their own pending requests. |
| `read_requests` | Scoped family/friend, administrator | Their own sent request status and permitted details. |
| `help_requests` | Family/friend | Other requesters' declined tasks/reasons, voluntary help and permitted resolution. |
| `review_request_flags` | Administrator | Scoped reason/help/flag review, acknowledgement and resolution. |
| Client authority | Addressed client only | Inbox decisions, capacity statements and request-sharing controls. |

Talk to Nancy uses the same typed commands and explicit readback. The model can prepare an action; the application commits only after complete playback and the action-specific phrase, such as **send this request**, **accept this request** or **decline this request**. Interrupting or changing topic invalidates the review. Unknown writes reconcile by receipt; the UI permits an exact-key retry only after a completed lookup finds no receipt.

Family/admin tools receive bounded request facts and availability summaries, not the client's private appointment descriptions, meal plans or clinical notes. Client tools retain the existing My Day workflow. Navigation between permitted client views preserves the conversation; login, role, client, grants or inference binding changes clear incompatible history and pending reviews.

The implemented production reasoner remains **owner practice only**. Voice controls explain unavailable account eligibility separately from a speech worker still warming up. This code does not qualify shared hosting of several ChatGPT subscriptions, and it cannot route another person's request through the owner's account. Family/client microphone trials require their actual account/runtime qualification and consent. UI readiness is not voice acceptance.

## State, recovery and operations

Migration `006_family_task_requests.sql` adds explicit request access, client capacity, human-approved structured constraints, requests, help, flags and immutable receipts. Care events retain actor, client, command, revision and plan/occurrence linkage. A declined reason is private care data, not operational telemetry. Operational logs keep bounded metadata for 14 days, including actual supplied token counts, timing, policy version and an opaque binding reference; missing usage stays unknown.

The request tables are in the encrypted backup and restore manifest. Preserve a pre-upgrade encrypted backup and prove restore before changing the active database. Old schema snapshots are not silently reinterpreted as current snapshots. Approved limits are supplied through scoped operator setup with an approval reference; Nancy has no tool to edit them.

Engineering checks use disposable databases and synthetic identities only:

```powershell
npm run check
node --import tsx scripts/task-request-probe.ts
node --import tsx scripts/check-governance-live.ts
node --import tsx scripts/task-request-browser.ts
```

The PostgreSQL probe creates and removes only fresh `nancy_requests_*` targets. The browser harness is loopback-only, uses synthetic accounts, enables no inference and must be stopped after review. The provider probe uses only the already-authorized owner's connection and a synthetic greeting; it is not participant/device acceptance.

Before a real family trial, complete only the still-open human actions in [HUMAN_ACTIONS.md](HUMAN_ACTIONS.md): identify recipients and scope, confirm sharing of reasons/help, provide actual capacity/constraints, and participate in the prepared voice/UI trial after route qualification. Full S01/S02/S10 and later dashboard gates remain open.
