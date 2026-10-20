# Focus interface review and Current rollback

**Owner decision, October 19:** Current was selected and locked after comparison. The shipped Focus review switch is now disabled; old review links display Current. The implementation and rollback evidence below are preserved as historical review material. See [the approved Current design](CURRENT_UI_DESIGN.md).

The owner authorized preserving the October 19 Current interface, verifying a rollback, and building an opt-in Focus experiment. The ordinary authenticated Nancy URL remains Current. The review URL is the same origin with `/?layout=focus`. No layout selector, new account, public care preview, migration or alternate voice service is introduced.

Focus changes presentation only. It keeps the five tabs, calendar timeline, FAQ and suggestions. One fixed bottom control area contains the horizontally centered Talk to Nancy button and a short current voice status. The Talk button remains visible during a conversation and is disabled until Stop voice ends that conversation; existing Stop/Interrupt controls remain in the same area. This prevents a second start. There is no animation or automatic microphone start.

The control area respects the device safe area. ResizeObserver measures its height so enlarged text and active voice controls reserve a separate area below the scrollable page. Page content scrolls within the space above the controls rather than behind them; scroll padding also keeps focused lower controls clear. Supported browser resize events refresh the measurement. Actual iPhone/Safari, large-text, low-height and intended-person voice acceptance remain separate live checks.

Both layouts use the same ClientHome state, voice handle, server permissions and durable records. Layout is selected once when the client mounts. A URL edit does not rearrange an active conversation. Use review/current links between conversations. Legitimate care records saved during a Focus trial remain saved when returning to Current.

Only one exact `layout=focus` query selects Focus, and only when the entry page contains `<meta name="nancy-focus-review" content="enabled">`. Missing, disabled, unknown or repeated selections resolve to Current. This is a presentation switch, never an authorization mechanism; ordinary sign-in and role/account checks still apply. No preference is saved in local storage, so opening the normal URL always returns to Current.

To disable the experiment without rebuilding, change that meta element's content to `disabled` in the deployed `dist/client/index.html`. Newly loaded review links then display Current. Existing pages retain their chosen layout until reloaded, so a conversation is not interrupted by the switch. Preserve that choice on subsequent builds if the experiment is to stay disabled.

## Preserved Current version

The ignored `.local/ui-rollback/current-2026-10-19/` restore point contains the actual public source at preservation time, the production client files, and a SHA-256 manifest. It excludes `.local` runtime files, credentials, databases, personal care records, logs, node_modules and Git internals. The preserved client bundle is `app-aAOMdFqm.js`.

An isolated restore copies every recorded source/build file and verifies its hash. Rebuilding from the restored source produces byte-identical HTML, JavaScript and CSS. The same rollback command used for production was exercised against an isolated target, then against the actual client build while Current was still live; the restored entry and browser rendering were verified before publishing Focus. Deliberately changed disposable files and an unsafe target were refused. Private results are `.local/probes/focus-ui-baseline.json` and `.local/probes/focus-ui-rollback-negative.json`; screenshots and all private runtime checks remain outside the public repository.

Verify the restore point from the repository root:

```powershell
pwsh -NoProfile -File ./scripts/restore-client-ui.ps1 -SnapshotPath .local/ui-rollback/current-2026-10-19 -VerifyOnly
```

Restore the exact saved Current build when no client conversation is active:

```powershell
pwsh -NoProfile -File ./scripts/restore-client-ui.ps1 -SnapshotPath .local/ui-rollback/current-2026-10-19
```

The command validates manifest paths and file hashes, rejects targets outside the client build or isolated drill directories, backs up the previous live entry page, publishes assets before the entry page and verifies each restored file. It does not delete assets, restart services, restore a database or modify account/credential configuration. Reloading picks up the saved Current entry page. Old loaded pages continue until reload. This restore is qualified against the unchanged current backend; later API/schema changes require rechecking compatibility before reusing it. Restoring the saved source for future development is a separate deliberate engineering operation; do not overwrite the current dirty workspace as a UI rollback.

## Scope of acceptance

The first experiment is the persistent centered control and concise status. New touch confirmation workflows, voice timing changes, navigation redesign and a different default are not part of this increment. No model request or microphone activation is needed for layout inspection. Synthetic tests and desktop browser checks establish engineering behaviour; the intended client's actual-device usability remains `awaiting_live_test`.

The design rationale uses [W3C consistent visual design](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o1p03-consistent-design/), [cognitive accessibility feedback](https://www.w3.org/TR/coga-usable/#provide-feedback-pattern), [enhanced target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html) and [focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html). These support predictable controls and readable feedback; they do not establish this particular placement as optimal for every diagnosis or prove WCAG conformance.

The subsequent narrow-window review found an inherited alignment rule at 639px. Focus now explicitly centers its action group with automatic inline margins. Final live checks at 639px and 1280px measure zero horizontal center error; the 56px button stays stationary during scrolling and footer controls remain clear. These desktop widths are not a physical iPhone/Safari acceptance result.
