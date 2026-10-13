import type { AppConfig, AppRole, CareCommand, GroceryItem, Receipt, SetupInput, Today } from "../shared/contracts";
import type { ActivityCommand, ActivityLedger, ActivityReceipt } from "../shared/activity-contracts";
import type { TaskRequestCommand, TaskRequestDraft, TaskRequestReceipt, TaskRequestReview, TaskRequestWorkspace } from '../shared/task-request-contracts';
import type { MealGroceryCommand, MealGroceryReceipt, MealGroceryWorkspace, GrocerySuggestion } from '../shared/meal-grocery-contracts';
import type { LocalDayCommand, LocalDayReceipt, LocalDayWorkspace, PromptItem } from '../shared/local-day-contracts';
import type { ProgramCommand, ProgramReceipt, ProgramWorkspace } from '../shared/program-contracts';
import type { SupportCommand, SupportReceipt, SupportWorkspace, SupportWorkspaceQuery } from '../shared/support-contracts';
import type { ProgressCommand, ProgressReceipt, ProgressRange, ProgressWorkspace } from '../shared/progress-contracts';
import type { OperationsCommand, OperationsReceipt, OperationsQuery, OperationsWorkspace } from '../shared/operations-contracts';

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
      if (response.status === 403 && body.error?.code === 'scope_changed') window.dispatchEvent(new Event('nancy:scope-changed'));
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
export interface SessionInfo { authenticated: true; role: AppRole; participant_id: string; scope_key: string; voice_eligible: boolean; voice_unavailable_reason?: string | null; task_requests_available?: boolean; local_features_available?: boolean }

export const api = {
  config: () => request<AppConfig>("/api/config"),
  session: () => request<SessionInfo>("/api/auth/session"),
  login: (email: string, password: string) => request<{ ok: true }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST", body: "{}" }),
  today: () => request<Today>("/api/today"),
  setup: (input: SetupInput) => request<Today>("/api/setup", { method: "POST", body: JSON.stringify(input) }),
  command: (command: CareCommand) => request<Receipt>("/api/commands", { method: "POST", body: JSON.stringify(command) }),
  receipt: (key: string) => request<Receipt>(`/api/receipts/${encodeURIComponent(key)}`),
  groceries: () => request<{ items: GroceryItem[] } | GroceryItem[]>("/api/groceries"),
  addGrocery: (input: GroceryInput) => request<GroceryItem>("/api/groceries", { method: "POST", body: JSON.stringify(input) }),
  addAppointment: (input: { title: string; starts_at: string; idempotency_key: string }) => request<{ appointment: { id: string; title: string; starts_at: string } }>("/api/appointments", { method: "POST", body: JSON.stringify(input) }),
  activity: (date?: string) => request<ActivityLedger>(`/api/activity${date ? `?date=${encodeURIComponent(date)}` : ""}`),
  activityCommand: (command: ActivityCommand) => request<ActivityReceipt>("/api/activity/commands", { method: "POST", body: JSON.stringify(command) }),
  activityReceipt: (key: string) => request<ActivityReceipt>(`/api/activity/receipts/${encodeURIComponent(key)}`),
  taskRequests: () => request<TaskRequestWorkspace>('/api/task-requests'),
  reviewTaskRequest: (draft: TaskRequestDraft) => request<TaskRequestReview>('/api/task-requests/review', { method: 'POST', body: JSON.stringify(draft) }),
  taskRequestCommand: (command: TaskRequestCommand) => request<TaskRequestReceipt>('/api/task-requests/commands', { method: 'POST', body: JSON.stringify(command) }),
  taskRequestReceipt: (key: string) => request<TaskRequestReceipt>(`/api/task-requests/receipts/${encodeURIComponent(key)}`),
  mealGroceryWorkspace: () => request<MealGroceryWorkspace>('/api/meals-groceries'),
  mealGrocerySuggestions: (id: string) => request<GrocerySuggestion[]>(`/api/meals-groceries/suggestions/${encodeURIComponent(id)}`),
  mealGroceryCommand: (command: MealGroceryCommand) => request<MealGroceryReceipt>('/api/meals-groceries/commands',{method:'POST',body:JSON.stringify(command)}),
  mealGroceryReceipt: (key: string) => request<MealGroceryReceipt>(`/api/meals-groceries/receipts/${encodeURIComponent(key)}`),
  localDayWorkspace: (before?: string) => request<LocalDayWorkspace>(`/api/local-day${before?`?before=${encodeURIComponent(before)}`:''}`),
  localDayCommand: (command: LocalDayCommand) => request<LocalDayReceipt>('/api/local-day/commands',{method:'POST',body:JSON.stringify(command)}),
  localDayReceipt: (key: string) => request<LocalDayReceipt>(`/api/local-day/receipts/${encodeURIComponent(key)}`),
  claimPrompt: () => request<PromptItem|null>('/api/prompts/claim',{method:'POST',body:'{}'}),
  promptAck: (id: string,claimToken:string,channel:string) => request<{ok:true}>(`/api/prompts/${encodeURIComponent(id)}/ack`,{method:'POST',body:JSON.stringify({claim_token:claimToken,channel})}),
  programWorkspace: () => request<ProgramWorkspace>('/api/programs'),
  programCommand: (command: ProgramCommand) => request<ProgramReceipt>('/api/programs/commands',{method:'POST',body:JSON.stringify(command)}),
  programReceipt: (key: string) => request<ProgramReceipt>(`/api/programs/receipts/${encodeURIComponent(key)}`),
  supportWorkspace: (query?: SupportWorkspaceQuery) => request<SupportWorkspace>(`/api/support-team${query?`?${new URLSearchParams(Object.entries(query).filter(([,value])=>value!==undefined).map(([field,value])=>[field,String(value)])).toString()}`:''}`),
  supportCommand: (command: SupportCommand) => request<SupportReceipt>('/api/support-team/commands',{method:'POST',body:JSON.stringify(command)}),
  supportReceipt: (key: string) => request<SupportReceipt>(`/api/support-team/receipts/${encodeURIComponent(key)}`),
  progressWorkspace: (range: ProgressRange) => request<ProgressWorkspace>(`/api/progress?${new URLSearchParams(range).toString()}`),
  progressCommand: (command: ProgressCommand) => request<ProgressReceipt>('/api/progress/commands',{method:'POST',body:JSON.stringify(command)}),
  progressReceipt: (key: string) => request<ProgressReceipt>(`/api/progress/receipts/${encodeURIComponent(key)}`),
  operationsWorkspace: (query?:OperationsQuery) => request<OperationsWorkspace>(`/api/operations${query?`?${new URLSearchParams(Object.entries(query).filter(([,value])=>value!==undefined).map(([field,value])=>[field,String(value)])).toString()}`:''}`),
  operationsCommand: (command:OperationsCommand) => request<OperationsReceipt>('/api/operations/commands',{method:'POST',body:JSON.stringify(command)}),
  operationsReceipt: (key:string) => request<OperationsReceipt>(`/api/operations/receipts/${encodeURIComponent(key)}`),
  conversationStart: (signal?: AbortSignal) => request<ConversationStart>("/api/conversation", { method: "POST", body: "{}", signal }, 90_000),
  conversationTurn: (id: string, text: string, turnId: string, signal?: AbortSignal) => request<ConversationReply>(`/api/conversation/${encodeURIComponent(id)}/turn`, { method: "POST", body: JSON.stringify({ text, turn_id: turnId }), signal }, 90_000),
  conversationAudio: (id: string, wav: string, turnId: string, signal?: AbortSignal) => request<ConversationReply>(`/api/conversation/${encodeURIComponent(id)}/audio`, { method: "POST", body: JSON.stringify({ wav, turn_id: turnId }), signal }, 90_000),
  conversationPlayed: (id: string, replyId: string, signal?: AbortSignal) => request<{ ok: true }>(`/api/conversation/${encodeURIComponent(id)}/played`, { method: "POST", body: JSON.stringify({ reply_id: replyId }), signal }),
  conversationInterrupt: (id: string, signal?: AbortSignal) => request<{ ok: true }>(`/api/conversation/${encodeURIComponent(id)}/interrupt`, { method: "POST", body: "{}", signal }),
  conversationEnd: (id: string) => request<{ ok: true }>(`/api/conversation/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
