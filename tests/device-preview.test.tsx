// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DevicePreview, previewTasks } from "../src/client/DevicePreview";

beforeEach(() => { vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("phone device preview", () => {
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
    expect(screen.getByText(/not a live conversation/)).toBeInTheDocument();
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
