import { FormEvent, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { startVoice } from "./voice";
import { startLocalVoice, type LocalVoiceState } from "./local-voice";
import { localDateTimeWithOffset } from "../shared/local-time";
import { mealSlots, type AcceptedPlan, type AppConfig, type CareCommand, type ClientView, type GroceryItem, type MealSlot, type Plan, type Receipt, type SetupInput, type Today } from "../shared/contracts";
import type { ActivityCommand, ActivityEntry, ActivityKind, ActivityLedger, ActivityOption } from "../shared/activity-contracts";

type AppState = "loading" | "readiness" | "login" | "setup" | "today" | "signout";
type SaveState = { kind: "idle" | "saving" | "saved" | "unconfirmed" | "conflict" | "error"; message?: string; key?: string };
type VoiceState = LocalVoiceState;
type Transcript = { speaker: "you" | "nancy"; text: string };
type ActivityDraft =
  | { mode: "record"; activity: ActivityOption; status: "completed" | "deferred"; occurredLocal: string; notes: string; portion: string }
  | { mode: "correct"; activity: ActivityEntry; status: "completed" | "deferred" | "voided"; occurredLocal: string; notes: string; portion: string; reason: string }
  | { mode: "reschedule"; activity: ActivityOption; scheduledLocal: string; reason: string }
  | { mode: "unplanned"; kind: ActivityKind; title: string; mealSlot: MealSlot; occurredLocal: string; notes: string; portion: string };

const labelForSlot: Record<MealSlot, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
const keyFor = () => crypto.randomUUID();

function selectedPlan(today: Today): { taskIds: string[]; meals: Record<MealSlot, string> } {
  const source = today.checkin?.proposal ?? today.checkin?.accepted;
  const meals = Object.fromEntries(mealSlots.map(slot => [slot, source?.meals.find(meal => meal.slot === slot)?.option_id ?? ""])) as Record<MealSlot, string>;
  return { taskIds: source?.task_ids ?? today.tasks.map(task => task.id), meals };
}

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

function shiftedDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function validActivityDate(value: string, latest: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value > latest) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
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

function activityDetail(today: Today, activity: ActivityOption | undefined, zone: string) {
  if (!activity) return null;
  const entry = effectiveEntry(today, activity);
  if (activity.status === "completed") return `${activityKindLabel(activity.kind)} ${activityVerb(activity.kind)} · ${entry?.occurred_at ? displayInstant(entry.occurred_at, zone) : "time not recorded"}`;
  if (activity.status === "deferred") return "Deferred";
  if (activity.status === "voided") return "Mistaken report removed · ready to report again";
  if (entry?.last_action === "rescheduled" && activity.scheduled_at) return `Rescheduled for ${displayInstant(activity.scheduled_at, zone)}`;
  return null;
}

function activityDefaultTime(date: string, zone: string) {
  const now = localInputValue(new Date(), zone);
  return now.slice(0, 10) === date ? now : `${date}T12:00`;
}

function displayedTasks(today: Today) {
  const accepted = new Map((today.checkin?.accepted?.tasks ?? []).map(task => [task.id, task]));
  return today.tasks.map(task => accepted.get(task.id) ?? task);
}

function taskTiming(task: Today['tasks'][number], today: Today) {
  if (!task.scheduled_time) return 'No time set';
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
  const [message, setMessage] = useState<string | null>(null);
  const [signoutBusy, setSignoutBusy] = useState(false);
  const sessionEpoch = useRef(0);
  const todayRequest = useRef(0);

  useEffect(() => {
    const expired = () => {
      sessionEpoch.current += 1; todayRequest.current += 1;
      setToday(null); setScreen("login");
    };
    window.addEventListener('nancy:session-expired', expired);
    return () => window.removeEventListener('nancy:session-expired', expired);
  }, []);

  const signOut = async () => {
    sessionEpoch.current += 1; todayRequest.current += 1;
    setToday(null); setScreen('signout'); setSignoutBusy(true); setMessage(null);
    try { await api.logout(); setScreen('login'); }
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

  useEffect(() => {
    if (screen !== 'today' || config?.voice_available) return;
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
  }, [screen, config?.voice_available]);

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
          await api.session();
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            setScreen("login");
            return;
          }
          throw error;
        }
        const nextToday = await refreshToday();
        setScreen(nextToday.profile ? "today" : "setup");
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
    const next = await refreshToday();
    setScreen(next.profile ? "today" : "setup");
  }} />;
  if (screen === "setup") return <Setup initialToday={today} onSaved={next => { setToday(next); setScreen("today"); }} />;
  return <TodayView today={today!} voiceAvailable={config?.voice_available ?? false} voiceTransport={config?.voice_transport} onCheckVoice={checkVoice} onRefresh={refreshToday} onReceipt={applyReceipt} onEditChoices={() => { todayRequest.current += 1; setScreen("setup"); }} onLogout={signOut} />;
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(null);
    try { await api.login(email, password); await onLoggedIn(); }
    catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(false); }
  };
  return <main className="centered-page"><form className="auth-card" onSubmit={submit} aria-labelledby="welcome-title">
    <div className="sun-mark" aria-hidden="true">N</div>
    <p className="eyebrow">Nancy · your day</p>
    <h1 id="welcome-title">Welcome back</h1>
    <p>Sign in to see today’s plan.</p>
    <label>Email<input autoComplete="email" type="email" value={email} onChange={event => setEmail(event.target.value)} required /></label>
    <label>Password<input autoComplete="current-password" type="password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
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

function TodayView({ today, voiceAvailable, voiceTransport, onCheckVoice, onRefresh, onEditChoices, onLogout, onReceipt }: { today: Today; voiceAvailable: boolean; voiceTransport?: AppConfig['voice_transport']; onCheckVoice: () => Promise<AppConfig>; onRefresh: () => Promise<Today>; onEditChoices: () => void; onLogout: () => Promise<void>; onReceipt: (receipt: Receipt, date: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshIssue, setRefreshIssue] = useState<string | null>(null);
  const [voice, setVoice] = useState<VoiceState>("stopped");
  const [voiceSessionActive, setVoiceSessionActive] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState<string | undefined>();
  const [transcript, setTranscript] = useState<Transcript[]>([]);
  const [view, setView] = useState<ClientView>('my_day');
  const [typedTurn, setTypedTurn] = useState('');
  const voiceHandle = useRef<{ stop: () => Promise<void>; sendText?: (text: string) => Promise<void>; interrupt?: () => void } | null>(null);
  const voiceAbort = useRef<AbortController | null>(null);
  const active = useRef(true);
  const currentCheckin = useRef(today.checkin?.id ?? null);
  const voiceAttempt = useRef(0);
  const pending = planIsPending(today);
  const date = formatDay(today.local_date, today.profile!.time_zone);

  useEffect(() => { currentCheckin.current = today.checkin?.id ?? null; }, [today.checkin?.id]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      voiceAttempt.current += 1;
      voiceAbort.current?.abort();
      voiceAbort.current = null;
      void voiceHandle.current?.stop();
      voiceHandle.current = null;
    };
  }, []);

  const stillCurrent = (checkinId: string | null) => active.current && currentCheckin.current === checkinId;

  const refresh = async () => {
    const checkinId = currentCheckin.current;
    setRefreshing(true);
    try {
      await onRefresh();
      if (stillCurrent(checkinId)) {
        setRefreshIssue(null);
        setSave(current => current.kind === "conflict" ? { kind: "idle" } : current);
      }
    } catch (error) {
      if (stillCurrent(checkinId)) setRefreshIssue(friendlyError(error));
    } finally { if (stillCurrent(checkinId)) setRefreshing(false); }
  };
  const begin = async () => {
    if (today.checkin) return;
    await issue({ type: "start_or_resume_checkin", idempotency_key: keyFor(), local_date: today.local_date, expected_revision: 0, payload: {} });
  };
  const issue = async (command: CareCommand, after?: (receipt: Receipt) => void) => {
    const checkinId = today.checkin?.id ?? null;
    setSave({ kind: "saving" });
    try {
      const receipt = await api.command(command);
      if (!stillCurrent(checkinId)) return;
      onReceipt(receipt, command.local_date);
      setSave({ kind: "saved", message: receipt.result === "accepted" ? "Your plan is saved." : receipt.result === "resumed" ? "Today’s check-in is ready." : "Your plan is ready for review." });
      try { await onRefresh(); if (stillCurrent(checkinId)) setRefreshIssue(null); }
      catch (error) { if (stillCurrent(checkinId)) setRefreshIssue(friendlyError(error)); }
      if (!stillCurrent(checkinId)) return;
      after?.(receipt);
    } catch (error) {
      if (!stillCurrent(checkinId)) return;
      if (error instanceof ApiError && error.code === "connection_unconfirmed") {
        setSave({ kind: "unconfirmed", key: command.idempotency_key, message: "Save unconfirmed. Check saved plan." });
      } else if (error instanceof ApiError && error.status === 409) {
        setSave({ kind: "conflict", message: "Today’s plan changed elsewhere. Refresh it before making another change." });
      } else setSave({ kind: "error", message: friendlyError(error) });
    }
  };
  const reconcile = async () => {
    if (!save.key) return;
    const pendingKey = save.key;
    const checkinId = currentCheckin.current;
    setSave({ kind: "unconfirmed", key: pendingKey, message: "Checking saved plan…" });
    try {
      const receipt = await api.receipt(pendingKey);
      if (!stillCurrent(checkinId)) return;
      onReceipt(receipt, today.local_date);
      setSave({ kind: "saved", message: receipt.result === "accepted" ? "Your plan is saved." : receipt.result === "resumed" ? "Today’s check-in is ready." : "Your plan is ready for review." });
      try { await onRefresh(); if (stillCurrent(checkinId)) setRefreshIssue(null); }
      catch (error) { if (stillCurrent(checkinId)) setRefreshIssue(friendlyError(error)); }
    } catch (error) {
      if (!stillCurrent(checkinId)) return;
      if (error instanceof ApiError && error.status === 404) setSave({ kind: "unconfirmed", key: pendingKey, message: "Nancy has not confirmed this change yet. It was not sent again." });
      else setSave({ kind: "unconfirmed", key: pendingKey, message: "Save is still unconfirmed. It was not sent again." });
    }
  };
  const startSpeaking = async () => {
    if (voiceHandle.current || save.kind === "unconfirmed" || save.kind === "conflict") return;
    const attempt = ++voiceAttempt.current;
    const controller = new AbortController();
    voiceAbort.current?.abort();
    voiceAbort.current = controller;
    setVoice("connecting"); setVoiceMessage("Connecting to Nancy…");
    try {
      const ready = voiceAvailable ? { voice_available: true, voice_transport: voiceTransport } : await onCheckVoice();
      if (!ready.voice_available) { setVoice('stopped'); setVoiceMessage('Nancy’s voice is warming up. Try again in a moment.'); return; }
      if (controller.signal.aborted || !active.current || attempt !== voiceAttempt.current) return;
      const options = {
        signal: controller.signal,
        onState: (state: VoiceState, message?: string) => {
          if (!active.current || attempt !== voiceAttempt.current) return;
          setVoice(state); setVoiceMessage(message);
          if (state === "stopped" || state === "error") { voiceHandle.current = null; setVoiceSessionActive(false); }
        },
        onTranscript: (speaker: "you" | "nancy", text: string) => {
          if (active.current && attempt === voiceAttempt.current) setTranscript(current => [...current.slice(-7), { speaker, text }]);
        },
        onChange: () => { if (active.current && attempt === voiceAttempt.current) void refresh(); },
        onNavigate: (destination: string) => {
          if (!active.current || attempt !== voiceAttempt.current) return;
          if (destination === 'my_day' || destination === 'activity' || destination === 'tasks' || destination === 'meals' || destination === 'groceries') setView(destination);
        },
      };
      const onReady = (handle: { stop: () => Promise<void>; sendText?: (text: string) => Promise<void>; interrupt?: () => void }) => {
        if (!active.current || attempt !== voiceAttempt.current) { void handle.stop(); return; }
        voiceHandle.current = handle;
        setVoiceSessionActive(true);
      };
      const localOptions = { ...options, onReady };
      const handle = await (ready.voice_transport === 'local' ? startLocalVoice(localOptions) : startVoice(options));
      if (!active.current || attempt !== voiceAttempt.current) {
        await handle.stop();
        return;
      }
      voiceHandle.current = handle;
      setVoiceSessionActive(true);
      voiceAbort.current = null;
    } catch (error) {
      if (controller.signal.aborted || !active.current || attempt !== voiceAttempt.current) return;
      if (active.current && attempt === voiceAttempt.current) { voiceHandle.current = null; setVoiceSessionActive(false); setVoice("error"); setVoiceMessage(friendlyError(error)); }
    }
  };
  const stopSpeaking = async () => {
    voiceAttempt.current += 1;
    voiceAbort.current?.abort();
    voiceAbort.current = null;
    const handle = voiceHandle.current;
    voiceHandle.current = null;
    setVoiceSessionActive(false);
    setVoice("stopped"); setVoiceMessage("Conversation ended.");
    await handle?.stop();
  };
  const signOut = async () => {
    voiceAttempt.current += 1;
    voiceAbort.current?.abort();
    voiceAbort.current = null;
    const handle = voiceHandle.current;
    voiceHandle.current = null;
    setVoiceSessionActive(false);
    await handle?.stop();
    await onLogout();
  };
  const editLocked = save.kind === "saving" || save.kind === "unconfirmed" || save.kind === "conflict";
  const voiceHeading = voice === 'connecting' ? 'Starting Nancy' : voice === 'thinking' ? 'Nancy is thinking' : voice === 'listening' ? 'Nancy is listening' : voice === 'speaking' ? 'Nancy is speaking' : voice === 'closing' ? 'Nancy is waiting' : voice === 'error' ? 'Nancy needs a moment' : voiceAvailable ? 'Ready when you are' : 'Nancy is warming up';
  const submitTypedTurn = (event: FormEvent) => {
    event.preventDefault();
    if (!voiceHandle.current?.sendText || !typedTurn.trim() || voice === 'thinking' || voice === 'speaking') return;
    const text = typedTurn.trim(); setTypedTurn('');
    void voiceHandle.current.sendText(text);
  };
  const earlierTranscript = transcript.slice(0, -3);
  const recentTranscript = transcript.slice(-3);
  const transcriptLine = (line: Transcript, index: number) => <p key={`${line.speaker}-${index}`} className={line.speaker}><strong>{line.speaker === "nancy" ? "Nancy" : "You"}</strong>{line.text}</p>;

  return <main className="today-shell"><header className="today-header"><div><p className="eyebrow">Nancy · your day</p><h1>{today.priority_context?.greeting || `Hello, ${today.profile!.display_name}.`}</h1><p className="date-line">{date}</p></div><div className="header-actions"><button className="text-button" onClick={onEditChoices} disabled={editLocked}>Edit choices</button><button className="text-button" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh"}</button><button className="text-button" onClick={() => void signOut()}>Sign out</button></div></header>
    <nav className="day-tabs" aria-label="My Day views">{([['my_day', 'My Day'], ['activity', 'Activity'], ['tasks', 'Tasks'], ['meals', 'Meals'], ['groceries', 'Groceries']] as const).map(([id, label]) => <button key={id} type="button" aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>{label}</button>)}</nav>
    <section className="voice-panel" aria-label="Talk to Nancy"><div><p className="eyebrow">Talk to Nancy</p><h2 aria-live="polite">{voiceHeading}</h2><p>{voiceMessage ?? (voiceAvailable ? "Ask Nancy about your day, meals, or anything you need help with." : "Nancy’s voice is warming up. You can review your day while you wait.")}</p></div>
      <div className="voice-actions">{voiceSessionActive || voice === "connecting" ? <>{voiceTransport === 'local' && voiceSessionActive && (voice === 'speaking' || voice === 'thinking') && voiceHandle.current?.interrupt && <button className="interrupt-button" onClick={() => voiceHandle.current?.interrupt?.()}>Interrupt Nancy</button>}<button className="stop-button" onClick={() => void stopSpeaking()}>Stop voice</button></> : <button className="talk-button" onClick={() => void startSpeaking()} disabled={editLocked}>Talk to Nancy</button>}</div>
    </section>
    {voiceTransport === 'local' && voiceSessionActive && <form className="typed-turn" onSubmit={submitTypedTurn}><label>Type to Nancy<input value={typedTurn} onChange={event => setTypedTurn(event.target.value)} maxLength={2000} disabled={voice === 'thinking' || voice === 'speaking'} placeholder="Ask Nancy about your day" /></label><button className="secondary-button" disabled={!typedTurn.trim() || voice === 'thinking' || voice === 'speaking'}>Send</button></form>}
    {transcript.length > 0 && <section className="transcript" aria-live="polite" aria-label="Recent conversation">{earlierTranscript.length > 0 && <details className="transcript-history"><summary>Earlier conversation ({earlierTranscript.length})</summary>{earlierTranscript.map(transcriptLine)}</details>}{recentTranscript.map((line, index) => transcriptLine(line, earlierTranscript.length + index))}</section>}
    <DayOverview today={today} onView={setView} onRefresh={onRefresh} visible={view === 'my_day'} />
    {view === 'my_day' && (!today.checkin?.accepted && !today.checkin?.proposal && !mealSlots.every(slot => today.meal_options.some(option => option.slots.includes(slot))) ? <section className="empty-plan"><h2>Add meal choices to plan today</h2><p>You can review saved tasks now. Add a choice for breakfast, lunch, and dinner when you are ready to make a day plan.</p><button className="primary-button" onClick={onEditChoices}>Add choices</button></section> : !today.checkin ? <section className="empty-plan"><h2>Start today’s check-in</h2><p>Review your task and meal choices, then decide on the plan that suits today.</p><button className="primary-button" onClick={() => void begin()} disabled={save.kind === "saving" || save.kind === "unconfirmed" || save.kind === "conflict"}>Begin today’s check-in</button></section> : <PlanWorkspace key={[today.local_date, today.checkin.id, today.checkin.revision, today.checkin.proposal?.id, today.checkin.accepted?.id].join(':')} today={today} editing={editing} setEditing={setEditing} save={save} onIssue={issue} />)}
    {view === 'tasks' && <TasksView today={today} onReview={() => setView('my_day')} />}
    {view === 'meals' && <MealsView today={today} onReview={() => setView('my_day')} />}
    {view === 'activity' && <ActivityView initial={today.activity_ledger} localDate={today.local_date} timeZone={today.profile!.time_zone} onTodayRefresh={onRefresh} />}
    <GroceriesView initial={today.groceries} visible={view === 'groceries'} />
    <SaveNotice state={save} onReconcile={() => void reconcile()} onRefresh={() => void refresh()} />
    {refreshIssue && <p className="refresh-issue" role="status">{refreshIssue} Your last confirmed plan is still shown.</p>}
  </main>;
}

function DayOverview({ today, onView, onRefresh, visible }: { today: Today; onView: (view: ClientView) => void; onRefresh: () => Promise<Today>; visible: boolean }) {
  const [appointmentTitle, setAppointmentTitle] = useState('');
  const [appointmentStart, setAppointmentStart] = useState('');
  const [appointmentBusy, setAppointmentBusy] = useState(false);
  const [appointmentPending, setAppointmentPending] = useState<{ title: string; starts_at: string; idempotency_key: string } | null>(null);
  const [appointmentNotice, setAppointmentNotice] = useState<string | null>(null);
  const afterAppointmentSaved = async (message: string) => {
    setAppointmentPending(null); setAppointmentTitle(''); setAppointmentStart('');
    setAppointmentNotice(message);
    try { await onRefresh(); }
    catch { setAppointmentNotice(`${message} Refresh your day to see the latest appointments.`); }
  };
  const refreshAppointments = async () => {
    setAppointmentBusy(true);
    try {
      const current = await onRefresh();
      if (appointmentPending) {
        const found = current.appointments?.some(item => item.title === appointmentPending.title && new Date(item.starts_at).getTime() === new Date(appointmentPending.starts_at).getTime());
        if (found) setAppointmentNotice('A matching appointment is on your list. If you need to retry this add, use the same request below.');
        else setAppointmentNotice('This appointment is still unconfirmed. It was not sent again.');
      }
    } catch (error) { setAppointmentNotice(friendlyError(error)); }
    finally { setAppointmentBusy(false); }
  };
  const addAppointment = async (event: FormEvent) => {
    event.preventDefault(); if (!appointmentTitle.trim() || !appointmentStart.trim() || appointmentBusy || appointmentPending) return;
    const converted = localDateTimeWithOffset(appointmentStart, today.profile!.time_zone);
    if (!converted.ok) {
      setAppointmentNotice(converted.reason === 'nonexistent' ? 'That time does not occur on this date because the clocks change. Choose another time.'
        : converted.reason === 'ambiguous' ? 'That time occurs twice because the clocks change. Choose another time.'
        : converted.reason === 'zone' ? 'Your time zone could not be read. Check your profile before adding an appointment.'
        : 'Choose a valid appointment date and time.');
      return;
    }
    const startsAt = converted.value;
    setAppointmentBusy(true); setAppointmentNotice(null);
    const input = { title: appointmentTitle.trim(), starts_at: startsAt, idempotency_key: keyFor() };
    try { await api.addAppointment(input); await afterAppointmentSaved('Appointment added.'); }
    catch (error) {
      if (error instanceof ApiError && error.code === 'connection_unconfirmed') { setAppointmentPending(input); setAppointmentNotice('Save unconfirmed. Check appointments before trying again.'); }
      else setAppointmentNotice(friendlyError(error));
    } finally { setAppointmentBusy(false); }
  };
  const retryAppointment = async () => {
    if (!appointmentPending || appointmentBusy) return;
    setAppointmentBusy(true);
    try { await api.addAppointment(appointmentPending); await afterAppointmentSaved('Appointment confirmed.'); }
    catch (error) { setAppointmentNotice(error instanceof ApiError && error.code === 'connection_unconfirmed' ? 'Save remains unconfirmed. The same request was used; check appointments again.' : friendlyError(error)); }
    finally { setAppointmentBusy(false); }
  };
  const visibleTasks = displayedTasks(today).flatMap(task => {
    const activity = effectiveActivity(today, 'task', task.id);
    if (activity?.status === 'completed') return [];
    const detail = activityDetail(today, activity, today.profile!.time_zone);
    return [{ task, detail: detail ?? [taskTiming(task, today), task.urgency ? `${task.urgency} urgency` : null].filter(Boolean).join(' · ') }];
  });
  const plan = today.checkin?.accepted ?? today.checkin?.proposal;
  const appointmentThrough = shiftedDate(today.local_date, 7);
  const visibleAppointments = (today.appointments ?? []).flatMap(item => {
    const activity = effectiveActivity(today, 'appointment', item.id);
    const effectiveTime = activity?.scheduled_at ?? item.starts_at;
    const effectiveDate = dateForInstant(effectiveTime, today.profile!.time_zone);
    if (effectiveDate < today.local_date || effectiveDate > appointmentThrough || activity?.status === 'completed' && effectiveDate !== today.local_date) return [];
    return [{ item, activity, effectiveTime }];
  }).sort((a, b) => a.effectiveTime.localeCompare(b.effectiveTime));
  return <section className="day-overview" aria-labelledby="day-overview-title" hidden={!visible}><h2 id="day-overview-title">Your day</h2>
    <div className="day-task-glance"><div className="glance-heading"><h3>Tasks</h3><button className="text-button" onClick={() => onView('tasks')}>See tasks</button></div>{visibleTasks.length ? <ul>{visibleTasks.map(({ task, detail }) => <li key={task.id}><span>{task.title}</span><small>{detail}</small></li>)}</ul> : <p>{today.tasks.length ? 'No tasks are waiting for you.' : 'No tasks have been added.'}</p>}</div>
    <div className="day-task-glance"><div className="glance-heading"><h3>Meals</h3><button className="text-button" onClick={() => onView('meals')}>See meals</button></div><ul>{mealSlots.map(slot => { const meal = plan?.meals.find(item => item.slot === slot); const activity = meal ? effectiveActivity(today, 'meal', meal.option_id, slot) : unplannedMeal(today, slot); return <li key={slot}><span><strong>{labelForSlot[slot]}</strong> · {meal?.name ?? activity?.title ?? 'No meal chosen'}</span><small>{activityDetail(today, activity, today.profile!.time_zone) ?? mealTiming(activity, today.profile!.time_zone)}</small></li>; })}</ul></div>
    <div className="appointment-list"><h3>Appointments</h3>{visibleAppointments.length ? <ul>{visibleAppointments.map(({ item, activity, effectiveTime }) => <li key={item.id}>{item.title} · {displayInstant(effectiveTime, today.profile!.time_zone)}{activityDetail(today, activity, today.profile!.time_zone) ? ` · ${activityDetail(today, activity, today.profile!.time_zone)}` : ''}</li>)}</ul> : <p>No appointments saved for the next seven days.</p>}
      {appointmentNotice && <p className="notice" role="status">{appointmentNotice}</p>}
      {appointmentPending ? <div className="pending-actions"><button className="secondary-button" disabled={appointmentBusy} onClick={() => void refreshAppointments()}>Check appointments</button><button className="secondary-button" disabled={appointmentBusy} onClick={() => void retryAppointment()}>Retry same appointment add</button></div> : <details className="appointment-entry"><summary>Add an appointment</summary><form className="appointment-form" onSubmit={addAppointment}><label>Appointment title<input value={appointmentTitle} onChange={event => setAppointmentTitle(event.target.value)} maxLength={160} required placeholder="For example, clinic visit" /></label><label>Date and time in {today.profile!.time_zone}<input type="datetime-local" value={appointmentStart} onChange={event => setAppointmentStart(event.target.value)} required aria-describedby="appointment-time-help" /></label><p id="appointment-time-help" className="field-help">Use the date and time where you live. If the clocks change at that time, Nancy will ask you to choose another.</p><button className="secondary-button" disabled={appointmentBusy}>Add appointment</button></form></details>}
    </div>
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
    return <section key={slot} className={activity?.status === 'completed' ? 'activity-complete' : undefined}><h3>{labelForSlot[slot]}</h3><p className="meal-name">{meal?.name ?? activity?.title ?? 'No meal chosen'}</p><p>{result ? `${result}${portion ? ` · ${portion}` : ''}` : meal ? `${today.checkin?.accepted ? 'In accepted plan' : 'In proposed plan'} · ${mealTiming(activity, today.profile!.time_zone)}` : 'Choose a meal with Nancy or in My Day.'}</p></section>;
  })}</div>{(today.activity_ledger?.entries ?? []).filter(item => item.kind === 'meal' && item.unplanned && item.status !== 'voided' && !unplannedInCards.has(item.id)).map(item => <div className="reported-meal" key={item.id}><h3>{item.title}</h3><p>{activityDetail(today, item, today.profile!.time_zone)}{item.portion ? ` · ${item.portion}` : ''}</p></div>)}</section>;
}

function ActivityView({ initial, localDate, timeZone, onTodayRefresh }: { initial?: ActivityLedger; localDate: string; timeZone: string; onTodayRefresh: () => Promise<Today> }) {
  const [selectedDate, setSelectedDate] = useState(localDate);
  const selectedDateRef = useRef(selectedDate);
  const ledgerRequest = useRef(0);
  const [ledger, setLedger] = useState<ActivityLedger | null>(initial ?? null);
  const [loading, setLoading] = useState(!initial);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<ActivityDraft | null>(null);
  const [notice, setNotice] = useState<{ kind: "status" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState<{ command: ActivityCommand; canRetry: boolean } | null>(null);

  useEffect(() => { if (selectedDate === localDate && initial?.local_date === localDate) setLedger(initial); }, [initial, localDate, selectedDate]);

  const refreshLedger = async () => {
    const date = selectedDate;
    const request = ++ledgerRequest.current;
    const current = () => selectedDateRef.current === date && ledgerRequest.current === request;
    try {
      const next = await api.activity(date);
      if (!current()) return null;
      if (next.local_date !== date) throw new Error('Activity date did not match the requested day.');
      setLedger(next);
      return next;
    } catch (error) {
      if (!current()) return null;
      throw error;
    }
  };

  useEffect(() => {
    let current = true;
    if (ledger?.local_date === selectedDate) { setLoading(false); return; }
    setLoading(true);
    void refreshLedger().then(next => { if (current && next) setNotice(null); })
      .catch(error => { if (current) setNotice({ kind: "error", text: friendlyError(error) }); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; ledgerRequest.current += 1; };
  }, [selectedDate]);

  const afterCommitted = async (message: string) => {
    setPending(null); setDraft(null);
    try { await refreshLedger(); setNotice({ kind: "status", text: message }); }
    catch { setNotice({ kind: "status", text: `${message} Refresh the activity list to see the latest details.` }); }
    try { await onTodayRefresh(); } catch { /* The activity commit remains valid when the broader day refresh fails. */ }
  };

  const commit = async (command: ActivityCommand, message: string) => {
    setBusy(true); setNotice(null);
    try {
      await api.activityCommand(command);
      await afterCommitted(message);
    } catch (error) {
      if (error instanceof ApiError && error.code === "connection_unconfirmed") {
        setPending({ command, canRetry: false });
        setNotice({ kind: "status", text: "Save unconfirmed. Check saved activity before trying again." });
      } else if (error instanceof ApiError && error.status === 409) {
        setNotice({ kind: "error", text: "This activity changed elsewhere. Refresh the activity list before making another change." });
      } else setNotice({ kind: "error", text: friendlyError(error) });
    } finally { setBusy(false); }
  };

  const checkPending = async () => {
    if (!pending || busy) return;
    setBusy(true); setNotice({ kind: "status", text: "Checking saved activity…" });
    try {
      await api.activityReceipt(pending.command.idempotency_key);
      await afterCommitted("Activity saved.");
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setPending({ ...pending, canRetry: true });
        setNotice({ kind: "status", text: "This activity was not found. You can retry the same save." });
      } else setNotice({ kind: "error", text: `${friendlyError(error)} The activity was not sent again.` });
    } finally { setBusy(false); }
  };

  const retryPending = async () => {
    if (!pending?.canRetry || busy) return;
    await commit(pending.command, "Activity saved.");
  };

  const convertLocalTime = (value: string) => {
    const converted = localDateTimeWithOffset(value, timeZone);
    if (converted.ok) return converted.value;
    setNotice({ kind: "error", text: converted.reason === "nonexistent" ? "That time does not occur because the clocks change. Choose another time."
      : converted.reason === "ambiguous" ? "That time occurs twice because the clocks change. Choose another time."
      : converted.reason === "zone" ? "Your time zone could not be read. Check your profile before saving."
      : "Choose a valid date and time." });
    return null;
  };

  const submitDraft = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || busy || pending) return;
    if (draft.mode === "record") {
      const occurredAt = draft.status === "completed" ? convertLocalTime(draft.occurredLocal) : null;
      if (draft.status === "completed" && !occurredAt) return;
      const command: ActivityCommand = { type: "record_activity", idempotency_key: keyFor(), local_date: occurredAt ? draft.occurredLocal.slice(0, 10) : ledger!.local_date,
        expected_revision: draft.activity.revision, payload: { activity_id: draft.activity.id, status: draft.status, occurred_at: occurredAt, notes: draft.notes.trim(), ...(draft.activity.kind === "meal" ? { portion: draft.portion.trim() || null } : {}) } };
      await commit(command, draft.status === "completed" ? `${activityKindLabel(draft.activity.kind)} saved as ${activityVerb(draft.activity.kind)}.` : "Activity deferred.");
      return;
    }
    if (draft.mode === "correct") {
      const occurredAt = draft.status === "completed" ? convertLocalTime(draft.occurredLocal) : null;
      if (draft.status === "completed" && !occurredAt) return;
      const command: ActivityCommand = { type: "correct_activity", idempotency_key: keyFor(), local_date: occurredAt ? draft.occurredLocal.slice(0, 10) : draft.activity.local_date,
        expected_revision: draft.activity.revision, payload: { activity_id: draft.activity.id, status: draft.status, occurred_at: occurredAt, notes: draft.notes.trim(),
          ...(draft.activity.kind === "meal" ? { portion: draft.portion.trim() || null } : {}), reason: draft.reason.trim() } };
      await commit(command, "Activity correction saved.");
      return;
    }
    if (draft.mode === "reschedule") {
      const scheduledAt = convertLocalTime(draft.scheduledLocal);
      if (!scheduledAt) return;
      const command: ActivityCommand = { type: "reschedule_activity", idempotency_key: keyFor(), local_date: draft.activity.local_date,
        expected_revision: draft.activity.revision, payload: { activity_id: draft.activity.id, scheduled_at: scheduledAt, reason: draft.reason.trim() } };
      await commit(command, "New time saved.");
      return;
    }
    const occurredAt = convertLocalTime(draft.occurredLocal);
    if (!occurredAt) return;
    const command: ActivityCommand = { type: "record_activity", idempotency_key: keyFor(), local_date: draft.occurredLocal.slice(0, 10), expected_revision: 0,
      payload: { unplanned: { kind: draft.kind, title: draft.title.trim(), ...(draft.kind === "meal" ? { meal_slot: draft.mealSlot } : {}) }, status: "completed", occurred_at: occurredAt,
        notes: draft.notes.trim(), ...(draft.kind === "meal" ? { portion: draft.portion.trim() || null } : {}) } };
    await commit(command, `${activityKindLabel(draft.kind)} added to today’s activity.`);
  };

  const formatWhen = (value: string | null) => value ? new Intl.DateTimeFormat("en-CA", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "No actual time recorded";
  const openRecord = (activity: ActivityOption, status: "completed" | "deferred") => setDraft({ mode: "record", activity, status, occurredLocal: activityDefaultTime(selectedDate, timeZone), notes: "", portion: "" });
  const openCorrection = (activity: ActivityEntry) => setDraft({ mode: "correct", activity, status: activity.status === "pending" ? "deferred" : activity.status,
    occurredLocal: activity.occurred_at ? localInputValue(activity.occurred_at, timeZone) : activityDefaultTime(activity.local_date, timeZone), notes: activity.notes, portion: activity.portion ?? "", reason: "" });
  const openReschedule = (activity: ActivityOption) => setDraft({ mode: "reschedule", activity, scheduledLocal: activity.scheduled_at ? localInputValue(activity.scheduled_at, timeZone) : activityDefaultTime(selectedDate, timeZone), reason: "" });

  const viewingToday = selectedDate === localDate;
  const selectedDayLabel = formatDay(selectedDate, timeZone);
  const dateControl = <div className="activity-date"><label>Activity date<input type="date" value={selectedDate} max={localDate} disabled={busy || Boolean(pending)} onChange={event => {
    const value = event.target.value;
    if (!validActivityDate(value, localDate) || value === selectedDate) return;
    selectedDateRef.current = value; ledgerRequest.current += 1;
    setSelectedDate(value); setDraft(null); setNotice(null);
  }} /></label><span>{viewingToday ? "Today" : selectedDayLabel}</span></div>;
  if (loading || !ledger || ledger.local_date !== selectedDate) return <section className="data-view" aria-labelledby="activity-title"><p className="eyebrow">What actually happened</p><h2 id="activity-title">Activity</h2>{dateControl}{loading ? <p aria-live="polite">Loading activity…</p> : <>{notice && <p className="notice error" role="alert">{notice.text}</p>}<button className="secondary-button" disabled={busy} onClick={() => {
    setLoading(true); setBusy(true);
    void refreshLedger().then(next => { if (next) setNotice(null); }).catch(error => setNotice({ kind: "error", text: friendlyError(error) })).finally(() => { setLoading(false); setBusy(false); });
  }}>Try again</button></>}</section>;

  const openActivities = ledger.options.filter(item => item.status === "pending" || item.status === "deferred" || item.status === "voided" && !item.unplanned);
  return <section className="data-view activity-view" aria-labelledby="activity-title">
    <div className="section-heading"><div><p className="eyebrow">What actually happened</p><h2 id="activity-title">Activity</h2><p>Plans are choices for the day. This list changes only when you report what happened.</p></div><button className="text-button" disabled={busy} onClick={() => { setBusy(true); void refreshLedger().then(() => setNotice(null)).catch(error => setNotice({ kind: "error", text: friendlyError(error) })).finally(() => setBusy(false)); }}>Refresh activity</button></div>
    {dateControl}
    <dl className="activity-summary" aria-label={`${viewingToday ? "Today’s" : selectedDayLabel} activity summary`}><div><dt>Tasks done</dt><dd>{ledger.summary.tasks_completed}</dd></div><div><dt>Meals eaten</dt><dd>{ledger.summary.meals_eaten}</dd></div><div><dt>Appointments attended</dt><dd>{ledger.summary.appointments_attended}</dd></div><div><dt>Deferred</dt><dd>{ledger.summary.deferred}</dd></div></dl>
    {notice && <p className={`notice ${notice.kind === "error" ? "error" : "saved"}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
    {pending && <div className="pending-actions"><button className="secondary-button" disabled={busy} onClick={() => void checkPending()}>Check saved activity</button>{pending.canRetry && <button className="secondary-button" disabled={busy} onClick={() => void retryPending()}>Retry same save</button>}</div>}

    {draft && <form className="activity-editor" onSubmit={submitDraft} aria-label="Activity details">
      <div className="section-heading"><div><p className="eyebrow">{draft.mode === "correct" ? "Correct the record" : draft.mode === "reschedule" ? "Choose a new time" : draft.mode === "unplanned" ? "Add actual activity" : "Confirm what happened"}</p><h3>{draft.mode === "unplanned" ? "Unplanned activity" : draft.activity.title}</h3></div><button type="button" className="text-button" onClick={() => setDraft(null)} disabled={busy}>Cancel</button></div>
      {draft.mode === "unplanned" && <><label>Type<select value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value as ActivityKind })}><option value="task">Task</option><option value="meal">Meal</option><option value="appointment">Appointment</option></select></label><label>What happened?<input value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} maxLength={160} required /></label>{draft.kind === "meal" && <label>Meal<select value={draft.mealSlot} onChange={event => setDraft({ ...draft, mealSlot: event.target.value as MealSlot })}>{mealSlots.map(slot => <option key={slot} value={slot}>{labelForSlot[slot]}</option>)}</select></label>}</>}
      {draft.mode === "record" && <label>Result<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as "completed" | "deferred" })}><option value="completed">{activityKindLabel(draft.activity.kind)} {activityVerb(draft.activity.kind)}</option><option value="deferred">Deferred</option></select></label>}
      {draft.mode === "correct" && <label>Correct result<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as "completed" | "deferred" | "voided" })}><option value="completed">{activityKindLabel(draft.activity.kind)} {activityVerb(draft.activity.kind)}</option><option value="deferred">Deferred</option><option value="voided">Remove mistaken report</option></select></label>}
      {(draft.mode === "record" && draft.status === "completed" || draft.mode === "correct" && draft.status === "completed" || draft.mode === "unplanned") && <label>Actual date and time<input type="datetime-local" value={draft.occurredLocal} max={localInputValue(new Date(), timeZone)} onChange={event => setDraft({ ...draft, occurredLocal: event.target.value })} required /></label>}
      {draft.mode === "reschedule" && <label>New date and time<input type="datetime-local" value={draft.scheduledLocal} onChange={event => setDraft({ ...draft, scheduledLocal: event.target.value })} required /></label>}
      {((draft.mode === "record" || draft.mode === "correct") && draft.activity.kind === "meal" || draft.mode === "unplanned" && draft.kind === "meal") && <label>Portion or amount <span className="optional">Optional</span><input value={draft.portion} onChange={event => setDraft({ ...draft, portion: event.target.value })} maxLength={160} placeholder="For example, one bowl" /></label>}
      {(draft.mode === "record" || draft.mode === "correct" || draft.mode === "unplanned") && <label>Notes <span className="optional">Optional</span><textarea value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} maxLength={500} rows={2} /></label>}
      {(draft.mode === "correct" || draft.mode === "reschedule") && <label>Why are you changing this?<input value={draft.reason} onChange={event => setDraft({ ...draft, reason: event.target.value })} maxLength={500} required /></label>}
      <button className="primary-button" disabled={busy || Boolean(pending)}>{busy ? "Saving…" : draft.mode === "reschedule" ? "Save new time" : draft.mode === "correct" ? "Save correction" : "Save actual activity"}</button>
    </form>}

    <div className="activity-section-heading"><div><h3>Still to do or update</h3><p>These items have not been recorded as completed.</p></div><button className="secondary-button" disabled={busy || Boolean(pending)} onClick={() => setDraft({ mode: "unplanned", kind: "task", title: "", mealSlot: "breakfast", occurredLocal: activityDefaultTime(selectedDate, timeZone), notes: "", portion: "" })}>Add unplanned activity</button></div>
    {openActivities.length ? <ul className="activity-list">{openActivities.map(item => <li key={item.id}><div><span className="activity-kind">{activityKindLabel(item.kind)}</span><h3>{item.title}</h3><p>{item.status === "deferred" ? "Deferred" : item.status === "voided" ? "Mistaken report removed · ready to report again" : item.scheduled_at ? `Planned for ${formatWhen(item.scheduled_at)}` : "No planned time"}</p></div><div className="activity-actions"><button className="primary-button" aria-label={`Mark ${item.title} ${activityVerb(item.kind)}`} disabled={busy || Boolean(pending)} onClick={() => openRecord(item, "completed")}>Mark {activityVerb(item.kind)}</button>{item.status !== "deferred" && <button className="secondary-button" aria-label={`Defer ${item.title}`} disabled={busy || Boolean(pending)} onClick={() => openRecord(item, "deferred")}>Defer</button>}<button className="text-button" aria-label={`Reschedule ${item.title}`} disabled={busy || Boolean(pending)} onClick={() => openReschedule(item)}>Reschedule</button></div></li>)}</ul> : <p className="activity-empty">Nothing is waiting for an update.</p>}

    <div className="activity-section-heading"><div><h3>{viewingToday ? "Recorded today" : `Recorded on ${selectedDayLabel}`}</h3><p>Only saved reports appear here. You can correct a mistake without changing the accepted plan.</p></div></div>
    {ledger.entries.length ? <ul className="activity-list recorded-list">{ledger.entries.map(item => <li key={item.id}><div><span className="activity-kind">{item.unplanned ? `Unplanned ${activityKindLabel(item.kind).toLowerCase()}` : activityKindLabel(item.kind)}</span><h3>{item.title}</h3><p>{item.last_action === "rescheduled" ? `Rescheduled for ${formatWhen(item.scheduled_at)}` : item.status === "completed" ? `${activityKindLabel(item.kind)} ${activityVerb(item.kind)} · ${formatWhen(item.occurred_at)}` : item.status === "deferred" ? "Deferred" : "Mistaken report removed"}{item.portion ? ` · ${item.portion}` : ""}</p>{item.notes && <p>{item.notes}</p>}</div><button className="secondary-button" aria-label={`Correct ${item.title}`} disabled={busy || Boolean(pending)} onClick={() => openCorrection(item)}>Correct</button></li>)}</ul> : <p className="activity-empty">No actual activity was recorded on this date.</p>}
  </section>;
}

function GroceriesView({ initial, visible }: { initial?: GroceryItem[]; visible: boolean }) {
  const [items, setItems] = useState(initial ?? []);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [pendingItem, setPendingItem] = useState<{ name: string; quantity?: string; idempotency_key: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const refresh = async () => {
    setBusy(true); setNotice(null);
    try {
      const result = await api.groceries(); const latest = Array.isArray(result) ? result : result.items;
      setItems(latest); setLoaded(true);
      if (pendingItem) setNotice(latest.some(item => item.name === pendingItem.name && (item.quantity ?? '') === (pendingItem.quantity ?? '')) ? 'A matching item is on your list. If you retry this add, use the same request below.' : 'This item is still unconfirmed. It was not sent again.');
    }
    catch (error) { setNotice(friendlyError(error)); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (initial) setItems(initial); }, [initial]);
  useEffect(() => { if (visible && !loaded) void refresh(); }, [visible]);
  const add = async (event: FormEvent) => {
    event.preventDefault(); if (!name.trim() || busy || uncertain) return;
    setBusy(true); setNotice(null);
    const input = { name: name.trim(), ...(quantity.trim() ? { quantity: quantity.trim() } : {}), idempotency_key: keyFor() };
    try {
      await api.addGrocery(input);
      setName(''); setQuantity(''); await refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'connection_unconfirmed') { setUncertain(true); setPendingItem(input); setNotice('Add unconfirmed. Refresh the list before trying again.'); }
      else setNotice(friendlyError(error));
    } finally { setBusy(false); }
  };
  const retry = async () => {
    if (!pendingItem || busy) return;
    setBusy(true);
    try { await api.addGrocery(pendingItem); setUncertain(false); setPendingItem(null); setName(''); setQuantity(''); await refresh(); setNotice('Grocery item confirmed.'); }
    catch (error) { setNotice(error instanceof ApiError && error.code === 'connection_unconfirmed' ? 'Add remains unconfirmed. The same request was used; check the list again.' : friendlyError(error)); }
    finally { setBusy(false); }
  };
  return <section className="data-view" aria-labelledby="groceries-title" hidden={!visible}><div className="section-heading"><div><p className="eyebrow">Household</p><h2 id="groceries-title">Groceries</h2></div><button className="text-button" onClick={() => void refresh()} disabled={busy}>Refresh list</button></div><p>Add something when you want it on the list. Nancy will ask before adding a spoken item.</p>
    {notice && <p className="notice error" role="status">{notice}</p>}
    <form className="grocery-form" onSubmit={add}><label>Item<input value={name} onChange={event => setName(event.target.value)} maxLength={160} required placeholder="For example, milk" /></label><label>Quantity <span className="optional">Optional</span><input value={quantity} onChange={event => setQuantity(event.target.value)} maxLength={80} placeholder="For example, 1 carton" /></label><button className="primary-button" disabled={busy || uncertain || !name.trim()}>Add to groceries</button></form>
    {pendingItem && <button className="secondary-button" disabled={busy} onClick={() => void retry()}>Retry same grocery add</button>}
    <h3>On the list</h3>{loaded && !items.length ? <p>Nothing on your grocery list yet.</p> : <ul className="item-list">{items.map(item => <li key={item.id}><span>{item.name}</span>{item.quantity && <span>{item.quantity}</span>}</li>)}</ul>}
  </section>;
}

function SaveNotice({ state, onReconcile, onRefresh }: { state: SaveState; onReconcile: () => void; onRefresh: () => void }) {
  if (state.kind === "idle" || state.kind === "saving") return state.kind === "saving" ? <p className="save-status" aria-live="polite">Saving your choice…</p> : null;
  return <section className={`notice ${state.kind}`} role={state.kind === "error" || state.kind === "conflict" ? "alert" : "status"}><p>{state.message}</p>{state.kind === "unconfirmed" && <button className="secondary-button" onClick={onReconcile}>Check saved plan</button>}{state.kind === "conflict" && <button className="secondary-button" onClick={onRefresh}>Refresh today</button>}</section>;
}

function PlanWorkspace({ today, editing, setEditing, save, onIssue }: { today: Today; editing: boolean; setEditing: (value: boolean) => void; save: SaveState; onIssue: (command: CareCommand) => Promise<void> }) {
  const pending = planIsPending(today);
  const accepted = today.checkin?.accepted;
  const proposal = today.checkin?.proposal;
  // The parent's plan-version key resets drafts before display, never in a
  // delayed mount effect that could overwrite the participant's first choice.
  const [choice, setChoice] = useState(() => selectedPlan(today));
  const canSave = mealSlots.every(slot => Boolean(choice.meals[slot]));
  const locked = save.kind === "saving" || save.kind === "unconfirmed" || save.kind === "conflict";
  const saveForReview = async () => {
    const type = accepted ? "revise_day_plan" : "propose_day_plan";
    const source = proposal ?? accepted;
    const task_overrides = choice.taskIds.flatMap(id => {
      const task = source?.tasks.find(item => item.id === id);
      return task ? [{ id, urgency: task.urgency, scheduled_time: task.scheduled_time, duration_minutes: task.duration_minutes }] : [];
    });
    await onIssue({ type, idempotency_key: keyFor(), local_date: today.local_date, expected_revision: today.checkin!.revision, payload: { task_ids: choice.taskIds, meals: mealSlots.map(slot => ({ slot, option_id: choice.meals[slot] })), task_overrides } });
    setEditing(false);
  };
  const accept = async () => { if (proposal) await onIssue({ type: "accept_day_plan", idempotency_key: keyFor(), local_date: today.local_date, expected_revision: today.checkin!.revision, payload: { proposal_id: proposal.id } }); };
  if (pending && !editing) return <ReviewPlan plan={proposal!} heading="Review this plan" explanation="Nothing has been accepted yet. Look it over, then choose what happens next." primaryLabel="Accept this plan" primary={accept} secondaryLabel="Make changes" secondary={() => setEditing(true)} busy={locked} />;
  if (accepted && !editing) return <><ReviewPlan plan={accepted} heading="Today’s accepted plan" explanation="This is the plan you chose for today." primaryLabel="Revise today’s plan" primary={() => setEditing(true)} busy={locked} /><p className="plan-note">Changing it creates a new plan for you to review. It does not replace today’s accepted plan until you choose to accept the new one.</p></>;
  return <section className="planner" aria-labelledby="planner-title"><div className="section-heading"><div><p className="eyebrow">{accepted ? "Make a change" : "Plan together"}</p><h2 id="planner-title">Choose what feels right today.</h2></div><span className="review-chip">Review before saving</span></div><fieldset disabled={locked}><legend>Tasks</legend>{today.tasks.map(task => <label className="choice-row" key={task.id}><input type="checkbox" checked={choice.taskIds.includes(task.id)} onChange={event => { const checked = event.target.checked; setChoice(current => ({ ...current, taskIds: checked ? [...current.taskIds, task.id] : current.taskIds.filter(id => id !== task.id) })); }} /><span>{task.title}{task.time_hint && <small>{task.time_hint}</small>}</span></label>)}</fieldset><fieldset disabled={locked}><legend>Meals</legend>{mealSlots.map(slot => <label className="meal-select" key={slot}>{labelForSlot[slot]}<select value={choice.meals[slot]} onChange={event => { const value = event.target.value; setChoice(current => ({ ...current, meals: { ...current.meals, [slot]: value } })); }}><option value="">Choose a meal</option>{today.meal_options.filter(option => option.slots.includes(slot)).map(option => <option value={option.id} key={option.id}>{option.name}</option>)}</select></label>)}</fieldset><div className="planner-actions"><button className="primary-button" disabled={!canSave || locked} onClick={() => void saveForReview()}>{save.kind === "saving" ? "Saving…" : "Save plan for review"}</button>{accepted && <button className="text-button" disabled={locked} onClick={() => setEditing(false)}>Keep accepted plan</button>}</div></section>;
}

function ReviewPlan({ plan, heading, explanation, primaryLabel, primary, secondaryLabel, secondary, busy }: { plan: Plan; heading: string; explanation: string; primaryLabel: string; primary: () => void | Promise<void>; secondaryLabel?: string; secondary?: () => void; busy: boolean }) {
  return <section className="review-card" aria-labelledby="review-title"><p className="eyebrow">Your day</p><h2 id="review-title">{heading}</h2><p>{explanation}</p><div className="review-grid"><div><h3>Tasks</h3><ul>{plan.tasks.map(task => <li key={task.id}>{task.title}{(task.scheduled_time || task.urgency || task.duration_minutes || task.category && task.category !== 'task') && <small>{[task.scheduled_time, task.urgency ? `${task.urgency} urgency` : null, task.duration_minutes ? `${task.duration_minutes} min` : null, task.category && task.category !== 'task' ? task.category : null].filter(Boolean).join(' · ')}</small>}</li>)}</ul></div><div><h3>Meals</h3><dl>{mealSlots.map(slot => <div key={slot}><dt>{labelForSlot[slot]}</dt><dd>{plan.meals.find(meal => meal.slot === slot)?.name ?? "Not chosen"}</dd></div>)}</dl></div></div><div className="review-actions"><button className="primary-button" onClick={() => void primary()} disabled={busy}>{primaryLabel}</button>{secondary && <button className="secondary-button" disabled={busy} onClick={secondary}>{secondaryLabel}</button>}</div></section>;
}
