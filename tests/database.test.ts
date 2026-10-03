import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { randomBytes } from "node:crypto";
import { backupTables, decryptSnapshot, encryptSnapshot, exportSnapshot, restoreSnapshot } from "../src/server/backup.js";

const migration = readFileSync(fileURLToPath(new URL("../db/001_s01.sql", import.meta.url)), "utf8");
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const key = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let db: PGlite;
async function freshDatabase() {
  const instance = new PGlite();
  await instance.exec(`create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;`);
  await instance.exec(migration);
  return instance;
}
async function actor(uid: string | null, role = "authenticated") {
  await db.exec(`reset role; set role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid ?? ""]);
}
async function rpc(name: string, value?: unknown) {
  const sql = value === undefined ? `select public.${name}() as value` : `select public.${name}($1::jsonb) as value`;
  const result = value === undefined ? await db.query<{ value: any }>(sql) : await db.query<{ value: any }>(sql, [JSON.stringify(value)]);
  return result.rows[0].value;
}
async function today() { return rpc("nancy_today"); }
async function setup(uid = alice) {
  await actor(uid);
  return rpc("nancy_setup", {
    display_name: "Test Person", time_zone: "Pacific/Kiritimati", expected_revision: 0,
    preferences: "Ordinary meals", tasks: [{ title: "Walk", time_hint: "morning" }, { title: "Call", time_hint: null }],
    meal_options: [
      { name: "Oats", slots: ["breakfast"] },
      { name: "Soup", slots: ["lunch"] },
      { name: "Rice", slots: ["dinner"] },
    ],
  });
}
function command(type: string, local_date: string, expected_revision: number, payload: unknown, n: number) {
  return { type, idempotency_key: key(n), local_date, expected_revision, payload };
}
function choices(state: any) {
  return { task_ids: state.tasks.map((t: any) => t.id), meals: ["breakfast", "lunch", "dinner"].map(slot => ({ slot, option_id: state.meal_options.find((o: any) => o.slots.includes(slot)).id })) };
}

beforeEach(async () => {
  db = await freshDatabase();
});
afterEach(async () => { await db.close(); });

describe("S01 database RPCs", () => {
  it("serializes two competing requests at the same revision with one committed proposal", async () => {
    const initial = await setup();
    await rpc('nancy_command', command('start_or_resume_checkin', initial.local_date, 0, {}, 501));
    const attempts = await Promise.allSettled([
      rpc('nancy_command', command('propose_day_plan', initial.local_date, 0, choices(initial), 502)),
      rpc('nancy_command', command('propose_day_plan', initial.local_date, 0, { ...choices(initial), task_ids: [] }, 503)),
    ]);
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await today()).checkin.revision).toBe(1);
    await db.exec('reset role');
    expect((await db.query('select * from private.day_plan_proposals')).rows).toHaveLength(1);
    expect((await db.query('select * from private.command_receipts')).rows).toHaveLength(2);
  });
  it("limits table and RPC grants while requiring an active participant grant", async () => {
    await actor(alice, "anon");
    await expect(today()).rejects.toThrow();
    await actor(alice);
    await expect(db.query("select * from private.participant_profiles")).rejects.toThrow();
    await expect(rpc("nancy_command", {})).rejects.toThrow();
    await setup();
    const state = await today();
    expect(state.profile.id).toBe(alice);
    await actor(bob);
    expect((await today()).profile).toBeNull();
    await actor(alice);
    await db.exec("reset role");
    await db.query("update private.role_grants set revoked_at=now() where participant_id=$1", [alice]);
    await actor(alice);
    await expect(today()).rejects.toThrow(/revoked/);
    await expect(rpc("nancy_setup", { bad: true })).rejects.toThrow(/revoked/);
    await expect(db.query("select public.nancy_receipt($1::uuid)", [key(1)])).rejects.toThrow(/revoked/);
  });

  it("commits proposal, immutable acceptance, receipt and events; rejects stale and changed replay", async () => {
    const initial = await setup();
    const start = command("start_or_resume_checkin", initial.local_date, 0, {}, 1);
    const started = await rpc("nancy_command", start);
    expect(started.revision).toBe(0);
    expect((await rpc("nancy_command", start)).replayed).toBe(true);
    const proposalCommand = command("propose_day_plan", initial.local_date, 0, choices(initial), 2);
    const proposed = await rpc("nancy_command", proposalCommand);
    expect(proposed.result).toBe("proposed");
    expect((await today()).checkin.accepted).toBeNull();
    await expect(rpc("nancy_command", { ...proposalCommand, payload: { ...(proposalCommand.payload as object), task_ids: [] } })).rejects.toThrow(/Idempotency/);
    await expect(rpc("nancy_command", command("propose_day_plan", initial.local_date, 0, choices(initial), 3))).rejects.toThrow(/Stale/);
    const accepted = await rpc("nancy_command", command("accept_day_plan", initial.local_date, 1, { proposal_id: proposed.plan.id }, 4));
    expect(accepted.plan.version).toBe(1);
    expect((await today()).checkin.accepted.id).toBe(proposed.plan.id);
    await expect(rpc("nancy_command", command("accept_day_plan", initial.local_date, 2, { proposal_id: proposed.plan.id }, 5))).rejects.toThrow(/already accepted/);
    const revised = await rpc("nancy_command", command("revise_day_plan", initial.local_date, 2, { ...choices(initial), task_ids: [] }, 6));
    expect(revised.plan.task_ids).toEqual([]);
    expect((await today()).checkin.accepted.version).toBe(1);
    await rpc("nancy_command", command("accept_day_plan", initial.local_date, 3, { proposal_id: revised.plan.id }, 7));
    await db.exec("reset role");
    const history = await db.query<{ version: number }>("select version from private.accepted_day_plan_versions order by version");
    expect(history.rows.map(r => r.version)).toEqual([1, 2]);
    await expect(db.query("update private.accepted_day_plan_versions set version=99 where version=1")).rejects.toThrow(/append only/);
    expect((await db.query("select * from private.command_receipts")).rows).toHaveLength(5);
    expect((await db.query("select * from private.domain_events where event_type like 'DayPlan%'")).rows).toHaveLength(4);
  });

  it("rejects malformed, unknown, cross-owner and stale-setup writes without partial state", async () => {
    const a = await setup();
    await rpc("nancy_command", command("start_or_resume_checkin", a.local_date, 0, {}, 10));
    const bad = [
      { ...choices(a), extra: true },
      { ...choices(a), task_ids: [a.tasks[0].id, a.tasks[0].id] },
      { ...choices(a), task_ids: [bob] },
      { ...choices(a), meals: choices(a).meals.map((m, i) => i === 0 ? { ...m, option_id: bob } : m) },
    ];
    for (let i = 0; i < bad.length; i++) {
      await expect(rpc("nancy_command", command("propose_day_plan", a.local_date, 0, bad[i], 11 + i))).rejects.toThrow();
    }
    await expect(rpc("nancy_command", command("propose_day_plan", "2000-01-01", 0, choices(a), 20))).rejects.toThrow(/local date/);
    const proposed = await rpc("nancy_command", command("propose_day_plan", a.local_date, 0, choices(a), 21));
    await actor(bob);
    const b = await setup(bob);
    await rpc("nancy_command", command("start_or_resume_checkin", b.local_date, 0, {}, 22));
    await expect(rpc("nancy_command", command("propose_day_plan", b.local_date, 0, { ...choices(b), task_ids: [a.tasks[0].id] }, 25))).rejects.toThrow(/Unknown or inactive task/);
    await expect(rpc("nancy_command", command("accept_day_plan", b.local_date, 0, { proposal_id: proposed.plan.id }, 23))).rejects.toThrow(/proposal/);
    await actor(alice);
    await rpc("nancy_setup", { display_name: "Updated", time_zone: a.profile.time_zone, expected_revision: 1, preferences: a.profile.preferences, tasks: a.tasks, meal_options: a.meal_options });
    await expect(rpc("nancy_command", command("accept_day_plan", a.local_date, 1, { proposal_id: proposed.plan.id }, 24))).rejects.toThrow(/setup/);
    await db.exec("reset role");
    expect((await db.query("select * from private.command_receipts where participant_id=$1", [alice])).rows).toHaveLength(2);
    expect((await db.query("select * from private.domain_events where participant_id=$1", [alice])).rows).toHaveLength(4);
  });

  it("uses the profile time zone and denies duplicate or foreign setup IDs", async () => {
    const a = await setup();
    const expectedDate = new Intl.DateTimeFormat("en-CA", { timeZone: a.profile.time_zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    expect(a.local_date).toBe(expectedDate);
    await expect(rpc("nancy_setup", { display_name: "X", time_zone: a.profile.time_zone, expected_revision: 1, preferences: "", tasks: [a.tasks[0], a.tasks[0]], meal_options: a.meal_options })).rejects.toThrow(/Duplicate task ID/);
    await actor(bob);
    const b = await setup(bob);
    await expect(rpc("nancy_setup", { display_name: "B", time_zone: b.profile.time_zone, expected_revision: 1, preferences: "", tasks: [{ ...b.tasks[0], id: a.tasks[0].id }], meal_options: b.meal_options })).rejects.toThrow(/Unknown task ID/);
    await actor(alice);
    expect((await today()).profile.revision).toBe(1);
  });

  it("rejects explicit JSON nulls at every required command boundary", async () => {
    const a = await setup();
    const validSetup = { display_name: "Test Person", time_zone: a.profile.time_zone, expected_revision: 1,
      preferences: a.profile.preferences, tasks: a.tasks, meal_options: a.meal_options };
    for (const field of ["display_name", "time_zone", "expected_revision", "preferences", "tasks", "meal_options"]) {
      await expect(rpc("nancy_setup", { ...validSetup, [field]: null })).rejects.toThrow();
    }
    const validStart = command("start_or_resume_checkin", a.local_date, 0, {}, 40);
    for (const field of ["type", "idempotency_key", "local_date", "expected_revision", "payload"]) {
      await expect(rpc("nancy_command", { ...validStart, [field]: null })).rejects.toThrow();
    }
    await rpc("nancy_command", validStart);
    const validProposal = command("propose_day_plan", a.local_date, 0, choices(a), 41);
    for (const field of ["task_ids", "meals"]) {
      await expect(rpc("nancy_command", { ...validProposal, payload: { ...choices(a), [field]: null } })).rejects.toThrow();
    }
    await expect(rpc("nancy_command", { ...validProposal, payload: { ...choices(a), meals: [{ slot: null, option_id: a.meal_options[0].id }, ...choices(a).meals.slice(1)] } })).rejects.toThrow();
    await expect(rpc("nancy_command", command("accept_day_plan", a.local_date, 0, { proposal_id: null }, 42))).rejects.toThrow();
    await db.exec("reset role");
    expect((await db.query("select * from private.command_receipts")).rows).toHaveLength(1);
    expect((await db.query("select * from private.day_plan_proposals")).rows).toHaveLength(0);
    expect((await db.query<{ revision: number }>("select revision from private.participant_profiles")).rows[0].revision).toBe(1);
  });

  it("encrypts a full accepted history, restores it to an isolated target, and survives restart", async () => {
    const a = await setup();
    await rpc("nancy_command", command("start_or_resume_checkin", a.local_date, 0, {}, 50));
    const p1 = await rpc("nancy_command", command("propose_day_plan", a.local_date, 0, choices(a), 51));
    await rpc("nancy_command", command("accept_day_plan", a.local_date, 1, { proposal_id: p1.plan.id }, 52));
    const p2 = await rpc("nancy_command", command("revise_day_plan", a.local_date, 2, { ...choices(a), task_ids: [] }, 53));
    await rpc("nancy_command", command("accept_day_plan", a.local_date, 3, { proposal_id: p2.plan.id }, 54));
    await db.exec("reset role");
    const source = await exportSnapshot(db, "source-db");
    expect(backupTables.every(table => source.tables[table].length > 0)).toBe(true);
    const secret = randomBytes(32);
    const encrypted = encryptSnapshot(source, secret);
    expect(encrypted.includes(Buffer.from("Test Person"))).toBe(false);
    expect(() => decryptSnapshot(encrypted, randomBytes(32))).toThrow();
    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 1] ^= 1;
    expect(() => decryptSnapshot(tampered, secret)).toThrow();
    const decrypted = decryptSnapshot(encrypted, secret);
    const target = await freshDatabase();
    try {
      await expect(restoreSnapshot(target, decrypted, "source-db")).rejects.toThrow(/source database/);
      const damaged = structuredClone(decrypted);
      delete damaged.tables.command_receipts[0].result;
      await expect(restoreSnapshot(target, damaged, "isolated-db")).rejects.toThrow(/columns differ/);
      expect((await target.query("select * from private.participant_profiles")).rows).toHaveLength(0);
      await restoreSnapshot(target, decrypted, "isolated-db");
      const restored = await exportSnapshot(target, "isolated-db");
      expect(restored.tables).toEqual(source.tables);
      await expect(restoreSnapshot(target, decrypted, "isolated-db")).rejects.toThrow(/contains care data/);
      const dump = await target.dumpDataDir();
      await target.close();
      const reopened = new PGlite({ loadDataDir: dump });
      try {
        const again = await exportSnapshot(reopened, "isolated-db");
        expect(again.tables).toEqual(source.tables);
        await reopened.exec("set role authenticated");
        await reopened.query("select set_config('request.jwt.claim.sub', $1, false)", [alice]);
        const readback = await reopened.query<{ plan: any }>("select public.nancy_today() as plan");
        expect(readback.rows[0].plan.checkin.accepted.version).toBe(2);
        const receipt = await reopened.query<{ receipt: any }>("select public.nancy_receipt($1::uuid) as receipt", [key(52)]);
        expect(receipt.rows[0].receipt.plan.version).toBe(1);
      } finally { await reopened.close(); }
    } finally {
      try { await target.close(); } catch { /* May already be closed for restart. */ }
    }
  });
});
