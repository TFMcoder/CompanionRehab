import { useEffect, useRef, useState } from "react";
import "./device-preview.css";

type View = "home" | "tasks" | "meals";
type Urgency = "High" | "Medium" | "Low";
type SampleTask = {
  id: string;
  what: string;
  urgency: Urgency;
  time: string;
  kind: "task" | "meal";
  detail?: string;
};

const voiceSampleText = "Good morning. I'm glad you're here. We can take today one step at a time.";

export function localEnglishVoices(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return voices.filter(voice => voice.localService === true && /^en(?:-|$)/i.test(voice.lang));
}

// A meal has one occurrence identity. Both views project this same list.
export const previewTasks: readonly SampleTask[] = [
  { id: "sample-breakfast", what: "Breakfast", urgency: "Medium", time: "8:30 AM", kind: "meal", detail: "Oatmeal and fruit" },
  { id: "sample-walk", what: "Take a short walk", urgency: "Medium", time: "11:00 AM", kind: "task" },
  { id: "sample-lunch", what: "Lunch", urgency: "Medium", time: "12:30 PM", kind: "meal", detail: "Soup and a sandwich" },
  { id: "sample-call", what: "Call a friend", urgency: "Low", time: "3:00 PM", kind: "task" },
  { id: "sample-dinner", what: "Dinner", urgency: "Medium", time: "6:00 PM", kind: "meal", detail: "Pasta and vegetables" },
];

function localDate() {
  return new Intl.DateTimeFormat("en-CA", { weekday: "long", month: "long", day: "numeric" }).format(new Date());
}

function TaskCard({ task, date }: { task: SampleTask; date: string }) {
  return <li className="dp-task" data-occurrence-id={task.id}>
    <div className="dp-task-time"><span className="dp-time-dot" aria-hidden="true" />{task.time}</div>
    <div className="dp-task-body">
      <div><h3>{task.what}</h3>{task.detail && <p>{task.detail}</p>}</div>
      <span className={`dp-urgency dp-urgency-${task.urgency.toLowerCase()}`}>{task.urgency} urgency</span>
    </div>
    <p className="dp-task-date">Scheduled {date} at {task.time}</p>
  </li>;
}

export function DevicePreview() {
  const [view, setView] = useState<View>("home");
  const [sampleMessage, setSampleMessage] = useState("");
  const [samplePlaying, setSamplePlaying] = useState(false);
  const [localVoices, setLocalVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState("");
  const [voiceRate, setVoiceRate] = useState(1);
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState("");
  const [micState, setMicState] = useState<"idle" | "requesting" | "recording" | "ready">("idle");
  const [micMessage, setMicMessage] = useState("");
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const sampleAudio = useRef<HTMLAudioElement>(null);
  const recordingAudio = useRef<HTMLAudioElement>(null);
  const recording = useRef<{ recorder: MediaRecorder; stream: MediaStream; chunks: Blob[] } | null>(null);
  const recordingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingUrlRef = useRef<string | null>(null);
  const micEpoch = useRef(0);
  const micRequested = useRef(false);
  const sampleEpoch = useRef(0);
  const voiceEpoch = useRef(0);
  const voiceUtterance = useRef<SpeechSynthesisUtterance | null>(null);
  const mounted = useRef(true);
  const date = localDate();

  const clearRecordingUrl = () => {
    recordingAudio.current?.pause();
    if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current);
    recordingUrlRef.current = null;
    setRecordingUrl(null);
  };

  const stopMicrophone = (keepPlayback: boolean) => {
    micRequested.current = false;
    if (recordingTimer.current) clearTimeout(recordingTimer.current);
    recordingTimer.current = null;
    const current = recording.current;
    if (!keepPlayback) micEpoch.current += 1;
    if (!current) {
      if (!keepPlayback && mounted.current) setMicState("idle");
      return;
    }
    recording.current = null;
    if (!keepPlayback) current.recorder.onstop = null;
    if (current.recorder.state !== "inactive") current.recorder.stop();
    current.stream.getTracks().forEach(track => track.stop());
    if (!keepPlayback && mounted.current) setMicState("idle");
  };

  const stopAudio = () => {
    sampleAudio.current?.pause();
    if (sampleAudio.current) sampleAudio.current.currentTime = 0;
    setSamplePlaying(false);
    clearRecordingUrl();
  };

  const stopVoice = () => {
    voiceEpoch.current += 1;
    voiceUtterance.current = null;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    if (mounted.current) setVoicePlaying(false);
  };

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const synthesis = window.speechSynthesis;
    const refresh = () => {
      try {
        setLocalVoices(localEnglishVoices(synthesis.getVoices()));
      } catch {
        setLocalVoices([]);
        setVoiceMessage("This browser could not load its installed voices.");
      }
    };
    refresh();
    synthesis.addEventListener("voiceschanged", refresh);
    return () => synthesis.removeEventListener("voiceschanged", refresh);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const suspend = () => {
      const wasChecking = micRequested.current;
      stopMicrophone(false);
      sampleEpoch.current += 1;
      stopAudio();
      stopVoice();
      if (wasChecking) setMicMessage("Microphone check stopped when this page was left. Tap to try again.");
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") suspend(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", suspend);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", suspend);
      mounted.current = false;
      micEpoch.current += 1;
      sampleEpoch.current += 1;
      if (recordingTimer.current) clearTimeout(recordingTimer.current);
      const current = recording.current;
      recording.current = null;
      if (current) {
        current.recorder.onstop = null;
        if (current.recorder.state !== "inactive") current.recorder.stop();
        current.stream.getTracks().forEach(track => track.stop());
      }
      sampleAudio.current?.pause();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      recordingAudio.current?.pause();
      if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current);
    };
  }, []);

  const navigate = (destination: View) => {
    if (destination === view) return;
    stopMicrophone(false);
    sampleEpoch.current += 1;
    stopAudio();
    stopVoice();
    setMicMessage("");
    setSampleMessage("");
    setView(destination);
    document.documentElement.scrollTop = 0;
  };

  const hearNancy = async () => {
    const audio = sampleAudio.current;
    if (!audio) return;
    const epoch = ++sampleEpoch.current;
    setSampleMessage("");
    stopVoice();
    stopMicrophone(false);
    if (samplePlaying) {
      audio.pause();
      audio.currentTime = 0;
      setSamplePlaying(false);
      return;
    }
    try {
      audio.currentTime = 0;
      await audio.play();
      if (mounted.current && epoch === sampleEpoch.current) setSamplePlaying(true);
    } catch {
      if (!mounted.current || epoch !== sampleEpoch.current) return;
      setSamplePlaying(false);
      setSampleMessage("Nancy’s sample voice could not play on this device. Check the sound and try again.");
    }
  };

  const playLocalVoice = () => {
    if (voicePlaying) {
      stopVoice();
      return;
    }
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      setVoiceMessage("This browser cannot play installed voices.");
      return;
    }
    let currentVoices: SpeechSynthesisVoice[];
    try {
      currentVoices = localEnglishVoices(window.speechSynthesis.getVoices());
      setLocalVoices(currentVoices);
    } catch {
      setVoiceMessage("This browser could not confirm its installed voices. Try again later.");
      return;
    }
    const voice = selectedVoice
      ? currentVoices.find(candidate => candidate.voiceURI === selectedVoice)
      : currentVoices[0];
    if (!voice) {
      setVoiceMessage("The selected installed voice is no longer available. Choose another voice and try again.");
      return;
    }
    sampleEpoch.current += 1;
    stopAudio();
    stopMicrophone(false);
    stopVoice();
    setVoiceMessage("");
    const epoch = voiceEpoch.current;
    try {
      const utterance = new SpeechSynthesisUtterance(voiceSampleText);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = voiceRate;
      utterance.onend = () => {
        if (!mounted.current || epoch !== voiceEpoch.current) return;
        voiceUtterance.current = null;
        setVoicePlaying(false);
      };
      utterance.onerror = () => {
        if (!mounted.current || epoch !== voiceEpoch.current) return;
        voiceUtterance.current = null;
        setVoicePlaying(false);
        setVoiceMessage("This installed voice could not play. Try another voice or the fixed sample.");
      };
      voiceUtterance.current = utterance;
      window.speechSynthesis.speak(utterance);
      setVoicePlaying(true);
    } catch {
      stopVoice();
      setVoiceMessage("This installed voice could not start. Try another voice or the fixed sample.");
    }
  };

  const finishMicrophone = () => {
    if (recording.current) {
      stopMicrophone(true);
      setMicMessage("Microphone check complete. Play your recording below; it stays on this device.");
    }
  };

  const startMicrophone = async () => {
    stopVoice();
    sampleEpoch.current += 1;
    stopAudio();
    setMicMessage("");
    if (window.isSecureContext === false) {
      setMicMessage("Microphone access needs a secure HTTPS page on this device.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMicMessage("This browser does not support the microphone check. Try an up-to-date browser.");
      return;
    }
    const epoch = ++micEpoch.current;
    micRequested.current = true;
    setMicState("requesting");
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || epoch !== micEpoch.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      const recorder = new MediaRecorder(stream);
      const current = { recorder, stream, chunks: [] as Blob[] };
      recording.current = current;
      recorder.ondataavailable = event => { if (event.data.size > 0) current.chunks.push(event.data); };
      recorder.onstop = () => {
        micRequested.current = false;
        if (recordingTimer.current) clearTimeout(recordingTimer.current);
        recordingTimer.current = null;
        stream?.getTracks().forEach(track => track.stop());
        if (recording.current === current) recording.current = null;
        if (!mounted.current || epoch !== micEpoch.current) return;
        if (!current.chunks.length) {
          setMicState("idle");
          setMicMessage("No audio was captured. Check microphone permission and try again.");
          return;
        }
        const url = URL.createObjectURL(new Blob(current.chunks, { type: recorder.mimeType || "audio/webm" }));
        recordingUrlRef.current = url;
        setRecordingUrl(url);
        setMicState("ready");
      };
      recorder.onerror = () => {
        if (epoch !== micEpoch.current || !mounted.current) return;
        stopMicrophone(false);
        setMicMessage("The microphone stopped unexpectedly. Check the device and try again.");
      };
      recorder.start();
      setMicState("recording");
      recordingTimer.current = setTimeout(finishMicrophone, 10_000);
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      if (epoch !== micEpoch.current || !mounted.current) return;
      stopMicrophone(false);
      setMicMessage(error instanceof DOMException && error.name === "NotAllowedError"
        ? "Microphone permission was denied. Allow it in your browser settings, then try again."
        : "The microphone could not start. Check that it is connected and try again.");
    }
  };

  const visibleTasks = view === "meals" ? previewTasks.filter(task => task.kind === "meal") : previewTasks;
  const activeVoice = localVoices.find(voice => voice.voiceURI === selectedVoice) ?? localVoices[0];
  return <main className="dp-page">
    <div className="dp-shell">
      <header className="dp-header">
        <div className="dp-mark" aria-hidden="true">N</div>
        <div><p className="dp-brand">Nancy</p><p className="dp-brand-sub">My Day</p></div>
        <span className="dp-preview-tag">Device preview · sample data</span>
      </header>

      <nav className="dp-nav" aria-label="My Day">
        <button type="button" aria-current={view === "home" ? "page" : undefined} onClick={() => navigate("home")}>Home</button>
        <button type="button" aria-current={view === "tasks" ? "page" : undefined} onClick={() => navigate("tasks")}>Tasks</button>
        <button type="button" aria-current={view === "meals" ? "page" : undefined} onClick={() => navigate("meals")}>Meals</button>
      </nav>

      <div className="dp-content">
        <p className="dp-date">{date}</p>
        {view === "home" ? <>
          <section className="dp-hero" aria-labelledby="dp-home-title">
            <span className="dp-sun" aria-hidden="true">✳</span>
            <p className="dp-eyebrow">A gentler way into the day</p>
            <h1 id="dp-home-title">Good morning.</h1>
            <p>Start with a short conversation, then see what is coming up today.</p>
            <button type="button" className="dp-primary" onClick={() => void hearNancy()}>{samplePlaying ? "Stop sample voice" : "Hear Nancy’s sample voice"}</button>
            <audio ref={sampleAudio} preload="none" src="/preview/voice-sample.wav" onEnded={() => setSamplePlaying(false)} onError={() => { setSamplePlaying(false); setSampleMessage("Nancy’s sample voice is unavailable right now. Please try again later."); }} />
            {sampleMessage && <p className="dp-inline-error" role="alert">{sampleMessage}</p>}
            <p className="dp-hint">Fixed Windows Zira sample. It is not a live conversation.</p>
          </section>

          <section className="dp-voice-card" aria-labelledby="dp-voice-title">
            <div className="dp-section-top"><span className="dp-icon" aria-hidden="true">♫</span><div><p className="dp-eyebrow">Listen and choose</p><h2 id="dp-voice-title">Voice for this preview</h2></div></div>
            <p>Try English voices this browser reports as installed on your device. The same short sentence plays each time. Your choice applies only to this preview.</p>
            {localVoices.length > 0 ? <>
              <div className="dp-voice-controls">
                <label>Voice<select value={selectedVoice || activeVoice?.voiceURI || ""} onChange={event => { stopVoice(); setSelectedVoice(event.target.value); setVoiceMessage(""); }}>
                  {selectedVoice && !localVoices.some(voice => voice.voiceURI === selectedVoice) && <option value={selectedVoice}>Previously selected voice is unavailable</option>}
                  {localVoices.map(voice => <option key={`${voice.voiceURI}-${voice.name}`} value={voice.voiceURI}>{voice.name} ({voice.lang})</option>)}
                </select></label>
                <label>Pace<select value={voiceRate} onChange={event => { stopVoice(); setVoiceRate(Number(event.target.value)); }}>
                  <option value={0.85}>Relaxed</option><option value={1}>Regular</option><option value={1.15}>Brisk</option>
                </select></label>
              </div>
              <button type="button" className="dp-secondary" onClick={playLocalVoice}>{voicePlaying ? "Stop selected voice" : "Preview selected voice"}</button>
            </> : <p className="dp-inline-info" role="status">No installed English voices are available from this browser yet. You can still play the fixed sample above.</p>}
            {voiceMessage && <p className="dp-inline-error" role="alert">{voiceMessage}</p>}
            <p className="dp-hint">This is a fixed sample, not a live conversation or a saved Nancy voice preference.</p>
          </section>

          <section className="dp-mic-card" aria-labelledby="dp-mic-title">
            <div className="dp-section-top"><span className="dp-icon" aria-hidden="true">●</span><div><p className="dp-eyebrow">Try your device</p><h2 id="dp-mic-title">Microphone check</h2></div></div>
            <p>Tap to record up to 10 seconds, then listen to yourself. Nothing is uploaded or saved.</p>
            <div className="dp-mic-actions">
              {micState === "recording" ? <button type="button" className="dp-secondary" onClick={finishMicrophone}>Stop recording</button> : <button type="button" className="dp-secondary" disabled={micState === "requesting"} onClick={() => void startMicrophone()}>{micState === "requesting" ? "Waiting for permission…" : micState === "ready" ? "Record again" : "Check microphone"}</button>}
              {micState === "recording" && <span className="dp-recording"><span aria-hidden="true" />Recording… 10 sec max</span>}
            </div>
            {micMessage && <p className={micState === "ready" ? "dp-inline-info" : "dp-inline-error"} role={micState === "ready" ? "status" : "alert"}>{micMessage}</p>}
            {recordingUrl && <audio ref={recordingAudio} controls src={recordingUrl} aria-label="Play your microphone check recording" onPlay={() => { stopVoice(); sampleEpoch.current += 1; sampleAudio.current?.pause(); setSamplePlaying(false); }} />}
          </section>

          <section className="dp-overview" aria-labelledby="dp-overview-title">
            <div className="dp-section-heading"><div><p className="dp-eyebrow">At a glance</p><h2 id="dp-overview-title">Today’s sample day</h2></div></div>
            <div className="dp-overview-grid">
              <button type="button" onClick={() => navigate("tasks")}><span className="dp-overview-number">{previewTasks.length}</span><span>Tasks today</span><span aria-hidden="true">→</span></button>
              <button type="button" onClick={() => navigate("meals")}><span className="dp-overview-number">{previewTasks.filter(task => task.kind === "meal").length}</span><span>Meals today</span><span aria-hidden="true">→</span></button>
            </div>
          </section>
        </> : <section className="dp-list-section" aria-labelledby="dp-list-title">
          <p className="dp-eyebrow">Sample schedule</p>
          <h1 id="dp-list-title">{view === "tasks" ? "Tasks today" : "Meals today"}</h1>
          <p className="dp-list-intro">{view === "tasks" ? "Meals and other tasks appear together in the day’s schedule." : "These meals are the same scheduled items shown in Tasks."}</p>
          <ul className="dp-task-list">{visibleTasks.map(task => <TaskCard key={task.id} task={task} date={date} />)}</ul>
        </section>}

        <aside className="dp-notice" aria-label="Preview limitations"><strong>Preview only.</strong> These are sample items. No plan has been saved, and Nancy’s live conversation is not connected yet.</aside>
      </div>
      <footer className="dp-footer">Nancy · My Day preview</footer>
    </div>
  </main>;
}
