"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { sha256Hex, pickRecorderMimeType, extensionForMimeType } from "@/lib/upload";

type Status = "idle" | "requesting" | "recording" | "paused" | "done" | "error";

type AudioRecorderProps = {
  // If provided (e.g. 3000): limited mode with a live countdown and a hard
  // auto-stop. If omitted/undefined: unlimited mode, counting up, with
  // pause/resume and a manual stop.
  maxDurationMs?: number;
  onRecordingComplete: (file: File, durationMs: number, checksumSha256: string) => void;
  onError?: (error: string) => void;
};

function formatRemaining(ms: number): string {
  return `${Math.max(0, ms / 1000).toFixed(1)}s remaining`;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

export default function AudioRecorder({ maxDurationMs, onRecordingComplete, onError }: AudioRecorderProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [durationMs, setDurationMs] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // Mirrors `status` for the requestAnimationFrame loop below, which is a
  // long-lived closure that would otherwise only ever see the status from
  // the render it was scheduled in.
  const statusRef = useRef<Status>("idle");
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelDataRef = useRef<Uint8Array | null>(null);
  const rafRef = useRef<number | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const mimeTypeRef = useRef("audio/webm");
  const startTimeRef = useRef(0);
  const pausedDurationRef = useRef(0);
  const pauseStartRef = useRef(0);
  const audioUrlRef = useRef<string | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const loop = useCallback(() => {
    if (analyserRef.current && levelDataRef.current) {
      analyserRef.current.getByteTimeDomainData(levelDataRef.current as Uint8Array<ArrayBuffer>);
      let sumSquares = 0;
      for (let i = 0; i < levelDataRef.current.length; i++) {
        const normalized = (levelDataRef.current[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / levelDataRef.current.length);
      setMicLevel(Math.min(1, rms * 4));
    }

    if (statusRef.current === "recording") {
      const elapsed = performance.now() - startTimeRef.current - pausedDurationRef.current;
      setDurationMs(elapsed);
      if (maxDurationMs && elapsed >= maxDurationMs) {
        stopRecording();
        return;
      }
    }

    rafRef.current = requestAnimationFrame(loop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxDurationMs]);

  const requestMic = useCallback(async () => {
    setStatus("requesting");
    setErrorMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      levelDataRef.current = new Uint8Array(analyser.frequencyBinCount);

      setStatus("idle");
      rafRef.current = requestAnimationFrame(loop);
    } catch (err) {
      setStatus("error");
      const message = err instanceof Error ? err.message : "Microphone permission denied";
      setErrorMessage(message);
      onError?.(message);
    }
  }, [loop, onError]);

  useEffect(() => {
    requestMic();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioContextRef.current?.close().catch(() => {});
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;

    const mimeType = pickRecorderMimeType();
    mimeTypeRef.current = mimeType;
    const recorder = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      const finalDurationMs = performance.now() - startTimeRef.current - pausedDurationRef.current;
      const file = new File(chunksRef.current, `recording.${extensionForMimeType(mimeType)}`, {
        type: mimeType,
        lastModified: Date.now(),
      });

      const url = URL.createObjectURL(file);
      audioUrlRef.current = url;
      setAudioUrl(url);
      setDurationMs(finalDurationMs);
      setStatus("done");

      const checksumSha256 = await sha256Hex(file);
      onRecordingComplete(file, finalDurationMs, checksumSha256);
    };

    mediaRecorderRef.current = recorder;
    recorder.start();
    startTimeRef.current = performance.now();
    pausedDurationRef.current = 0;
    setDurationMs(0);
    setStatus("recording");
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
  }

  function pauseRecording() {
    mediaRecorderRef.current?.pause();
    pauseStartRef.current = performance.now();
    setStatus("paused");
  }

  function resumeRecording() {
    mediaRecorderRef.current?.resume();
    pausedDurationRef.current += performance.now() - pauseStartRef.current;
    setStatus("recording");
  }

  function retake() {
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setAudioUrl(null);
    setDurationMs(0);
    setIsPlaying(false);
    setStatus("idle");
  }

  function togglePlayback() {
    const el = audioElRef.current;
    if (!el) return;
    if (isPlaying) el.pause();
    else el.play();
  }

  const micMeter = (
    <div className="h-2 w-56 overflow-hidden rounded-full bg-slate-700">
      <div className="h-full bg-emerald-500 transition-[width]" style={{ width: `${Math.round(micLevel * 100)}%` }} />
    </div>
  );

  if (status === "requesting") {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-600 border-t-blue-500" />
        <p className="text-sm text-slate-400">Requesting microphone access...</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-col items-center gap-3">
        <p className="text-sm text-red-400">{errorMessage}</p>
        <button onClick={requestMic} className="rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-500">
          Try Again
        </button>
      </div>
    );
  }

  if (status === "idle") {
    return (
      <div className="flex flex-col items-center gap-3">
        <button
          onClick={startRecording}
          className="flex h-20 w-20 items-center justify-center rounded-full bg-red-600 text-white shadow-lg transition hover:bg-red-500"
          aria-label="Start recording"
        >
          <MicIcon />
        </button>
        <p className="text-sm text-slate-400">
          {maxDurationMs ? `Tap to record (max ${(maxDurationMs / 1000).toFixed(0)} seconds)` : "Tap to start recording"}
        </p>
        {micMeter}
      </div>
    );
  }

  if (status === "recording" && maxDurationMs) {
    const remainingMs = maxDurationMs - durationMs;
    const progressPct = Math.min(100, (durationMs / maxDurationMs) * 100);
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="text-5xl font-bold tabular-nums text-white">{formatRemaining(remainingMs)}</div>
        <div className="h-3 w-64 overflow-hidden rounded-full bg-slate-700">
          <div className="h-full bg-red-500 transition-[width]" style={{ width: `${progressPct}%` }} />
        </div>
        {micMeter}
        <p className="text-sm font-semibold text-red-400">Recording... auto-stops at {(maxDurationMs / 1000).toFixed(0)} seconds</p>
      </div>
    );
  }

  if (status === "recording" && !maxDurationMs) {
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="text-4xl font-bold tabular-nums text-white">{formatElapsed(durationMs)}</div>
        {micMeter}
        <div className="flex gap-3">
          <button onClick={pauseRecording} className="rounded-lg bg-slate-700 px-5 py-3 font-semibold text-white hover:bg-slate-600">
            Pause
          </button>
          <button onClick={stopRecording} className="rounded-lg bg-red-600 px-5 py-3 font-semibold text-white hover:bg-red-500">
            Stop
          </button>
        </div>
      </div>
    );
  }

  if (status === "paused") {
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="text-4xl font-bold tabular-nums text-white">{formatElapsed(durationMs)}</div>
        {micMeter}
        <div className="flex gap-3">
          <button onClick={resumeRecording} className="rounded-lg bg-emerald-600 px-5 py-3 font-semibold text-white hover:bg-emerald-500">
            Resume
          </button>
          <button onClick={stopRecording} className="rounded-lg bg-red-600 px-5 py-3 font-semibold text-white hover:bg-red-500">
            Stop
          </button>
        </div>
      </div>
    );
  }

  // status === "done"
  return (
    <div className="flex flex-col items-center gap-4">
      <audio
        ref={audioElRef}
        src={audioUrl ?? undefined}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        className="hidden"
      />
      <p className="text-lg font-semibold text-emerald-400">
        Recording ready -- {(durationMs / 1000).toFixed(1)}s
      </p>
      <div className="flex gap-3">
        <button onClick={togglePlayback} className="rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-500">
          {isPlaying ? "Pause" : "Play"}
        </button>
        <button onClick={retake} className="rounded-lg bg-slate-700 px-5 py-3 font-semibold text-white hover:bg-slate-600">
          Retake
        </button>
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-8 w-8">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" strokeLinecap="round" />
    </svg>
  );
}
