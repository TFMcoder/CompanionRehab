// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodePcmFloat32LE, isCurrentTrace, StreamingAudition, streamingSampleUrl } from '../src/client/StreamingAudition.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
beforeEach(() => { vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); });

function float32Base64(...samples: number[]) {
  const bytes = new Uint8Array(samples.length * 4);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => view.setFloat32(index * 4, sample, true));
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

describe('streaming voice audition protocol', () => {
  it('decodes little-endian float32 audio and rejects invalid chunks', () => {
    expect([...decodePcmFloat32LE(float32Base64(0.25, -0.5))]).toEqual([0.25, -0.5]);
    expect(() => decodePcmFloat32LE('')).toThrow('Invalid audio chunk');
    expect(() => decodePcmFloat32LE(float32Base64(1.5))).toThrow('invalid sample');
  });

  it('accepts only the active trace and builds the expected fixed-audio URL', () => {
    expect(isCurrentTrace('active', 'active')).toBe(true);
    expect(isCurrentTrace('active', 'late')).toBe(false);
    expect(isCurrentTrace(null, 'active')).toBe(false);
    expect(streamingSampleUrl('pocket', 'alba', 'water')).toBe('/preview/voice-eval/pocket/alba/water.wav');
    expect(streamingSampleUrl('kokoro', 'af_heart', 'long')).toBe('/preview/voice-eval/kokoro/af_heart/long.wav');
    expect(streamingSampleUrl('nano', 'alba', 'water')).toBe('/preview/voice-eval/nano/alba/water.wav');
    expect(streamingSampleUrl('qwen', 'serena', 'long')).toBe('/preview/voice-eval/qwen/serena/long.wav');
  });

  it('waits for an output quantum before silence ack, rejects late worklet chunks and excludes end underruns', () => {
    const messages: Record<string, unknown>[] = [];
    let Processor: new () => { port: { onmessage: ((event: { data: Record<string, unknown> }) => void) | null; postMessage: (data: Record<string, unknown>) => void }; process: (_inputs: unknown, outputs: Float32Array[][]) => boolean };
    class WorkletBase {
      port = { onmessage: null as ((event: { data: Record<string, unknown> }) => void) | null, postMessage: (data: Record<string, unknown>) => messages.push(data) };
    }
    runInNewContext(readFileSync('src/client/pcm-worklet.js', 'utf8'), {
      AudioWorkletProcessor: WorkletBase,
      Float32Array,
      registerProcessor: (_name: string, ctor: typeof Processor) => { Processor = ctor; },
    });
    const worklet = new Processor!();
    const send = (data: Record<string, unknown>) => worklet.port.onmessage?.({ data });
    const quantum = () => { const output = new Float32Array(4); worklet.process([], [[output]]); return output; };
    send({ type: 'start', trace: 'old-trace', targetFrames: 2, maxFrames: 16 });
    send({ type: 'chunk', trace: 'old-trace', seq: 0, pcm: new Float32Array([0.00001, 0.25]) });
    const rendered = quantum();
    expect(rendered[0]).toBeCloseTo(0.00001, 7);
    expect([...rendered.slice(1)]).toEqual([0.25, 0, 0]);
    expect(messages.find(message => message.type === 'first_nonzero_rendered')).toMatchObject({ frameOffset: 1, renderedFrames: 1 });
    send({ type: 'cancel', trace: 'old-trace' });
    expect(messages.some(message => message.type === 'silence')).toBe(false);
    expect([...quantum()]).toEqual([0, 0, 0, 0]);
    expect(messages.at(-1)).toMatchObject({ type: 'silence', trace: 'old-trace', queuedFrames: 0 });
    send({ type: 'chunk', trace: 'old-trace', seq: 1, pcm: new Float32Array([0.5]) });
    expect(messages.filter(message => message.type === 'enqueued')).toHaveLength(1);

    send({ type: 'start', trace: 'underrun-trace', targetFrames: 1, maxFrames: 16 });
    send({ type: 'chunk', trace: 'underrun-trace', seq: 0, pcm: new Float32Array([0.5]) });
    quantum();
    send({ type: 'complete', trace: 'underrun-trace' });
    quantum();
    expect(messages.find(message => message.type === 'drained' && message.trace === 'underrun-trace')).toMatchObject({ underruns: 1 });
  });

  it('sends cancellation, ignores late and stale audio, and records the worklet silence acknowledgement', async () => {
    class FakePort {
      onmessage: ((event: MessageEvent) => void) | null = null;
      messages: Record<string, unknown>[] = [];
      postMessage(message: Record<string, unknown>) { this.messages.push(message); }
      emit(data: Record<string, unknown>) { this.onmessage?.({ data } as MessageEvent); }
    }
    class FakeNode {
      port = new FakePort();
      connect() {}
      disconnect() {}
    }
    class FakeAudioContext {
      static instances: FakeAudioContext[] = [];
      sampleRate = 24_000;
      state: AudioContextState = 'running';
      destination = {} as AudioDestinationNode;
      audioWorklet = { addModule: vi.fn(async () => undefined) };
      node?: FakeNode;
      constructor(_options: AudioContextOptions) { FakeAudioContext.instances.push(this); }
      resume = vi.fn(async () => undefined);
      close = vi.fn(async () => { this.state = 'closed'; });
    }
    class FakeAudioWorkletNode extends FakeNode {
      constructor(_context: AudioContext, _name: string, _options: AudioWorkletNodeOptions) { super(); FakeAudioContext.instances.at(-1)!.node = this; }
    }
    class FakeWebSocket {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
      static instances: FakeWebSocket[] = [];
      readyState = FakeWebSocket.CONNECTING;
      onopen: (() => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      sent: Record<string, unknown>[] = [];
      constructor(readonly url: string) { FakeWebSocket.instances.push(this); }
      send(value: string) { this.sent.push(JSON.parse(value)); }
      close() { this.readyState = FakeWebSocket.CLOSED; this.onclose?.(); }
      open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
      emit(value: Record<string, unknown>) { this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent); }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
    vi.stubGlobal('WebSocket', FakeWebSocket);
    render(<StreamingAudition />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0]!;
    act(() => { socket.open(); socket.emit({ type: 'ready' }); });
    fireEvent.click(screen.getByRole('button', { name: 'Play live sample' }));
    const start = socket.sent.find(message => message.type === 'start')!;
    expect(start).toMatchObject({ type: 'start', sample: 'water', voice: 'alba' });
    const trace = String(start.trace);
    const port = FakeAudioContext.instances[0]!.node!.port;
    const beforeLateAudio = port.messages.length;
    act(() => socket.emit({ type: 'audio', trace: 'different-trace', seq: 0, model_elapsed_ms: 1, pcm: float32Base64(0.1) }));
    expect(port.messages).toHaveLength(beforeLateAudio);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(socket.sent).toContainEqual({ type: 'cancel', trace });
    expect(port.messages.at(-1)).toMatchObject({ type: 'cancel', trace });
    const afterCancel = port.messages.length;
    act(() => socket.emit({ type: 'audio', trace, seq: 0, model_elapsed_ms: 3, pcm: float32Base64(0.1) }));
    expect(port.messages).toHaveLength(afterCancel);
    act(() => port.emit({ type: 'silence', trace, queuedFrames: 0 }));
    expect(screen.getByRole('status')).toHaveTextContent('Stopped.');
    expect(screen.getByLabelText('Timing metrics')).toHaveTextContent('cancellationTapToSilenceAckMs');
  });
});
