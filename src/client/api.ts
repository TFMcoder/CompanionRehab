import type { AppConfig, CareCommand, Receipt, SetupInput, Today } from "../shared/contracts";

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isWrite = (init?.method ?? "GET").toUpperCase() !== "GET";
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), isWrite ? 15_000 : 12_000);
  try {
    const response = await fetch(path, {
      credentials: "same-origin",
      ...init,
      signal: controller.signal,
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

export const api = {
  config: () => request<AppConfig>("/api/config"),
  session: () => request<{ authenticated: true }>("/api/auth/session"),
  login: (email: string, password: string) => request<{ ok: true }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST", body: "{}" }),
  today: () => request<Today>("/api/today"),
  setup: (input: SetupInput) => request<Today>("/api/setup", { method: "POST", body: JSON.stringify(input) }),
  command: (command: CareCommand) => request<Receipt>("/api/commands", { method: "POST", body: JSON.stringify(command) }),
  receipt: (key: string) => request<Receipt>(`/api/receipts/${encodeURIComponent(key)}`),
};
