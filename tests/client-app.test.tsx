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

  it("keeps a proposal separate until the participant explicitly accepts it", async () => {
    let current = today();
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === "/api/config") return response({ configured: true, voice_available: false, assistant_name: "Nancy", missing: [] });
      if (path === "/api/auth/session") return response({ authenticated: true });
      if (path === "/api/today") return response(current);
      if (path === "/api/commands") {
        const command = JSON.parse(String(init?.body));
        if (command.type === "propose_day_plan") {
          current = today({ revision: 2, proposal: proposed, accepted: null });
          return response({ command_id: command.idempotency_key, checkin_id: ids.checkin, revision: 2, result: "proposed", plan: proposed, replayed: false });
        }
        if (command.type === "accept_day_plan") {
          current = today({ revision: 3, proposal: proposed, accepted: { ...proposed, version: 1, accepted_at: "2026-09-29T14:01:00Z" } });
          return response({ command_id: command.idempotency_key, checkin_id: ids.checkin, revision: 3, result: "accepted", plan: current.checkin!.accepted, replayed: false });
        }
      }
      throw new Error(`Unexpected request ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    expect(await screen.findByRole("heading", { name: "Choose what feels right today." })).toBeInTheDocument();
    chooseMeals();
    fireEvent.click(screen.getByRole("button", { name: "Save plan for review" }));
    expect(await screen.findByRole("heading", { name: "Review this plan" })).toBeInTheDocument();
    expect(screen.getByText("Nothing has been accepted yet. Look it over, then choose what happens next.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept this plan" })).toBeInTheDocument();
    expect(screen.queryByText("Today’s accepted plan")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Accept this plan" }));
    expect(await screen.findByRole("heading", { name: "Today’s accepted plan" })).toBeInTheDocument();
    const commandTypes = fetchMock.mock.calls.filter(([path]) => path === "/api/commands").map(([, init]) => JSON.parse(String((init as RequestInit).body)).type);
    expect(commandTypes).toEqual(["propose_day_plan", "accept_day_plan"]);
  });

  it('keeps unsaved choices on an unchanged refresh and resets them for a new plan version', async () => {
    let current = today();
    let reads = 0;
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path === '/api/config') return response({ configured: true, voice_available: false, assistant_name: 'Nancy', missing: [] });
      if (path === '/api/auth/session') return response({ authenticated: true });
      if (path === '/api/today') { reads += 1; return response(current); }
      throw new Error(`Unexpected request ${path}`);
    }));
    render(<App />);
    await screen.findByRole('heading', { name: 'Choose what feels right today.' });
    chooseMeals();
    fireEvent.click(screen.getByRole('checkbox', { name: /Fold the laundry/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh', exact: true }));
    await waitFor(() => expect(reads).toBe(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled());
    expect(screen.getByLabelText('Breakfast')).toHaveValue(ids.breakfast);
    expect(screen.getByRole('checkbox', { name: /Fold the laundry/ })).not.toBeChecked();
    current = today({ revision: 2, proposal: proposed });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh', exact: true }));
    fireEvent.click(await screen.findByRole('button', { name: 'Make changes' }));
    expect(screen.getByRole('checkbox', { name: /Fold the laundry/ })).toBeChecked();
    expect(screen.getByLabelText('Breakfast')).toHaveValue(ids.breakfast);
    expect(screen.getByRole('button', { name: 'Save plan for review' })).toBeEnabled();
  });

  it("does not retry an unconfirmed plan write and retains its receipt key until confirmation", async () => {
    let receiptAttempts = 0;
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === "/api/config") return response({ configured: true, voice_available: false, assistant_name: "Nancy", missing: [] });
      if (path === "/api/auth/session") return response({ authenticated: true });
      if (path === "/api/today") return response(today());
      if (path === "/api/commands") return response({ error: { code: "temporarily_unavailable", message: "Try later" } }, 503);
      if (String(path).startsWith("/api/receipts/")) {
        receiptAttempts += 1;
        if (receiptAttempts === 1) return Promise.reject(new TypeError("still offline"));
        return response({ command_id: "88888888-8888-4888-888888888888", checkin_id: ids.checkin, revision: 2, result: "proposed", plan: proposed, replayed: false });
      }
      throw new Error(`Unexpected request ${path} ${init?.method ?? "GET"}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    expect(await screen.findByRole("heading", { name: "Choose what feels right today." })).toBeInTheDocument();
    chooseMeals();
    fireEvent.click(screen.getByRole("button", { name: "Save plan for review" }));
    expect(await screen.findByRole("button", { name: "Check saved plan" })).toBeInTheDocument();
    expect(screen.getByText("Save unconfirmed. Check saved plan.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check saved plan" }));
    await waitFor(() => expect(screen.getByText("Save is still unconfirmed. It was not sent again.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Check saved plan" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check saved plan" }));
    await waitFor(() => expect(screen.getByText("Your plan is ready for review.")).toBeInTheDocument());
    expect(fetchMock.mock.calls.filter(([path]) => path === "/api/commands")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([path]) => String(path).startsWith("/api/receipts/"))).toHaveLength(2);
  });

  it("discards a late command result after this view has closed", async () => {
    let resolveCommand: ((value: Response) => void) | undefined;
    const command = new Promise<Response>(resolve => { resolveCommand = resolve; });
    const fetchMock = vi.fn(async (path: string) => {
      if (path === "/api/config") return response({ configured: true, voice_available: false, assistant_name: "Nancy", missing: [] });
      if (path === "/api/auth/session") return response({ authenticated: true });
      if (path === "/api/today") return response(today());
      if (path === "/api/commands") return command;
      throw new Error(`Unexpected request ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { unmount } = render(<App />);
    expect(await screen.findByRole("heading", { name: "Choose what feels right today." })).toBeInTheDocument();
    chooseMeals();
    fireEvent.click(screen.getByRole("button", { name: "Save plan for review" }));
    unmount();
    resolveCommand!(response({ command_id: "88888888-8888-4888-888888888888", checkin_id: ids.checkin, revision: 2, result: "proposed", plan: proposed, replayed: false }));
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock.mock.calls.filter(([path]) => path === "/api/today")).toHaveLength(1);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("preserves retained task and meal IDs when choices are edited", async () => {
    let setupPayload: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === "/api/config") return response({ configured: true, voice_available: false, assistant_name: "Nancy", missing: [] });
      if (path === "/api/auth/session") return response({ authenticated: true });
      if (path === "/api/today") return response(today());
      if (path === "/api/setup") {
        setupPayload = JSON.parse(String(init?.body));
        return response(today());
      }
      throw new Error(`Unexpected request ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    expect(await screen.findByRole("button", { name: "Edit choices" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit choices" }));
    expect(await screen.findByRole("button", { name: "Save choices" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save choices" }));
    await waitFor(() => expect(setupPayload).toBeDefined());
    expect(setupPayload).toMatchObject({ expected_revision: 1, tasks: [{ id: ids.task }] });
    expect(setupPayload?.meal_options).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ids.breakfast, name: "Oatmeal", slots: ["breakfast"] }),
      expect.objectContaining({ id: ids.lunch, name: "Soup", slots: ["lunch"] }),
      expect.objectContaining({ id: ids.dinner, name: "Pasta", slots: ["dinner"] }),
    ]));
  });

  it('saves one real task without requiring invented meal choices', async () => {
    let setupPayload: Record<string, unknown> | undefined;
    const empty: Today = { ...today(), profile: null, tasks: [], meal_options: [], checkin: null };
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/config') return response({ configured: true, voice_available: false, assistant_name: 'Nancy', missing: [] });
      if (path === '/api/auth/session') return response({ authenticated: true });
      if (path === '/api/today') return response(empty);
      if (path === '/api/setup') { setupPayload = JSON.parse(String(init?.body)); return response({ ...empty, profile: today().profile, tasks: [{ id: ids.task, title: 'Call the clinic', time_hint: null }] }); }
      throw new Error(`Unexpected request ${path}`);
    }));
    render(<App />);
    fireEvent.change(await screen.findByLabelText('What should Nancy call you?'), { target: { value: 'Pat' } });
    fireEvent.change(screen.getByLabelText('Tasks to choose from'), { target: { value: 'Call the clinic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to today' }));
    await waitFor(() => expect(setupPayload).toBeDefined());
    expect(setupPayload).toMatchObject({ tasks: [{ title: 'Call the clinic' }], meal_options: [] });
    expect(setupSchema.safeParse(setupPayload).success).toBe(true);
    expect(await screen.findByRole('heading', { name: 'Add meal choices to plan today' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add choices' })).toBeInTheDocument();
  });

  it("aborts a still-connecting voice start and stops its late handle", async () => {
    let resolveVoice: ((value: { stop: () => Promise<void> }) => void) | undefined;
    const stop = vi.fn().mockResolvedValue(undefined);
    vi.mocked(startVoice).mockReturnValue(new Promise(resolve => { resolveVoice = resolve; }));
    vi.stubGlobal("fetch", vi.fn(async (path: string) => {
      if (path === "/api/config") return response({ configured: true, voice_available: true, assistant_name: "Nancy", missing: [] });
      if (path === "/api/auth/session") return response({ authenticated: true });
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
      if (path === '/api/auth/session') return response({ authenticated: true });
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

  it("clears participant data when a command discovers revoked access", async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path === '/api/config') return response({ configured: true, voice_available: false, assistant_name: 'Nancy', missing: [] });
      if (path === '/api/auth/session') return response({ authenticated: true });
      if (path === '/api/today') return response(today({ proposal: proposed }));
      if (path === '/api/commands') return response({ error: { code: 'unauthorized', message: 'Please sign in.' } }, 401);
      throw new Error('Unexpected request');
    }));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Accept this plan' }));
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.queryByText('Fold the laundry')).not.toBeInTheDocument();
    expect(screen.queryByText('Oatmeal')).not.toBeInTheDocument();
  });

  it("does not present an uncertain logout as confirmed", async () => {
    let attempts = 0;
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path === '/api/config') return response({ configured: true, voice_available: false, assistant_name: 'Nancy', missing: [] });
      if (path === '/api/auth/session') return response({ authenticated: true });
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

  it('uses a confirmed acceptance receipt even when the following read fails', async () => {
    let committed = false;
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path === '/api/config') return response({ configured: true, voice_available: false, assistant_name: 'Nancy', missing: [] });
      if (path === '/api/auth/session') return response({ authenticated: true });
      if (path === '/api/today') { if (committed) throw new TypeError('read unavailable'); return response(today({ proposal: proposed })); }
      if (path === '/api/commands') {
        committed = true;
        return response({ command_id: ids.proposal, checkin_id: ids.checkin, revision: 2, result: 'accepted', plan: { ...proposed, version: 1, accepted_at: '2026-09-29T14:00:00Z' }, replayed: false });
      }
      throw new Error('Unexpected request');
    }));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Accept this plan' }));
    expect(await screen.findByRole('heading', { name: 'Today’s accepted plan' })).toBeInTheDocument();
    expect(await screen.findByText('Your plan is saved.')).toBeInTheDocument();
    expect(await screen.findByText(/Your last confirmed plan is still shown/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept this plan' })).not.toBeInTheDocument();
  });

  it('discards an older Today read when a newer voice-triggered refresh has already finished', async () => {
    const reads: Array<(value: Response) => void> = [];
    let first = true;
    vi.mocked(startVoice).mockResolvedValue({ stop: vi.fn().mockResolvedValue(undefined) });
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path === '/api/config') return response({ configured: true, voice_available: true, assistant_name: 'Nancy', missing: [] });
      if (path === '/api/auth/session') return response({ authenticated: true });
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
    expect(await screen.findByRole('heading', { name: 'Today’s accepted plan' })).toBeInTheDocument();
    await act(async () => { reads[0](response(today())); });
    expect(screen.getByRole('heading', { name: 'Today’s accepted plan' })).toBeInTheDocument();
  });

  it('treats malformed successful write responses as unconfirmed', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('truncated JSON'); } });
    vi.stubGlobal('fetch', request);
    await expect(api.command({ type: 'start_or_resume_checkin', idempotency_key: ids.proposal, expected_revision: 0, local_date: '2026-09-29', payload: {} })).rejects.toMatchObject({ code: 'connection_unconfirmed' });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
