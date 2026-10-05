import { FormEvent, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { startVoice } from "./voice";
import { startLocalVoice, type LocalVoiceState } from "./local-voice";
import { localDateTimeWithOffset } from "../shared/local-time";
import { mealSlots, type AcceptedPlan, type AppConfig, type CareCommand, type ClientView, type GroceryItem, type MealSlot, type Plan, type Receipt, type SetupInput, type Today } from "../shared/contracts";

type AppState = "loading" | "readiness" | "login" | "setup" | "today" | "signout";
type SaveState = { kind: "idle" | "saving" | "saved" | "unconfirmed" | "conflict" | "error"; message?: string; key?: string };
type VoiceState = LocalVoiceState;
type Transcript = { speaker: "you" | "nancy"; text: string };

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
  if (screen === "readiness") return <Readiness config={config} message={message} onRetry={retry} />;
  if (screen === "login") return <Login onLoggedIn={async () => {
    sessionEpoch.current += 1;
    const next = await refreshToday();
    setScreen(next.profile ? "today" : "setup");
  }} />;
  if (screen === "setup") return <Setup initialToday={today} onSaved={next => { setToday(next); setScreen("today"); }} />;
  return <TodayView today={today!} voiceAvailable={config?.voice_available ?? false} voiceTransport={config?.voice_transport} synthetic={config?.synthetic ?? false} onRefresh={refreshToday} onReceipt={applyReceipt} onEditChoices={() => { todayRequest.current += 1; setScreen("setup"); }} onLogout={signOut} />;
}

function Loading() {
  return <main className="loading-page" aria-live="polite"><div className="loading-orb" /><p>Getting your day ready…</p></main>;
}

function Readiness({ config, message, onRetry }: { config: AppConfig | null; message: string | null; onRetry: () => void }) {
  const missing = config?.missing ?? ["The connection to Nancy"];
  return <main className="centered-page">
    <section className="readiness-card" aria-labelledby="readiness-title">
      <div className="sun-mark" aria-hidden="true">☀</div>
      <p className="eyebrow">Nancy is getting ready</p>
      <h1 id="readiness-title">A few things still need attention.</h1>
      <p>Nancy will be ready once the following setup is complete.</p>
      <ul>{missing.map(item => <li key={item}>{item}</li>)}</ul>
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
  return <main className="setup-page"><section className="setup-intro"><div className="sun-mark" aria-hidden="true">☀</div><p className="eyebrow">{editing ? "Your choices" : "A gentle beginning"}</p><h1>{editing ? "Keep your choices current." : "Let’s make today easier."}</h1><p>List practical tasks and meal choices. You can change today’s plan before you accept it.</p></section>
    <form className="setup-form" onSubmit={submit} aria-label={editing ? "Edit Nancy choices" : "Set up Nancy"}>
      <label>What should Nancy call you?<input value={name} onChange={event => setName(event.target.value)} maxLength={60} required /></label>
      <label>Your time zone<input value={zone} onChange={event => setZone(event.target.value)} maxLength={80} required aria-describedby="timezone-help" /></label><p id="timezone-help" className="field-help">This keeps “today” and your 10 AM check-in in the right local day.</p>
      <label>Tasks to choose from<textarea value={tasksText} onChange={event => setTasksText(event.target.value)} maxLength={3200} rows={4} required placeholder={"For example:\nFold laundry\nWater the plants"} /></label><p className="field-help">One task per line.</p>
      {lines(tasksText).length > 0 && <fieldset className="task-details"><legend>Task timing and priority <span className="optional">Optional</span></legend>{lines(tasksText).map((title, index) => <div className="task-detail" key={`${title}-${index}`}><h3>{title}</h3><div><label>Urgency for {title}<select value={taskDetails[title]?.urgency ?? ''} onChange={event => updateTaskDetail(title, { urgency: event.target.value ? event.target.value as 'high' | 'medium' | 'low' : undefined })}><option value="">Not set</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label><label>Time for {title}<input type="time" value={taskDetails[title]?.scheduled_time ?? ''} onChange={event => updateTaskDetail(title, { scheduled_time: event.target.value || null })} /></label><label>Category for {title}<select value={taskDetails[title]?.category ?? 'task'} onChange={event => updateTaskDetail(title, { category: event.target.value as 'task' | 'exercise' | 'rehab' })}><option value="task">Task</option><option value="exercise">Approved exercise</option><option value="rehab">Approved rehab</option></select></label><label>Minutes for {title}<input type="number" min="1" max="480" value={taskDetails[title]?.duration_minutes ?? ''} onChange={event => updateTaskDetail(title, { duration_minutes: event.target.value ? Number(event.target.value) : null })} /></label></div></div>)}</fieldset>}
      <fieldset><legend>Practical meal choices</legend>{mealSlots.map(slot => <label key={slot}>{labelForSlot[slot]}<textarea value={meals[slot]} onChange={event => setMeals(current => ({ ...current, [slot]: event.target.value }))} maxLength={3200} rows={3} required placeholder={`One ${slot} choice per line`} /></label>)}</fieldset>
      <label>Anything Nancy should keep in mind? <span className="optional">Optional</span><textarea value={preferences} onChange={event => setPreferences(event.target.value)} maxLength={1000} rows={3} placeholder="Preferences or practical notes" /></label>
      {error && <p className="notice error" role="alert">{error}</p>}
      {unconfirmed ? <button type="button" className="secondary-button" disabled={checking} onClick={() => void checkSavedSetup()}>{checking ? "Checking saved choices…" : "Check saved choices"}</button> : <button className="primary-button" disabled={busy}>{busy ? "Saving your choices…" : editing ? "Save choices" : "Continue to today"}</button>}
    </form>
  </main>;
}

function TodayView({ today, voiceAvailable, voiceTransport, synthetic, onRefresh, onEditChoices, onLogout, onReceipt }: { today: Today; voiceAvailable: boolean; voiceTransport?: AppConfig['voice_transport']; synthetic: boolean; onRefresh: () => Promise<Today>; onEditChoices: () => void; onLogout: () => Promise<void>; onReceipt: (receipt: Receipt, date: string) => void }) {
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
  const voiceHandle = useRef<{ stop: () => Promise<void>; sendText?: (text: string) => Promise<void> } | null>(null);
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
    if (!voiceAvailable || voiceHandle.current || save.kind === "unconfirmed" || save.kind === "conflict") return;
    const attempt = ++voiceAttempt.current;
    const controller = new AbortController();
    voiceAbort.current?.abort();
    voiceAbort.current = controller;
    setVoice("connecting"); setVoiceMessage("Connecting to Nancy…");
    try {
      const handle = await (voiceTransport === 'local' ? startLocalVoice : startVoice)({
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
          if (destination === 'my_day' || destination === 'tasks' || destination === 'meals' || destination === 'groceries') setView(destination);
        },
      });
      if (!active.current || attempt !== voiceAttempt.current) {
        await handle.stop();
        return;
      }
      voiceHandle.current = handle;
      setVoiceSessionActive(true);
      voiceAbort.current = null;
    } catch (error) {
      if (controller.signal.aborted || !active.current || attempt !== voiceAttempt.current) return;
      if (active.current && attempt === voiceAttempt.current) { setVoice("error"); setVoiceMessage(friendlyError(error)); }
    }
  };
  const stopSpeaking = async () => {
    voiceAttempt.current += 1;
    voiceAbort.current?.abort();
    voiceAbort.current = null;
    const handle = voiceHandle.current;
    voiceHandle.current = null;
    setVoiceSessionActive(false);
    setVoice("stopped"); setVoiceMessage("Nancy is paused.");
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
  const submitTypedTurn = (event: FormEvent) => {
    event.preventDefault();
    if (!voiceHandle.current?.sendText || !typedTurn.trim() || voice === 'thinking' || voice === 'speaking') return;
    const text = typedTurn.trim(); setTypedTurn('');
    void voiceHandle.current.sendText(text);
  };

  return <main className="today-shell">{synthetic && <p className="practice-banner" role="status">Practice account · sample data only</p>}<header className="today-header"><div><p className="eyebrow">Nancy · your day</p><h1>{today.priority_context?.greeting || `Hello, ${today.profile!.display_name}.`}</h1><p className="date-line">{date}</p></div><div className="header-actions"><button className="text-button" onClick={onEditChoices} disabled={editLocked}>Edit choices</button><button className="text-button" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh"}</button><button className="text-button" onClick={() => void signOut()}>Sign out</button></div></header>
    <nav className="day-tabs" aria-label="My Day views">{([['my_day', 'My Day'], ['tasks', 'Tasks'], ['meals', 'Meals'], ['groceries', 'Groceries']] as const).map(([id, label]) => <button key={id} type="button" aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>{label}</button>)}</nav>
    <section className="voice-panel" aria-label="Talk to Nancy"><div><p className="eyebrow">Talk together</p><h2>{voice === "listening" ? "Nancy is listening" : voice === "speaking" ? "Nancy is speaking" : "Ready when you are"}</h2><p>{voiceAvailable ? voiceMessage ?? (voice === "listening" ? "After you have reviewed the plan, you can say, “Nancy, accept this plan.”" : "Start a conversation and choose what matters today. You’re always in control.") : "Voice is not available right now. You can still review today using the buttons below."}</p></div>
      {voiceSessionActive || voice === "connecting" ? <button className="stop-button" onClick={() => void stopSpeaking()}>Stop voice</button> : <button className="talk-button" onClick={() => void startSpeaking()} disabled={!voiceAvailable || editLocked}>{"Talk to Nancy"}</button>}
    </section>
    {voiceTransport === 'local' && voiceSessionActive && <form className="typed-turn" onSubmit={submitTypedTurn}><label>Type to Nancy<input value={typedTurn} onChange={event => setTypedTurn(event.target.value)} maxLength={2000} disabled={voice === 'thinking' || voice === 'speaking'} placeholder="Ask Nancy about your day" /></label><button className="secondary-button" disabled={!typedTurn.trim() || voice === 'thinking' || voice === 'speaking'}>Send</button></form>}
    {transcript.length > 0 && <section className="transcript" aria-live="polite" aria-label="Recent conversation">{transcript.map((line, index) => <p key={`${line.speaker}-${index}`} className={line.speaker}><strong>{line.speaker === "nancy" ? "Nancy" : "You"}</strong>{line.text}</p>)}</section>}
    <DayOverview today={today} onView={setView} onRefresh={onRefresh} visible={view === 'my_day'} />
    {view === 'my_day' && (!today.checkin ? <section className="empty-plan"><h2>Start today’s check-in</h2><p>Review your task and meal choices, then decide on the plan that suits today.</p><button className="primary-button" onClick={() => void begin()} disabled={save.kind === "saving" || save.kind === "unconfirmed" || save.kind === "conflict"}>Begin today’s check-in</button></section> : <PlanWorkspace today={today} editing={editing} setEditing={setEditing} save={save} onIssue={issue} />)}
    {view === 'tasks' && <TasksView today={today} />}
    {view === 'meals' && <MealsView today={today} />}
    <GroceriesView initial={today.groceries} visible={view === 'groceries'} />
    <SaveNotice state={save} onReconcile={() => void reconcile()} onRefresh={() => void refresh()} />
    {refreshIssue && <p className="refresh-issue" role="status">{refreshIssue} Your last confirmed plan is still shown.</p>}
  </main>;
}

function DayOverview({ today, onView, onRefresh, visible }: { today: Today; onView: (view: ClientView) => void; onRefresh: () => Promise<Today>; visible: boolean }) {
  const context = today.priority_context;
  const [appointmentTitle, setAppointmentTitle] = useState('');
  const [appointmentStart, setAppointmentStart] = useState('');
  const [appointmentBusy, setAppointmentBusy] = useState(false);
  const [appointmentPending, setAppointmentPending] = useState<{ title: string; starts_at: string; idempotency_key: string } | null>(null);
  const [appointmentNotice, setAppointmentNotice] = useState<string | null>(null);
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
    try { await api.addAppointment(input); await onRefresh(); setAppointmentTitle(''); setAppointmentStart(''); setAppointmentNotice('Appointment added.'); }
    catch (error) {
      if (error instanceof ApiError && error.code === 'connection_unconfirmed') { setAppointmentPending(input); setAppointmentNotice('Save unconfirmed. Check appointments before trying again.'); }
      else setAppointmentNotice(friendlyError(error));
    } finally { setAppointmentBusy(false); }
  };
  const retryAppointment = async () => {
    if (!appointmentPending || appointmentBusy) return;
    setAppointmentBusy(true);
    try { await api.addAppointment(appointmentPending); await onRefresh(); setAppointmentPending(null); setAppointmentTitle(''); setAppointmentStart(''); setAppointmentNotice('Appointment confirmed.'); }
    catch (error) { setAppointmentNotice(error instanceof ApiError && error.code === 'connection_unconfirmed' ? 'Save remains unconfirmed. The same request was used; check appointments again.' : friendlyError(error)); }
    finally { setAppointmentBusy(false); }
  };
  const suggestions = context?.suggestions?.length ? context.suggestions : [
    { kind: 'tasks', label: 'See today’s tasks', reason: 'Choose what matters first at your pace.' },
    { kind: 'meals', label: 'Look at meal choices', reason: 'Breakfast, lunch and dinner are ready to review.' },
  ];
  return <section className="day-overview" aria-labelledby="day-overview-title" hidden={!visible}><div className="section-heading"><div><p className="eyebrow">Your day at a glance</p><h2 id="day-overview-title">What would help now?</h2></div>{context?.local_time && <span className="review-chip">{context.local_time}</span>}</div>
    <div className="overview-grid">{suggestions.map((suggestion, index) => <div className="overview-card" key={`${suggestion.kind}-${index}`}><h3>{suggestion.label}</h3><p>{suggestion.reason}</p>{(suggestion.kind === 'tasks' || suggestion.kind === 'meals' || suggestion.kind === 'groceries') && <button className="text-button" onClick={() => onView(suggestion.kind as ClientView)}>Open {suggestion.kind}</button>}</div>)}</div>
    <div className="day-task-glance"><h3>Tasks to consider</h3><ul>{today.tasks.map(task => <li key={task.id}><span>{task.title}</span><small>{[task.scheduled_time, task.urgency ? `${task.urgency} urgency` : null].filter(Boolean).join(' · ')}</small></li>)}</ul></div>
    <div className="appointment-list"><h3>Appointments</h3>{today.appointments?.length ? <ul>{today.appointments.map(item => <li key={item.id}>{item.title} · {new Intl.DateTimeFormat('en-CA', { timeZone: today.profile!.time_zone, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(item.starts_at))}</li>)}</ul> : <p>No appointments listed yet.</p>}
      {appointmentNotice && <p className="notice" role="status">{appointmentNotice}</p>}
      {appointmentPending ? <div className="pending-actions"><button className="secondary-button" disabled={appointmentBusy} onClick={() => void refreshAppointments()}>Check appointments</button><button className="secondary-button" disabled={appointmentBusy} onClick={() => void retryAppointment()}>Retry same appointment add</button></div> : <form className="appointment-form" onSubmit={addAppointment}><label>Appointment title<input value={appointmentTitle} onChange={event => setAppointmentTitle(event.target.value)} maxLength={160} required placeholder="For example, clinic visit" /></label><label>Date and time in {today.profile!.time_zone}<input type="datetime-local" value={appointmentStart} onChange={event => setAppointmentStart(event.target.value)} required aria-describedby="appointment-time-help" /></label><p id="appointment-time-help" className="field-help">Use the date and time where you live. If the clocks change at that time, Nancy will ask you to choose another.</p><button className="secondary-button" disabled={appointmentBusy}>Add appointment</button></form>}
    </div>
  </section>;
}

function TasksView({ today }: { today: Today }) {
  const selected = new Set(today.checkin?.accepted?.task_ids ?? today.checkin?.proposal?.task_ids ?? []);
  return <section className="data-view" aria-labelledby="tasks-title"><p className="eyebrow">Your choices</p><h2 id="tasks-title">Tasks</h2><p>These are your available tasks. A plan does not mean a task has been done.</p><ul className="item-list">{today.tasks.map(task => <li key={task.id}><div><h3>{task.title}</h3><p>{[task.scheduled_time, task.time_hint, task.duration_minutes ? `${task.duration_minutes} min` : null, task.category && task.category !== 'task' ? task.category : null].filter(Boolean).join(' · ') || 'Any time today'}</p></div><div className="item-tags">{task.urgency && <span>{task.urgency} urgency</span>}{selected.has(task.id) && <span>{today.checkin?.accepted ? 'In accepted plan' : 'In proposed plan'}</span>}</div></li>)}</ul></section>;
}

function MealsView({ today }: { today: Today }) {
  const planned = today.checkin?.accepted ?? today.checkin?.proposal;
  return <section className="data-view" aria-labelledby="meals-title"><p className="eyebrow">Your choices</p><h2 id="meals-title">Meals</h2><p>These are meal choices. A plan does not mean a meal was eaten.</p><div className="meal-cards">{mealSlots.map(slot => <section key={slot}><h3>{labelForSlot[slot]}</h3>{planned?.meals.find(meal => meal.slot === slot)?.name && <p className="planned-meal">{today.checkin?.accepted ? 'Accepted' : 'Proposed'}: {planned.meals.find(meal => meal.slot === slot)?.name}</p>}<ul>{today.meal_options.filter(option => option.slots.includes(slot)).map(option => <li key={option.id}>{option.name}</li>)}</ul></section>)}</div></section>;
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
  const [choice, setChoice] = useState(() => selectedPlan(today));
  useEffect(() => { setChoice(selectedPlan(today)); }, [today.checkin?.revision, today.checkin?.proposal?.id, today.checkin?.accepted?.id]);
  const canSave = choice.taskIds.length > 0 && mealSlots.every(slot => Boolean(choice.meals[slot]));
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
