// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startVoice } from '../src/client/voice.js';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('browser microphone lifecycle (synthetic device)', () => {
  it('stops a late microphone grant when connecting has been cancelled', async () => {
    vi.stubGlobal('isSecureContext', true);
    const stop = vi.fn();
    let grant!: (value: MediaStream) => void;
    const getUserMedia = vi.fn(() => new Promise<MediaStream>(resolve => { grant = resolve; }));
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const network = vi.fn(); vi.stubGlobal('fetch', network);
    const controller = new AbortController();
    const pending = startVoice({ signal: controller.signal, onState: vi.fn(), onTranscript: vi.fn(), onChange: vi.fn() });
    controller.abort();
    grant({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await expect(pending).rejects.toThrow('stopped');
    expect(stop).toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });
  it('keeps touch available when microphone permission is refused', async () => {
    vi.stubGlobal('isSecureContext', true);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockRejectedValue(new DOMException('Refused', 'NotAllowedError')) } });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const onState = vi.fn();
    await expect(startVoice({ onState, onTranscript: vi.fn(), onChange: vi.fn() })).rejects.toThrow('use touch');
    expect(onState).toHaveBeenLastCalledWith('error', expect.stringContaining('permission'));
  });
});
