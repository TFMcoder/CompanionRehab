import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import catalogue from '../shared/voice-evaluation.json';

export interface VoiceStreamOptions { python: string; allowedOrigins: string[]; allowedHosts: string[] }
const samples = new Set(catalogue.samples.map(s => s.id));
const voices = new Set(['alba', 'anna']);
const validTrace = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);

/** Fixed synthetic text only. This is NOT a care/voice upload endpoint. */
export function attachPreviewVoiceStream(server: Server, options: VoiceStreamOptions) {
  let ready = false;
  let failed = false;
  let startup: { model_load_ms: number; warmup_ms: number } | undefined;
  let worker: ChildProcessWithoutNullStreams | undefined;
  let active: { socket: WebSocket; trace: string; timer: ReturnType<typeof setTimeout>; chunks: number } | undefined;
  const sockets = new Set<WebSocket>();
  const ws = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  const send = (socket: WebSocket, event: unknown) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
  };
  const cancel = (socket: WebSocket) => {
    if (active?.socket === socket) worker?.stdin.write(JSON.stringify({ type: 'cancel', trace: active.trace }) + '\n');
  };
  const failActive = (code: string) => {
    if (!active) return;
    cancel(active.socket);
    send(active.socket, { type: 'error', trace: active.trace, code });
    clearTimeout(active.timer);
    active = undefined;
  };
  // Explicit environment: the public preview never forwards account/provider credentials.
  worker = spawn(resolve(options.python), ['-u', 'scripts/pocket-voice-eval.py', '--serve'], {
    cwd: process.cwd(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP,
      HF_HOME: resolve('.local/speech/pocket-cache'), HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_IMPLICIT_TOKEN: '1',
      HF_HUB_DISABLE_TELEMETRY: '1', PYTHONUNBUFFERED: '1' },
  });
  // Do not expose Python diagnostics/model paths through the public endpoint.
  worker.stderr.on('data', () => {});
  const lines = createInterface({ input: worker.stdout });
  lines.on('line', line => {
    if (line.length > 700_000) { failActive('worker_output_limit'); return; }
    let event: any;
    try { event = JSON.parse(line); } catch { return; }
    if (event.type === 'ready') {
      if (Number.isFinite(event.load_ms) && Number.isFinite(event.warmup_ms)) startup = { model_load_ms: event.load_ms, warmup_ms: event.warmup_ms };
      ready = true; for (const socket of sockets) send(socket, { type: 'ready' }); return;
    }
    if (!active || event.trace !== active.trace) return;
    if (!['accepted', 'audio', 'complete', 'cancelled', 'error'].includes(event.type)) return;
    if (active.socket.bufferedAmount > 262_144) { failActive('slow_connection'); return; }
    if (event.type === 'audio' && (++active.chunks > 1000 || typeof event.pcm !== 'string' || event.pcm.length > 640_000)) {
      failActive('audio_limit'); return;
    }
    send(active.socket, event);
    if (['complete', 'cancelled', 'error'].includes(event.type)) {
      clearTimeout(active.timer); active = undefined;
    }
  });
  const unavailable = (code: string) => {
    ready = false; failed = true; failActive(code);
    for (const socket of sockets) send(socket, { type: 'unavailable' });
  };
  worker.on('error', () => unavailable('worker_unavailable'));
  worker.on('exit', () => unavailable('worker_exited'));
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/preview/voice-stream' || !options.allowedHosts.includes(request.headers.host || '') ||
        !options.allowedOrigins.includes(request.headers.origin || '') || sockets.size >= 2) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
    }
    ws.handleUpgrade(request, socket, head, client => ws.emit('connection', client));
  });
  let requests: number[] = [];
  ws.on('connection', socket => {
    sockets.add(socket);
    send(socket, { type: ready ? 'ready' : failed ? 'unavailable' : 'warming' });
    socket.on('message', (bytes, binary) => {
      if (binary) { socket.close(1008, 'Text commands only'); return; }
      let message: any;
      try { message = JSON.parse(bytes.toString()); } catch { socket.close(1008, 'Invalid command'); return; }
      if (!message || !validTrace(message.trace)) { socket.close(1008, 'Invalid trace'); return; }
      if (message.type === 'cancel') {
        if (active?.trace === message.trace) cancel(socket);
        return;
      }
      if (message.type !== 'start' || !samples.has(message.sample) || !voices.has(message.voice) ||
          Object.keys(message).some(key => !['type', 'trace', 'sample', 'voice'].includes(key))) {
        send(socket, { type: 'error', trace: message.trace, code: 'fixed_samples_only' }); return;
      }
      requests = requests.filter(at => performance.now() - at < 60_000);
      if (!ready || active || requests.length >= 10) {
        send(socket, { type: 'error', trace: message.trace, code: !ready ? 'warming' : active ? 'busy' : 'rate_limit' }); return;
      }
      requests.push(performance.now());
      active = { socket, trace: message.trace, chunks: 0, timer: setTimeout(() => failActive('generation_timeout'), 60_000) };
      worker?.stdin.write(JSON.stringify(message) + '\n');
    });
    socket.on('close', () => { cancel(socket); sockets.delete(socket); });
    socket.on('error', () => cancel(socket));
  });
  return {
    isReady: () => ready,
    startup: () => startup,
    close: () => {
      if (active) { cancel(active.socket); clearTimeout(active.timer); active = undefined; }
      for (const socket of sockets) socket.terminate();
      ws.close(); lines.close(); worker?.stdin.end(); worker?.kill();
    },
  };
}
