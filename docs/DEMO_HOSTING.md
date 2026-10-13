# Local demo hosting

Updated 2026-10-13. Nancy now runs under the **Nancy Local Demo** Windows scheduled task. The app and speech workers recover after a process failure; the supervisor restarts the existing local PostgreSQL instance if it stops. Windows retries the supervisor every minute and launches it when the configured user signs in. These scripts do not create users, seed care data, change inference credentials or run database migrations.

The approved stable HTTPS route is Tailscale Funnel on port 8443, using the already connected host. Its machine address is stored only in ignored `.local/runtime/demo-host.json`. The existing port 443 service is preserved. **The owner explicitly approved this public destination on October 13. Tailscale account sign-in and one-time Funnel activation are now pending; no new public route is active yet.** The current app remains at `http://localhost:8787`.

Tailscale Funnel can retain its HTTPS address and configuration when started with `--bg`; its certificate is managed by Tailscale. This uses the installed service and requires no domain purchase or new paid subscription. [Funnel CLI and restart behavior](https://tailscale.com/docs/reference/tailscale-cli/funnel). Account policy, public reachability and HTTPS authentication must still pass before this candidate is advertised as live.

## Current operating boundary

- Keep this computer powered on and connected. Idle sleep is currently disabled; closing the lid, manually sleeping, shutting down or losing internet can still interrupt the demo.
- After a reboot, sign into the configured Windows account. This installation is a user-logon deployment; operation before Windows sign-in and Tailscale unattended service mode have not been configured or tested.
- The task retries a stopped supervisor every minute. The supervisor checks app health and database process state every five seconds; HTTP startup receives a 60-second grace period. Recovery is best effort, not an uptime guarantee.
- No reboot, locked-iPhone audio, closed-browser listening or actual participant acceptance is implied. Nancy's owner-only inference restriction remains in place.
- Login and role permissions remain mandatory. The Cloudflare-specific client-IP trust setting is disabled by this supervisor. Without a separately qualified proxy identity, public logins share the loopback rate-limit bucket.

## Private configuration and controls

The only required field in `.local/runtime/demo-host.json` is `origin`, an exact HTTPS origin (or `http://localhost:8787` for local operation). The supervisor supplies it as `PUBLIC_ORIGIN`; it overrides historical temporary-tunnel settings in `.env.local`. The established `.env.local` and `.local/runtime/local-care.env` continue to supply private service/database settings. No credentials belong in the host file or public repository.

Install or refresh startup with:

```powershell
pwsh -NoProfile -File scripts/install-local-demo.ps1
```

The installer launches hidden PowerShell under the current user's existing, limited Windows token. It requires no stored Windows password. First stop any identified manually launched Nancy process; the supervisor refuses to replace an unrelated process using port 8787. It identifies its own orphan processes using the exact executable and a unique launch marker, so a stale PID is insufficient authority to stop a process.

Check `.local/runtime/demo-supervisor.json` for state, last check time, process IDs and restart count. Process logs are `.local/runtime/demo-app.stdout.log` and `demo-app.stderr.log`, retained for five launches. PostgreSQL startup logging stays local. The application's bounded numeric database telemetry remains the primary operational record; do not add transcripts, audio or credentials to logs.

Remove the scheduled task with `pwsh -NoProfile -File scripts/install-local-demo.ps1 -Uninstall`. This preserves database files and does not change ingress configuration. Do not run another manual `npm start` while supervision is active.

## HTTPS activation checklist

1. Destination approval is complete: the owner explicitly approved the prepared public hostname/port on October 13. Complete the existing provider account sign-in and one-time Funnel activation. Do not ask again for the same publication approval.
2. Set the private host configuration to the approved HTTPS origin and restart the supervised app. Preserve the independent service on port 443.
3. Enable only the approved port with `tailscale funnel --bg --https=8443 http://127.0.0.1:8787`. Never use a global Funnel reset, which could affect other services.
4. Verify public DNS and reachability from outside the tailnet, valid TLS, secure session cookies, unauthorized access denial, wrong-origin denial, logout revocation and Heart audio delivery. A successful test through the private tailnet alone is insufficient public evidence.
5. Check the same address after app recovery, update private address records, then perform the intended iPhone/Safari acceptance tests. Each future connector must use an explicitly registered redirect URI matching its deployed route.

See [sanitized deployment evidence](evidence/DEMO-HOSTING-2026-10-13.json). The local recovery checks passed; public HTTPS, reboot and physical-device checks remain pending. No slice or human acceptance gate has been marked complete.
