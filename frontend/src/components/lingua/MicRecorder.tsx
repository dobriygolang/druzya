// MicRecorder — Phase K W8 web-port of hone speaking recorder.
//
// MediaRecorder API → audio/webm; codecs=opus. Caps at 15s default, auto-
// stop on cap. Live waveform via AnalyserNode + canvas. Returns the
// recorded Blob via `onRecorded` callback.
//
// Permissions: first invocation prompts via getUserMedia. If denied,
// surface a banner. Web works on Chrome/Firefox/Safari without any extra
// permission flags (vs. Electron которое требует session.setPermission).
//
// B/W only; #FF3B30 = recording dot only (per Sergey rule).
import { useCallback, useEffect, useRef, useState } from 'react'

interface Props {
  maxSeconds?: number
  onRecorded: (blob: Blob, durationMs: number) => void
  disabled?: boolean
}

type State =
  | { kind: 'idle' }
  | { kind: 'recording'; startedAt: number }
  | { kind: 'denied'; message: string }
  | { kind: 'error'; message: string }

export function MicRecorder({ maxSeconds = 15, onRecorded, disabled = false }: Props) {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [elapsedMs, setElapsedMs] = useState(0)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const autoStopRef = useRef<number | null>(null)
  const elapsedTimerRef = useRef<number | null>(null)
  // Keep latest elapsedMs accessible from MediaRecorder.onstop without making
  // start() depend on the state (which would cause stale closures).
  const elapsedRef = useRef(0)

  useEffect(() => {
    elapsedRef.current = elapsedMs
  }, [elapsedMs])

  const cleanup = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (autoStopRef.current != null) {
      window.clearTimeout(autoStopRef.current)
      autoStopRef.current = null
    }
    if (elapsedTimerRef.current != null) {
      window.clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop()
      }
      streamRef.current = null
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close()
      audioCtxRef.current = null
    }
    analyserRef.current = null
    mediaRecorderRef.current = null
  }, [])

  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [cleanup])

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current
    const analyser = analyserRef.current
    if (!canvas || !analyser) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw)
      analyser.getByteFrequencyData(dataArray)
      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)
      const barWidth = (w / bufferLength) * 2.5
      let x = 0
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] ?? 0
        const barHeight = (v / 255) * h
        ctx.fillRect(x, h - barHeight, barWidth, barHeight)
        x += barWidth + 1
      }
    }
    draw()
  }, [])

  const stop = useCallback(() => {
    const rec = mediaRecorderRef.current
    if (!rec) return
    if (autoStopRef.current != null) {
      window.clearTimeout(autoStopRef.current)
      autoStopRef.current = null
    }
    if (elapsedTimerRef.current != null) {
      window.clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
    if (rec.state === 'recording') {
      rec.stop()
    }
  }, [])

  const start = useCallback(async () => {
    if (state.kind === 'recording' || disabled) return
    chunksRef.current = []

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (err instanceof Error && err.name === 'NotAllowedError') {
        setState({
          kind: 'denied',
          message:
            'Microphone access denied. Allow it in your browser site settings (lock icon → Microphone).',
        })
      } else {
        setState({ kind: 'error', message: msg })
      }
      return
    }
    streamRef.current = stream

    const mimeType = pickMimeType()
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    mediaRecorderRef.current = rec

    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
    }
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' })
      const dur = elapsedRef.current
      cleanup()
      setState({ kind: 'idle' })
      setElapsedMs(0)
      onRecorded(blob, dur)
    }

    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctor()
      audioCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      analyserRef.current = analyser
      drawWaveform()
    } catch {
      /* waveform optional */
    }

    const startedAt = Date.now()
    setState({ kind: 'recording', startedAt })
    setElapsedMs(0)

    elapsedTimerRef.current = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt)
    }, 60)

    autoStopRef.current = window.setTimeout(() => {
      stop()
    }, maxSeconds * 1000)

    rec.start(100)
  }, [state.kind, disabled, maxSeconds, onRecorded, cleanup, drawWaveform, stop])

  const recording = state.kind === 'recording'
  const denied = state.kind === 'denied'
  const errored = state.kind === 'error'
  const seconds = (elapsedMs / 1000).toFixed(1)

  return (
    <div className="flex flex-col gap-3">
      <div className="relative h-14 overflow-hidden rounded-md border border-border bg-transparent">
        <canvas
          ref={canvasRef}
          width={480}
          height={56}
          className="block h-full w-full"
        />
        {recording && (
          <div className="absolute right-2.5 top-2 inline-flex items-center gap-1.5 font-mono text-[11px] text-text-primary tabular-nums">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: '#FF3B30', animation: 'pulseLinguaRec 1.2s ease-in-out infinite' }}
            />
            {seconds}s / {maxSeconds}s
          </div>
        )}
      </div>

      {denied && (
        <div role="alert" className="rounded-md border border-border-strong bg-surface-1 px-3 py-2 text-xs text-text-secondary">
          {state.message}
        </div>
      )}
      {errored && (
        <div role="alert" className="rounded-md border border-border-strong bg-surface-1 px-3 py-2 text-xs text-text-secondary">
          {state.message}
        </div>
      )}

      <div className="flex gap-2">
        {!recording ? (
          <button
            type="button"
            onClick={() => void start()}
            disabled={disabled}
            aria-label="Start recording"
            className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-transparent px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: '#FF3B30' }}
              aria-hidden
            />
            Record
          </button>
        ) : (
          <button
            type="button"
            onClick={stop}
            aria-label="Stop recording"
            className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-text-primary px-4 py-2 text-sm font-medium text-bg transition-colors hover:opacity-90"
          >
            <span className="inline-block h-2.5 w-2.5 bg-bg" aria-hidden />
            Stop
          </button>
        )}
      </div>

      <style>{`
        @keyframes pulseLinguaRec {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}

function pickMimeType(): string | null {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return null
  }
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return null
}
