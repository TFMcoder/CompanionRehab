// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReminderDelivery, type ReminderClientService } from '../src/client/ReminderDelivery';
import { IntakeTimingControls } from '../src/client/IntakeTimingControls';
import type { PromptItem } from '../src/shared/local-day-contracts';

afterEach(() => { cleanup();vi.unstubAllGlobals();vi.restoreAllMocks(); });
const prompt: PromptItem = { id: 'synthetic-prompt', message: 'Synthetic food check', state: 'claimed', claim_token: 'synthetic-token',
  due_at: '2026-10-18T16:00:00Z', expires_at: '2026-10-18T16:10:00Z', foreground_speech: true, browser_notifications: true };
const panel = (service: ReminderClientService, active = false) => <ReminderDelivery service={service} scopeKey="synthetic-scope" conversationActive={active} voiceEligible onTalk={() => {}} onActivity={() => {}}/>;
function audioFixture(decode = vi.fn(async () => ({}))) {
  const start = vi.fn(), stop = vi.fn(), audio = { state: 'running', resume: vi.fn(async () => {}), close: vi.fn(async () => {}), decodeAudioData: decode,
    createBufferSource: vi.fn(() => ({ start, stop, connect: vi.fn(), buffer: null, onended: null })), destination: {} };
  vi.stubGlobal('AudioContext', function () { return audio; });return { audio, start, stop };
}
describe('foreground reminder fallback and validated audio release', () => {
  it('keeps a denied-notification reminder on screen without requesting permission or starting a microphone', async () => {
    const Notification = Object.assign(vi.fn(), { permission: 'denied', requestPermission: vi.fn() });vi.stubGlobal('Notification', Notification);
    const getUserMedia = vi.fn();Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    try {
      const service = { claim: vi.fn().mockResolvedValueOnce(prompt), ack: vi.fn(async () => ({})), current: vi.fn(async () => true) };
      render(panel(service));await screen.findByText(prompt.message);await waitFor(() => expect(service.ack).toHaveBeenCalledWith(prompt.id, prompt.claim_token, 'in_app'));
      expect(Notification).not.toHaveBeenCalled();expect(Notification.requestPermission).not.toHaveBeenCalled();expect(getUserMedia).not.toHaveBeenCalled();
    } finally { Reflect.deleteProperty(navigator, 'mediaDevices'); }
  });
  it('falls back to visible text after synthesis or notification failure', async () => {
    audioFixture();vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    vi.stubGlobal('Notification', Object.assign(vi.fn(function () { throw new Error('Synthetic browser denial'); }), { permission: 'granted' }));
    let release!: (item: PromptItem) => void;
    const service = { claim: vi.fn(() => new Promise<PromptItem>(resolve => { release = resolve; })), ack: vi.fn(async () => ({})), current: vi.fn(async () => true) };
    render(panel(service));fireEvent.click(screen.getByRole('button', { name: 'Enable reminder sound' }));await screen.findByRole('button', { name: 'Sound enabled' });
    await act(async () => { release(prompt); });
    await waitFor(() => expect(service.ack).toHaveBeenCalledWith(prompt.id, prompt.claim_token, 'in_app'));expect(screen.getByText(prompt.message)).toBeTruthy();
  });
  it('checks source freshness after sound preparation and discards corrected reminders before playback', async () => {
    const audio = audioFixture();vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) })));
    let release!: (item: PromptItem) => void;
    const service = { claim: vi.fn(() => new Promise<PromptItem>(resolve => { release = resolve; })), ack: vi.fn(async () => ({})), current: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false) };
    render(panel(service));fireEvent.click(screen.getByRole('button', { name: 'Enable reminder sound' }));await screen.findByRole('button', { name: 'Sound enabled' });
    await act(async () => { release({ ...prompt, browser_notifications: false }); });
    await waitFor(() => expect(service.current).toHaveBeenCalledTimes(2));expect(audio.start).not.toHaveBeenCalled();expect(service.ack).not.toHaveBeenCalled();expect(screen.queryByText(prompt.message)).toBeNull();
  });
  it('cancels prepared audio across a brief conversation without acknowledging an unheard reminder', async () => {
    let decoded!: (value: {}) => void;const audio = audioFixture(vi.fn(() => new Promise<{}>(resolve => { decoded = resolve; })));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) })));
    let release!: (item: PromptItem) => void;const service = { claim: vi.fn(() => new Promise<PromptItem>(resolve => { release = resolve; })), ack: vi.fn(async () => ({})) };
    const view = render(panel(service));fireEvent.click(screen.getByRole('button', { name: 'Enable reminder sound' }));await screen.findByRole('button', { name: 'Sound enabled' });
    await act(async () => { release({ ...prompt, browser_notifications: false }); });await waitFor(() => expect(audio.audio.decodeAudioData).toHaveBeenCalledOnce());
    view.rerender(panel(service, true));view.rerender(panel(service, false));await act(async () => { decoded({}); });
    expect(audio.start).not.toHaveBeenCalled();expect(service.ack).not.toHaveBeenCalled();expect(screen.queryByText(prompt.message)).toBeNull();
  });
  it('requires exact review for personal food timing and reuses its key after an uncertain save', async () => {
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<IntakeTimingControls busy={false} onSave={save}/>);fireEvent.click(screen.getByText('Food timing choices'));
    fireEvent.change(screen.getByLabelText('Minutes between automatic full-meal suggestions'), { target: { value: '180' } });
    fireEvent.change(screen.getByLabelText('Minutes without a food report before an opted-in check'), { target: { value: '240' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review food timing' }));expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: 'Review food timing' }).textContent).toContain('180 minutes');
    fireEvent.click(screen.getByRole('button', { name: 'Save food timing' }));await waitFor(() => expect(save).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Save food timing' }));await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0]).toEqual(save.mock.calls[0][0]);
  });
});
