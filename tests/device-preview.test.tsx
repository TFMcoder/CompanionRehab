// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DevicePreview, localEnglishVoices, previewTasks } from "../src/client/DevicePreview";

beforeEach(() => { vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("phone device preview", () => {
  const localVoice = { name: "Kind voice", lang: "en-CA", voiceURI: "local-kind", localService: true } as SpeechSynthesisVoice;
  const otherLocalVoice = { name: "Steady voice", lang: "en-US", voiceURI: "local-steady", localService: true } as SpeechSynthesisVoice;
  const remoteVoice = { name: "Online voice", lang: "en-US", voiceURI: "online", localService: false } as SpeechSynthesisVoice;

  function installSpeech(initialVoices: SpeechSynthesisVoice[] = []) {
    let voices = initialVoices;
    const events = new EventTarget();
    const speak = vi.fn();
    const cancel = vi.fn();
    const synthesis = { getVoices: () => voices, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), speak, cancel };
    class FakeUtterance {
      voice: SpeechSynthesisVoice | null = null;
      lang = "";
      rate = 1;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(readonly text: string) {}
    }
    vi.stubGlobal("speechSynthesis", synthesis);
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    return { speak, cancel, setVoices(next: SpeechSynthesisVoice[]) { voices = next; events.dispatchEvent(new Event("voiceschanged")); } };
  }

  it("offers only installed English voices, including voices that arrive later", () => {
    const speech = installSpeech([]);
    render(<DevicePreview />);
    expect(screen.getByText(/No installed English voices are available/)).toBeInTheDocument();
    act(() => speech.setVoices([remoteVoice, { ...localVoice, lang: "fr-CA" } as SpeechSynthesisVoice, localVoice]));
    expect(screen.getByRole("option", { name: "Kind voice (en-CA)" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Online voice/ })).not.toBeInTheDocument();
    expect(localEnglishVoices([remoteVoice, localVoice])).toEqual([localVoice]);
  });

  it("plays fixed text at the chosen pace and cancels on navigation", () => {
    const speech = installSpeech([localVoice, otherLocalVoice, remoteVoice]);
    render(<DevicePreview />);
    fireEvent.change(screen.getByLabelText("Installed voice"), { target: { value: "local-steady" } });
    fireEvent.change(screen.getByLabelText("Pace"), { target: { value: "0.85" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview selected voice" }));
    const utterance = speech.speak.mock.calls[0]?.[0] as SpeechSynthesisUtterance;
    expect(utterance.text).toBe("Good morning. I'm glad you're here. We can take today one step at a time.");
    expect(utterance.voice).toBe(otherLocalVoice);
    expect(utterance.rate).toBe(0.85);
    expect(screen.getByRole("button", { name: "Stop selected voice" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tasks" }));
    expect(speech.cancel).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Stop selected voice" })).not.toBeInTheDocument();
  });

  it("cancels an installed voice before a microphone check and reports playback failure", () => {
    const speech = installSpeech([localVoice]);
    render(<DevicePreview />);
    fireEvent.click(screen.getByRole("button", { name: "Preview selected voice" }));
    const utterance = speech.speak.mock.calls[0]?.[0] as SpeechSynthesisUtterance;
    act(() => utterance.onerror?.(new Event("error") as SpeechSynthesisErrorEvent));
    expect(screen.getByRole("alert")).toHaveTextContent("could not play");
    fireEvent.click(screen.getByRole("button", { name: "Preview selected voice" }));
    const before = speech.cancel.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Check microphone" }));
    expect(speech.cancel.mock.calls.length).toBeGreaterThan(before);
    expect(screen.getByRole("alert")).toHaveTextContent("does not support the microphone check");
  });

  it("refuses a voice removed from the live local inventory", () => {
    const speech = installSpeech([localVoice, otherLocalVoice]);
    render(<DevicePreview />);
    fireEvent.change(screen.getByLabelText("Installed voice"), { target: { value: "local-steady" } });
    act(() => speech.setVoices([localVoice]));
    fireEvent.click(screen.getByRole("button", { name: "Preview selected voice" }));
    expect(speech.speak).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("no longer available");
  });

  it("shows one sample task list and projects the same meal occurrences into Meals", () => {
    render(<DevicePreview />);
    expect(screen.getByText("Device preview · sample data")).toBeInTheDocument();
    expect(screen.getByText(/No plan has been saved/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tasks" }));
    expect(screen.getByRole("heading", { name: "Tasks today" })).toBeInTheDocument();
    const taskIds = [...document.querySelectorAll(".dp-task")].map(node => node.getAttribute("data-occurrence-id"));
    expect(taskIds).toEqual(previewTasks.map(task => task.id));
    expect(screen.getAllByText("Scheduled", { exact: false })).toHaveLength(previewTasks.length);
    fireEvent.click(screen.getByRole("button", { name: "Meals" }));
    const mealIds = [...document.querySelectorAll(".dp-task")].map(node => node.getAttribute("data-occurrence-id"));
    expect(mealIds).toEqual(previewTasks.filter(task => task.kind === "meal").map(task => task.id));
    expect(screen.getByText("These meals are the same scheduled items shown in Tasks.")).toBeInTheDocument();
    expect(screen.queryByText("Take a short walk")).not.toBeInTheDocument();
  });

  it("tells the truth when sample voice cannot play", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new Error("audio unavailable"));
    render(<DevicePreview />);
    fireEvent.click(screen.getByRole("button", { name: "Hear Nancy’s sample voice" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("could not play"));
    expect(play).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(/not a live conversation/)).toHaveLength(2);
  });

  it("plays the exact Kokoro voice and utterance selected, with the script visible", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const { container } = render(<DevicePreview />);
    const kokoroAudio = container.querySelector<HTMLAudioElement>('audio[src^="/preview/kokoro/"]')!;
    expect(kokoroAudio).toHaveAttribute("preload", "none");
    expect(kokoroAudio).toHaveAttribute("src", "/preview/kokoro/af_heart/morning.wav");
    fireEvent.change(screen.getByLabelText("Kokoro voice"), { target: { value: "bf_emma" } });
    fireEvent.change(screen.getByLabelText("Kokoro sample"), { target: { value: "meals" } });
    expect(screen.getByText(/Emma says:/).closest(".dp-sample-script")).toHaveTextContent("We could make an omelette");
    const selectedAudio = container.querySelector<HTMLAudioElement>('audio[src^="/preview/kokoro/"]')!;
    expect(selectedAudio).toHaveAttribute("src", "/preview/kokoro/bf_emma/meals.wav");
    fireEvent.click(screen.getByRole("button", { name: "Play Kokoro sample" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop Kokoro sample" })).toBeInTheDocument());
    expect(play).toHaveBeenCalledTimes(1);
    fireEvent.ended(selectedAudio);
    expect(screen.getByRole("button", { name: "Play Kokoro sample" })).toBeInTheDocument();
  });

  it("stops pending Kokoro playback on selection and ignores its late completion", async () => {
    let resolvePlay!: () => void;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => new Promise<void>(resolve => { resolvePlay = resolve; }));
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    render(<DevicePreview />);
    fireEvent.click(screen.getByRole("button", { name: "Play Kokoro sample" }));
    expect(screen.getByRole("button", { name: "Stop Kokoro sample" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Kokoro sample"), { target: { value: "carryover" } });
    expect(screen.getByRole("button", { name: "Play Kokoro sample" })).toBeInTheDocument();
    await act(async () => resolvePlay());
    expect(screen.getByRole("button", { name: "Play Kokoro sample" })).toBeInTheDocument();
    expect(pause).toHaveBeenCalled();
  });

  it("does not stop a newer Kokoro clip when an older play promise resolves", async () => {
    const resolves: Array<() => void> = [];
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => new Promise<void>(resolve => { resolves.push(resolve); }));
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const { container } = render(<DevicePreview />);
    const firstAudio = container.querySelector<HTMLAudioElement>('audio[src^="/preview/kokoro/"]')!;
    fireEvent.click(screen.getByRole("button", { name: "Play Kokoro sample" }));
    fireEvent.change(screen.getByLabelText("Kokoro voice"), { target: { value: "af_bella" } });
    const secondAudio = container.querySelector<HTMLAudioElement>('audio[src^="/preview/kokoro/"]')!;
    fireEvent.click(screen.getByRole("button", { name: "Play Kokoro sample" }));
    await act(async () => resolves[0]());
    expect(screen.getByRole("button", { name: "Stop Kokoro sample" })).toBeInTheDocument();
    expect(pause.mock.instances).toContain(firstAudio);
    expect(pause.mock.instances).not.toContain(secondAudio);
    await act(async () => resolves[1]());
    expect(screen.getByRole("button", { name: "Stop Kokoro sample" })).toBeInTheDocument();
  });

  it("pauses a late same-clip play completion after Stop", async () => {
    let resolvePlay!: () => void;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => new Promise<void>(resolve => { resolvePlay = resolve; }));
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    render(<DevicePreview />);
    fireEvent.click(screen.getByRole("button", { name: "Play Kokoro sample" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop Kokoro sample" }));
    const afterStop = pause.mock.calls.length;
    await act(async () => resolvePlay());
    expect(pause.mock.calls.length).toBeGreaterThan(afterStop);
    expect(screen.getByRole("button", { name: "Play Kokoro sample" })).toBeInTheDocument();
  });

  it("reports missing Kokoro audio and cancels playback when microphone checking begins", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValueOnce(new Error("missing")).mockResolvedValue();
    render(<DevicePreview />);
    fireEvent.click(screen.getByRole("button", { name: "Play Kokoro sample" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("could not play"));
    fireEvent.click(screen.getByRole("button", { name: "Play Kokoro sample" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop Kokoro sample" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Check microphone" }));
    expect(screen.getByRole("button", { name: "Play Kokoro sample" })).toBeInTheDocument();
    expect(play).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Nothing is uploaded or saved/)).toBeInTheDocument();
  });

  it("stops Kokoro on navigation, page hide and unmount", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const rendered = render(<DevicePreview />);
    fireEvent.click(screen.getByRole("button", { name: "Play Kokoro sample" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop Kokoro sample" })).toBeInTheDocument());
    const beforeNavigate = pause.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Tasks" }));
    expect(pause.mock.calls.length).toBeGreaterThan(beforeNavigate);
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    fireEvent.click(screen.getByRole("button", { name: "Play Kokoro sample" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop Kokoro sample" })).toBeInTheDocument());
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    expect(screen.getByRole("button", { name: "Play Kokoro sample" })).toBeInTheDocument();
    visibility.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Play Kokoro sample" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop Kokoro sample" })).toBeInTheDocument());
    const beforeUnmount = pause.mock.calls.length;
    rendered.unmount();
    expect(pause.mock.calls.length).toBeGreaterThan(beforeUnmount);
  });

  it("reports unsupported microphone access without requesting or saving anything", () => {
    render(<DevicePreview />);
    fireEvent.click(screen.getByRole("button", { name: "Check microphone" }));
    expect(screen.getByRole("alert")).toHaveTextContent("does not support the microphone check");
    expect(screen.getByText(/Nothing is uploaded or saved/)).toBeInTheDocument();
  });

  it("stops microphone tracks when leaving Home", async () => {
    const stopTrack = vi.fn();
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] });
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    const recorderStop = vi.fn();
    class FakeRecorder {
      state = "recording";
      mimeType = "audio/webm";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() { this.state = "recording"; }
      stop() { this.state = "inactive"; recorderStop(); this.onstop?.(); }
    }
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    render(<DevicePreview />);
    fireEvent.click(screen.getByRole("button", { name: "Check microphone" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop recording" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Tasks" }));
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(recorderStop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Tasks today" })).toBeInTheDocument();
  });

  it("drops a pending microphone permission when the phone page is hidden", async () => {
    let resolvePermission!: (stream: MediaStream) => void;
    const permission = new Promise<MediaStream>(resolve => { resolvePermission = resolve; });
    const getUserMedia = vi.fn().mockReturnValue(permission);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    vi.stubGlobal("MediaRecorder", class {});
    const stopTrack = vi.fn();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    render(<DevicePreview />);
    fireEvent.click(screen.getByRole("button", { name: "Check microphone" }));
    expect(screen.getByRole("button", { name: "Waiting for permission…" })).toBeDisabled();
    fireEvent(document, new Event("visibilitychange"));
    expect(screen.getByRole("alert")).toHaveTextContent("stopped when this page was left");
    resolvePermission({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream);
    await waitFor(() => expect(stopTrack).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Check microphone" })).toBeEnabled();
    visibility.mockRestore();
  });
});
