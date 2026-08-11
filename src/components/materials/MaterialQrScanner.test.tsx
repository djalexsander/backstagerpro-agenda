import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { QrScannerMock, qrScannerInstances, nextBehavior } = vi.hoisted(() => {
  const instances: InstanceType<typeof QrScannerMock>[] = [];
  const nextBehavior = {
    startImpl: () => Promise.resolve(),
    hasFlashImpl: () => Promise.resolve(false),
  };
  class QrScannerMock {
    video: HTMLVideoElement;
    onDecode: (result: { data: string }) => void;
    options: Record<string, unknown>;
    start = vi.fn(() => nextBehavior.startImpl());
    destroy = vi.fn();
    hasFlash = vi.fn(() => nextBehavior.hasFlashImpl());
    isFlashOn = vi.fn(() => false);
    toggleFlash = vi.fn(() => Promise.resolve());
    constructor(video: HTMLVideoElement, onDecode: (result: { data: string }) => void, options: Record<string, unknown>) {
      this.video = video;
      this.onDecode = onDecode;
      this.options = options;
      instances.push(this);
    }
  }
  return { QrScannerMock, qrScannerInstances: instances, nextBehavior };
});
vi.mock("qr-scanner", () => ({ default: QrScannerMock }));

import { MaterialQrScanner } from "./MaterialQrScanner";

function stubGetUserMedia() {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) },
  });
}

describe("MaterialQrScanner", () => {
  const originalMediaDevices = navigator.mediaDevices;

  beforeEach(() => {
    qrScannerInstances.length = 0;
    nextBehavior.startImpl = () => Promise.resolve();
    nextBehavior.hasFlashImpl = () => Promise.resolve(false);
    stubGetUserMedia();
  });

  afterEach(() => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: originalMediaDevices });
    vi.clearAllMocks();
  });

  it("does not create a scanner or touch the camera when open=false", async () => {
    render(<MaterialQrScanner open={false} onOpenChange={vi.fn()} onDetected={vi.fn()} />);
    // Give any accidental async init a chance to run before asserting nothing happened.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(qrScannerInstances).toHaveLength(0);
  });

  it("starts the camera against the rear-facing camera as soon as open=true", async () => {
    render(<MaterialQrScanner open onOpenChange={vi.fn()} onDetected={vi.fn()} />);

    await waitFor(() => expect(qrScannerInstances).toHaveLength(1));
    const instance = qrScannerInstances[0];
    expect(instance.start).toHaveBeenCalledTimes(1);
    expect(instance.options).toMatchObject({ preferredCamera: "environment" });
  });

  it("delivers a detected code exactly once, then stops and closes", async () => {
    const onDetected = vi.fn();
    const onOpenChange = vi.fn();
    render(<MaterialQrScanner open onOpenChange={onOpenChange} onDetected={onDetected} />);
    await waitFor(() => expect(qrScannerInstances).toHaveLength(1));
    const instance = qrScannerInstances[0];

    act(() => instance.onDecode({ data: "BACKSTAGE-PRO:MATERIAL:abc-123" }));

    expect(onDetected).toHaveBeenCalledTimes(1);
    expect(onDetected).toHaveBeenCalledWith("BACKSTAGE-PRO:MATERIAL:abc-123");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(instance.destroy).toHaveBeenCalled();
  });

  it("ignores every detection after the first, even for the same QR staying in frame", async () => {
    const onDetected = vi.fn();
    render(<MaterialQrScanner open onOpenChange={vi.fn()} onDetected={onDetected} />);
    await waitFor(() => expect(qrScannerInstances).toHaveLength(1));
    const instance = qrScannerInstances[0];

    act(() => {
      instance.onDecode({ data: "BACKSTAGE-PRO:MATERIAL:abc-123" });
      instance.onDecode({ data: "BACKSTAGE-PRO:MATERIAL:abc-123" });
      instance.onDecode({ data: "BACKSTAGE-PRO:MATERIAL:abc-123" });
    });

    expect(onDetected).toHaveBeenCalledTimes(1);
  });

  it("stops the scanner when open flips back to false", async () => {
    const { rerender } = render(<MaterialQrScanner open onOpenChange={vi.fn()} onDetected={vi.fn()} />);
    await waitFor(() => expect(qrScannerInstances).toHaveLength(1));
    const instance = qrScannerInstances[0];

    rerender(<MaterialQrScanner open={false} onOpenChange={vi.fn()} onDetected={vi.fn()} />);

    expect(instance.destroy).toHaveBeenCalled();
  });

  it("stops the scanner on unmount", async () => {
    const { unmount } = render(<MaterialQrScanner open onOpenChange={vi.fn()} onDetected={vi.fn()} />);
    await waitFor(() => expect(qrScannerInstances).toHaveLength(1));
    const instance = qrScannerInstances[0];

    unmount();

    expect(instance.destroy).toHaveBeenCalled();
  });

  it("shows a clear message and no crash when camera permission is denied", async () => {
    nextBehavior.startImpl = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
    render(<MaterialQrScanner open onOpenChange={vi.fn()} onDetected={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/permiss[ãa]o de câmera negada/i);
    const instance = qrScannerInstances[0];
    expect(instance.destroy).toHaveBeenCalled();
  });

  it("shows the flashlight toggle only when the camera reports flash support", async () => {
    nextBehavior.hasFlashImpl = () => Promise.resolve(true);
    render(<MaterialQrScanner open onOpenChange={vi.fn()} onDetected={vi.fn()} />);

    expect(await screen.findByRole("button", { name: /ligar lanterna/i })).toBeInTheDocument();
  });

  it("hides the flashlight toggle when the camera reports no flash support", async () => {
    nextBehavior.hasFlashImpl = () => Promise.resolve(false);
    render(<MaterialQrScanner open onOpenChange={vi.fn()} onDetected={vi.fn()} />);

    await waitFor(() => expect(qrScannerInstances).toHaveLength(1));
    await waitFor(() => expect(qrScannerInstances[0].hasFlash).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /ligar lanterna/i })).not.toBeInTheDocument();
  });

  it("a failure probing flash support does not break scanning", async () => {
    nextBehavior.hasFlashImpl = () => Promise.reject(new Error("not supported"));
    render(<MaterialQrScanner open onOpenChange={vi.fn()} onDetected={vi.fn()} />);

    await waitFor(() => expect(qrScannerInstances).toHaveLength(1));
    await waitFor(() => expect(qrScannerInstances[0].hasFlash).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ligar lanterna/i })).not.toBeInTheDocument();
  });
});
