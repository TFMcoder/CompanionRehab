import type { AppConfig, CareCommand, GroceryItem, Receipt, SetupInput, Today } from "../shared/contracts";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type ErrorBody = { error?: { code?: string; message?: string } };

async function request<T>(path: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  const isWrite = (init?.method ?? "GET").toUpperCase() !== "GET";
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs ?? (isWrite ? 15_000 : 12_000));
  try {
    const response = await fetch(path, {
      credentials: "same-origin",
      ...init,
      signal: init?.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal,
      headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    });
    if (isWrite && response.status >= 500) throw new ApiError(response.status, "connection_unconfirmed", "Save unconfirmed. Check saved plan.");
    if (!response.ok) {
      if (response.status === 401) window.dispatchEvent(new Event('nancy:session-expired'));
      const body = await response.json().catch((): ErrorBody => ({}));
      throw new ApiError(response.status, body.error?.code ?? "request_failed", body.error?.message ?? "Something went wrong. Please try again.");
    }
    try {
      return await response.json() as T;
    } catch {
      if (isWrite) throw new ApiError(response.status, "connection_unconfirmed", "Save unconfirmed. Check saved plan.");
      throw new ApiError(response.status, "invalid_response", "Nancy could not read the latest plan. Please refresh.");
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (isWrite) throw new ApiError(0, "connection_unconfirmed", "Save unconfirmed. Check saved plan.");
    throw new ApiError(0, "connection_unavailable", "Nancy could not reach the latest plan. Please refresh.");
  } finally {
    window.clearTimeout(timeout);
  }
}

export interface ConversationReply { text: string; reply_id: string; navigate?: string; changed?: boolean; transcript?: string; speech_parts?: number }
export interface ConversationStart extends ConversationReply { session_id: string }
export interface GroceryInput { name: string; quantity?: string; idempotency_key: string }

export const api = {
  config: () => request<AppConfig>("/api/config"),
  session: () => request<{ authenticated: true }>("/api/auth/session"),
  login: (email: string, password: string) => request<{ ok: true }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST", body: "{}" }),
  today: () => request<Today>("/api/today"),
  setup: (input: SetupInput) => request<Today>("/api/setup", { method: "POST", body: JSON.stringify(input) }),
  command: (command: CareCommand) => request<Receipt>("/api/commands", { method: "POST", body: JSON.stringify(command) }),
  receipt: (key: string) => request<Receipt>(`/api/receipts/${encodeURIComponent(key)}`),
  groceries: () => request<{ items: GroceryItem[] } | GroceryItem[]>("/api/groceries"),
  addGrocery: (input: GroceryInput) => request<GroceryItem>("/api/groceries", { method: "POST", body: JSON.stringify(input) }),
  addAppointment: (input: { title: string; starts_at: string; idempotency_key: string }) => request<{ appointment: { id: string; title: string; starts_at: string } }>("/api/appointments", { method: "POST", body: JSON.stringify(input) }),
  conversationStart: (signal?: AbortSignal) => request<ConversationStart>("/api/conversation", { method: "POST", body: "{}", signal }, 90_000),
  conversationTurn: (id: string, text: string, turnId: string, signal?: AbortSignal) => request<ConversationReply>(`/api/conversation/${encodeURIComponent(id)}/turn`, { method: "POST", body: JSON.stringify({ text, turn_id: turnId }), signal }, 90_000),
  conversationAudio: (id: string, wav: string, turnId: string, signal?: AbortSignal) => request<ConversationReply>(`/api/conversation/${encodeURIComponent(id)}/audio`, { method: "POST", body: JSON.stringify({ wav, turn_id: turnId }), signal }, 90_000),
  conversationPlayed: (id: string, replyId: string, signal?: AbortSignal) => request<{ ok: true }>(`/api/conversation/${encodeURIComponent(id)}/played`, { method: "POST", body: JSON.stringify({ reply_id: replyId }), signal }),
  conversationInterrupt: (id: string, signal?: AbortSignal) => request<{ ok: true }>(`/api/conversation/${encodeURIComponent(id)}/interrupt`, { method: "POST", body: "{}", signal }),
  conversationEnd: (id: string) => request<{ ok: true }>(`/api/conversation/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
