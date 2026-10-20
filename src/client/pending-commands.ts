import { api, ApiError, scopedRequest } from './api';
import type { CareCommand } from '../shared/contracts';
import type { ActivityCommand } from '../shared/activity-contracts';
import type { TaskRequestCommand } from '../shared/task-request-contracts';
import type { MealGroceryCommand } from '../shared/meal-grocery-contracts';
import type { LocalDayCommand } from '../shared/local-day-contracts';
import type { ProgramCommand } from '../shared/program-contracts';
import type { SupportCommand } from '../shared/support-contracts';
import type { ProgressCommand } from '../shared/progress-contracts';
import type { OperationsCommand } from '../shared/operations-contracts';

/** Only typed commands whose server exposes an actor-scoped receipt belong here. */
export type PendingFamily = 'care' | 'activity' | 'task_request' | 'meal_grocery' | 'local_day' | 'program' | 'support' | 'progress' | 'operations';
export type RecoverableCommand = CareCommand | ActivityCommand | TaskRequestCommand | MealGroceryCommand | LocalDayCommand | ProgramCommand | SupportCommand | ProgressCommand | OperationsCommand;
export type PendingStatus = 'queued' | 'unknown' | 'ready_retry' | 'needs_review' | 'saved';
export interface PendingCommand {
  key: string;
  family: PendingFamily;
  scopeKey: string;
  command: RecoverableCommand | null;
  status: PendingStatus;
  createdAt: number;
  updatedAt: number;
  reason?: string;
}
export interface PendingStorage {
  read(): Promise<PendingCommand[]>;
  write(items: PendingCommand[]): Promise<void>;
  clear(): Promise<void>;
}
export interface PendingTransport {
  scopeKey(): Promise<string>;
  receipt(family: PendingFamily, key: string, scopeKey: string): Promise<unknown>;
  command(family: PendingFamily, command: RecoverableCommand, scopeKey: string): Promise<unknown>;
}

const paths:Record<PendingFamily,string>={care:'/api',activity:'/api/activity',task_request:'/api/task-requests',meal_grocery:'/api/meals-groceries',local_day:'/api/local-day',program:'/api/programs',support:'/api/support-team',progress:'/api/progress',operations:'/api/operations'};
export const pendingTransport: PendingTransport = {
  scopeKey: async () => (await api.session()).scope_key,
  receipt: (family,key,scopeKey) => scopedRequest(`${paths[family]}/receipts/${encodeURIComponent(key)}`,scopeKey),
  command: (family,command,scopeKey) => scopedRequest(`${paths[family]}/commands`,scopeKey,{method:'POST',body:JSON.stringify(command)}),
};

const DB_NAME = 'nancy-pending-commands';
const DB_VERSION = 1;
const STORE = 'device';
const ROW = 'commands';
export const MAX_PENDING_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ITEMS = 20;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Device storage is unavailable.')); return; }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Device storage is unavailable.'));
  });
}

/** One serialized record makes scope purges atomic with the local queue update. */
export class IndexedDbPendingStorage implements PendingStorage {
  private sequence: Promise<unknown> = Promise.resolve();
  private transact<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const task = async () => {
      const db = await openDatabase();
      try {
        return await new Promise<T>((resolve, reject) => {
          const tx = db.transaction(STORE, mode);
          const request = operation(tx.objectStore(STORE));
          let result: T;
          request.onsuccess = () => { result = request.result; };
          request.onerror = () => reject(request.error ?? new Error('Device storage failed.'));
          tx.oncomplete = () => resolve(result);
          tx.onerror = () => reject(tx.error ?? new Error('Device storage failed.'));
          tx.onabort = () => reject(tx.error ?? new Error('Device storage failed.'));
        });
      } finally { db.close(); }
    };
    const result = this.sequence.then(task, task);
    this.sequence = result.catch(() => undefined);
    return result;
  }
  async read(): Promise<PendingCommand[]> { const value = await this.transact('readonly', store => store.get(ROW)); return Array.isArray(value) ? value : []; }
  async write(items: PendingCommand[]): Promise<void> { await this.transact('readwrite', store => store.put(items, ROW)); }
  async clear(): Promise<void> { await this.transact('readwrite', store => store.delete(ROW)); }
}

const unknown = (error: unknown) => error instanceof ApiError && (error.code === 'connection_unconfirmed' || error.status === 0 || error.status >= 500);
const conflict = (error: unknown) => error instanceof ApiError && (error.status === 409 || error.status === 412);
const unauthorized = (error: unknown) => error instanceof ApiError && (error.status === 401 || error.status === 403);
const missingReceipt = (error: unknown) => error instanceof ApiError && error.status === 404;

export class PendingCommands {
  private scope: string | null = null;
  private epoch = 0;
  private items: PendingCommand[] = [];
  private operations = new Map<string,Promise<unknown|null>>();
  private listeners = new Set<(items: PendingCommand[]) => void>();
  constructor(private storage: PendingStorage = new IndexedDbPendingStorage(), private transport: PendingTransport = pendingTransport, private now: () => number = Date.now) {}
  get snapshot(): PendingCommand[] { return structuredClone(this.items); }
  private once(key:string,work:()=>Promise<unknown|null>):Promise<unknown|null> {
    const operationKey=`${this.epoch}:${key}`,prior=this.operations.get(operationKey);if(prior)return prior;
    const result=work().finally(()=>{if(this.operations.get(operationKey)===result)this.operations.delete(operationKey);});
    this.operations.set(operationKey,result);return result;
  }
  subscribe(listener: (items: PendingCommand[]) => void): () => void { this.listeners.add(listener); listener(this.snapshot); return () => this.listeners.delete(listener); }
  private emit() { const copy = this.snapshot; for (const listener of this.listeners) listener(copy); }
  private async save() { await this.storage.write(this.items); this.emit(); }
  private active(epoch: number, scope: string) { return this.epoch === epoch && this.scope === scope; }
  private async sameAuthority(scope: string, epoch: number): Promise<boolean> {
    try {
      const current = await this.transport.scopeKey();
      if (!this.active(epoch, scope)) return false;
      if (current === scope) return true;
      await this.deactivate();
      return false;
    } catch (error) {
      if (this.active(epoch, scope) && unauthorized(error)) await this.deactivate();
      throw error;
    }
  }

  /** Call after a fresh authenticated session read; the server scope includes actor, login, client and grants. */
  async activate(scopeKey: string): Promise<void> {
    if (!scopeKey) throw new Error('A confirmed session scope is required.');
    const epoch = ++this.epoch;
    this.scope = scopeKey;
    this.items = [];
    this.emit();
    const prior = await this.storage.read();
    if (!this.active(epoch, scopeKey)) return;
    const cutoff = this.now() - MAX_PENDING_AGE_MS;
    this.items = prior.filter(item => item.scopeKey === scopeKey && item.createdAt >= cutoff && item.createdAt <= this.now() &&
      item.status !== 'saved' && item.key === item.command?.idempotency_key);
    // Saved markers have no retained payload and may be displayed until dismissed.
    this.items.push(...prior.filter(item => item.scopeKey === scopeKey && item.status === 'saved' && item.command === null && item.createdAt >= cutoff && item.createdAt <= this.now()));
    this.items = this.items.slice(-MAX_ITEMS);
    await this.save();
  }

  async deactivate(): Promise<void> {
    ++this.epoch;
    this.scope = null;
    this.items = [];
    this.emit();
    await this.storage.clear();
  }

  /** Durable preparation precedes every network dispatch. A storage failure prevents the write. */
  async queue(family: PendingFamily, command: RecoverableCommand): Promise<PendingCommand> {
    const scope = this.scope;
    if (!scope) throw new Error('Sign in before saving work.');
    if (!command.idempotency_key || this.items.some(item => item.key === command.idempotency_key)) throw new Error('A new command needs a unique receipt key.');
    if (this.items.length >= MAX_ITEMS) throw new Error('Resolve pending work before adding more.');
    const instant = this.now();
    const item: PendingCommand = { key: command.idempotency_key, family, scopeKey: scope, command: structuredClone(command), status: 'queued', createdAt: instant, updatedAt: instant };
    this.items.push(item);
    try { await this.save(); } catch (error) { this.items = this.items.filter(row => row !== item); this.emit(); throw error; }
    return structuredClone(item);
  }

  private async setStatus(key: string, status: PendingStatus, reason?: string, erasePayload = false) {
    const item = this.items.find(row => row.key === key);
    if (!item) return;
    item.status = status; item.reason = reason; item.updatedAt = this.now();
    if (erasePayload) item.command = null;
    await this.save();
  }

  /** For freshly queued, never-dispatched work only. Unknown writes must go through reconcile(). */
  submit(key: string): Promise<unknown | null> { return this.once(key,()=>this.submitOnce(key)); }
  private async submitOnce(key: string): Promise<unknown | null> {
    const item = this.items.find(row => row.key === key);
    if (!item || item.status !== 'queued' || !item.command || !this.scope) throw new Error('This work cannot be sent without review.');
    const { scopeKey, command, family } = item;
    const epoch = this.epoch;
    if (!await this.sameAuthority(scopeKey, epoch)) return null;
    // Mark unknown before dispatch: a crash after this point must read the receipt first.
    await this.setStatus(key, 'unknown');
    if (!this.active(epoch, scopeKey)||!await this.sameAuthority(scopeKey,epoch)) return null;
    try {
      const receipt = await this.transport.command(family, command, scopeKey);
      if (this.active(epoch, scopeKey)) await this.setStatus(key, 'saved', undefined, true);
      return this.active(epoch, scopeKey) ? receipt : null;
    } catch (error) {
      if (!this.active(epoch, scopeKey)) return null;
      if (unauthorized(error)) { await this.deactivate(); return null; }
      if (conflict(error)) await this.setStatus(key, 'needs_review', 'The saved version changed. Review the current day before trying again.');
      else if (!unknown(error)) await this.setStatus(key, 'needs_review', 'The command was rejected. Review it before trying again.');
      throw error;
    }
  }

  /** Receipt lookup never dispatches a write, including after timeout or process restart. */
  reconcile(key: string): Promise<unknown | null> { return this.once(key,()=>this.reconcileOnce(key)); }
  private async reconcileOnce(key: string): Promise<unknown | null> {
    const item = this.items.find(row => row.key === key);
    if (!item || !['unknown', 'ready_retry'].includes(item.status) || !this.scope) return null;
    const { scopeKey, family } = item;
    const epoch = this.epoch;
    if (!await this.sameAuthority(scopeKey, epoch)) return null;
    try {
      const receipt = await this.transport.receipt(family, key, scopeKey);
      if (this.active(epoch, scopeKey)) await this.setStatus(key, 'saved', undefined, true);
      return this.active(epoch, scopeKey) ? receipt : null;
    } catch (error) {
      if (!this.active(epoch, scopeKey)) return null;
      if (unauthorized(error)) { await this.deactivate(); return null; }
      if (missingReceipt(error)) await this.setStatus(key, 'ready_retry', 'No receipt was found. Review the current day, then choose whether to retry.');
      else if (conflict(error)) await this.setStatus(key, 'needs_review', 'The saved version changed. Review the current day.');
      // A failed receipt lookup leaves the write unconfirmed and is never a retry signal.
      return null;
    }
  }

  /** Explicit user action; read the receipt once more before resending the exact key and payload. */
  retry(key: string): Promise<unknown | null> { return this.once(key,()=>this.retryOnce(key)); }
  private async retryOnce(key: string): Promise<unknown | null> {
    const item = this.items.find(row => row.key === key);
    if (!item || item.status !== 'ready_retry' || !item.command) throw new Error('Review this work before retrying.');
    const scope = this.scope;
    const epoch = this.epoch;
    if (!scope || !await this.sameAuthority(scope, epoch)) return null;
    try {
      const receipt = await this.transport.receipt(item.family, key, scope);
      if (this.active(epoch, scope)) await this.setStatus(key, 'saved', undefined, true);
      return this.active(epoch, scope) ? receipt : null;
    } catch (error) {
      if (!this.active(epoch, scope)) return null;
      if (unauthorized(error)) { await this.deactivate(); return null; }
      if (conflict(error)) { await this.setStatus(key, 'needs_review', 'The saved version changed. Review the current day.'); return null; }
      if (!missingReceipt(error)) return null;
    }
    if (!this.active(epoch, scope)) return null;
    await this.setStatus(key, 'queued');
    return this.submitOnce(key);
  }

  async discard(key: string): Promise<void> {
    this.items = this.items.filter(item => item.key !== key);
    await this.save();
  }
}
