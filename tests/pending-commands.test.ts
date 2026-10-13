import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/client/api';
import { PendingCommands, MAX_PENDING_AGE_MS, type PendingCommand, type PendingStorage, type PendingTransport } from '../src/client/pending-commands';
import type { CareCommand } from '../src/shared/contracts';

const key = '11111111-1111-4111-8111-111111111111';
const command: CareCommand = { type: 'start_or_resume_checkin', idempotency_key: key, local_date: '2026-10-13', expected_revision: 0, payload: {} };
class MemoryStorage implements PendingStorage {
  items: PendingCommand[] = [];
  async read() { return structuredClone(this.items); }
  async write(items: PendingCommand[]) { this.items = structuredClone(items); }
  async clear() { this.items = []; }
}
function fixture(storage = new MemoryStorage(), scope = 'actor-login-client-grants-v1') {
  const transport: PendingTransport = {
    scopeKey: vi.fn(async () => scope),
    receipt: vi.fn(async () => { throw new ApiError(404, 'not_found', 'No receipt'); }),
    command: vi.fn(async () => ({ result: 'resumed' })),
  };
  const controller = new PendingCommands(storage, transport, () => 1_000_000);
  return { storage, transport, controller };
}

describe('device pending commands', () => {
  it('persists before dispatch and restores a never-submitted command without calling the server', async () => {
    const f = fixture();
    await f.controller.activate('actor-login-client-grants-v1');
    await f.controller.queue('care', command);
    expect(f.storage.items[0]).toMatchObject({ status: 'queued', command, key });
    const afterReload = new PendingCommands(f.storage, f.transport, () => 1_000_000);
    await afterReload.activate('actor-login-client-grants-v1');
    expect(afterReload.snapshot[0].status).toBe('queued');
    expect(f.transport.command).not.toHaveBeenCalled();
    expect(f.transport.receipt).not.toHaveBeenCalled();
  });

  it('reads a committed receipt after a lost write response and does not resend', async () => {
    const f = fixture();
    const receipt = { result: 'resumed', checkin_id: 'checkin-1' };
    vi.mocked(f.transport.command).mockRejectedValueOnce(new ApiError(503, 'connection_unconfirmed', 'Unknown'));
    vi.mocked(f.transport.receipt).mockResolvedValueOnce(receipt);
    await f.controller.activate('actor-login-client-grants-v1');
    await f.controller.queue('care', command);
    await expect(f.controller.submit(key)).rejects.toMatchObject({ code: 'connection_unconfirmed' });
    expect(f.storage.items[0].status).toBe('unknown');
    const afterReload = new PendingCommands(f.storage, f.transport, () => 1_000_000);
    await afterReload.activate('actor-login-client-grants-v1');
    expect(await afterReload.reconcile(key)).toEqual(receipt);
    expect(afterReload.snapshot[0]).toMatchObject({ status: 'saved', command: null });
    expect(f.transport.command).toHaveBeenCalledTimes(1);
    expect(f.transport.receipt).toHaveBeenCalledTimes(1);
  });

  it('never resends when receipt lookup is uncertain, and retries exact payload/key only after an explicit action and fresh 404', async () => {
    const f = fixture();
    await f.controller.activate('actor-login-client-grants-v1');
    await f.controller.queue('care', command);
    vi.mocked(f.transport.command).mockRejectedValueOnce(new ApiError(0, 'connection_unconfirmed', 'Unknown'));
    await expect(f.controller.submit(key)).rejects.toBeInstanceOf(ApiError);
    vi.mocked(f.transport.receipt).mockRejectedValueOnce(new ApiError(0, 'connection_unavailable', 'Offline'));
    expect(await f.controller.reconcile(key)).toBeNull();
    expect(f.controller.snapshot[0].status).toBe('unknown');
    expect(f.transport.command).toHaveBeenCalledTimes(1);
    expect(await f.controller.reconcile(key)).toBeNull();
    expect(f.controller.snapshot[0].status).toBe('ready_retry');
    vi.mocked(f.transport.receipt).mockRejectedValueOnce(new ApiError(0, 'connection_unavailable', 'Offline'));
    expect(await f.controller.retry(key)).toBeNull();
    expect(f.transport.command).toHaveBeenCalledTimes(1);
    expect(await f.controller.retry(key)).toEqual({ result: 'resumed' });
    expect(f.transport.command).toHaveBeenCalledTimes(2);
    expect(f.transport.command).toHaveBeenLastCalledWith('care', command);
  });

  it('requires review after a stale-version conflict and never alters the original payload', async () => {
    const f = fixture();
    await f.controller.activate('actor-login-client-grants-v1');
    await f.controller.queue('care', command);
    vi.mocked(f.transport.command).mockRejectedValueOnce(new ApiError(409, 'stale_revision', 'Changed'));
    await expect(f.controller.submit(key)).rejects.toMatchObject({ status: 409 });
    expect(f.controller.snapshot[0]).toMatchObject({ status: 'needs_review', command });
    await expect(f.controller.retry(key)).rejects.toThrow('Review this work');
    expect(f.transport.command).toHaveBeenCalledTimes(1);
  });

  it('drops inaccessible scope data and ignores late receipt after logout', async () => {
    const f = fixture();
    await f.controller.activate('actor-login-client-grants-v1');
    await f.controller.queue('care', command);
    vi.mocked(f.transport.command).mockRejectedValueOnce(new ApiError(503, 'connection_unconfirmed', 'Unknown'));
    await expect(f.controller.submit(key)).rejects.toBeInstanceOf(ApiError);
    let finish!: (value: unknown) => void;
    vi.mocked(f.transport.receipt).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.controller.reconcile(key);
    await vi.waitFor(() => expect(f.transport.receipt).toHaveBeenCalled());
    await f.controller.deactivate();
    finish({ result: 'resumed' });
    expect(await pending).toBeNull();
    expect(f.storage.items).toEqual([]);
    await f.controller.activate('another-actor-login');
    expect(f.controller.snapshot).toEqual([]);
  });

  it('does not clear a newer session when an old authority check returns late', async () => {
    const f = fixture();
    await f.controller.activate('actor-login-client-grants-v1');
    await f.controller.queue('care', command);
    let finish!: (scope: string) => void;
    vi.mocked(f.transport.scopeKey).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const staleSubmit = f.controller.submit(key);
    await vi.waitFor(() => expect(f.transport.scopeKey).toHaveBeenCalled());
    await f.controller.activate('actor-login-client-grants-v2');
    finish('actor-login-client-grants-v2');
    expect(await staleSubmit).toBeNull();
    expect(f.controller.snapshot).toEqual([]);
    expect(f.transport.command).not.toHaveBeenCalled();
    await f.controller.queue('care', command);
    expect(f.controller.snapshot).toHaveLength(1);
  });

  it('purges old records and refuses a queued command after authority revision changes', async () => {
    const f = fixture();
    await f.controller.activate('actor-login-client-grants-v1');
    await f.controller.queue('care', command);
    vi.mocked(f.transport.scopeKey).mockResolvedValueOnce('actor-login-client-grants-v2');
    expect(await f.controller.submit(key)).toBeNull();
    expect(f.storage.items).toEqual([]);
    expect(f.transport.command).not.toHaveBeenCalled();
    f.storage.items = [{ ...command, key, family: 'care', scopeKey: 'actor-login-client-grants-v1', command, status: 'queued', createdAt: 1_000_000 - MAX_PENDING_AGE_MS - 1, updatedAt: 0 }];
    await f.controller.activate('actor-login-client-grants-v1');
    expect(f.controller.snapshot).toEqual([]);
  });

  it('will not dispatch if the pending command cannot be saved on device', async () => {
    const f = fixture();
    await f.controller.activate('actor-login-client-grants-v1');
    f.storage.write = vi.fn(async () => { throw new Error('Storage full'); });
    await expect(f.controller.queue('care', command)).rejects.toThrow('Storage full');
    expect(f.controller.snapshot).toEqual([]);
    expect(f.transport.command).not.toHaveBeenCalled();
  });
});
