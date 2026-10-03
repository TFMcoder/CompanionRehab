# S01 implementation interfaces

**Historical baseline — September 29 implementation.** The [October 3 decisions](PRODUCT_DECISIONS_2026-10-03.md) and canonical roadmap supersede hosting, role, task and model assumptions here. Adapt these contracts for local PostgreSQL/auth, four scoped roles, My Day navigation, meals as task occurrences with urgency/schedule, and GPT-6 Sol high with separate speech. The interfaces below remain a description of current code, not proof the new requirements are implemented.

Assistant name: Nancy. Read src/shared/contracts.ts. All /api routes same-origin, cookies HttpOnly; no browser API keys. Reestablish explicit file ownership when delegating implementation work; the earlier agent assignments are no longer a standing instruction.

## HTTP
- GET /api/config -> AppConfig (safe public readiness, no credentials)
- POST /api/auth/login {email,password} -> {ok:true}; encrypted HttpOnly session cookie set by server. No signup.
- GET /api/auth/session -> {authenticated:true} or 401
- POST /api/auth/logout {} -> {ok:true}
- GET /api/today -> Today
- POST /api/setup -> SetupInput; returns Today. This is a minimal self-profile/task/meal setup; no fixture seeding in live mode.
- POST /api/commands -> CareCommand; returns Receipt. Touch and voice share the same backend RPC.
- GET /api/receipts/:key -> Receipt or 404; use to reconcile unknown writes, never blind retry.
- POST /api/voice {sdp:string} -> {sdp:string,session_id:string}; backend creates OpenAI WebRTC call and attaches server sideband before returning. Parent supplies src/client/voice.ts separately. Parent will send frontend exact module signature.
- DELETE /api/voice/:session_id -> {ok:true}, owner checked.

Errors {error:{code:string,message:string}} with status. On timed-out command keep exact key and query receipt, don't announce saved. No actual reports/completion UI (S02).

## Database RPC
Supabase public wrapper functions (thin invoker calling fixed-path private definer functions) with explicit auth.uid checks; no service-role runtime key.
nancy_today() -> Today, read only, nullable profile/checkin if not set up.
nancy_setup(p_input jsonb) -> Today, strict validation, owner profile id=auth.uid(), checks expected_revision, assigns UUIDs when omitted, versions setup. Keep historical accepted copies. Reject unknown/duplicate provided IDs, no privilege escalation.
nancy_command(p_command jsonb) -> Receipt. Database independently validates all fields, types, sizes, IDs/dates; API validation is not authority. Scoped idempotency key actor+key stores exact original jsonb, replay same->original receipt, changed->conflict. Atomically state+receipt+event, lock participant first for concurrent initial starts. start returns existing participant/local-date checkin or creates revision0; start expects revision0 and no payload. Other commands require checkin today and exact revision, profile setup revision bound to proposal. propose/revise creates UUID proposal with selected tasks/captured names/options and increments checkin revision; accepted plan stays until explicit acceptance. accept exact current proposal id, reject stale setup/proposal/revision, snapshot version accepted immutable, event. Same accepted proposal may not accept twice under new key. All commands only participant current local_date (not arbitrary backdating).
nancy_receipt(p_key uuid) -> Receipt or null; actor scoped.
Tables in private schema, RLS enabled; no public/anon/authenticated direct table access; wrapper EXECUTE for authenticated only, private definer EXECUTE available only wrapper-required authenticated call with auth checks. PUBLIC execute revoked; fixed empty search_path. No broad imports.
Tests use @electric-sql/pglite disposable PostgreSQL + synthetic auth.uid shim; test role/grants, atomic receipt, stale/unknown/duplicate, immutable history, date check and setup-version mismatch. Test API with actual generated SQL, not a JS memory stand-in.
