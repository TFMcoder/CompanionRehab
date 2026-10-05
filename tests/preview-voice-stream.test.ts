import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once, EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { attachPreviewVoiceStream } from '../src/server/preview-voice-stream';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
const trace = '00000000-0000-4000-8000-000000000001';
const nextTrace = '00000000-0000-4000-8000-000000000002';
const until = async (condition: () => boolean) => {
  for (let attempt = 0; attempt < 100 && !condition(); attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  expect(condition()).toBe(true);
};

describe('fixed synthetic WebSocket boundary', () => {
  let server: Server;
  let bridge: ReturnType<typeof attachPreviewVoiceStream>;
  const clients: WebSocket[] = [];
  const origin = 'https://preview.example.test';
  async function setup() {
    const worker = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    const commands: any[] = [];
    worker.stdin.on('data', bytes => commands.push(JSON.parse(bytes.toString())));
    vi.mocked(spawn).mockReturnValue(worker as any);
    server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address() as { port: number };
    const host = `127.0.0.1:${address.port}`;
    bridge = attachPreviewVoiceStream(server, { python: 'test-python', allowedHosts: [host], allowedOrigins: [origin] });
    worker.stdout.write(JSON.stringify({ type: 'ready' }) + '\n');
    const connect = async () => {
      const client = new WebSocket(`ws://${host}/preview/voice-stream`, { origin }); clients.push(client);
      const events: any[] = []; client.on('message', bytes => events.push(JSON.parse(bytes.toString())));
      await once(client, 'open'); await until(() => events.some(e => e.type === 'ready'));
      return { client, events };
    };
    return { worker, commands, host, connect, emit: (event: unknown) => worker.stdout.write(JSON.stringify(event) + '\n') };
  }
  afterEach(async () => {
    for (const client of clients.splice(0)) client.terminate();
    bridge?.close();
    if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  });
  it('rejects foreign origins, arbitrary text and unlisted sample IDs without invoking a model', async () => {
    const { connect, host, commands } = await setup();
    const rejected = new WebSocket(`ws://${host}/preview/voice-stream`, { origin: 'https://foreign.test' });
    clients.push(rejected);
    const error = await new Promise<Error>(resolve => rejected.once('error', resolve));
    expect(error.message).toContain('403');
    const { client, events } = await connect();
    client.send(JSON.stringify({ type: 'start', trace, voice: 'alba', sample: 'water', text: 'private arbitrary text' }));
    await until(() => events.some(e => e.code === 'fixed_samples_only'));
    client.send(JSON.stringify({ type: 'start', trace: nextTrace, voice: 'alba', sample: 'unknown' }));
    await until(() => events.filter(e => e.code === 'fixed_samples_only').length === 2);
    expect(commands).toEqual([]);
    expect((vi.mocked(spawn).mock.calls[0][2] as any).env).not.toHaveProperty('OPENAI_API_KEY');
  });
  it('forwards early chunks before completion, limits concurrent generation and excludes obsolete traces', async () => {
    const { connect, commands, emit } = await setup();
    const a = await connect(); const b = await connect();
    a.client.send(JSON.stringify({ type: 'start', trace, voice: 'alba', sample: 'long' }));
    await until(() => commands.length === 1);
    b.client.send(JSON.stringify({ type: 'start', trace: nextTrace, voice: 'anna', sample: 'water' }));
    await until(() => b.events.some(e => e.code === 'busy'));
    emit({ type: 'audio', trace, seq: 0, pcm: 'AAAAAA==' });
    await until(() => a.events.some(e => e.type === 'audio'));
    expect(a.events.some(e => e.type === 'complete')).toBe(false);
    expect(b.events.some(e => e.type === 'audio')).toBe(false);
    a.client.send(JSON.stringify({ type: 'cancel', trace }));
    await until(() => commands.some(c => c.type === 'cancel' && c.trace === trace));
    emit({ type: 'cancelled', trace });
    await until(() => a.events.some(e => e.type === 'cancelled'));
    b.client.send(JSON.stringify({ type: 'start', trace: nextTrace, voice: 'anna', sample: 'water' }));
    await until(() => commands.filter(c => c.type === 'start').length === 2);
    emit({ type: 'audio', trace, seq: 1, pcm: 'AAAAAA==' });
    emit({ type: 'audio', trace: nextTrace, seq: 0, pcm: 'AAAAAA==' });
    await until(() => b.events.some(e => e.type === 'audio'));
    expect(b.events.filter(e => e.type === 'audio').map(e => e.trace)).toEqual([nextTrace]);
  });
  it('cancels only the disconnected owner and releases the slot after cancellation', async () => {
    const { connect, commands, emit } = await setup();
    const owner = await connect();
    const observer = await connect();
    owner.client.send(JSON.stringify({ type: 'start', trace, voice: 'alba', sample: 'long' }));
    await until(() => commands.length === 1);
    observer.client.send(JSON.stringify({ type: 'cancel', trace }));
    observer.client.close();
    await once(observer.client, 'close');
    expect(commands).toHaveLength(1);
    owner.client.close();
    await until(() => commands.some(c => c.type === 'cancel' && c.trace === trace));
    emit({ type: 'cancelled', trace });
    const replacement = await connect();
    replacement.client.send(JSON.stringify({ type: 'start', trace: nextTrace, voice: 'alba', sample: 'water' }));
    await until(() => commands.filter(c => c.type === 'start').length === 2);
  });
  it('reports worker failure explicitly and cancels its active generation', async () => {
    const { connect, commands, worker } = await setup();
    const { client, events } = await connect();
    client.send(JSON.stringify({ type: 'start', trace, voice: 'alba', sample: 'long' }));
    await until(() => commands.length === 1);
    worker.emit('exit', 1);
    await until(() => events.some(e => e.code === 'worker_exited'));
    expect(bridge.isReady()).toBe(false);
    expect(commands.some(c => c.type === 'cancel')).toBe(true);
  });
});
