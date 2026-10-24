# Standalone Asana sandbox — October 24, 2026

Status: prepared, awaiting account sign-in and actual provisioning. No Asana workspace, project or task creation has been verified. The current Nancy/Safari work is committed at 5c3aa9b; Nancy, Dad, Heart and billing are outside this task.

The owner explicitly chose a standalone sandbox first. Do not connect it to either Nancy environment, register a Nancy OAuth app, generate API tokens, install webhooks, invite people, import real household/medical records or configure automation in this step. The optional Asana connection for this chat is separate from a Nancy integration and is not confirmed connected.

## Prepared layout

- Preferred new ordinary workspace: Nancy Sandbox - Test Only.
- Project: Daily Life - Sandbox.
- Audience: the signed-in owner only. Verify the actual workspace membership and project privacy in Asana before importing. If a private owner-only workspace/project cannot be created on the actual free account, pause that operation and present the concrete alternative rather than using an existing shared company space.
- Views: list, board and calendar, using the ordinary free Personal features.
- Sections: Start here, Inbox, Proposed, Planned, Needs help, Completed examples.
- Fixture: [12 synthetic tasks](fixtures/asana-standalone-sandbox.csv), all unassigned and visibly prefixed [TEST]. The fixture includes a meal, a generic activity, groceries, a fictional request/help case, an undated task, duplicate titles, rescheduling and completion/reopening examples. No actual activity, clinical protocol or client approval is implied.

Asana lists Personal at $0 with two users and list/board/calendar views. This is the researched target, not verification of the user's actual account plan. No trial, paid feature, seat purchase or billing change is authorized or performed. [Official pricing](https://asana.com/pricing).

Asana's separately provisioned developer sandbox is a temporary domain intended for integration developers and eligible existing customers, with provisioning potentially taking up to a week. It is unnecessary for this initial standalone exploration. Do not submit that request or describe an ordinary workspace as an official Asana developer sandbox. [Developer-sandbox guidance](https://developers.asana.com/docs/developer-sandbox).

## Provisioning sequence

1. Owner signs in to the intended Asana account in the opened Asana page. Any new account password, MFA, CAPTCHA or legal acceptance stays with the owner when required. Reuse an already signed-in account if the owner selects it; do not guess an email/account.
2. Check for an existing clearly labelled sandbox to avoid duplicates. Create the separate ordinary workspace if the UI/account permits it, with only the current owner and no invitation or trial purchase. Otherwise prepare an owner-private test project in a user-selected appropriate space and record its actual isolation limits.
3. Create the named blank project and verify owner-only membership/privacy. Set the project description to identify synthetic standalone data and the absent Nancy/email/calendar connections.
4. Import the prepared CSV exactly once. Map Name, Description, Section, blank Assignee and Due Date to native fields, not paid custom fields. Dates use the US month/day/year format in Asana's current instructions. Inspect the preview before import. CSV imports add new tasks rather than update existing tasks, so reconcile a timeout or partial result before attempting another import. [CSV preparation](https://help.asana.com/s/article/preparing-data-for-csv-import), [import workflow](https://asana.com/apps/csv-importer).
5. Verify 12 tasks, six sections, all unassigned, two separate Pick up groceries tasks, the undated task and October 26–28, 2026 due dates. Section grouping and native completion are separate: the Completed examples section does not check a task's completion box.
6. Only in this new synthetic project, mark NSBX-008 complete; complete then reopen NSBX-012; move NSBX-009 to October 28. Verify the intended states and list/board/calendar views. Save private provider references and a screenshot; publish only sanitized setup evidence. No existing task is moved, deleted or edited.

## Current evidence and remaining scope

The local fixture has been validated for counts, identifiers, duplicate/undated examples, test labels, blank assignees, date format and absence of contact details. This does not establish that Asana accepted the import or that any live workflow passed. The browser was at Asana's sign-in page when preparation began; no provider credentials or account identity are in this repository.

Standalone provisioning and the short disposable UI checks remain awaiting_live_test. OAuth, Nancy ingestion, client acceptance, writeback, webhook recovery and full S06 acceptance remain separate future work. S06-H01 is not complete from creating a standalone project. Exact private workspace/project/task references belong only in ignored local evidence.
