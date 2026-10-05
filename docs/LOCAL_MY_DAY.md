# Local My Day workflow

The October 5 implementation connects the client workflow to a local PostgreSQL care service, the app-specific ChatGPT connection (`gpt-6-sol`, high reasoning), faster-whisper small.en input and the selected Kokoro Heart output. It adds no paid service. This is a supervised development pilot; S01's actual participant/iPhone acceptance is still open.

## What is working

- Talk to Nancy starts with an open question and fresh participant-local suggestions. The 08:00–11:00 morning window includes breakfast, planning and existing approved exercise/rehab tasks; nearby appointments take precedence. Unknown completion remains unknown.
- My Day, Tasks, Meals and Groceries remain available by buttons. Changing these views preserves the active conversation. Supported voice navigation uses the same destinations.
- The person can choose saved meals and tasks, propose urgency/time/duration changes, hear the exact proposal, and explicitly accept it after playback. Touch uses the same versioned commands. A proposal or accepted plan never means a task was performed or a meal eaten.
- Confirmed missing ingredients enter the grocery list. Manual appointments use the participant's time zone. Uncertain grocery/appointment retries preserve the original request key.
- Heart reads coherent chunks, with one next chunk prepared while the current chunk plays. Microphone audio is sent to the local server only during an explicitly started session. This build uses half-duplex turns: listening resumes after Nancy finishes speaking. End releases the microphone and discards late replies. Silence endpointing is initially 1.2 seconds; inactivity closes after 30 seconds plus 10 seconds of grace, excluding thinking/speaking time.
- Local passwords use salted scrypt. Encrypted session cookies bind server-side sessions and explicit participant grants. Four role names are stored, but this increment exposes care actions only to the client role. Broader administrator, Support Team and Clinician Partners experiences are not claimed complete.

## Local operation

Runtime secrets, local data, downloaded binaries and weights stay under ignored `.local/` paths. The existing app-specific OAuth credential is encrypted with `SESSION_KEY` from `.env.local`. Do not print, copy into Git, or send these files to another service.

1. Start the existing PostgreSQL cluster if it is stopped:
   `& .local/postgres/pgsql/bin/pg_ctl.exe -D .local/postgres/data -l .local/postgres/server.log start`
2. Run `npm run build`, then `npm start`. The app binds loopback. Its allowed browser address is `PUBLIC_ORIGIN`; after the approved HTTPS trial setup, use the current `origin` in `.local/runtime/my-day.json` rather than the earlier localhost URL. The local speech workers warm in the background.
3. The initial practice account's credentials are in `.local/runtime/owner-pilot-login.txt`. The practice account contains synthetic tasks and meals only. Its care account is explicitly bound to the owner's existing ChatGPT connection with `NANCY_PLAN_USER_ID`; this does not authorize sharing that plan with another person.
4. Keep the computer awake and the server processes running during a supervised trial. No boot service, unattended daily operation or stable public hostname is configured by this increment.

`scripts/local-care-migrate.ts` creates/migrates the local development and disposable test databases. `scripts/local-care-pilot.ts` creates the labeled practice profile once and refuses to overwrite an existing account. Neither script is a public account-provisioning route. Runtime defaults read `.env.local`, followed by `.local/runtime/local-care.env`; explicit process environment variables take precedence.

The PostgreSQL 17.11 portable archive came from the EDB binary link on the [PostgreSQL Windows download page](https://www.postgresql.org/download/windows/). The observed archive SHA-256 is `80379b2c04d51c30225532e0ae04509899141e9957ed096fe749d7fd9df8f82f`. This is a download fingerprint, not an independently published signature. The cluster listens on `127.0.0.1:55432` with SCRAM password authentication. Its database, role and task schemas are isolated from Cerberus.

## Verification and remaining work

Run `npm run check` for the automated checks. Run `scripts/check-my-day-live.ts` against the running local app only for the explicitly labeled synthetic owner profile. It checks real Sol tool use, Heart output, generated-audio ASR acceptance, exact proposal commitment, replay and sign-in readback. It does not simulate a person speaking into an iPhone or prove audible playback on Safari.

Encrypted care backups now support `BACKUP_SCHEMA=companion_local` using `npm run backup`. Configure a separate private `BACKUP_KEY` and administrative `BACKUP_DATABASE_URL`. Local snapshots include account email and salted password hashes, care records, plan versions, receipts and events. They exclude active sessions and OAuth credentials. Restore requires an empty separately identified database, `RESTORE_DATABASE_URL` and `RESTORE_TARGET=isolated-disposable`; the schema must already be applied. Keep the backup key separate from the backup. A restore test does not establish a recurring backup schedule.

Still required before calling S01 complete: actual iPhone microphone/audible/latency acceptance, intended participant ChatGPT eligibility and account binding, consent and real setup, stable HTTPS operation, foreground wake consent/implementation, further ordinary meal/pantry/portion workflows, meal task-occurrence identity integration, and the remaining failure/renewal/revocation acceptance cases. Actual activity logging is S02. Outlook/Asana integration, automatic reminders, protocol guidance and dashboards remain in their assigned later slices.

The owner explicitly approved temporary public exposure of this password-protected sample-data app after the initial automatic approval rejection. The current Cloudflare Quick Tunnel URL and verified process IDs are saved in `.local/runtime/my-day.json` and `.local/runtime/my-day-tunnel.json`; the private login file also includes the URL. [HTTPS evidence](evidence/S01-MY-DAY-HTTPS-2026-10-05.json) records authenticated readback, denial without sign-in, session revocation and Heart greeting delivery. This URL depends on the current tunnel process and computer staying online; it is not a stable deployment. Recreating the tunnel requires updating `PUBLIC_ORIGIN` and restarting the app. The earlier sample-only preview remains separate.
