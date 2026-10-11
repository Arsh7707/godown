"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shrinks a camera photo before upload (slow 4G). Long edge 2000px is enough
 * for handwriting; JPEG 0.82 keeps strokes sharp.
 */
export async function compressImage(file: Blob, maxEdge = 2000, quality = 0.82): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
  return out && out.size < file.size ? out : file;
}

/** WhatsApp voice notes are Opus in an Ogg file, often with no or an odd MIME type. */
export function normalizeAudio(file: File): Blob {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".opus") || lower.endsWith(".ogg") || file.type === "audio/opus") return new Blob([file], { type: "audio/ogg" });
  if (lower.endsWith(".m4a") || file.type === "audio/x-m4a" || file.type === "audio/aac") return new Blob([file], { type: "audio/mp4" });
  return file;
}

/** Length of an audio file in seconds (0 if the browser cannot tell, e.g. Opus on iPhone). */
export function audioSeconds(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const a = new Audio();
    const done = (s: number) => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(s) ? s : 0);
    };
    a.preload = "metadata";
    a.onloadedmetadata = () => done(a.duration);
    a.onerror = () => done(0);
    setTimeout(() => done(0), 3000);
    a.src = url;
  });
}

const MAX_SECONDS = 120;
const MIN_MS = 700;

/** Tap to start, tap again to stop; onDone gets the audio unless it was too short. */
export function useRecorder(onDone: (blob: Blob, seconds: number) => void) {
  const [state, setState] = useState<"idle" | "starting" | "recording" | "blocked" | "tooShort">("idle");
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const starting = useRef(false);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(
    () => () => {
      cleanup();
      // Leaving the screen mid-recording: release the mic without sending.
      const r = rec.current;
      if (r) {
        r.onstop = null;
        if (r.state === "recording") r.stop();
        r.stream.getTracks().forEach((t) => t.stop());
      }
    },
    [],
  );

  const start = useCallback(async () => {
    if (starting.current || rec.current) return;
    starting.current = true;
    setState("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      starting.current = false;
      setState("blocked");
      return;
    }
    const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported(m));
    const r = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      cleanup();
      rec.current = null;
      const ms = Date.now() - startedAt.current;
      if (ms < MIN_MS) {
        setState("tooShort");
        return;
      }
      setState("idle");
      onDone(new Blob(chunks, { type: (r.mimeType || "audio/webm").split(";")[0] }), ms / 1000);
    };
    rec.current = r;
    starting.current = false;
    startedAt.current = Date.now();
    r.start(250);
    setElapsed(0);
    setState("recording");
    timer.current = setInterval(() => {
      const s = (Date.now() - startedAt.current) / 1000;
      setElapsed(s);
      if (s >= MAX_SECONDS) r.stop();
    }, 200);
  }, [onDone]);

  const stop = useCallback(() => {
    if (rec.current?.state === "recording") rec.current.stop();
  }, []);

  /** One button: first tap starts, next tap stops and sends. */
  const toggle = useCallback(() => {
    if (rec.current) stop();
    else start();
  }, [start, stop]);

  return { state, elapsed, toggle };
}
