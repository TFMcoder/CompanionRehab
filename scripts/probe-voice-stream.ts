// Fixed synthetic cancellation/recovery probe. Browser rendering is measured separately.
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const origin = process.env.PREVIEW_PROBE_ORIGIN;
if (!origin || new URL(origin).origin !== origin || !/^https:\/\//.test(origin)) throw new Error('Set an exact approved HTTPS preview origin.');
const socket = new WebSocket(origin.replace(/^https:/, 'wss:') + '/preview/voice-stream', { origin });
const cancelledTrace = randomUUID();
const recoveryTrace = randomUUID();
const result: Record<string, unknown> = { started_at: new Date().toISOString(), route: 'existing public HTTPS/WSS Quick Tunnel',
  clocks: 'Node performance.now durations; Python model_elapsed_ms separate, no cross-clock subtraction', cancelledTrace, recoveryTrace };
let started = 0;
let cancelledAt: number | undefined;
let cancelledAcknowledged = false;
let chunks = 0;
let recoveredChunks = 0;
await new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Stream probe timeout')), 30_000);
  socket.on('error', reject);
  socket.on('message', bytes => {
    try {
      const event = JSON.parse(bytes.toString());
      if (event.type === 'ready') {
        started = performance.now();
        socket.send(JSON.stringify({ type: 'start', trace: cancelledTrace, voice: 'alba', sample: 'long' }));
      } else if (event.type === 'error' || event.type === 'unavailable') throw new Error(`Stream unavailable: ${event.code || event.type}`);
      else if (event.trace === cancelledTrace && event.type === 'audio') {
        if (cancelledAcknowledged) throw new Error('Obsolete audio after cancellation acknowledgement');
        chunks++;
        if (chunks === 1) result.first_audio_received_ms = +(performance.now() - started).toFixed(2);
        if (chunks === 10) {
          cancelledAt = performance.now();
          socket.send(JSON.stringify({ type: 'cancel', trace: cancelledTrace }));
        }
      } else if (event.trace === cancelledTrace && event.type === 'complete') throw new Error('Generation completed instead of cancelling');
      else if (event.trace === cancelledTrace && event.type === 'cancelled') {
        if (cancelledAt === undefined) throw new Error('Unexpected cancellation');
        cancelledAcknowledged = true;
        result.cancel_to_worker_terminal_received_ms = +(performance.now() - cancelledAt).toFixed(2);
        result.generated_chunks_before_cancel_terminal = chunks;
        result.worker_generation_ms_until_cancel = event.generation_ms;
        result.worker_terminal = event.type;
        socket.send(JSON.stringify({ type: 'start', trace: recoveryTrace, voice: 'alba', sample: 'water' }));
      } else if (event.trace === recoveryTrace && event.type === 'audio') recoveredChunks++;
      else if (event.trace === recoveryTrace && event.type === 'complete') {
        if (!cancelledAcknowledged || recoveredChunks === 0) throw new Error('Recovery produced no audio');
        result.recovery_completed = true; result.recovery_chunks = recoveredChunks;
        clearTimeout(timer); resolve();
      }
    } catch (error) { clearTimeout(timer); reject(error); }
  });
}).finally(() => socket.close());
await writeFile('.local/probes/voice-eval/remote-cancellation.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
