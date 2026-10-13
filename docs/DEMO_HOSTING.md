# Local demo hosting

Updated 2026-10-13. Nancy now runs under the **Nancy Local Demo** Windows scheduled task. The app and speech workers recover after a process failure; the supervisor restarts the existing local PostgreSQL instance if it stops. Windows retries the supervisor every minute and launches it when the configured user signs in. These scripts do not create users, seed care data, change inference credentials or run database migrations.

**The stable HTTPS route is active and verified.** It uses Tailscale Funnel on port 8443 with background persistence. The owner approved the exact public destination, completed provider sign-in and enabled Funnel on October 13. Its machine address is stored only in ignored `.local/runtime/demo-host.json`; the existing port 443 service is preserved. Nancy's configured origin is now HTTPS, so use that address instead of the old localhost or temporary Cloudflare links.

Tailscale Funnel retains its configuration when started with `--bg`; its certificate is managed by Tailscale. This uses the installed service and required no domain purchase or new paid subscription. [Funnel CLI and restart behavior](https://tailscale.com/docs/reference/tailscale-cli/funnel). Nineteen public HTTPS checks passed, including valid TLS, scoped authentication, cookies, access/origin denial, revocation and Heart audio. The probe resolved public DNS and forced its connection to the public ingress IP, so this evidence does not depend on private tailnet access.

## Current operating boundary

- Keep this computer powered on and connected. Idle sleep is currently disabled; closing the lid, manually sleeping, shutting down or losing internet can still interrupt the demo.
- After a reboot, sign into the configured Windows account. This installation is a user-logon deployment; operation before Windows sign-in and Tailscale unattended service mode have not been configured or tested.
- The task retries a stopped supervisor every minute. The supervisor checks app health and database process state every five seconds; HTTP startup receives a 60-second grace period. Recovery is best effort, not an uptime guarantee.
- The owner shut down and restarted the computer during setup. Nancy HTTP, its database and Tailscale returned after sign-in. Speech initially failed because its libraries were on an absent external drive; that dependency is now installed on the internal drive and re-tested. A full reboot after this repair and public activation remains untested. Locked-iPhone audio, closed-browser listening and participant acceptance are not implied. Nancy's owner-only inference restriction remains in place.
- Login and role permissions remain mandatory. The Cloudflare-specific client-IP trust setting is disabled by this supervisor. Without a separately qualified proxy identity, public logins share the loopback rate-limit bucket.

## Private configuration and controls

The only required field in `.local/runtime/demo-host.json` is `origin`, an exact HTTPS origin (or `http://localhost:8787` for local operation). The supervisor supplies it as `PUBLIC_ORIGIN`; it overrides historical temporary-tunnel settings in `.env.local`. The established `.env.local` and `.local/runtime/local-care.env` continue to supply private service/database settings. No credentials belong in the host file or public repository.

GPU speech libraries now reside at `.local/speech/cuda-runtime/site-packages` on the internal drive. `scripts/setup-asr-cuda.ps1` defaults to this workspace-local path; the private `NANCY_ASR_CUDA_ROOT` setting points there. The pinned NVIDIA versions, Kokoro Heart voice and CUDA recognition mode are unchanged. A missing speech runtime can leave touch available while voice is unavailable: check `/api/config` voice readiness as well as HTTP before a demo.

Install or refresh startup with:

```powershell
pwsh -NoProfile -File scripts/install-local-demo.ps1
```

The installer launches hidden PowerShell under the current user's existing, limited Windows token. It requires no stored Windows password. First stop any identified manually launched Nancy process; the supervisor refuses to replace an unrelated process using port 8787. It identifies its own orphan processes using the exact executable and a unique launch marker, so a stale PID is insufficient authority to stop a process.

Check `.local/runtime/demo-supervisor.json` for state, last check time, process IDs and restart count. Process logs are `.local/runtime/demo-app.stdout.log` and `demo-app.stderr.log`, retained for five launches. PostgreSQL startup logging stays local. The application's bounded numeric database telemetry remains the primary operational record; do not add transcripts, audio or credentials to logs.

Remove the scheduled task with `pwsh -NoProfile -File scripts/install-local-demo.ps1 -Uninstall`. This preserves database files and does not change ingress configuration. Do not run another manual `npm start` while supervision is active.

## Verified activation and future changes

1. Destination approval, provider sign-in and one-time Funnel activation are complete. Do not repeat the same approval request.
2. The private host configuration and `.env.local` use the approved HTTPS origin. The independent service on port 443 is preserved.
3. The approved command is `tailscale funnel --bg --https=8443 http://127.0.0.1:8787`. This configuration is already active. Never use a global Funnel reset, which could affect other services.
4. Public DNS, TLS, login/cookies, denial/revocation and Heart checks passed. My Day was also verified in the browser. Sixteen further checks passed for generated-audio recognition, repository nutrition, account binding, numeric usage/logging and absence of invented activity.
5. The same HTTPS origin served before and after the app restart for the speech repair. Physical iPhone/Safari acceptance and a full post-repair reboot remain open. Each future connector must use an explicitly registered redirect URI matching its deployed route.

See [sanitized deployment evidence](evidence/DEMO-HOSTING-2026-10-13.json). Local recovery and public HTTPS engineering checks passed. This does not complete a feature slice, intended-account qualification or participant acceptance gate.
