# Standalone Asana sandbox — October 24, 2026

Subsequent October 24 instruction: the owner authorized connecting this sandbox to the separate Nancy test copy. That read-only checkpoint is implemented and verified in [the owner integration record](ASANA_OWNER_TEST_2026-10-24.md). The standalone-only restrictions below describe the earlier completed setup step; they do not override the later explicit direction. Dad's instance remains outside the connection.

Status: standalone workspace/project provisioned and verified against actual Asana on October 24, 2026. The owner signed in, the private project contains 12 imported synthetic tasks, and native completion/reopening/rescheduling plus list/board/calendar checks pass. Nancy/Safari checkpoint 5c3aa9b and preparation checkpoint 7432fdb are preserved. Nancy, Dad, Heart and billing remain unchanged.

The owner explicitly chose a standalone sandbox first. Do not connect it to either Nancy environment, register a Nancy OAuth app, generate API tokens, install webhooks, invite people, import real household/medical records or configure automation in this step. The optional Asana connection for this chat is separate from a Nancy integration and is not confirmed connected.

## Created layout

- Created ordinary workspace: Nancy Sandbox - Test Only.
- Project: Daily Life - Sandbox.
- Audience: the signed-in owner only. Verify the actual workspace membership and project privacy in Asana before importing. If a private owner-only workspace/project cannot be created on the actual free account, pause that operation and present the concrete alternative rather than using an existing shared company space.
- Views: list, board and calendar, using the ordinary free Personal features.
- Sections: Start here, Inbox, Proposed, Planned, Needs help, Completed examples.
- Fixture: [12 synthetic tasks](fixtures/asana-standalone-sandbox.csv), all unassigned and visibly prefixed [TEST]. The fixture includes a meal, a generic activity, groceries, a fictional request/help case, an undated task, duplicate titles, rescheduling and completion/reopening examples. No actual activity, clinical protocol or client approval is implied.

Asana lists Personal at $0 with two users and list/board/calendar views. Only basic views were selected, the Advanced trial option was left off, and no billing details, paid field or purchase action was submitted. The formal billing-page plan name was not inspected. The separate workspace uses the same business login; it is not a new personal-email account. [Official pricing](https://asana.com/pricing).

Asana's separately provisioned developer sandbox is a temporary domain intended for integration developers and eligible existing customers, with provisioning potentially taking up to a week. It is unnecessary for this initial standalone exploration. Do not submit that request or describe an ordinary workspace as an official Asana developer sandbox. [Developer-sandbox guidance](https://developers.asana.com/docs/developer-sandbox).

## Provisioning sequence

1. Owner signs in to the intended Asana account in the opened Asana page. Any new account password, MFA, CAPTCHA or legal acceptance stays with the owner when required. Reuse an already signed-in account if the owner selects it; do not guess an email/account.
2. Check for an existing clearly labelled sandbox to avoid duplicates. Create the separate ordinary workspace if the UI/account permits it, with only the current owner and no invitation or trial purchase. Otherwise prepare an owner-private test project in a user-selected appropriate space and record its actual isolation limits.
3. Create the named blank project and verify owner-only membership/privacy. Set the project description to identify synthetic standalone data and the absent Nancy/email/calendar connections.
4. Import the prepared CSV exactly once. Map Name, Description, Section, blank Assignee and Due Date to native fields, not paid custom fields. Dates use the US month/day/year format in Asana's current instructions. Inspect the preview before import. CSV imports add new tasks rather than update existing tasks, so reconcile a timeout or partial result before attempting another import. [CSV preparation](https://help.asana.com/s/article/preparing-data-for-csv-import), [import workflow](https://asana.com/apps/csv-importer).
5. Verify 12 tasks, six sections, all unassigned, two separate Pick up groceries tasks, the undated task and October 26–28, 2026 due dates. Section grouping and native completion are separate: the Completed examples section does not check a task's completion box.
6. Only in this new synthetic project, mark NSBX-008 complete; complete then reopen NSBX-012; move NSBX-009 to October 28. Verify the intended states and list/board/calendar views. Save private provider references and a screenshot; publish only sanitized setup evidence. No existing task is moved, deleted or edited.

## Current evidence and remaining scope

The fixture passes ten local structural checks and an independent CSV parse. Asana confirms a single successful 12-row import. The workspace membership view shows one owner, and the project share dialog shows Private with only that owner. Imported native sections and October 26–28 dates are verified in the real UI. Source assignees are blank, the blank import column was ignored, and three edited task details were individually checked as No assignee. No custom fields were added. Project description readback confirms the standalone synthetic boundary.

Standalone provisioning and the disposable provider UI checks are complete: NSBX-008 stays completed after reload; NSBX-012 stays reopened; NSBX-009 moves from October 26 to October 28. Calendar week October 25–31 contains ten dated tasks, with two undated entries separately retained. The native empty Untitled section may still appear in Board; it has zero tasks, and the six named sections contain all twelve fixtures. Hiding empty columns did not persist across view changes. The list view is left open for review. A requested CSV export did not return through the browser download event and was not retried or counted as successful. OAuth, Nancy ingestion, client acceptance, writeback, webhook recovery and full S06 acceptance remain separate future work. S06-H01 is not complete from creating a standalone project. Exact private workspace/project/task references belong only in ignored local evidence.

Actual setup evidence: [sanitized provider checks](evidence/ASANA-SANDBOX-2026-10-24.json). Private exact project links and screenshots remain in ignored local evidence and are delivered directly to the owner. No application source changed, so this configuration-only task uses the previously qualified source revision sha256:cf39729b498510609de3a55959dcb702668a5f6a3bb1fa48bcf1f46aab9f47a2.
