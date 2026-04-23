// Voice-input hook — wraps MediaRecorder and the transcribe IPC.
//
// Lifecycle:
//   idle → recording (on start)
//   recording → transcribing (on stop)
//   transcribing → idle (on success; `transcript` available via onDone)
//   → error (on failure)
//
// Level metering happens locally via AudioContext AnalyserNode so the UI
// can render a waveform without touching the main process every frame.

import { useCallback, useEffect, useRef, useState } from 'react';

export type VoiceState = 'idle' | 'recording' | 'transcribing' | 'error';

export interface UseVoiceReturn {
  state: VoiceState;
  /** 0..1 — current RMS level; updates every animation frame while recording. */
  level: number;
  /** Seconds since recording started. 0 when idle. */
  elapsed: number;
  error: string | null;
  /** Begin capture. Rejects if the mic permission is denied. */
  start: () => Promise<void>;
  /** Stop capture and request transcription. onDone fires with the transcript. */
  stop: () => Promise<void>;
  /** Discard the in-progress recording without transcribing. */
  cancel: () => void;
}

export function useVoice(onDone: (transcript: string) => void): UseVoiceReturn {
  const [state, setState] = useState<VoiceState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const startAtRef = useRef(0);
  const cancelledRef = useRef(false);

  const cleanup = useCallback(() => {
    rafRef.current && cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {
      /* already closed */
    });
    audioCtxRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    setLevel(0);
    setElapsed(0);
  }, []);

  // Stop everything on unmount.
  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    setError(null);
    cancelledRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Level meter.
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        // RMS around 128-centered 8-bit samples.
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i]! - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        setLevel(Math.min(1, rms * 3)); // gentle visual boost
        setElapsed((Date.now() - startAtRef.current) / 1000);
        rafRef.current = requestAnimationFrame(tick);
      };

      // Recorder. Prefer webm/opus — well-supported by Whisper.
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        if (cancelledRef.current) {
          cleanup();
          setState('idle');
          return;
        }
        const blob = new Blob(chunksRef.current, { type: mimeType });
        cleanup();
        setState('transcribing');
        try {
          const buf = await blob.arrayBuffer();
          const b64 = arrayBufferToBase64(buf);
          const r = await window.druz9.voice.transcribe({
            audioBase64: b64,
            mimeType,
            language: 'ru',
          });
          if (!r.ok) {
            setError(r.error ?? 'transcription failed');
            setState('error');
            return;
          }
          if (r.transcript) onDone(r.transcript);
          setState('idle');
        } catch (err) {
          setError((err as Error).message);
          setState('error');
        }
      };

      startAtRef.current = Date.now();
      recorder.start(250);
      tick();
      setState('recording');
    } catch (err) {
      cleanup();
      setError((err as Error).message);
      setState('error');
    }
  }, [cleanup, onDone]);

  const stop = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (rec.state !== 'inactive') rec.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop();
  }, []);

  return { state, level, elapsed, error, start, stop, cancel };
}

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/wav'];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return 'audio/webm'; // hope for the best
}

/** Chromium's btoa + Uint8Array → base64 path. */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
