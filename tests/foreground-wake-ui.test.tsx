// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WakeControl } from '../src/client/WakeControl';

const wake = vi.hoisted(() => ({ start: vi.fn(), supported: vi.fn() }));
vi.mock('../src/client/foreground-wake', () => ({ startForegroundWake: wake.start, foregroundWakeSupported: wake.supported }));

beforeEach(() => { wake.supported.mockReturnValue(true); wake.start.mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('foreground wake opt-in UI', () => {
  it('does not request a microphone until explicit enable, then stops on scope change', async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    wake.start.mockResolvedValue({ stop });
    const onWake = vi.fn();
    const view = render(<WakeControl scopeKey="client-a" enabled conversationActive={false} onWake={onWake} />);
    expect(wake.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Enable Hey Nancy' }));
    expect(wake.start).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Stop Hey Nancy' })).toBeTruthy());
    view.rerender(<WakeControl scopeKey="client-b" enabled conversationActive={false} onWake={onWake} />);
    await vi.waitFor(() => expect(stop).toHaveBeenCalled());
    expect(onWake).not.toHaveBeenCalled();
  });
  it('stops when conversation starts and ignores a late wake callback', async () => {
    let signal!: AbortSignal;
    let lateWake!: () => Promise<void>;
    const stop = vi.fn().mockResolvedValue(undefined);
    wake.start.mockImplementation(async (options: { signal: AbortSignal; onWake: () => Promise<void> }) => {
      signal = options.signal; lateWake = options.onWake; return { stop };
    });
    const onWake = vi.fn();
    const view = render(<WakeControl scopeKey="client-a" enabled conversationActive={false} onWake={onWake} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enable Hey Nancy' }));
    await vi.waitFor(() => expect(wake.start).toHaveBeenCalled());
    view.rerender(<WakeControl scopeKey="client-a" enabled conversationActive onWake={onWake} />);
    expect(signal.aborted).toBe(true);
    await lateWake();
    expect(onWake).not.toHaveBeenCalled();
  });
  it('keeps the normal button route available when wake is unsupported', () => {
    wake.supported.mockReturnValue(false);
    render(<WakeControl scopeKey="client-a" enabled conversationActive={false} onWake={vi.fn()} />);
    expect(screen.getByText(/Use Talk to Nancy/)).toBeTruthy();
    expect(wake.start).not.toHaveBeenCalled();
  });
});
