// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/client/voice", () => ({ startVoice: vi.fn() }));

import { App } from "../src/client/App";
import { api, ApiError } from "../src/client/api";
import { startVoice } from "../src/client/voice";
import { setupSchema, type Today } from "../src/shared/contracts";

const ids = {
  profile: "11111111-1111-4111-8111-111111111111",
  checkin: "22222222-2222-4222-8222-222222222222",
  task: "33333333-3333-4333-833333333333",
  breakfast: "44444444-4444-4444-844444444444",
  lunch: "55555555-5555-4555-855555555555",
  dinner: "66666666-6666-4666-866666666666",
  proposal: "77777777-7777-4777-877777777777",
};

function today(overrides: Partial<NonNullable<Today["checkin"]>> = {}): Today {
  return {
    profile: { id: ids.profile, display_name: "Pat", time_zone: "America/Toronto", preferences: "", revision: 1 },
    local_date: "2026-09-29",
    tasks: [{ id: ids.task, title: "Fold the laundry", time_hint: "Morning" }],
    meal_options: [
      { id: ids.breakfast, name: "Oatmeal", slots: ["breakfast"] },
      { id: ids.lunch, name: "Soup", slots: ["lunch"] },
      { id: ids.dinner, name: "Pasta", slots: ["dinner"] },
    ],
    checkin: { id: ids.checkin, local_date: "2026-09-29", revision: 1, proposal: null, accepted: null, ...overrides },
  };
}

const proposed = {
  id: ids.proposal,
  task_ids: [ids.task],
  tasks: [{ id: ids.task, title: "Fold the laundry", time_hint: "Morning" }],
  meals: [
    { slot: "breakfast" as const, option_id: ids.breakfast, name: "Oatmeal" },
    { slot: "lunch" as const, option_id: ids.lunch, name: "Soup" },
    { slot: "dinner" as const, option_id: ids.dinner, name: "Pasta" },
  ],
  created_at: "2026-09-29T14:00:00Z",
};

function response(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function chooseMeals() {
  fireEvent.change(screen.getByLabelText("Breakfast"), { target: { value: ids.breakfast } });
  fireEvent.change(screen.getByLabelText("Lunch"), { target: { value: ids.lunch } });
  fireEvent.change(screen.getByLabelText("Dinner"), { target: { value: ids.dinner } });
  expect(screen.getByLabelText("Breakfast")).toHaveValue(ids.breakfast);
  expect(screen.getByLabelText("Lunch")).toHaveValue(ids.lunch);
  expect(screen.getByLabelText("Dinner")).toHaveValue(ids.dinner);
  expect(screen.getByRole("button", { name: "Save plan for review" })).toBeEnabled();
}

describe("S01 participant plan UI", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "88888888-8888-4888-888888888888") });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("aborts a still-connecting voice start and stops its late handle", async () => {
    let resolveVoice: ((value: { stop: () => Promise<void> }) => void) | undefined;
    const stop = vi.fn().mockResolvedValue(undefined);
    vi.mocked(startVoice).mockReturnValue(new Promise(resolve => { resolveVoice = resolve; }));
    vi.stubGlobal("fetch", vi.fn(async (path: string) => {
      if (path === "/api/config") return response({ configured: true, voice_available: true, assistant_name: "Nancy", missing: [] });
      if (path === "/api/auth/session") return response({ authenticated: true, role: 'client', participant_id: '11111111-1111-4111-8111-111111111111', scope_key: 'client-test-scope', voice_eligible: true, task_requests_available: true });
      if (path === "/api/today") return response(today());
      throw new Error(`Unexpected request ${path}`);
    }));

    render(<App />);
    expect(await screen.findByRole("button", { name: "Talk to Nancy" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Talk to Nancy" }));
    await waitFor(() => expect(startVoice).toHaveBeenCalledTimes(1));
    const options = vi.mocked(startVoice).mock.calls[0][0];
    fireEvent.click(screen.getByRole("button", { name: "Stop voice" }));
    expect(options.signal?.aborted).toBe(true);
    resolveVoice!({ stop });
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
  });

  it('rechecks a warming voice when Talk to Nancy is pressed', async () => {
    let configReads = 0;
    const stop = vi.fn().mockResolvedValue(undefined);
    vi.mocked(startVoice).mockResolvedValue({ stop });
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path === '/api/config') return response({ configured: true, voice_available: ++configReads > 1, assistant_name: 'Nancy', missing: [] });
      if (path === '/api/auth/session') return response({ authenticated: true, role: 'client', participant_id: '11111111-1111-4111-8111-111111111111', scope_key: 'client-test-scope', voice_eligible: true, task_requests_available: true });
      if (path === '/api/today') return response(today());
      throw new Error(`Unexpected request ${path}`);
    }));
    render(<App />);
    expect(await screen.findByText(/Nancy’s voice is warming up/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Talk to Nancy' }));
    await waitFor(() => expect(startVoice).toHaveBeenCalledTimes(1));
    expect(configReads).toBe(2);
    expect(screen.getByRole('button', { name: 'Stop voice' })).toBeInTheDocument();
  });

  it("treats a timed-out write as unconfirmed", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_path: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const write = api.command({ type: "start_or_resume_checkin", idempotency_key: "88888888-8888-4888-888888888888", local_date: "2026-09-29", expected_revision: 0, payload: {} });
    const assertion = expect(write).rejects.toMatchObject({ code: "connection_unconfirmed" });
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });

  it("does not present an uncertain logout as confirmed", async () => {
    let attempts = 0;
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path === '/api/config') return response({ configured: true, voice_available: false, assistant_name: 'Nancy', missing: [] });
      if (path === '/api/auth/session') return response({ authenticated: true, role: 'client', participant_id: '11111111-1111-4111-8111-111111111111', scope_key: 'client-test-scope', voice_eligible: true, task_requests_available: true });
      if (path === '/api/today') return response(today());
      if (path === '/api/auth/logout') { if (++attempts === 1) throw new TypeError('offline'); return response({ ok: true }); }
      throw new Error('Unexpected request');
    }));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Check sign-out' })).toBeInTheDocument();
    expect(screen.queryByText('Fold the laundry')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try sign-out again' }));
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it('discards an older Today read when a newer voice-triggered refresh has already finished', async () => {
    const reads: Array<(value: Response) => void> = [];
    let first = true;
    vi.mocked(startVoice).mockResolvedValue({ stop: vi.fn().mockResolvedValue(undefined) });
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path === '/api/config') return response({ configured: true, voice_available: true, assistant_name: 'Nancy', missing: [] });
      if (path === '/api/auth/session') return response({ authenticated: true, role: 'client', participant_id: '11111111-1111-4111-8111-111111111111', scope_key: 'client-test-scope', voice_eligible: true, task_requests_available: true });
      if (path === '/api/today') { if (first) { first = false; return response(today()); } return new Promise<Response>(resolve => reads.push(resolve)); }
      throw new Error('Unexpected request');
    }));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Talk to Nancy' }));
    await waitFor(() => expect(startVoice).toHaveBeenCalled());
    const options = vi.mocked(startVoice).mock.calls[0][0];
    act(() => { options.onChange(); options.onChange(); });
    expect(reads).toHaveLength(2);
    const latest = today({ revision: 3, proposal: proposed, accepted: { ...proposed, version: 1, accepted_at: '2026-09-29T14:00:00Z' } });
    await act(async () => { reads[1](response(latest)); });
    expect(await screen.findAllByText('In accepted plan')).toHaveLength(3);
    await act(async () => { reads[0](response(today())); });
    expect(screen.getAllByText('In accepted plan')).toHaveLength(3);
  });

  it('treats malformed successful write responses as unconfirmed', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('truncated JSON'); } });
    vi.stubGlobal('fetch', request);
    await expect(api.command({ type: 'start_or_resume_checkin', idempotency_key: ids.proposal, expected_revision: 0, local_date: '2026-09-29', payload: {} })).rejects.toMatchObject({ code: 'connection_unconfirmed' });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
