// MicRecorder — Phase J / H4 mic capture component for Speaking surface.
//
// MediaRecorder API → audio/webm; codecs=opus. Caps at 15s default;
// auto-stop on cap. Live waveform via AnalyserNode + canvas. Returns
// the recorded Blob via `onRecorded` callback.
//
// Permissions: first invocation prompts via getUserMedia. If denied,
// surface a banner instead of a record-disabled state — the page is
// useless without mic.
//
// 2026-05-12: B/W only; recording indicator = #FF3B30 dot (single-purpose
// indicator usage, per project rule).
import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  /** Max recording duration in seconds. Default 15. */
  maxSeconds?: number;
  /** Called once recording stops (either auto-cap or user-press). */
  onRecorded: (blob: Blob, durationMs: number) => void;
  /** Disable record button (e.g. while grading is in-flight). */
  disabled?: boolean;
}

type State =
  | { kind: 'idle' }
  | { kind: 'recording'; startedAt: number }
  | { kind: 'denied'; message: string }
  | { kind: 'error'; message: string };

const monoFont = "'JetBrains Mono', ui-monospace, monospace";

export function MicRecorder({ maxSeconds = 15, onRecorded, disabled = false }: Props) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [elapsedMs, setElapsedMs] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const autoStopRef = useRef<number | null>(null);
  const elapsedTimerRef = useRef<number | null>(null);

  // Cleanup on unmount — release mic, cancel timers, close audio context.
  useEffect(() => {
    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cleanup() {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (autoStopRef.current != null) {
      window.clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    if (elapsedTimerRef.current != null) {
      window.clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    mediaRecorderRef.current = null;
  }

  const start = useCallback(async () => {
    if (state.kind === 'recording' || disabled) return;
    chunksRef.current = [];

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // NotAllowedError → permission denied; otherwise treat as device error.
      if (err instanceof Error && err.name === 'NotAllowedError') {
        setState({ kind: 'denied', message: 'Microphone access denied. Allow it in System Settings → Privacy & Security → Microphone.' });
      } else {
        setState({ kind: 'error', message: msg });
      }
      return;
    }
    streamRef.current = stream;

    // Pick a supported mime type. webm/opus is the default in Chromium.
    const mimeType = pickMimeType();
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorderRef.current = rec;

    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
      const dur = elapsedTimerRef.current != null ? elapsedMs : 0;
      cleanup();
      setState({ kind: 'idle' });
      setElapsedMs(0);
      onRecorded(blob, dur);
    };

    // Set up live waveform.
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      drawWaveform();
    } catch {
      // Waveform fails → recording still works, just no visual feedback.
    }

    const startedAt = Date.now();
    setState({ kind: 'recording', startedAt });
    setElapsedMs(0);

    elapsedTimerRef.current = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 60);

    autoStopRef.current = window.setTimeout(() => {
      stop();
    }, maxSeconds * 1000);

    rec.start(100); // 100ms chunks — keeps the blob small if user stops early.
  }, [state.kind, disabled, maxSeconds, elapsedMs, onRecorded]);

  const stop = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    if (autoStopRef.current != null) {
      window.clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    if (elapsedTimerRef.current != null) {
      window.clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    if (rec.state === 'recording') {
      rec.stop();
    }
  }, []);

  function drawWaveform() {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      // B/W bars only. ink-30 (60% transparent white) → renders subtle.
      const barWidth = (w / bufferLength) * 2.5;
      let x = 0;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] ?? 0;
        const barHeight = (v / 255) * h;
        ctx.fillRect(x, h - barHeight, barWidth, barHeight);
        x += barWidth + 1;
      }
    };
    draw();
  }

  const recording = state.kind === 'recording';
  const denied = state.kind === 'denied';
  const seconds = (elapsedMs / 1000).toFixed(1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'stretch' }}>
      {/* Waveform canvas — fixed 56px height, full width. */}
      <div
        style={{
          position: 'relative',
          height: 56,
          border: '1px solid var(--hair)',
          borderRadius: 'var(--radius-inner)',
          background: 'transparent',
          overflow: 'hidden',
        }}
      >
        <canvas
          ref={canvasRef}
          width={480}
          height={56}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
        {recording && (
          <div
            style={{
              position: 'absolute',
              top: 8,
              right: 10,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: monoFont,
              fontSize: 11,
              color: 'var(--ink)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                background: '#FF3B30',
                animation: 'pulse 1.2s ease-in-out infinite',
              }}
            />
            {seconds}s / {maxSeconds}s
          </div>
        )}
      </div>

      {denied && (
        <div
          role="alert"
          style={{
            padding: '8px 12px',
            border: '1px solid var(--hair-2)',
            borderRadius: 'var(--radius-inner)',
            color: 'var(--ink-60)',
            fontSize: 12,
          }}
        >
          {state.message}
        </div>
      )}
      {state.kind === 'error' && (
        <div
          role="alert"
          style={{
            padding: '8px 12px',
            border: '1px solid var(--hair-2)',
            borderRadius: 'var(--radius-inner)',
            color: 'var(--ink-60)',
            fontSize: 12,
          }}
        >
          {state.message}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        {!recording ? (
          <button
            type="button"
            onClick={() => void start()}
            disabled={disabled}
            className="focus-ring motion-press"
            style={recordButtonStyle(disabled)}
            aria-label="Start recording"
          >
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: 5,
                background: '#FF3B30',
                marginRight: 8,
              }}
            />
            Record
          </button>
        ) : (
          <button
            type="button"
            onClick={stop}
            className="focus-ring motion-press"
            style={recordButtonStyle(false, true)}
            aria-label="Stop recording"
          >
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                background: 'var(--ink)',
                marginRight: 8,
              }}
            />
            Stop
          </button>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

function recordButtonStyle(disabled: boolean, stop = false): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 18px',
    background: stop ? 'var(--ink)' : 'transparent',
    color: stop ? 'var(--ink-on-fill)' : 'var(--ink)',
    border: '1px solid var(--hair-2)',
    borderRadius: 999,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    fontSize: 13,
    fontWeight: 500,
    transition:
      'background-color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
  };
}

function pickMimeType(): string | null {
  // Chromium supports webm/opus natively; Safari needs mp4. We test the
  // preferred order and return the first hit.
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return null;
  }
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}
