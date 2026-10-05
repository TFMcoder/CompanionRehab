import { describe, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../src/server/app.js';
import { configFromEnv } from '../src/server/config.js';
import { SessionRevocations } from '../src/server/revocations.js';
import { sealSession, type Session } from '../src/server/session.js';
import type { CareService } from '../src/server/care-access.js';
import type { ActivityEntry, ActivityLedger, ActivityReceipt } from '../src/shared/activity-contracts.js';

const config = configFromEnv({
  PUBLIC_ORIGIN: 'http://localhost:8787',
  DATABASE_URL: 'postgresql://local.invalid/synthetic',
  SESSION_KEY: randomBytes(32).toString('base64'),
});
const session: Session = {
  user_id: randomUUID(), session_id: randomUUID(), access_token: 'synthetic-access', refresh_token: 'synthetic-refresh',
  issued_at: Date.now() / 1000, expires_at: Date.now() / 1000 + 3600,
};
const headers = {
  host: 'localhost:8787', origin: config.origin,
  cookie: `nancy_session=${sealSession(session, config.sessionKey!)}`,
};
const activityId = randomUUID();
const entry: ActivityEntry = {
  id: activityId, kind: 'task', title: 'Synthetic task', local_date: '2026-10-05', source_id: randomUUID(), meal_slot: null,
  plan_id: randomUUID(), scheduled_at: null, status: 'completed', revision: 1, unplanned: false,
  occurred_at: '2026-10-05T14:00:00.000Z', recorded_at: '2026-10-05T14:01:00.000Z', updated_at: '2026-10-05T14:01:00.000Z',
  notes: '', portion: null, last_action: 'reported',
};
const ledger: ActivityLedger = {
  local_date: '2026-10-05', options: [entry], entries: [entry], recent_entries: [entry],
  summary: { tasks_completed: 1, meals_eaten: 0, appointments_attended: 0, deferred: 0 },
};
const command = {
  type: 'record_activity' as const, idempotency_key: randomUUID(), local_date: '2026-10-05', expected_revision: 0,
  payload: { unplanned: { kind: 'task' as const, title: 'Synthetic unplanned task' }, status: 'completed' as const, occurred_at: '2026-10-05T14:00:00.000Z', notes: '' },
};

function careDouble() {
  const receipt: ActivityReceipt = { command_id: command.idempotency_key, result: 'reported', entry, replayed: false };
  return {
    authorize: vi.fn(async value => value),
    ledger: vi.fn(async () => structuredClone(ledger)),
    activityCommand: vi.fn(async () => structuredClone(receipt)),
    activityReceipt: vi.fn(async () => structuredClone(receipt)),
    close: vi.fn(),
  } as unknown as CareService;
}

describe('activity ledger HTTP capability boundaries', () => {
  it('requires authentication and validates ledger dates before calling care', async () => {
    const care = careDouble();
    const app = await createApp(config, { care, revocations: new SessionRevocations() });
    try {
      expect((await app.inject({ url: '/api/activity?date=2026-10-05', headers: { host: headers.host } })).statusCode).toBe(401);
      const valid = await app.inject({ url: '/api/activity?date=2026-10-05', headers });
      expect(valid.statusCode).toBe(200);
      expect(valid.json()).toMatchObject({ local_date: '2026-10-05', summary: { tasks_completed: 1 } });
      expect(care.ledger).toHaveBeenCalledWith(session, '2026-10-05');

      expect((await app.inject({ url: '/api/activity?date=2026-02-30', headers })).statusCode).toBe(400);
      expect((await app.inject({ url: '/api/activity?date=2026-10-05&participant_id=' + randomUUID(), headers })).statusCode).toBe(400);
      expect(care.ledger).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });

  it('accepts only a typed activity command and rejects cross-origin or caller-selected ownership', async () => {
    const care = careDouble();
    const app = await createApp(config, { care, revocations: new SessionRevocations() });
    try {
      const injectedOwner = await app.inject({
        method: 'POST', url: '/api/activity/commands', headers,
        payload: { ...command, participant_id: randomUUID() },
      });
      expect(injectedOwner.statusCode).toBe(400);
      expect(care.activityCommand).not.toHaveBeenCalled();

      const invalidActual = await app.inject({
        method: 'POST', url: '/api/activity/commands', headers,
        payload: { ...command, payload: { ...command.payload, status: 'deferred', occurred_at: command.payload.occurred_at } },
      });
      expect(invalidActual.statusCode).toBe(400);
      expect(care.activityCommand).not.toHaveBeenCalled();

      const denied = await app.inject({
        method: 'POST', url: '/api/activity/commands', headers: { ...headers, origin: 'https://other.invalid' }, payload: command,
      });
      expect(denied.statusCode).toBe(403);
      expect(care.activityCommand).not.toHaveBeenCalled();

      const accepted = await app.inject({ method: 'POST', url: '/api/activity/commands', headers, payload: command });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json()).toMatchObject({ command_id: command.idempotency_key, result: 'reported' });
      expect(care.activityCommand).toHaveBeenCalledWith(session, command);
    } finally { await app.close(); }
  });

  it('reads only exact authenticated activity receipts and preserves missing/invalid outcomes', async () => {
    const care = careDouble();
    const app = await createApp(config, { care, revocations: new SessionRevocations() });
    try {
      expect((await app.inject({ url: '/api/activity/receipts/not-a-uuid', headers })).statusCode).toBe(400);
      expect(care.activityReceipt).not.toHaveBeenCalled();

      vi.mocked(care.activityReceipt!).mockResolvedValueOnce(null);
      const absentKey = randomUUID();
      const absent = await app.inject({ url: `/api/activity/receipts/${absentKey}`, headers });
      expect(absent.statusCode).toBe(404);
      expect(absent.json()).toMatchObject({ error: { code: 'not_found' } });
      expect(care.activityReceipt).toHaveBeenCalledWith(session, absentKey);

      const found = await app.inject({ url: `/api/activity/receipts/${command.idempotency_key}`, headers });
      expect(found.statusCode).toBe(200);
      expect(found.json()).toMatchObject({ command_id: command.idempotency_key, result: 'reported' });
      expect(care.activityReceipt).toHaveBeenLastCalledWith(session, command.idempotency_key);
    } finally { await app.close(); }
  });

  it('returns an explicit unavailable result when the care adapter lacks ledger capabilities', async () => {
    const care = { authorize: vi.fn(async value => value), close: vi.fn() } as unknown as CareService;
    const app = await createApp(config, { care, revocations: new SessionRevocations() });
    try {
      for (const response of [
        await app.inject({ url: '/api/activity', headers }),
        await app.inject({ method: 'POST', url: '/api/activity/commands', headers, payload: command }),
        await app.inject({ url: `/api/activity/receipts/${command.idempotency_key}`, headers }),
      ]) {
        expect(response.statusCode).toBe(503);
        expect(response.json()).toMatchObject({ error: { code: 'ledger_unavailable' } });
      }
    } finally { await app.close(); }
  });
});
