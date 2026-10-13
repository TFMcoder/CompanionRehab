// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from '../src/client/api';
import { PendingCommandsPanel } from '../src/client/PendingCommands';
import { PendingCommands, type PendingCommand, type PendingStorage, type PendingTransport } from '../src/client/pending-commands';
import type { CareCommand } from '../src/shared/contracts';

afterEach(cleanup);

it('shows truthful unknown state and requires latest-day review before a same-key retry', async () => {
  const key = '11111111-1111-4111-8111-111111111111';
  const command: CareCommand = { type: 'start_or_resume_checkin', idempotency_key: key, local_date: '2026-10-13', expected_revision: 0, payload: {} };
  const storage: PendingStorage = {
    read: async () => rows,
    write: async items => { rows = structuredClone(items); },
    clear: async () => { rows = []; },
  };
  let rows: PendingCommand[] = [];
  const transport: PendingTransport = {
    scopeKey: async () => 'scope-1',
    receipt: vi.fn(async () => { throw new ApiError(404, 'not_found', 'No receipt'); }),
    command: vi.fn(async () => { throw new ApiError(503, 'connection_unconfirmed', 'Unknown'); }),
  };
  const controller = new PendingCommands(storage, transport, () => 1_000_000);
  await controller.activate('scope-1');
  await controller.queue('care', command);
  await expect(controller.submit(key)).rejects.toBeInstanceOf(ApiError);
  const review = vi.fn(async () => undefined);
  render(<PendingCommandsPanel controller={controller} onReview={review} />);
  expect(screen.getByText('Save unconfirmed. Check the receipt when connected.')).toBeInTheDocument();
  expect(screen.getByText(/Voice needs a connection/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Check saved receipt' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry same change' })).toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: 'Review latest day plan' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry same change' })).toBeEnabled());
  expect(review).toHaveBeenCalledOnce();
  expect(review).toHaveBeenCalledWith('care');
  expect(transport.command).toHaveBeenCalledTimes(1);
});
