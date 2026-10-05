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
    fireEvent.change(screen.getByLabelText("Voice"), { target: { value: "local-steady" } });
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
    fireEvent.change(screen.getByLabelText("Voice"), { target: { value: "local-steady" } });
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
