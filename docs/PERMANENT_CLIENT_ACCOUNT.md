# Permanent client account transition

**October 17 activation:** The owner explicitly approved the transition for UI/Outlook testing. It is applied: a distinct client actor retains the existing participant/history; the owner account retains its credentials and now has administrator access, with prior client sessions revoked. A fresh encrypted backup, exact re-review and 27 preservation/configuration checks passed. The current stopping point is manual client sign-in; personal inference qualification remains open. See [activation evidence](evidence/MICROSOFT-CLIENT-ACTIVATION-2026-10-17.json). Do not create a second client or rotate the protected login to repeat this step.

The client’s CompanionRehab login, participant profile and care history are independent of the reasoning provider. The October 14 decision retains the existing owner-bound Pro connection. A future qualified GPT connection can change the inference binding without copying care records or renaming historical actors.

The current practice login must not be relabelled as the intended client. `scripts/provision-client-account.ts` prepares a distinct actor attached to the existing participant. It preserves meals, tasks, accepted plans, corrections and their original actor attribution. It does not qualify a reasoning account or add sharing permissions.

## Review the transition privately

Create an explicit request in ignored `.local/provisioning/`. It contains a fresh operation UUID, the existing participant and practice actor IDs, a fresh client actor UUID, the desired local login email, the practice actor’s reviewed subsequent role (`none`, `family_friend` or `administrator`), and private authorization and encrypted-backup references. A local login identifier need not be an external email account; no email is sent.

Run:

```powershell
npx tsx scripts/provision-client-account.ts review .local/provisioning/request.json
```

The read-only result is saved privately and includes a digest of the exact access transition and preservation counts. Review it before applying. Changed grants, accounts, sessions, profile revisions or care counts invalidate the review. Ambiguous existing client grants or unreviewed additional roles cause a refusal.

The apply command uses that exact digest:

```powershell
npx tsx scripts/provision-client-account.ts apply .local/provisioning/request.json REVIEW_DIGEST
```

It stages an encrypted generated login before the transaction, creates the new client actor, retires the practice actor’s client grant, revokes its existing participant sessions and optionally grants the reviewed subsequent role. It writes a durable provisioning event. Repeating the same operation recovers its result and original protected login; it does not rotate the password or create another actor. No care rows are copied, relabelled or seeded.

## Deployment decision

Applying this transition changes which actor can use My Day as the client. Keep it separate from the application code deployment and additive database migration. Retaining the owner’s Pro connection does not automatically qualify the new actor’s direct reasoning route. Do not apply the transition merely to make a readiness check green, or remove the inference binding to compensate.

After activation, privately deliver the generated credentials to the intended user, verify their authenticated meal/task save and readback, and qualify their explicit reasoning route before describing direct Nancy conversation as ready. Keep credentials, identifiers, care counts, backup keys and full review evidence outside this public repository. The slice’s genuine-user and actual-device acceptance gates remain applicable.
