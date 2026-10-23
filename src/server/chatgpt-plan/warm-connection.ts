import WebSocket from 'ws';
import { PlanReasoner, type Reasoner } from '../plan-reasoner.js';
import { ApiError } from '../errors.js';
import { bindingRef, type InferenceBinding, type InferenceScope } from '../inference-binding.js';
import { dialogueConversationGuidance } from '../dialogue-replies.js';
import { verifiedReferenceGuidance } from '../verified-answers.js';
import { PlanStore } from './storage.js';
import { createPlanRequest, reasoningCandidates, type OutputItem } from './inference.js';

/** One authenticated connection, no retries, redirects, paid tier or persisted response IDs. */
export class PlanSocket {
  private socket?: WebSocket;
  private token?: string;
  private parent?: string;
  private pending?: { event(event: Record<string, any>): void; fail(error: Error): void };
  private expiry?: NodeJS.Timeout;
  constructor(private connect = (token: string) => new WebSocket('wss://api.openai.com/v1/responses', {
    headers: { Authorization: `Bearer ${token}` }, handshakeTimeout: 12000, maxPayload: 1_000_000, followRedirects: false,
  })) {}

  private async open(token: string) {
    if (this.token !== token || this.socket?.readyState !== WebSocket.OPEN) this.close();
    if (this.socket) return;
    const socket = this.socket = this.connect(token); this.token = token;
    socket.on('message', data => {
      if (this.socket !== socket) return;
      try { this.pending?.event(JSON.parse(data.toString())); }
      catch { this.pending?.fail(new Error('Invalid selected connection event.')); }
    });
    socket.on('error', () => { if (this.socket === socket) this.pending?.fail(new Error('Selected connection failed.')); });
    socket.on('close', () => { if (this.socket === socket) this.pending?.fail(new Error('Selected connection closed.')); });
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', () => reject(new Error('Selected connection handshake failed.')));
      socket.once('unexpected-response', (_request, response) => {
        response.resume(); this.close(); reject(new Error('Selected connection was refused.'));
      });
      socket.once('close', () => reject(new Error('Selected connection closed during handshake.')));
    });
    this.expiry = setTimeout(() => this.close(), 120000); this.expiry.unref();
  }

  /** Adapt WebSocket events to the same completed-response parser used by HTTP. */
  async fetch(url: Parameters<typeof fetch>[0], init: RequestInit | undefined, warm: boolean): Promise<Response> {
    if (String(url) !== 'https://api.openai.com/v1/responses') throw new Error('Unexpected selected endpoint.');
    const body = JSON.parse(String(init?.body));
    if (body.model !== 'gpt-6-sol' || body.reasoning?.effort !== 'low' || body.store !== false || body.stream !== true
      || body.tools?.length || Object.keys(body).some(key => !['input','instructions','tools','tool_choice','model','reasoning','store','stream'].includes(key))
      || !Array.isArray(body.input) || warm && body.input.length) throw new Error('Unexpected selected connection request.');
    init?.signal?.throwIfAborted();
    const authorization = new Headers(init?.headers).get('authorization');
    if (!authorization?.startsWith('Bearer ')) throw new Error('Selected connection needs bound authorization.');
    await this.open(authorization.slice(7));
    init?.signal?.throwIfAborted();
    if (this.pending) throw new Error('Selected connection is busy.');
    delete body.stream;
    // The only reusable parent has no human, care or tool input. Every generated
    // turn still sends its complete fresh authorized context and dialogue.
    if (!warm && this.parent) { body.previous_response_id = this.parent; this.parent = undefined; }
    let cancelled = false, finished = false, bytes = 0;
    const stream = new ReadableStream<Uint8Array>({
      start: controller => {
        const finish = (error?: Error) => {
          if (finished) return; finished = true;
          this.pending = undefined; clearTimeout(timeout); init?.signal?.removeEventListener('abort', abort);
          if (error) { this.close(); if (!cancelled) controller.error(error); }
          else if (!cancelled) controller.close();
        };
        const abort = () => finish(new Error('Selected connection request cancelled.'));
        const timeout = setTimeout(() => finish(new Error('Selected connection request timed out.')), 45000); timeout.unref();
        this.pending = { fail: finish, event: event => {
          if (!event || typeof event !== 'object' || Array.isArray(event)) return finish(new Error('Invalid selected connection event.'));
          const encoded = new TextEncoder().encode('data: ' + JSON.stringify(event) + '\n\n'); bytes += encoded.byteLength;
          if (bytes > 1_000_000) return finish(new Error('Selected connection exceeded its limit.'));
          if (warm && event.type === 'response.completed') {
            const id = event.response?.id;
            if (typeof id !== 'string' || !/^resp_[a-zA-Z0-9_-]{1,180}$/.test(id)) return finish(new Error('Invalid warm response ID.'));
            this.parent = id;
          }
          if (!cancelled) controller.enqueue(encoded);
          if (['response.completed','response.failed','response.incomplete','error'].includes(event.type)) finish();
        }};
        init?.signal?.addEventListener('abort', abort, { once: true });
        if (init?.signal?.aborted) return abort();
        try {
          this.socket!.send(JSON.stringify({ type: 'response.create', ...body, ...(warm ? { generate: false } : {}) }), error => {
            if (error) finish(new Error('Selected connection send failed.'));
          });
        } catch { finish(new Error('Selected connection send failed.')); }
      },
      cancel: () => { cancelled = true; this.close(); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  }
  close() {
    clearTimeout(this.expiry); this.expiry = undefined;
    const socket = this.socket, pending = this.pending;
    this.pending = undefined; this.socket = undefined; this.token = undefined; this.parent = undefined;
    pending?.fail(new Error('Selected connection cleared.'));
    if (socket?.readyState === WebSocket.OPEN) socket.close(); else socket?.terminate();
  }
}

export interface ConnectionPreparationMetric {
  conversation_id?: string;
  stage: 'connection_preparation'; actor_id: string; binding_ref: string;
  outcome: 'completed' | 'failed' | 'interrupted'; duration_ms: number;
  model_calls: 0; connection_warmup_requests: 1;
  input_tokens: number | null; output_tokens: number | null; total_tokens: number | null;
  cached_input_tokens: number | null; reasoning_output_tokens: number | null;
}
type Lane = { key: string; socket: PlanSocket; reasoner: PlanReasoner; controller: AbortController;
  warming: boolean; failed: boolean; job?: Promise<void> };

/** Explicit owner-copy ordinary-chat transport. Care/tool requests retain HTTP. */
export class WarmPlanReasoner implements Reasoner {
  private base: PlanReasoner;
  private lane?: Lane;
  private attempts = 0;
  private busy = false;
  constructor(private store: PlanStore, private owner: string, private participant: string,
    private observe?: (metric: ConnectionPreparationMetric) => void, private socketFactory = () => new PlanSocket()) {
    this.base = new PlanReasoner(store, owner, createPlanRequest(reasoningCandidates['sol-low']));
  }
  available() { return this.base.available(); }
  async bind(scope: InferenceScope) {
    this.assertScope(scope);
    return this.base.bind(scope);
  }
  private assertScope(scope: InferenceScope) {
    if (scope.actor_id !== this.owner || scope.client_id !== this.participant || scope.active_role !== 'client')
      throw new ApiError(403, 'experiment_owner_only', 'This connection is limited to the exact owner practice copy.');
  }
  private createLane(binding: InferenceBinding) {
    this.assertScope(binding);
    if (binding.route_id !== 'chatgpt_plan_owner_practice' || binding.qualification !== 'owner_practice')
      throw new ApiError(403, 'experiment_owner_only', 'The exact owner practice connection is required.');
    this.releaseConnection();
    const socket = this.socketFactory(), pinned = createPlanRequest(reasoningCandidates['sol-low']);
    const lane: Lane = { key: bindingRef(binding), socket, controller: new AbortController(), warming: false, failed: false,
      reasoner: new PlanReasoner(this.store, this.owner, (account, input, options, _fetcher, timing, signal) =>
        pinned(account, input, options, (url, init) => socket.fetch(url, init, lane.warming), timing, signal)) };
    this.lane = lane; return lane;
  }
  /** Only known trusted instructions are prepared; no question, private facts or answer prediction. */
  async warmConnection(binding: InferenceBinding, signal: AbortSignal, conversationId?: string) {
    this.assertScope(binding);
    if (this.attempts >= 18 || this.busy) return;
    const lane = this.createLane(binding); lane.warming = true; this.attempts++;
    const started = performance.now();
    lane.job = (async () => {
      let outcome: ConnectionPreparationMetric['outcome'] = 'failed', usage;
      try {
        const response = await lane.reasoner.respond([], dialogueConversationGuidance, [],
          AbortSignal.any([signal, lane.controller.signal, AbortSignal.timeout(12000)]), undefined, binding);
        usage = response.usage;
        if (response.text || response.output.length) throw new Error('Context-only preparation generated output.');
        if (this.lane !== lane) throw new Error('Prepared connection changed.');
        outcome = 'completed';
      } catch {
        lane.failed = true; lane.socket.close();
        if (signal.aborted || lane.controller.signal.aborted) outcome = 'interrupted';
      } finally {
        lane.warming = false;
        try { this.observe?.({ ...(conversationId?{conversation_id:conversationId}:{}), stage: 'connection_preparation', actor_id: binding.actor_id, binding_ref: bindingRef(binding),
          outcome, duration_ms: Math.round(performance.now() - started), model_calls: 0, connection_warmup_requests: 1,
          input_tokens: usage?.inputTokens ?? null, output_tokens: usage?.outputTokens ?? null, total_tokens: usage?.totalTokens ?? null,
          cached_input_tokens: usage?.cachedInputTokens ?? null, reasoning_output_tokens: usage?.reasoningOutputTokens ?? null }); } catch { /* Numeric diagnostics cannot affect access. */ }
      }
    })();
    return lane.job;
  }
  async respond(input: OutputItem[], instructions: string, tools: OutputItem[], signal?: AbortSignal,
    onTextDelta?: (delta: string) => void, binding?: InferenceBinding) {
    if (!binding) throw new ApiError(403, 'reasoning_binding_changed', 'Start a new conversation.');
    this.assertScope(binding);
    if (this.busy) throw new ApiError(409, 'reasoning_busy', 'Nancy is finishing another response.');
    this.busy = true;
    try {
    const ordinary = !tools.length && (instructions === dialogueConversationGuidance || instructions === dialogueConversationGuidance + '\n' + verifiedReferenceGuidance);
    if (!ordinary) {
      if(this.lane && this.lane.key !== bindingRef(binding))this.releaseConnection();
      await this.lane?.job;
      return await this.base.respond(input, instructions, tools, signal, onTextDelta, binding);
    }
    const lane = this.lane?.key === bindingRef(binding) ? this.lane : this.createLane(binding);
    await lane.job; signal?.throwIfAborted();
    if (lane.failed || this.lane !== lane) throw new ApiError(503, 'reasoning_unavailable', 'The prepared Pro connection could not finish. Start a new conversation.');
    return await lane.reasoner.respond(input, instructions, tools, signal, onTextDelta, binding);
    } finally { this.busy = false; }
  }
  releaseConnection(binding?: InferenceBinding) {
    if (binding && this.lane?.key !== bindingRef(binding)) return;
    const lane = this.lane; this.lane = undefined; lane?.controller.abort(); lane?.socket.close();
  }
}
