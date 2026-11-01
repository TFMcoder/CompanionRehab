# Public hosting recheck — October 28, 2026

Dad's existing public HTTPS address is recovered and the deployed release passes readiness checks for the requested **October 29** test. The source remains `device-latency-2026-10-27`, revision `sha256:76dd59157ceb92f71e58bd79b0d3e695f584a43bd620e80e31664675ff77ff93`. The owner remains on `outlook-speech-2026-10-26`. Neither application was restarted or changed during this recheck.

The user reported restarting Windows and signing back in. Fresh checks initially still found Tailscale in `NoState`/starting, with a coordination-server synchronization warning. Both Nancy backends were already configured and voice-ready. The Tailscale desktop helper was not running. After launching the existing desktop app using the computer-use skill, CLI checks reported `Running`, the exact original machine name online and no health errors. This sequence is observed recovery evidence, not proof that every future reboot will recover automatically.

No new account, sign-in, consent, software installation, credential copying or unattended mode was introduced. The existing forwarding routes on 443, 8443 and 10000 returned intact. No routing reset or reconfiguration was needed. The earlier empty route result while Tailscale was uninitialized did not establish that its saved routes were erased.

## Public verification

The probe resolved the original hostname through public DNS and connected directly to public Funnel addresses, retaining the original HTTPS hostname/SNI/Host and normal certificate validation. It did not count private MagicDNS access as public success.

Both resolved public addresses pass the final TLS, HTTP 200, configured-client and native-voice-readiness checks. An authenticated probe through a verified public address passes **12 checks over six HTTP requests**: pinned Current HTML, running release, native speech readiness, existing client login, exact actor/client/account/host scope, selected Sol-low/warm-v2/Outlook/speech-priority policy, authorized Today and truthful Outlook status. Outlook reports **connected**. The single new engineering login is closed.

The probe excludes `/api/auth/session`, conversation endpoints and browser JavaScript, so it does not trigger meal/chat preparation or activate a microphone. Numeric runtime-event auditing finds zero new conversation events in either database since the readiness baseline, with **zero reasoning requests, care/provider writes or API billing**. No historical request ledger was reopened.

## Reliability limit

One public edge initially reset TLS while the other worked. Subsequent checks passed on both public addresses. The first probe also tried to inspect a response socket after it had closed; capturing TLS authorization before response completion corrected that private harness error without an application change.

At inspection, [Tailscale's official status page](https://status.tailscale.com/) reported an ongoing Funnel public-DNS incident. Our public DNS resolved successfully, and the initial failure was during TLS; the provider incident has **not** been proved to cause that reset. Both addresses currently pass, but overnight provider availability is not guaranteed. Keep this computer powered on, awake, connected and signed into Windows with Tailscale running for the test. This does not qualify unattended startup before Windows login.

## Preservation and remaining acceptance

All **1,478 protected files**, **64 client and 67 owner care-table hashes**, and **160 original login sessions** are unchanged against the fresh baseline. The one new engineering session is closed. Both actual process/parent/listener identities, release pointers, selected settings, account binding, Heart, locked Current assets and old dependency cache remain unchanged.

The prior **1,589 tests/two optional skips**, typecheck and build evidence applies to the same unchanged application revision; those checks were not rerun for a hosting-only observation. The generated human-action view, roadmap and public-boundary scan are checked separately. No full slice or human action is completed by this recheck.

The actual intended-person microphone, human-audible Heart, iPhone/Safari Wi-Fi/cellular responsiveness, genuine-day approval and full S01/S06 gates remain `awaiting_live_test`. The earlier cold tail and real-mailbox latency are not measured by this readiness probe. The [sanitized evidence](evidence/HOSTING-RECHECK-2026-10-28.json) retains private references. The [October 27 rollout](CLIENT_LATENCY_ROLLOUT_2026-10-27.md) remains historical evidence; its hosting blocker is superseded by this recheck.
