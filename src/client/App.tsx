import {ClientHome,NancySuggestionsPanel,type CalendarState} from './ClientHome';
import { FormEvent, useEffect, useRef, useState } from "react";
import { api, ApiError, type SessionInfo } from "./api";
import { TaskRequests, type TaskRequestService } from './TaskRequests';
import { PendingCommandsPanel } from './PendingCommands';
import { PendingCommands, type PendingFamily, type RecoverableCommand } from './pending-commands';
import { MealGroceries, type MealGroceryClientService } from './MealGroceries';
import { Programs, type ProgramClientService } from './Programs';
import {WakeControl} from './WakeControl';
import { SupportTeam, type SupportTeamClientService } from './SupportTeam';
import type {LocalDayClientService} from './LocalDayPanel';
import { ReminderDelivery, type ReminderClientService } from './ReminderDelivery';
import { Operations, type OperationsClientService } from './Operations';
import { Progress } from './Progress';
import { startVoice } from "./voice";
import { startLocalVoice, type LocalVoiceState } from "./local-voice";
import { localDateTimeWithOffset } from "../shared/local-time";
import { mealSlots, type AcceptedPlan, type AppConfig, type CareCommand, type ClientView, type GroceryItem, type MealSlot, type Plan, type Receipt, type SetupInput, type Today } from "../shared/contracts";
import type { ActivityCommand, ActivityEntry, ActivityKind, ActivityLedger, ActivityOption, IntakeKind } from "../shared/activity-contracts";
import type { TaskRequestCommand, TaskRequestReceipt } from '../shared/task-request-contracts';
import type { MealGroceryCommand, MealGroceryReceipt } from '../shared/meal-grocery-contracts';
import type { LocalDayCommand, LocalDayReceipt } from '../shared/local-day-contracts';
import type { ProgramCommand, ProgramReceipt } from '../shared/program-contracts';
import type { SupportCommand, SupportReceipt } from '../shared/support-contracts';
import type { ProgressCommand, ProgressReceipt } from '../shared/progress-contracts';
import type { OperationsCommand, OperationsReceipt } from '../shared/operations-contracts';

type AppState = "loading" | "readiness" | "login" | "setup" | "today" | "support" | "signout";
type SaveState = { kind: "idle" | "saving" | "saved" | "unconfirmed" | "conflict" | "error"; message?: string; key?: string };
type VoiceState = LocalVoiceState;
type Transcript = { speaker: "you" | "nancy"; text: string };
type ActivityDraft =
  | { mode: "record"; activity: ActivityOption; status: "completed" | "deferred"; occurredLocal: string; notes: string; portion: string; intakeKind: IntakeKind }
  | { mode: "correct"; activity: ActivityEntry; status: "completed" | "deferred" | "voided"; occurredLocal: string; notes: string; portion: string; intakeKind: IntakeKind; reason: string }
  | { mode: "reschedule"; activity: ActivityOption; scheduledLocal: string; reason: string }
  | { mode: "unplanned"; kind: ActivityKind; title: string; mealSlot: MealSlot; occurredLocal: string; notes: string; portion: string; intakeKind: IntakeKind };

const labelForSlot: Record<MealSlot, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
const keyFor = () => crypto.randomUUID();
const deviceCommands = new PendingCommands();
let durableCommandsEnabled = false;
async function recoverableCommand<T>(family: PendingFamily, command: RecoverableCommand, direct: () => Promise<T>): Promise<T> {
  if (!durableCommandsEnabled) return direct();
  const existing=deviceCommands.snapshot.find(item=>item.key===command.idempotency_key);
  if(existing&&existing.family!==family)throw new ApiError(409,'conflict','This receipt key belongs to another change.');
  if(!existing)await deviceCommands.queue(family, command);
  const result = existing?.status==='unknown' ? await deviceCommands.reconcile(command.idempotency_key)
    : existing?.status==='ready_retry' ? await deviceCommands.retry(command.idempotency_key)
    : existing?.status==='queued'||!existing ? await deviceCommands.submit(command.idempotency_key)
    : existing?.status==='saved' ? await pendingReceipt<T>(family,command.idempotency_key)
    : null;
  if (result === null) {
    const current=deviceCommands.snapshot.find(item=>item.key===command.idempotency_key);
    if(current?.status==='ready_retry')throw new ApiError(404,'not_found','No saved receipt was found. Review the latest day before retrying.');
    if(current?.status==='needs_review')throw new ApiError(409,'conflict','The saved version changed. Review this work.');
    if(current?.status==='unknown')throw new ApiError(0,'connection_unconfirmed','The save is still unconfirmed. Check the receipt before retrying.');
    throw new ApiError(403,'scope_changed','Your account view changed. Sign in and review this change.');
  }
  // An ordinary acknowledged save needs no recovery surface. Keep markers for
  // outcomes resolved through receipt lookup or an explicit same-key retry.
  if (!existing || existing.status==='queued') {
    await deviceCommands.discard(command.idempotency_key).catch(() => undefined);
  }
  return result as T;
}
async function pendingReceipt<T>(family:PendingFamily,key:string):Promise<T> {
  switch(family){
    case 'care': return await api.receipt(key) as T; case 'activity': return await api.activityReceipt(key) as T;
    case 'task_request': return await api.taskRequestReceipt(key) as T; case 'meal_grocery': return await api.mealGroceryReceipt(key) as T;
    case 'local_day': return await api.localDayReceipt(key) as T; case 'program': return await api.programReceipt(key) as T;
    case 'support': return await api.supportReceipt(key) as T; case 'progress': return await api.progressReceipt(key) as T;
    case 'operations': return await api.operationsReceipt(key) as T;
  }
}
async function recoverableReceipt<T>(family:PendingFamily,key:string,direct:()=>Promise<T>):Promise<T> {
  if(!durableCommandsEnabled) return direct();
  const item=deviceCommands.snapshot.find(row=>row.key===key&&row.family===family);
  if(!item||item.status==='saved')return direct();
  if(item.status==='unknown'||item.status==='ready_retry'){
    const receipt=await deviceCommands.reconcile(key);
    if(receipt!==null)return receipt as T;
    const current=deviceCommands.snapshot.find(row=>row.key===key);
    if(current?.status==='ready_retry')throw new ApiError(404,'not_found','No saved receipt was found. Review the current day before retrying.');
    if(current?.status==='needs_review')throw new ApiError(409,'conflict','The saved version changed. Review this work.');
    throw new ApiError(0,'connection_unconfirmed','The save is still unconfirmed. Check again before retrying.');
  }
  return direct();
}
const requestService: TaskRequestService = { workspace: api.taskRequests, review: api.reviewTaskRequest,
  command: (command: TaskRequestCommand) => recoverableCommand<TaskRequestReceipt>('task_request',command,()=>api.taskRequestCommand(command)), receipt: key=>recoverableReceipt('task_request',key,()=>api.taskRequestReceipt(key)) };
const mealGroceryService: MealGroceryClientService = {workspace:api.mealGroceryWorkspace,suggestions:api.mealGrocerySuggestions,
  command:(command:MealGroceryCommand)=>recoverableCommand<MealGroceryReceipt>('meal_grocery',command,()=>api.mealGroceryCommand(command)),receipt:key=>recoverableReceipt('meal_grocery',key,()=>api.mealGroceryReceipt(key))};
const programService: ProgramClientService = {workspace:api.programWorkspace,
  command:(command:ProgramCommand)=>recoverableCommand<ProgramReceipt>('program',command,()=>api.programCommand(command)),receipt:key=>recoverableReceipt('program',key,()=>api.programReceipt(key))};
const supportTeamService: SupportTeamClientService = {workspace:api.supportWorkspace,
  command:(command:SupportCommand)=>recoverableCommand<SupportReceipt>('support',command,()=>api.supportCommand(command)),receipt:key=>recoverableReceipt('support',key,()=>api.supportReceipt(key))};
const localDayService:LocalDayClientService={workspace:api.localDayWorkspace,
  command:(command:LocalDayCommand)=>recoverableCommand<LocalDayReceipt>('local_day',command,()=>api.localDayCommand(command)),receipt:key=>recoverableReceipt('local_day',key,()=>api.localDayReceipt(key))};
const reminderService:ReminderClientService={claim:api.claimPrompt,ack:api.promptAck,resume:api.resumePrompt,
  respond:command=>localDayService.command(command),current:async id=>(await api.currentPrompt(id)).current};
const operationsService:OperationsClientService={workspace:api.operationsWorkspace,
  command:(command:OperationsCommand)=>recoverableCommand<OperationsReceipt>('operations',command,()=>api.operationsCommand(command)),receipt:key=>recoverableReceipt('operations',key,()=>api.operationsReceipt(key))};

function planIsPending(today: Today): boolean {
  return Boolean(today.checkin?.proposal && (!today.checkin.accepted || today.checkin.proposal.id !== today.checkin.accepted.id));
}

function formatDay(date: string, zone: string) {
  const value = new Date(`${date}T12:00:00Z`);
  // `local_date` already belongs to this participant. Format its literal date,
  // rather than converting a UTC instant into another local calendar day.
  return new Intl.DateTimeFormat("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(value);
}

function friendlyError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "Nancy could not finish that step. Please try again.";
}

function localInputValue(value: string | Date, zone: string) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function activityVerb(kind: ActivityKind) {
  return kind === "meal" ? "eaten" : kind === "appointment" ? "attended" : "done";
}

function activityKindLabel(kind: ActivityKind) {
  return kind === "meal" ? "Meal" : kind === "appointment" ? "Appointment" : "Task";
}

function displayInstant(value: string, zone: string, includeDate = true) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, ...(includeDate ? { month: "short", day: "numeric" } : {}), hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function dateForInstant(value: string, zone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function effectiveActivity(today: Today, kind: ActivityKind, sourceId?: string | null, mealSlot?: MealSlot) {
  return today.activity_ledger?.options.find(item => item.kind === kind && (sourceId ? item.source_id === sourceId && (!mealSlot || item.meal_slot === mealSlot) : mealSlot ? item.unplanned && item.meal_slot === mealSlot : false));
}

function unplannedMeal(today: Today, slot: MealSlot) {
  return today.activity_ledger?.entries.find(item => item.kind === 'meal' && item.unplanned && item.meal_slot === slot && item.status !== 'voided');
}

function effectiveEntry(today: Today, activity?: ActivityOption) {
  return activity ? today.activity_ledger?.entries.find(item => item.id === activity.id) : undefined;
}

function intakeLabel(entry?: ActivityEntry) {
  return entry?.kind === 'meal' && entry.status === 'completed'
    ? entry.intake_kind === 'full_meal' ? ' · Full meal' : entry.intake_kind === 'snack' ? ' · Snack' : '' : '';
}

function activityDetail(today: Today, activity: ActivityOption | undefined, zone: string) {
  if (!activity) return null;
  const entry = effectiveEntry(today, activity);
  if (activity.status === "completed") return `${activityKindLabel(activity.kind)} ${activityVerb(activity.kind)} · ${entry?.occurred_at ? displayInstant(entry.occurred_at, zone) : "time not recorded"}${intakeLabel(entry)}`;
  if (activity.status === "deferred") return "Deferred";
  if (activity.status === "voided") return "Mistaken report removed · ready to report again";
  if (entry?.last_action === "rescheduled" && activity.scheduled_at) return `Rescheduled for ${displayInstant(activity.scheduled_at, zone)}`;
  return null;
}

function displayedTasks(today: Today) {
  const accepted = new Map((today.checkin?.accepted?.tasks ?? []).map(task => [task.id, task]));
  return today.tasks.map(task => accepted.get(task.id) ?? task);
}

declare const __NANCY_OWNER_TASK_DATES__: boolean;
function taskTiming(task: Today['tasks'][number], today: Today) {
  if (!task.scheduled_time) {
    const ownerPreview=typeof __NANCY_OWNER_TASK_DATES__!=='undefined'&&__NANCY_OWNER_TASK_DATES__;
    return ownerPreview&&task.scheduled_date?`${task.scheduled_date===today.local_date?'Today':formatDay(task.scheduled_date,today.profile!.time_zone)} · No time set`:'No time set';
  }
  const date = task.scheduled_date ?? today.local_date;
  return `${date === today.local_date ? 'Today' : formatDay(date, today.profile!.time_zone)} at ${task.scheduled_time}`;
}

function mealTiming(activity: ActivityOption | undefined, zone: string) {
  return activity?.scheduled_at ? displayInstant(activity.scheduled_at, zone) : 'No time set';
}

export function App() {
  const [screen, setScreen] = useState<AppState>("loading");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [today, setToday] = useState<Today | null>(null);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [signoutBusy, setSignoutBusy] = useState(false);
  const sessionEpoch = useRef(0);
  const todayRequest = useRef(0);

  useEffect(() => {
    const expired = () => {
      sessionEpoch.current += 1; todayRequest.current += 1;
      const hadDeviceCommands=durableCommandsEnabled;durableCommandsEnabled=false;
      if(hadDeviceCommands)void deviceCommands.deactivate().catch(()=>undefined);
      setToday(null); setSessionInfo(null); setScreen("login");
    };
    const changed = () => {
      sessionEpoch.current += 1; todayRequest.current += 1;
      setToday(null); setSessionInfo(null); setScreen('loading');
      const hadDeviceCommands=durableCommandsEnabled;durableCommandsEnabled=false;
      void (hadDeviceCommands?deviceCommands.deactivate():Promise.resolve()).then(enterSession).catch(error => { setMessage(friendlyError(error)); setScreen(error instanceof ApiError && error.status === 401 ? 'login' : 'readiness'); });
    };
    window.addEventListener('nancy:session-expired', expired);
    window.addEventListener('nancy:scope-changed', changed);
    return () => { window.removeEventListener('nancy:session-expired', expired); window.removeEventListener('nancy:scope-changed', changed); };
  }, []);

  const signOut = async () => {
    sessionEpoch.current += 1; todayRequest.current += 1;
    const hadDeviceCommands=durableCommandsEnabled;durableCommandsEnabled=false;
    setToday(null); setSessionInfo(null); setScreen('signout'); setSignoutBusy(true); setMessage(null);
    try { if(hadDeviceCommands)await deviceCommands.deactivate(); await api.logout(); setScreen('login'); }
    catch (error) {
      if (error instanceof ApiError && error.status === 401) setScreen('login');
      else setMessage('Sign-out could not be confirmed. Keep this tab open and try again when the connection returns.');
    } finally { setSignoutBusy(false); }
  };

  const applyReceipt = (receipt: Receipt, date: string) => {
    setToday(current => {
      if (!current || current.local_date !== date || current.checkin && (current.checkin.id !== receipt.checkin_id || current.checkin.revision > receipt.revision)) return current;
      const checkin = current.checkin || { id: receipt.checkin_id, local_date: date, revision: 0, accepted: null, proposal: null };
      return { ...current, checkin: { ...checkin, revision: receipt.revision,
        proposal: receipt.result === 'proposed' ? receipt.plan : checkin.proposal,
        accepted: receipt.result === 'accepted' ? receipt.plan as AcceptedPlan : checkin.accepted,
      } };
    });
  };

  const refreshToday = async () => {
    const epoch = sessionEpoch.current;
    const request = ++todayRequest.current;
    try {
      const next = await api.today();
      if (epoch === sessionEpoch.current && request === todayRequest.current) setToday(current =>
        current?.profile?.id === next.profile?.id && current?.checkin && next.checkin?.id === current.checkin.id && next.checkin.revision < current.checkin.revision
          ? { ...next, checkin: current.checkin } : next);
      return next;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401 && epoch === sessionEpoch.current) {
        sessionEpoch.current += 1;
        todayRequest.current += 1;
        const hadDeviceCommands=durableCommandsEnabled;durableCommandsEnabled=false;
        if(hadDeviceCommands)void deviceCommands.deactivate().catch(()=>undefined);
        setToday(null);
        setScreen("login");
      }
      throw error;
    }
  };

  const checkVoice = async () => {
    const next = await api.config();
    if (next.configured) setConfig(next);
    return next;
  };

  const enterSession = async () => {
    const epoch = sessionEpoch.current;
    const session = await api.session();
    if (epoch !== sessionEpoch.current) return;
    if (!['client', 'family_friend', 'administrator', 'clinician'].includes(session.role) || !session.participant_id || !session.scope_key || typeof session.voice_eligible !== 'boolean') throw new ApiError(403, 'invalid_session_scope', 'Your account view could not be confirmed. Please sign in again.');
    const hadDeviceCommands=durableCommandsEnabled;durableCommandsEnabled=false;
    if(session.local_features_available) { await deviceCommands.activate(session.scope_key); if(epoch!==sessionEpoch.current)return; durableCommandsEnabled=true; }
    else if(hadDeviceCommands) await deviceCommands.deactivate();
    setSessionInfo(session);
    if (session.role !== 'client') { setToday(null); setScreen('support'); return; }
    const next = await refreshToday();
    if (epoch === sessionEpoch.current) setScreen(next.profile ? 'today' : 'setup');
  };

  useEffect(() => {
    if ((screen !== 'today' && screen !== 'support') || config?.voice_available || !sessionInfo?.voice_eligible) return;
    let checks = 0;
    let busy = false;
    const check = async () => {
      if (busy || checks >= 20) return;
      busy = true; checks += 1;
      try { await checkVoice(); } catch { /* The button remains available for another check. */ }
      finally { busy = false; }
    };
    const timer = window.setInterval(() => { void check(); }, 2_000);
    window.addEventListener('focus', check);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', check); };
  }, [screen, config?.voice_available, sessionInfo?.voice_eligible]);

  useEffect(() => {
    void (async () => {
      try {
        const nextConfig = await api.config();
        setConfig(nextConfig);
        if (!nextConfig.configured) {
          setScreen("readiness");
          return;
        }
        try {
          await enterSession();
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            setScreen("login");
            return;
          }
          throw error;
        }
      } catch (error) {
        setMessage(friendlyError(error));
        setScreen("readiness");
      }
    })();
  }, []);

  const retry = () => {
    setMessage(null);
    setScreen("loading");
    window.location.reload();
  };

  if (screen === "loading") return <Loading />;
  if (screen === 'signout') return <main className="centered-page"><section className="auth-card"><h1>{signoutBusy ? 'Signing out…' : 'Check sign-out'}</h1>{message && <p role="alert">{message}</p>}<button className="primary-button" disabled={signoutBusy} onClick={() => void signOut()}>Try sign-out again</button></section></main>;
  if (screen === "readiness") return <Readiness message={message} onRetry={retry} />;
  if (screen === "login") return <Login onLoggedIn={async () => {
    sessionEpoch.current += 1;
    await enterSession();
  }} />;
  if (screen === "setup") return <Setup initialToday={today} onSaved={next => { setToday(next); setScreen("today"); }} />;
  if (screen === 'support' && sessionInfo) return <SupportHome key={sessionInfo.scope_key} session={sessionInfo} voiceAvailable={config?.voice_available ?? false} voiceTransport={config?.voice_transport} onCheckVoice={checkVoice} onLogout={signOut} />;
  return <TodayView key={sessionInfo!.scope_key} scopeKey={sessionInfo!.scope_key} localFeaturesAvailable={sessionInfo!.local_features_available===true} microsoftAvailable={sessionInfo!.microsoft_available===true}
    voiceEligible={sessionInfo!.voice_eligible} voiceConnection={sessionInfo!.voice_connection} requestsAvailable={sessionInfo!.task_requests_available === true} today={today!} voiceAvailable={config?.voice_available ?? false} voiceTransport={config?.voice_transport} onCheckVoice={checkVoice} onRefresh={refreshToday} onReceipt={applyReceipt} onEditChoices={() => { todayRequest.current += 1; setScreen("setup"); }} onLogout={signOut} />;
}

function Loading() {
  return <main className="loading-page" aria-live="polite"><div className="loading-orb" /><p>Getting your day ready…</p></main>;
}

function Readiness({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return <main className="centered-page">
    <section className="readiness-card" aria-labelledby="readiness-title">
      <div className="sun-mark" aria-hidden="true">☀</div>
      <p className="eyebrow">Nancy is getting ready</p>
      <h1 id="readiness-title">Please try again in a moment.</h1>
      <p>Your day is safe. If Nancy is still unavailable, ask the person who helps manage this app.</p>
      {message && <p className="notice error" role="alert">{message}</p>}
      <button className="secondary-button" onClick={onRetry}>Check again</button>
    </section>
  </main>;
}

function Login({ onLoggedIn }: { onLoggedIn: () => Promise<void> }) {
  const [rememberDevice,setRememberDevice]=useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(null);
    try { await api.login(email, password, rememberDevice); await onLoggedIn(); }
    catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(false); }
  };
  return <main className="centered-page"><form className="auth-card" onSubmit={submit} aria-labelledby="welcome-title">
    <div className="sun-mark" aria-hidden="true">N</div>
    <p className="eyebrow">Nancy · your day</p>
    <h1 id="welcome-title">Welcome back</h1>
    <p>Sign in to see today’s plan.</p>
    <label>Email<input autoComplete="username" type="email" value={email} onChange={event => setEmail(event.target.value)} required /></label>
    <label>Password<input autoComplete="current-password" type="password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
    <label className="remember-device"><input type="checkbox" checked={rememberDevice} onChange={event=>setRememberDevice(event.target.checked)}/>Keep me signed in on this device for 30 days</label>
    {error && <p className="notice error" role="alert">{error}</p>}
    <button className="primary-button" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
  </form></main>;
}

function lines(value: string) { return value.split("\n").map(item => item.trim()).filter(Boolean); }

function retainedId<T extends { id: string; title?: string; name?: string; slots?: MealSlot[] }>(items: T[], label: string, slots?: MealSlot[]) {
  const matches = items.filter(item => (item.title ?? item.name) === label && (!slots || item.slots?.join(",") === slots.join(",")));
  return matches.length === 1 ? matches[0].id : undefined;
}

function Setup({ initialToday, onSaved }: { initialToday: Today | null; onSaved: (today: Today) => void }) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Toronto";
  const profile = initialToday?.profile;
  const [name, setName] = useState(profile?.display_name ?? "");
  const [zone, setZone] = useState(profile?.time_zone ?? timeZone);
  const [preferences, setPreferences] = useState(profile?.preferences ?? "");
  const [tasksText, setTasksText] = useState(initialToday?.tasks.map(task => task.title).join("\n") ?? "");
  const [taskDetails, setTaskDetails] = useState<Record<string, Pick<SetupInput['tasks'][number], 'urgency' | 'scheduled_time' | 'category' | 'duration_minutes'>>>(() => Object.fromEntries((initialToday?.tasks ?? []).map(task => [task.title, { urgency: task.urgency, scheduled_time: task.scheduled_time, category: task.category, duration_minutes: task.duration_minutes }])));
  const updateTaskDetail = (title: string, change: Partial<SetupInput['tasks'][number]>) => setTaskDetails(current => ({ ...current, [title]: { ...current[title], ...change } }));
  const [meals, setMeals] = useState<Record<MealSlot, string>>(() => Object.fromEntries(mealSlots.map(slot => [slot, initialToday?.meal_options.filter(option => option.slots.includes(slot)).map(option => option.name).join("\n") ?? ""])) as Record<MealSlot, string>);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [checking, setChecking] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (unconfirmed) return; setError(null); setBusy(true);
    const taskLines = lines(tasksText);
    const input: SetupInput = {
      display_name: name,
      time_zone: zone,
      expected_revision: profile?.revision ?? 0,
      preferences,
      tasks: taskLines.map(title => { const previous = initialToday?.tasks.find(task => task.id === retainedId(initialToday.tasks, title)); const detail = taskDetails[title]; return { id: previous?.id, title, time_hint: previous?.time_hint ?? null, urgency: detail ? detail.urgency : previous?.urgency, scheduled_time: detail ? detail.scheduled_time : previous?.scheduled_time, category: detail?.category ?? previous?.category ?? 'task', duration_minutes: detail ? detail.duration_minutes : previous?.duration_minutes }; }),
      meal_options: mealSlots.flatMap(slot => lines(meals[slot]).map(name => ({ id: initialToday ? retainedId(initialToday.meal_options, name, [slot]) : undefined, name, slots: [slot] }))),
    };
    try { onSaved(await api.setup(input)); }
    catch (reason) {
      if (reason instanceof ApiError && reason.code === "connection_unconfirmed") {
        setUnconfirmed(true);
        setError("Your choices may have been saved. Check saved choices before changing anything.");
      } else setError(friendlyError(reason));
    }
    finally { setBusy(false); }
  };
  const checkSavedSetup = async () => {
    setChecking(true); setError(null);
    try {
      const current = await api.today();
      const expected = profile?.revision ?? 0;
      if (current.profile && current.profile.revision > expected) {
        onSaved(current);
        return;
      }
      setError("Nancy has not confirmed those choices. Reload or ask for help before trying again; they were not sent again.");
    } catch (reason) { setError(`${friendlyError(reason)} Your choices were not sent again.`); }
    finally { setChecking(false); }
  };
  const editing = Boolean(profile);
  return <main className="setup-page"><section className="setup-intro"><div className="sun-mark" aria-hidden="true">☀</div><p className="eyebrow">{editing ? "Your choices" : "Getting started"}</p><h1>{editing ? "Keep your choices current." : "Let’s get started."}</h1><p>Add the tasks and meals you know now. You can add more later.</p></section>
    <form className="setup-form" onSubmit={submit} aria-label={editing ? "Edit Nancy choices" : "Set up Nancy"}>
      <label>What should Nancy call you?<input value={name} onChange={event => setName(event.target.value)} maxLength={60} required /></label>
      <label>Your time zone<input value={zone} onChange={event => setZone(event.target.value)} maxLength={80} required aria-describedby="timezone-help" /></label><p id="timezone-help" className="field-help">Times in your plan use this time zone.</p>
      <label>Tasks to choose from<textarea value={tasksText} onChange={event => setTasksText(event.target.value)} maxLength={3200} rows={4} placeholder="One task per line" /></label><p className="field-help">Add only tasks you want Nancy to know about.</p>
      {lines(tasksText).length > 0 && <fieldset className="task-details"><legend>Task timing and priority <span className="optional">Optional</span></legend>{lines(tasksText).map((title, index) => <div className="task-detail" key={`${title}-${index}`}><h3>{title}</h3><div><label>Urgency for {title}<select value={taskDetails[title]?.urgency ?? ''} onChange={event => updateTaskDetail(title, { urgency: event.target.value ? event.target.value as 'high' | 'medium' | 'low' : undefined })}><option value="">Not set</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label><label>Time for {title}<input type="time" value={taskDetails[title]?.scheduled_time ?? ''} onChange={event => updateTaskDetail(title, { scheduled_time: event.target.value || null })} /></label><label>Category for {title}<select value={taskDetails[title]?.category ?? 'task'} onChange={event => updateTaskDetail(title, { category: event.target.value as 'task' | 'exercise' | 'rehab' })}><option value="task">Task</option><option value="exercise">Approved exercise</option><option value="rehab">Approved rehab</option></select></label><label>Minutes for {title}<input type="number" min="1" max="480" value={taskDetails[title]?.duration_minutes ?? ''} onChange={event => updateTaskDetail(title, { duration_minutes: event.target.value ? Number(event.target.value) : null })} /></label></div></div>)}</fieldset>}
      <fieldset><legend>Meal choices</legend>{mealSlots.map(slot => <label key={slot}>{labelForSlot[slot]}<textarea value={meals[slot]} onChange={event => setMeals(current => ({ ...current, [slot]: event.target.value }))} maxLength={3200} rows={3} placeholder={`One ${slot} choice per line`} /></label>)}</fieldset>
      <label>Anything Nancy should keep in mind? <span className="optional">Optional</span><textarea value={preferences} onChange={event => setPreferences(event.target.value)} maxLength={1000} rows={3} placeholder="Preferences or practical notes" /></label>
      {error && <p className="notice error" role="alert">{error}</p>}
      {unconfirmed ? <button type="button" className="secondary-button" disabled={checking} onClick={() => void checkSavedSetup()}>{checking ? "Checking saved choices…" : "Check saved choices"}</button> : <button className="primary-button" disabled={busy}>{busy ? "Saving your choices…" : editing ? "Save choices" : "Continue to today"}</button>}
    </form>
  </main>;
}

function SupportHome({ session, voiceAvailable, voiceTransport, onCheckVoice, onLogout }: { session: SessionInfo; voiceAvailable: boolean; voiceTransport?: AppConfig['voice_transport']; onCheckVoice(): Promise<AppConfig>; onLogout(): Promise<void> }) {
  const [voice, setVoice] = useState<VoiceState>('stopped');
  const [voiceMessage, setVoiceMessage] = useState<string>();
  const [voiceActive, setVoiceActive] = useState(false);
  const [transcript, setTranscript] = useState<Transcript[]>([]);
  const [typed, setTyped] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [requestUnconfirmed, setRequestUnconfirmed] = useState(false);
  const [participantDate,setParticipantDate]=useState<string|null>(null);
  const [moreOpen,setMoreOpen]=useState(false);
  const handle = useRef<Awaited<ReturnType<typeof startLocalVoice>> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const attempt = useRef(0);
  const active = useRef(true);
  const moreViews=useRef<HTMLDetailsElement|null>(null);
  const eligible = session.voice_eligible && session.role !== 'clinician';
  const stop = async () => {
    attempt.current += 1; controller.current?.abort(); controller.current = null;
    const current = handle.current; handle.current = null;
    setVoiceActive(false); setVoice('stopped');
    await current?.stop();
  };
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; attempt.current += 1; controller.current?.abort(); void handle.current?.stop().catch(() => undefined); handle.current = null; };
  }, []);
  useEffect(() => { if (requestUnconfirmed) { void stop(); setVoiceMessage('Check the saved request before continuing with Nancy.'); } }, [requestUnconfirmed]);
  useEffect(()=>{if(!session.local_features_available)return;let current=true;
    void api.supportWorkspace().then(workspace=>{if(current)setParticipantDate(workspace.local_date);}).catch(()=>{if(current)setParticipantDate(null);});
    return()=>{current=false;};
  },[session.scope_key,session.local_features_available]);
  const start = async () => {
    if (!eligible || requestUnconfirmed || handle.current || voice === 'connecting') return;
    const id = ++attempt.current, abort = new AbortController();
    let reportedVoiceError: string | undefined;
    controller.current?.abort(); controller.current = abort;
    setVoice('connecting'); setVoiceMessage('Connecting to Nancy…');
    const current = () => active.current && attempt.current === id && !abort.signal.aborted;
    try {
      const ready = voiceAvailable ? { voice_available: true, voice_transport: voiceTransport } : await onCheckVoice();
      if (!current()) return;
      if (!ready.voice_available || ready.voice_transport !== 'local') { setVoice('stopped'); setVoiceMessage('Nancy’s voice is not ready. You can use the request buttons while you wait.'); return; }
      const next = await startLocalVoice({ signal: abort.signal,
        onReady: next => { if (!current()) { void next.stop(); return; } handle.current = next; setVoiceActive(true); },
        onState: (state, message) => { if (!current()) return; if (state === 'error' && message?.trim()) reportedVoiceError = message; setVoice(state); setVoiceMessage(message); if (state === 'stopped' || state === 'error') { handle.current = null; setVoiceActive(false); } },
        onTranscript: (speaker, text) => { if (current()) setTranscript(previous => [...previous.slice(-7), { speaker, text }]); },
        onChange: () => { if (current()) setRefreshVersion(value => value + 1); },
        onNavigate: destination => { if (!current()) return;
          if (destination === 'requests' || destination === 'support_team') setRefreshVersion(value => value + 1);
          if (['groceries','progress','operations','routines'].includes(destination) && moreViews.current) moreViews.current.open=true;
        },
      });
      if (!current()) { await next.stop(); return; }
      handle.current = next; setVoiceActive(true);
    } catch (error) { if (current()) { handle.current = null; setVoiceActive(false); setVoice('error'); setVoiceMessage(reportedVoiceError ?? friendlyError(error)); } }
  };
  const title = session.role === 'clinician' ? 'Clinician Partners' : session.role === 'administrator' ? 'Requests and help' : 'Support Team';
  const reviewPending=async(family:PendingFamily)=>{
    if(family==='task_request'){await api.taskRequests();return;}
    if(family==='meal_grocery')await api.mealGroceryWorkspace();
    else if(family==='program')await api.programWorkspace();
    else if(family==='operations')await api.operationsWorkspace();
    else if(family==='progress'){
      const date=participantDate??(await api.supportWorkspace()).local_date;setParticipantDate(date);
      await api.progressWorkspace({from:date,to:date});
    }else await api.supportWorkspace();
    if(moreViews.current)moreViews.current.open=true;
  };
  const heading = !eligible ? 'Use the buttons below' : voice === 'connecting' ? 'Starting Nancy' : voice === 'thinking' ? 'Nancy is thinking' : voice === 'listening' ? 'Nancy is listening' : voice === 'speaking' ? 'Nancy is speaking' : voice === 'closing' ? 'Nancy is waiting' : voice === 'error' ? 'Nancy needs a moment' : voiceAvailable ? 'Ready when you are' : 'Nancy is warming up';
  return <main className="today-shell"><header className="today-header"><div><p className="eyebrow">Nancy</p><h1>{title}</h1></div><button className="text-button" onClick={() => void stop().catch(() => undefined).then(onLogout)}>Sign out</button></header>
    <section className="voice-panel" aria-label="Talk to Nancy"><div><p className="eyebrow">Talk to Nancy</p><h2 aria-live="polite">{heading}</h2><p>{voiceMessage ?? (!eligible ? session.voice_unavailable_reason ?? 'Nancy voice is not connected for this account yet. You can use the buttons below.' : 'Ask Nancy to help with a task request.')}</p></div><div className="voice-actions">{voiceActive || voice === 'connecting' ? <button className="stop-button" onClick={() => void stop()}>Stop voice</button> : <button className="talk-button" disabled={!eligible || requestUnconfirmed} onClick={() => void start()}>Talk to Nancy</button>}</div></section>
    {voiceActive && <form className="typed-turn" onSubmit={e => { e.preventDefault(); if (!typed.trim() || voice === 'thinking' || voice === 'speaking') return; const text = typed.trim(); setTyped(''); void handle.current?.sendText(text); }}><label>Type to Nancy<input value={typed} maxLength={2000} disabled={voice === 'thinking' || voice === 'speaking'} onChange={e => setTyped(e.target.value)} /></label><button className="secondary-button" disabled={!typed.trim() || voice === 'thinking' || voice === 'speaking'}>Send</button></form>}
    {transcript.length > 0 && <section className="transcript" aria-live="polite" aria-label="Recent conversation">{transcript.map((line, index) => <p key={index} className={line.speaker}><strong>{line.speaker === 'nancy' ? 'Nancy' : 'You'}</strong>{line.text}</p>)}</section>}
    {session.local_features_available&&<><WakeControl scopeKey={session.scope_key} enabled={eligible&&voiceAvailable&&voiceTransport==='local'} conversationActive={voiceActive||voice==='connecting'} onWake={start}/>
      <SupportTeam service={supportTeamService} scopeKey={session.scope_key} onTalk={()=>void start()} refreshVersion={refreshVersion}/>
      <details ref={moreViews} onToggle={event=>setMoreOpen(event.currentTarget.open)}><summary>More shared views and settings</summary>{moreOpen&&<>
        {session.role!=='clinician'&&<MealGroceries service={mealGroceryService} scopeKey={session.scope_key} onTalk={()=>void start()} mode="groceries"/>}
        {(session.role==='clinician'||session.role==='administrator')&&<Programs service={programService} scopeKey={session.scope_key} onTalk={()=>void start()}/>}
        {participantDate&&<Progress scopeKey={session.scope_key} localDate={participantDate} visible={true}
          commandAction={(command:ProgressCommand)=>recoverableCommand<ProgressReceipt>('progress',command,()=>api.progressCommand(command))}/>}
        {session.role==='administrator'&&<><Operations service={operationsService} scopeKey={session.scope_key} onTalk={()=>void start()} refreshVersion={refreshVersion}/><NancySuggestionsPanel scopeKey={session.scope_key} refreshVersion={refreshVersion} administrator/></>}
      </>}</details><PendingCommandsPanel controller={deviceCommands} onReview={reviewPending}/></>}
    {session.role === 'clinician' ? !session.local_features_available&&<section className="request-panel"><h2>Your shared views</h2><p>Clinical dashboards and exports are not available yet.</p></section> : session.task_requests_available === false ? <p>Task requests are not available for this account yet.</p> : <TaskRequests service={requestService} scopeKey={session.scope_key} onTalk={() => void start()} voiceAvailable={eligible && voiceAvailable} showTalk={false} refreshVersion={refreshVersion} onPendingChange={setRequestUnconfirmed} />}
  </main>;
}

function TodayView({today,scopeKey,localFeaturesAvailable,microsoftAvailable,voiceEligible,voiceAvailable,voiceTransport,onCheckVoice,onRefresh,onLogout}: {today:Today;scopeKey:string;localFeaturesAvailable:boolean;microsoftAvailable:boolean;voiceEligible:boolean;voiceConnection?:SessionInfo['voice_connection'];requestsAvailable:boolean;voiceAvailable:boolean;voiceTransport?:AppConfig['voice_transport'];onCheckVoice:()=>Promise<AppConfig>;onRefresh:()=>Promise<Today>;onEditChoices:()=>void;onLogout:()=>Promise<void>;onReceipt:(receipt:Receipt,date:string)=>void}) {
 return <ClientHome today={today} scopeKey={scopeKey} localFeaturesAvailable={localFeaturesAvailable} microsoftAvailable={microsoftAvailable} voiceEligible={voiceEligible} voiceAvailable={voiceAvailable} voiceTransport={voiceTransport} onCheckVoice={onCheckVoice} onRefresh={onRefresh} onLogout={onLogout}
  renderTasks={onTalk=><TasksView today={today} onReview={onTalk}/>}
  renderMeals={onTalk=><MealsView today={today} onReview={onTalk}/>}
  renderDay={calendar=><DayTimeline today={today} calendar={calendar}/>}
  reminders={(active,onTalk,onActivity)=>localFeaturesAvailable?<ReminderDelivery service={reminderService} scopeKey={scopeKey} conversationActive={active} onTalk={onTalk} onActivity={onActivity} voiceEligible={voiceEligible&&voiceAvailable&&voiceTransport==='local'} voiceOnly/>:null}
  pending={localFeaturesAvailable?<PendingCommandsPanel controller={deviceCommands} readOnly onSaved={async()=>{await onRefresh();}}/>:undefined}/>
}

function DayTimeline({today,calendar}:{today:Today;calendar:CalendarState}) {
 const zone=today.profile!.time_zone,plan=today.checkin?.accepted??today.checkin?.proposal;
 type Row={id:string;title:string;instant:string|null;time:string;detail:string;source?:string;outlook?:boolean};
 const rows:Row[]=[];
 for(const task of displayedTasks(today)){
  const activity=effectiveActivity(today,'task',task.id),entry=effectiveEntry(today,activity);
  const date=task.scheduled_date??today.local_date;
  const fromLedger=activity?.scheduled_at&&entry?.last_action==='rescheduled'?activity.scheduled_at:null;
  const local=task.scheduled_time?localDateTimeWithOffset(date+'T'+task.scheduled_time,zone):null;
  const instant=fromLedger??(local?.ok?local.value:null);
  if(instant&&dateForInstant(instant,zone)!==today.local_date||!instant&&date!==today.local_date)continue;
  rows.push({id:'task:'+task.id,title:task.title,instant,time:instant?displayInstant(instant,zone,false):'No time set',detail:activityDetail(today,activity,zone)??[task.urgency?task.urgency+' urgency':'Task',task.duration_minutes?task.duration_minutes+' min':null].filter(Boolean).join(' · ')});
 }
 for(const slot of mealSlots){
  const meal=plan?.meals.find(m=>m.slot===slot),activity=meal?effectiveActivity(today,'meal',meal.option_id,slot):unplannedMeal(today,slot);
  const instant=activity?.scheduled_at??null;
  if(instant&&dateForInstant(instant,zone)!==today.local_date)continue;
  rows.push({id:'meal:'+slot,title:labelForSlot[slot]+' · '+(meal?.name??activity?.title??'No meal chosen'),instant,time:instant?displayInstant(instant,zone,false):'No time set',detail:activityDetail(today,activity,zone)??(meal?(today.checkin?.accepted?'In accepted plan':'In proposed plan'):'Meal')});
 }
 for(const appointment of today.appointments??[]){const activity=effectiveActivity(today,'appointment',appointment.id),instant=activity?.scheduled_at??appointment.starts_at;if(dateForInstant(instant,zone)!==today.local_date)continue;rows.push({id:'local:'+appointment.id,title:appointment.title,instant,time:displayInstant(instant,zone,false),detail:activityDetail(today,activity,zone)??'Appointment'});}
 for(const event of calendar.events)rows.push({id:'outlook:'+event.id,title:event.subject||'Untitled appointment',instant:event.isAllDay?null:event.start,time:event.isAllDay?'All day':displayInstant(event.start,zone,false),detail:event.isCancelled?'Cancelled':event.isAllDay?'All-day appointment':'Until '+displayInstant(event.end,zone,false),source:'Outlook',outlook:true});
 const scheduled=rows.filter(r=>r.instant||r.time==='All day').sort((a,b)=>(a.time==='All day'?-1:b.time==='All day'?1:Date.parse(a.instant!)-Date.parse(b.instant!))||a.id.localeCompare(b.id)),unscheduled=rows.filter(r=>!r.instant&&r.time!=='All day');
 const list=(items:Row[])=> <ol>{items.map(row=><li key={row.id} className={row.outlook?'outlook':undefined}><time>{row.time}</time><div><h3>{row.title}</h3><p>{row.detail}{row.source?' · '+row.source:''}</p></div></li>)}</ol>;
 return <section className="client-timeline" aria-label="Your day"><header><h2>Your day</h2><p>{formatDay(today.local_date,zone)}</p></header>
  {calendar.state==='loading'&&<p role="status">Checking your calendar…</p>}
  {calendar.state==='unavailable'&&<p role="status">Outlook could not refresh. Your calendar may have other appointments.</p>}
  {calendar.state==='partial'&&<p role="status">Only part of your Outlook calendar was returned.</p>}
  {calendar.fetchedAt&&<p className="calendar-freshness">Outlook checked at {displayInstant(calendar.fetchedAt,zone,false)}</p>}
  {scheduled.length?list(scheduled):<p>No times planned yet.</p>}
  {unscheduled.length>0&&<div className="timeline-unscheduled"><h3>Not timed yet</h3>{list(unscheduled)}</div>}
 </section>;
}

function PendingPlanNotice({ today, onReview }: { today: Today; onReview: () => void }) {
  if (!planIsPending(today)) return null;
  return <div className="notice unconfirmed" role="status"><p>{today.checkin?.accepted ? 'A new plan is ready for review. Your accepted plan is still shown here.' : 'A plan is ready for review. Nothing has been accepted yet.'}</p><button className="secondary-button" onClick={onReview}>Review new plan</button></div>;
}

function TasksView({ today, onReview }: { today: Today; onReview: () => void }) {
  const selected = new Set(today.checkin?.accepted?.task_ids ?? today.checkin?.proposal?.task_ids ?? []);
  const plan = today.checkin?.accepted ?? today.checkin?.proposal;
  return <section className="data-view" aria-labelledby="tasks-title"><h2 id="tasks-title">Tasks</h2><p>A task is marked done only after you report it.</p><PendingPlanNotice today={today} onReview={onReview} /><ul className="item-list">{displayedTasks(today).map(task => {
    const activity = effectiveActivity(today, 'task', task.id);
    const entry = effectiveEntry(today, activity);
    const result = activityDetail(today, activity, today.profile!.time_zone);
    const timing = entry?.last_action === 'rescheduled' && activity?.scheduled_at ? `Rescheduled for ${displayInstant(activity.scheduled_at, today.profile!.time_zone)}` : taskTiming(task, today);
    return <li key={task.id} className={activity?.status === 'completed' ? 'activity-complete' : undefined}><div><h3>{task.title}</h3><p>{result ?? ([timing, task.time_hint, task.duration_minutes ? `${task.duration_minutes} min` : null, task.category && task.category !== 'task' ? task.category : null].filter(Boolean).join(' · '))}</p></div><div className="item-tags">{activity?.status === 'completed' ? <span>Done</span> : activity?.status === 'deferred' ? <span>Deferred</span> : activity?.status === 'voided' ? <span>Ready to report</span> : task.urgency && <span>{task.urgency} urgency</span>}{selected.has(task.id) && <span>{today.checkin?.accepted ? 'In accepted plan' : 'In proposed plan'}</span>}</div></li>;
  })}</ul>{today.tasks.length === 0 && <p>No tasks have been added.</p>}
    <h3 className="list-subheading">Meals</h3><ul className="item-list">{mealSlots.map(slot => { const meal = plan?.meals.find(item => item.slot === slot); if (!meal) return null; const activity = effectiveActivity(today, 'meal', meal.option_id, slot); return <li key={slot}><div><h3>{labelForSlot[slot]} · {meal.name}</h3><p>{activityDetail(today, activity, today.profile!.time_zone) ?? mealTiming(activity, today.profile!.time_zone)}</p></div><div className="item-tags"><span>{today.checkin?.accepted ? 'In accepted plan' : 'In proposed plan'}</span></div></li>; })}{(today.activity_ledger?.entries ?? []).filter(item => item.kind === 'meal' && item.unplanned && item.status !== 'voided').map(item => <li key={item.id}><div><h3>{item.title}</h3><p>{activityDetail(today, item, today.profile!.time_zone)}</p></div><div className="item-tags"><span>Reported meal</span></div></li>)}</ul>{!plan && <p>No meals are in today’s plan.</p>}
  </section>;
}

function MealsView({ today, onReview }: { today: Today; onReview: () => void }) {
  const planned = today.checkin?.accepted ?? today.checkin?.proposal;
  const unplannedInCards = new Set(mealSlots.flatMap(slot => {
    if (planned?.meals.some(meal => meal.slot === slot)) return [];
    const entry = unplannedMeal(today, slot);
    return entry ? [entry.id] : [];
  }));
  return <section className="data-view" aria-labelledby="meals-title"><h2 id="meals-title">Meals</h2><p>Chosen meals and meals eaten are shown here.</p><PendingPlanNotice today={today} onReview={onReview} /><div className="meal-cards">{mealSlots.map(slot => {
    const meal = planned?.meals.find(item => item.slot === slot);
    const activity = meal ? effectiveActivity(today, 'meal', meal.option_id, slot) : unplannedMeal(today, slot);
    const result = activityDetail(today, activity, today.profile!.time_zone);
    const portion = effectiveEntry(today, activity)?.portion;
    return <section key={slot} className={activity?.status === 'completed' ? 'activity-complete' : undefined}><h3>{labelForSlot[slot]}</h3><p className="meal-name">{meal?.name ?? activity?.title ?? 'No meal chosen'}</p><p>{result ? `${result}${portion ? ` · ${portion}` : ''}` : meal ? `${today.checkin?.accepted ? 'In accepted plan' : 'In proposed plan'} · ${mealTiming(activity, today.profile!.time_zone)}` : 'Choose a meal with Nancy.'}</p></section>;
  })}</div>{(today.activity_ledger?.entries ?? []).filter(item => item.kind === 'meal' && item.unplanned && item.status !== 'voided' && !unplannedInCards.has(item.id)).map(item => <div className="reported-meal" key={item.id}><h3>{item.title}</h3><p>{activityDetail(today, item, today.profile!.time_zone)}{item.portion ? ` · ${item.portion}` : ''}</p></div>)}</section>;
}
