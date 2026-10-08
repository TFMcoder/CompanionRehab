import { randomUUID } from 'node:crypto';

export interface RuntimeEvent {
  kind: 'http' | 'conversation' | 'startup';
  outcome: 'ok' | 'error' | 'interrupted' | 'ready' | 'unavailable';
  actor_id?: string; request_id?: string; conversation_id?: string; turn_id?: string;
  measurements?: Record<string, unknown>;
}
type NutritionRef = { document_id: string; sha256: string; items: string[] };
interface EventRow extends Omit<RuntimeEvent, 'measurements'> { id: string; recorded_at: string; measurements: Record<string, string | number | null | NutritionRef[]> }
interface LogDatabase { query(sql: string, params?: any[]): Promise<unknown> }
const durationKeys = new Set(['duration_ms','model_duration_ms','speech_ms','context_duration_ms','tool_duration_ms','first_text_delta_ms','first_speakable_ms']);
const countKeys = new Set(['model_calls','model_completed_calls','model_failed_calls','model_aborted_calls','model_call_index','tool_calls','input_chars','nutrition_retrievals','status_code','audio_bytes','input_items','instruction_chars','history_chars','context_chars']);
const usageKeys = new Set(['input_tokens','output_tokens','total_tokens','cached_input_tokens','reasoning_output_tokens']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Whitelist metadata: never persist request bodies, credentials, transcripts or arbitrary error text. */
export function safeEvent(input: RuntimeEvent): EventRow {
  const measurements: EventRow['measurements'] = {};
  for (const [key, value] of Object.entries(input.measurements || {})) {
    if (durationKeys.has(key) && typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER)
      measurements[key] = Math.round(value);
    if (countKeys.has(key) && typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) measurements[key] = value;
    // Persist missing token observations explicitly. Invalid values cannot become estimates or zero.
    if (usageKeys.has(key)) measurements[key] = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
    if (key === 'policy_version' && typeof value === 'string' && /^[a-z][a-z0-9_.-]{0,63}$/i.test(value)) measurements.policy_version = value;
    if (key === 'binding_ref' && typeof value === 'string' && (uuid.test(value) || /^sha256:[a-f0-9]{64}$/.test(value))) measurements.binding_ref = value;
    if (key === 'route' && typeof value === 'string' && /^\/api\/[a-z/:_-]{1,90}$/.test(value)) measurements.route = value;
    if (key === 'stage' && typeof value === 'string' && ['http_ready','speech_ready','speech_warmup','context','model','tools'].includes(value)) measurements.stage = value;
    if (key === 'method' && typeof value === 'string' && ['GET','POST','DELETE','PUT','PATCH','HEAD','OPTIONS'].includes(value)) measurements.method = value;
    if (key === 'nutrition_refs' && Array.isArray(value)) measurements.nutrition_refs = value.slice(0, 2).flatMap(ref => {
      if (!ref || typeof ref !== 'object' || !/^[A-Z0-9_]{1,50}$/.test(ref.document_id) || !/^[a-f0-9]{64}$/.test(ref.sha256) || !Array.isArray(ref.items)) return [];
      return [{ document_id: ref.document_id, sha256: ref.sha256, items: ref.items.filter((item: unknown) => typeof item === 'string' && /^[A-Z0-9_-]{1,40}$/i.test(item)).slice(0, 14) }];
    });
  }
  const row: EventRow = { id: randomUUID(), recorded_at: new Date().toISOString(), kind: input.kind, outcome: input.outcome, measurements };
  for (const key of ['actor_id','request_id','conversation_id','turn_id'] as const) if (input[key] && uuid.test(input[key]!)) row[key] = input[key];
  return row;
}

/** Bounded asynchronous batches keep diagnostics off the voice response path. */
export class RuntimeLog {
  private queue: EventRow[] = [];
  private timer: NodeJS.Timeout;
  private writing?: Promise<void>;
  private failures = 0;
  private dropped = 0;
  private closed = false;
  private lastPrune = 0;
  constructor(private db: LogDatabase, private warn = () => console.error('Nancy runtime logging is unavailable; care receipts remain separate.')) {
    this.timer = setInterval(() => { void this.flush(); }, 2000); this.timer.unref();
  }
  record(input: RuntimeEvent) {
    if (this.closed) return;
    if (this.queue.length >= 512) { this.dropped++; if (this.dropped === 1) this.warn(); return; }
    this.queue.push(safeEvent(input));
  }
  status() { return { pending: this.queue.length, failed_batches: this.failures, dropped: this.dropped }; }
  async flush() {
    if (this.writing) return this.writing;
    if (!this.queue.length) return;
    const batch = this.queue.splice(0, 64);
    this.writing = (async () => {
      try {
        await this.db.query(`insert into companion_local.runtime_events
          select * from jsonb_populate_recordset(null::companion_local.runtime_events,$1::jsonb) on conflict(id) do nothing`, [JSON.stringify(batch)]);
        this.failures = 0;
        if (Date.now() - this.lastPrune > 86400000) {
          await this.db.query("delete from companion_local.runtime_events where recorded_at < now() - interval '14 days'");
          this.lastPrune = Date.now();
        }
      } catch {
        this.failures++;
        if (this.failures === 1) this.warn();
        // Preserve transient failures without allowing an outage to grow memory without limit.
        const retry = [...batch, ...this.queue];
        this.dropped += Math.max(0, retry.length - 512);
        this.queue = retry.slice(0, 512);
      }
    })().finally(() => { this.writing = undefined; });
    return this.writing;
  }
  async close() {
    clearInterval(this.timer); this.closed = true;
    await this.writing;
    for (let i = 0; this.queue.length && i < 8; i++) { await this.flush(); if (this.failures) break; }
    if (this.queue.length) this.warn();
  }
}
