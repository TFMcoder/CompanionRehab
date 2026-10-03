# Connect S01: Nancy's daily task and meal plan

**Superseded deployment instructions — October 3, 2026:** Initial care data must now stay on this machine, and Nancy must use GPT-6 Sol with high reasoning behind a separate speech layer. The sections below document the September 29 Supabase/Realtime baseline only; do not provision Supabase cloud or retain real participant data by following this old sequence. S01 is in progress, pending local PostgreSQL/auth, role/navigation and model adaptation. See [the current decisions](architecture/PRODUCT_DECISIONS_2026-10-03.md) and [canonical roadmap](roadmap/roadmap.json). The executing agent must replace this runbook with verified local deployment steps before live use.

The project owner is the administrator and technical lead. Initial hosting and the exact reasoning model are already decided; only actual missing private provider/HTTPS access, device participation and the remaining real-data boundary need human input. Routine installation, configuration and verification remain engineering work.

## Historical baseline reference

The baseline is implemented locally but depends on cloud authentication/storage. A real device conversation and live acceptance have not run. The app does not pretend to be connected when configuration is missing.

## Run locally

Use Node 24+ and PowerShell 7.4+. From the repository root:

```powershell
npm ci
npm run check
npm start
```

Open `http://localhost:8787`. `npm start` serves the built UI and authenticated API on loopback. Run `npm run build` again after UI edits; `npm run dev` watches backend edits. Never expose the Vite development server through a public tunnel.

`.env.example` lists configuration names. An ignored `.env.local` has been prepared on this computer with independent random session and backup encryption keys; their values are not in this document. On a different computer, copy the example and generate separate 32-byte base64 keys. Preserve the session key across restarts. Back up the backup key separately from encrypted exports; losing it makes those exports unrecoverable. Keep the local disk/account protected and do not commit `.local`, `.env.local`, provider keys or exported records.

`npm run readiness` prints only missing configuration names. `npm run readiness -- --connect` additionally performs a read-only Supabase Auth reachability request. Neither command constitutes live acceptance. No model call is made by readiness or automated tests.

## Free service connection sequence

1. Reuse an available Supabase Free project after checking the account's free-project quota. For disposable tests choose a dedicated project. Canada Central (`ca-central-1`) is an available database option, subject to account capacity. For retained participant data, resolve S01-H03's processing/storage decision first. Apply `db/001_s01.sql` once using the private project SQL editor as database owner. It is a fresh-schema migration, not an idempotent reset script.
2. Disable public signup. Create/invite the explicitly authorized test accounts through Supabase's administrative setup. Use two disposable users for denied-access tests. Initial setup creates only the authenticated user's own participant grant. A revoked grant cannot be recreated by that user. S01 has no caregiver impersonation or administration UI; authenticated participants maintain their own ordinary task/meal choices. Deliver actual invitations/password setup through the account's approved private flow; do not put passwords in shell history or fixtures. Configure an existing sender or a free SMTP sender when real invite/recovery email is required. Auth-email recovery delivery must be verified before routine reliance.
3. Put the project URL and **publishable** key into `.env.local`. The runtime accepts user JWTs with the public key; it rejects known secret/service-role keys. It never receives the administrative migration or backup credential as its database client. The `private` schema must remain outside Supabase's exposed Data API schemas. Public RPC wrappers authorize each call by `auth.uid()` and an active grant; all underlying tables deny runtime direct access.
4. Put the existing project's OpenAI API key into `.env.local`. The configured initial model is `gpt-realtime-mini` with input transcription `gpt-4o-mini-transcribe`. Availability, voice quality and account spending must be verified in the live test. The browser sends microphone audio to OpenAI using WebRTC; the local backend controls function calls through a server WebSocket and keeps the standard API key private. The page states that Nancy is an AI voice companion before microphone use.
5. Reuse an existing Cloudflare domain and a named tunnel. Route only the public Nancy hostname to `http://127.0.0.1:8787`; the example is `ops/cloudflared.example.yml`. Set its Host header and `PUBLIC_ORIGIN` to that exact hostname/origin and restart the app. Preserve application authentication, bypass caching for Nancy, and use the built assets. The app denies other hosts and cross-origin writes. No router port forwarding or paid tunnel add-on is required by this design. If there is no suitable domain, choose a supported free test route or prepare an exact domain quote before any purchase.
6. Run S01-LIVE2 first with disposable accounts. After it passes, resolve the real-data boundary and run S01-LIVE1 on the actual participant device at the intended 10 AM check-in.

These are agent-executable setup steps once access exists. Only account ownership/MFA, missing household choices, participant consent and actual speaking/listening require the human. Do not delegate migration, debugging or verification back to the account owner as routine chores.

## Exact user flow

Sign in → supply the participant name, local timezone, real tasks and practical meal options → begin today's check-in → talk to Nancy or choose by touch → save a proposal for review → hear/read the proposal → explicitly accept it → retrieve or revise it. Changing options does not replace an accepted plan; a revised proposal needs fresh acceptance. Plans do not mean tasks were completed or meals eaten; reporting arrives in S02.

For voice acceptance, wait for the complete review and say **“Nancy, accept this plan.”** The server binds the proposal/revision to that readout, successful audio-response completion, drained audio buffer and subsequent microphone transcription. Interrupted reviews and ambiguous assent cannot pass that guard. The transcript is advisory and held in browser/session memory; raw audio/transcripts are not saved by this application. A successful provider buffer drain does not prove that a device speaker was audible; that remains a live usability check. Touch is available when speech recognition is difficult.

Stop releases the microphone and ends the call; it cannot undo an already committed command. On an unconfirmed save use **Check saved plan**. Receipt lookup never replays the write. This slice keeps uncertain command state in the current view, while a browser reload reads committed cloud state. Persistent offline/pending queues remain S03.

## Data boundary proposed for review

The proposed first retained trial uses one consenting participant, ordinary household tasks and meals, self-only access, a Canada Central database if available, and supervised local operation. The database retains profiles, scoped grants, choices, day/check-in IDs, immutable accepted versions, receipts and events. It stores no raw audio or transcript. Cloudflare terminates routed HTTPS; Supabase handles identity/data; OpenAI receives voice and the current scoped planning context. A Canadian database does not establish Canadian AI processing. Account-specific provider retention and eligibility still need review.

For the first supervised trial, review the retained care records after seven days and decide the ongoing retention period before expanding use. This is a proposal awaiting S01-H03; no automatic deletion or consent is assumed. Keep consent and detailed live evidence privately, with only sanitized references in the public roadmap. Clinical diet instructions remain out of scope until the authorized protocol owner supplies approved constraints.

## Backup and isolated restore

`npm run backup` is an administrative CLI, separate from the runtime. Set `BACKUP_DATABASE_URL` privately using a TLS database-owner connection and keep `BACKUP_KEY` outside the repository. The export reads all nine care tables in a consistent transaction and writes AES-256-GCM encrypted bytes; it refuses to overwrite a file. PostgreSQL credentials are never printed by the CLI.

```powershell
npm run backup -- export .local/backups/disposable-test.nancy
```

Use a separate empty disposable database with the same migration, set `RESTORE_DATABASE_URL` and `RESTORE_TARGET=isolated-disposable` privately, then run:

```powershell
npm run backup -- restore .local/backups/disposable-test.nancy
```

Restore refuses a matching source identity or a nonempty care schema, validates the schema revision, locks all destination tables, and commits all inserts together. Tampering/wrong keys fail authentication. The backup covers care tables, including grants, plan history and receipts. **It does not back up Supabase Auth users, project/provider settings, secrets, email configuration or the local revoked-session file.** Recovery needs those separately; restored actor UUIDs must be mapped to the same authorized Auth identities before use. Copy encrypted backups to separate existing protected storage; a backup only on the running computer is not disaster recovery. Production restoration/cutover is not automated by this disposable-target command.

## Cost and operating limits

No paid service commitment has been made. The initial plan uses local compute plus eligible free database/auth/tunnel tiers and an existing domain/sender/storage. Account eligibility and existing expenses are still unknown; therefore $0 is the planned incremental subscription cost, not a verified total household bill. Plan conservatively in CAD within the $50 ceiling, excluding GPT usage. Ask for currency/approval only before a concrete paid commitment.

Voice is user-started, one active call per participant, at most ten minutes per call and two full-call reservations per UTC day by default. Reservations are conservative, memory based and reset after API restart; they are **not** an account spending cap. Set provider project budgets/alerts and review actual usage. The local computer must be awake and online for routed use. Supabase Free may pause after inactivity and does not provide the required independent backup proof by itself. Daily reliance remains gated by S03's operating arrangement.

## Source references checked during implementation

- [Supabase regions](https://supabase.com/docs/guides/platform/regions), [API keys](https://supabase.com/docs/guides/api/api-keys), [database functions](https://supabase.com/docs/guides/database/functions), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
- [OpenAI WebRTC setup](https://developers.openai.com/api/docs/guides/voice-webrtc), [server controls](https://developers.openai.com/api/docs/guides/voice-server-controls), [Realtime conversations/events](https://developers.openai.com/api/docs/guides/realtime-conversations), [configured mini model](https://developers.openai.com/api/docs/models/gpt-realtime-mini).
- [Cloudflare named tunnel setup](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/create-local-tunnel/), [tunnel origin configuration](https://developers.cloudflare.com/tunnel/configuration/).
