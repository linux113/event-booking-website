"use client";

import type { Route } from "next";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { ScanVerdict } from "@/components/admin/scan-verdict";
import { CameraIcon, QrCodeIcon } from "@/components/icons";
import { Button, ButtonElement } from "@/components/ui/button";
import { isPassToken, readTokenFromFrame, tokenFromQrText } from "@/lib/pass/decode";
import type { PassScanResult, ScanApiResponse } from "@/types/admin";

/**
 * The gate scanner.
 *
 * The camera is the only part of this app that has to be a client component, and it
 * is kept on a short leash:
 *
 *   * it reads a QR code and turns it into a token — that is all it does locally;
 *   * it posts that token to `/api/staff/scan` and shows whatever comes back;
 *   * it never decides that a pass is good, never writes anything itself, and never
 *     sends a date, a pass id or a name.
 *
 * Every verdict on the screen came from the database. If this component were
 * replaced with a hostile page, the worst it could do is ask the server a question.
 *
 * Practical details that matter at a door: the rear camera is preferred, decoding is
 * throttled to ~7 frames a second (enough to catch a held-up code without cooking the
 * phone), only codes that are *our* verification URLs are accepted, and manual entry
 * exists for a cracked lens or a desktop webcam.
 */

type Phase = "idle" | "starting" | "scanning" | "checking" | "verdict" | "error";

/** How often a frame is decoded. The camera itself runs at its own rate. */
const FRAME_INTERVAL_MS = 140;
/** Frames are downscaled before decoding: smaller input, same code, less battery. */
const MAX_FRAME_WIDTH = 720;
/** Remembered so a staff member types their gate once per device. */
const GATE_STORAGE_KEY = "dandiya.gate-label";

function cameraMessage(error: unknown): string {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "Browsers only hand a camera to a secure page. Open this page over https:// — or enter the pass code by hand below.";
  }

  switch (error instanceof Error ? error.name : "") {
    case "NotAllowedError":
    case "SecurityError":
      return "The browser is blocking the camera. Allow camera access for this site in the browser settings and try again — until then, enter the pass code by hand below.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera was found on this device. Enter the pass code by hand below.";
    case "NotReadableError":
      return "The camera is already in use by another app. Close it and try again.";
    default:
      return "The camera could not be started. Enter the pass code by hand below, or reload the page.";
  }
}

type ScannerPanelProps = {
  /** The night the server considers the gate to be on, already formatted for display. */
  gateNightLabel: string;
};

export function ScannerPanel({ gateNightLabel }: ScannerPanelProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastDecodeRef = useRef(0);
  const gateInputRef = useRef<HTMLInputElement | null>(null);

  /**
   * The token currently on screen. It lives in a ref rather than in state on
   * purpose: it is a credential, and it has no business being rendered.
   */
  const tokenRef = useRef<string | null>(null);
  /** The latest `submit`, so the animation loop can call it without a dependency cycle. */
  const submitRef = useRef<(token: string) => void>(() => {});
  /** The animation loop itself, for the same reason: a frame cannot reference its own callback. */
  const tickRef = useRef<() => void>(() => {});

  const [phase, setPhase] = useState<Phase>("idle");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [result, setResult] = useState<PassScanResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [manual, setManual] = useState("");

  const stopFrames = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const stopCamera = useCallback(() => {
    stopFrames();

    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }

    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [stopFrames]);

  /** Decodes one frame, then schedules the next. */
  const tick = useCallback(() => {
    frameRef.current = requestAnimationFrame(() => tickRef.current());

    const video = videoRef.current;

    if (!video || video.readyState < 2 || video.videoWidth === 0) {
      return;
    }

    const now = performance.now();

    if (now - lastDecodeRef.current < FRAME_INTERVAL_MS) {
      return;
    }

    lastDecodeRef.current = now;

    const scale = Math.min(1, MAX_FRAME_WIDTH / video.videoWidth);
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = canvasRef.current ?? document.createElement("canvas");

    canvasRef.current = canvas;
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d", { willReadFrequently: true });

    if (!context) {
      return;
    }

    context.drawImage(video, 0, 0, width, height);

    const token = readTokenFromFrame(context.getImageData(0, 0, width, height));

    if (token) {
      // Found one: stop decoding until this pass has been dealt with, so the verdict
      // on screen cannot be replaced by the next frame.
      stopFrames();
      submitRef.current(token);
    }
  }, [stopFrames]);

  const startFrames = useCallback(() => {
    stopFrames();
    lastDecodeRef.current = 0;
    frameRef.current = requestAnimationFrame(() => tickRef.current());
  }, [stopFrames]);

  /** Ask the server what this token means. Read-only: nothing is admitted here. */
  const submit = useCallback(
    async (token: string) => {
      setPhase("checking");
      setMessage(null);
      setUnauthorized(false);
      setResult(null);
      tokenRef.current = token;

      try {
        const response = await fetch("/api/staff/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const payload = (await response.json()) as ScanApiResponse;

        if (!payload.ok) {
          tokenRef.current = null;
          setMessage(payload.error.message);
          setUnauthorized(payload.error.kind === "not-authorized");
          setPhase("error");

          return;
        }

        setResult(payload.result);
        setPhase("verdict");
      } catch {
        tokenRef.current = null;
        setMessage("The scanner could not reach the server. Check the connection and scan the pass again.");
        setPhase("error");
      }
    },
    [],
  );

  // Both refs are refreshed after render, so the loop always calls the current
  // closures without either of them having to depend on the other.
  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);

  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    setMessage(null);
    setUnauthorized(false);
    setResult(null);
    tokenRef.current = null;
    setPhase("starting");

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("unsupported");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        // The back camera is the one pointed at the guest's phone.
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });

      stopCamera();
      streamRef.current = stream;

      const video = videoRef.current;

      if (video) {
        video.srcObject = stream;
        await video.play();
      }

      setPhase("scanning");
      startFrames();
    } catch (error) {
      stopCamera();
      setPhase("idle");
      setCameraError(cameraMessage(error));
    }
  }, [startFrames, stopCamera]);

  const stopScan = useCallback(() => {
    stopCamera();
    setPhase("idle");
  }, [stopCamera]);

  /** Back to reading codes: the camera keeps running if it already was. */
  const resumeScanning = useCallback(() => {
    setResult(null);
    setMessage(null);
    setUnauthorized(false);
    setManual("");
    tokenRef.current = null;

    if (streamRef.current) {
      setPhase("scanning");
      startFrames();
    } else {
      setPhase("idle");
    }
  }, [startFrames]);

  /** The one action that changes anything: ask the database to admit this guest. */
  const handleCheckIn = useCallback(async () => {
    const token = tokenRef.current;

    if (!token) {
      setMessage("That pass is no longer on screen. Scan it again.");
      setPhase("error");

      return;
    }

    setPhase("checking");
    setMessage(null);

    try {
      const response = await fetch("/api/staff/check-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, gate: gateInputRef.current?.value.trim() || null }),
      });
      const payload = (await response.json()) as ScanApiResponse;

      if (!payload.ok) {
        setMessage(payload.error.message);
        setUnauthorized(payload.error.kind === "not-authorized");
        setPhase("error");

        return;
      }

      // Spent either way: the database has decided, and this token will never be
      // sent again from this screen.
      tokenRef.current = null;
      setResult(payload.result);
      setPhase("verdict");
    } catch {
      setMessage(
        "The scanner could not reach the server, so this entry may not have been recorded. Scan the pass again — a recorded entry will come back as PASS ALREADY USED.",
      );
      setPhase("error");
    }
  }, []);

  /** A code typed or pasted in: same path as a scanned one. */
  const handleManualSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const value = manual.trim();
      const token = tokenFromQrText(value) ?? (isPassToken(value) ? value : null);

      if (!token) {
        setResult(null);
        setUnauthorized(false);
        setMessage(
          "That does not look like a pass code. Paste the whole link from the guest's pass, or scan its QR code.",
        );
        setPhase("error");

        return;
      }

      stopFrames();
      void submitRef.current(token);
    },
    [manual, stopFrames],
  );

  // Release the camera when the page goes away: a phone left on this screen must not
  // keep recording.
  useEffect(() => stopCamera, [stopCamera]);

  const overlayText: Record<Phase, string | null> = {
    idle: "Camera off",
    starting: "Starting the camera…",
    scanning: "Hold the pass inside the frame",
    checking: "Checking the pass…",
    verdict: null,
    error: "The gate could not answer",
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted text-sm">
        Gate night: <span className="text-foreground font-semibold">{gateNightLabel}</span>
      </p>

      <div className="border-border bg-background/70 relative aspect-4/5 w-full overflow-hidden rounded-2xl border sm:aspect-video">
        <video
          ref={videoRef}
          className={`size-full object-cover ${phase === "scanning" ? "" : "opacity-30"}`}
          playsInline
          muted
          autoPlay
          aria-label="Camera preview"
        />

        {phase === "scanning" ? (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="border-marigold/70 size-56 max-w-[70%] rounded-2xl border-2 shadow-[0_0_0_9999px_rgba(11,10,36,0.45)] sm:size-64" />
          </div>
        ) : null}

        {overlayText[phase] ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            {phase === "idle" || phase === "starting" ? (
              <CameraIcon className="text-muted size-8" aria-hidden="true" />
            ) : (
              <QrCodeIcon className="text-muted size-8" aria-hidden="true" />
            )}
            <p className="text-foreground text-sm font-semibold">{overlayText[phase]}</p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {phase === "scanning" ? (
          <ButtonElement variant="secondary" size="sm" onClick={stopScan}>
            Stop camera
          </ButtonElement>
        ) : (
          <ButtonElement
            size="sm"
            onClick={() => void startCamera()}
            disabled={phase === "starting" || phase === "checking"}
          >
            <CameraIcon className="size-4" aria-hidden="true" />
            {phase === "idle" ? "Start camera" : "Use the camera again"}
          </ButtonElement>
        )}

        {phase === "error" ? (
          <ButtonElement variant="secondary" size="sm" onClick={resumeScanning}>
            Scan next pass
          </ButtonElement>
        ) : null}
      </div>

      {cameraError ? (
        <p role="alert" className="border-marigold/40 bg-marigold/10 text-marigold-soft rounded-xl border px-3.5 py-3 text-sm/6">
          {cameraError}
        </p>
      ) : null}

      {message ? (
        <div role="alert" className="border-rani/40 bg-rani/10 flex flex-col items-start gap-3 rounded-2xl border p-4">
          <p className="text-rani-soft text-xs font-semibold tracking-widest uppercase">The gate could not answer</p>
          <p className="text-foreground text-sm/6">{message}</p>
          {unauthorized ? (
            <Button href={"/admin/login?next=/admin/scanner" as Route} size="sm" variant="secondary">
              Sign in again
            </Button>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <ScanVerdict
          result={result}
          busy={phase === "checking"}
          onCheckIn={() => void handleCheckIn()}
          onNext={resumeScanning}
        />
      ) : null}

      <form onSubmit={handleManualSubmit} className="border-border flex flex-col gap-3 rounded-2xl border p-4">
        <label htmlFor="manual-code" className="text-xs font-semibold tracking-widest uppercase">
          Enter a code by hand
        </label>
        <p className="text-muted text-xs/5">
          For a cracked screen, a dead camera or a desktop browser without one. Paste the link from the guest&apos;s
          pass, or the 64-character code from their QR.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="manual-code"
            name="manual-code"
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://…/verify/…"
            className="border-border bg-background/60 placeholder:text-muted/50 focus:border-marigold/60 focus:ring-marigold/20 h-11 w-full rounded-xl border px-3.5 font-mono text-sm transition-colors focus:ring-2 focus:outline-none"
          />
          <ButtonElement type="submit" variant="secondary" size="md" className="sm:w-40">
            Check code
          </ButtonElement>
        </div>
      </form>

      <form
        onSubmit={(event) => event.preventDefault()}
        className="border-border flex flex-col gap-2 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <label htmlFor="gate-label" className="text-xs font-semibold tracking-widest uppercase">
          Gate label
        </label>
        <input
          id="gate-label"
          ref={(element) => {
            gateInputRef.current = element;

            // Restore what this device used last time. Done on the element rather than
            // in state so the server-rendered markup and the first client render match.
            if (element && element.value === "") {
              element.value = window.localStorage.getItem(GATE_STORAGE_KEY) ?? "";
            }
          }}
          onChange={(event) => {
            try {
              window.localStorage.setItem(GATE_STORAGE_KEY, event.target.value);
            } catch {
              // A browser with storage disabled simply does not remember it.
            }
          }}
          maxLength={40}
          autoComplete="off"
          placeholder="Gate A"
          className="border-border bg-background/60 placeholder:text-muted/50 focus:border-marigold/60 focus:ring-marigold/20 h-10 w-full rounded-xl border px-3.5 text-sm transition-colors focus:ring-2 focus:outline-none sm:max-w-56"
        />
      </form>
    </div>
  );
}
