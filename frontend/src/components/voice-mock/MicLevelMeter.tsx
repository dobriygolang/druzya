// MicLevelMeter — animated bar meter sourced from a real getUserMedia stream.
//
// Anti-fallback rule from _rules.md / task brief: if the mic is denied or
// missing, we surface that *honestly* via `state` callback — we NEVER mock
// audio with `Math.random` to fake a working mic.
//
// The component owns its own AudioContext + AnalyserNode and tears them down
// on unmount; a single shared context is unnecessary here because the
// pre-call screen is the only consumer and lifetime is short.
import { useEffect, useRef, useState } from 'react'

export type MicState = 'idle' | 'requesting' | 'ready' | 'denied' | 'unavailable'

interface Props {
  /** Number of bars in the meter. */
  bars?: number
  /** Notify parent of mic permission state for gating Start CTA. */
  onState?: (state: MicState) => void
  /** Auto-request permission on mount. */
  autoStart?: boolean
}

export function MicLevelMeter({ bars = 24, onState, autoStart = true }: Props) {
  const [state, setState] = useState<MicState>('idle')
  const [levels, setLevels] = useState<number[]>(() => Array(bars).fill(0))
  const ctxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const stateRef = useRef(onState)
  stateRef.current = onState

  useEffect(() => {
    if (!autoStart) return
    let cancelled = false

    async function start() {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setState('unavailable')
        stateRef.current?.('unavailable')
        return
      }
      setState('requesting')
      stateRef.current?.('requesting')
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const AC: typeof AudioContext =
          (window as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
            .AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        const ctx = new AC()
        ctxRef.current = ctx
        const src = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 64
        src.connect(analyser)
        const buf = new Uint8Array(analyser.frequencyBinCount)
        setState('ready')
        stateRef.current?.('ready')

        const tick = () => {
          analyser.getByteFrequencyData(buf)
          // Map analyser bins → bars: average each window
          const next: number[] = []
          const stride = Math.max(1, Math.floor(buf.length / bars))
          for (let i = 0; i < bars; i++) {
            let sum = 0
            for (let j = 0; j < stride; j++) sum += buf[i * stride + j] ?? 0
            next.push(Math.min(1, sum / stride / 200))
          }
          setLevels(next)
          rafRef.current = requestAnimationFrame(tick)
        }
        tick()
      } catch (e) {
        const name = (e as { name?: string })?.name ?? ''
        const denied = name === 'NotAllowedError' || name === 'PermissionDeniedError'
        const next: MicState = denied ? 'denied' : 'unavailable'
        setState(next)
        stateRef.current?.(next)
      }
    }
    void start()

    return () => {
      cancelled = true
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      void ctxRef.current?.close().catch(() => {})
      ctxRef.current = null
    }
  }, [autoStart, bars])

  return (
    <div className="flex h-16 items-end gap-[3px]" aria-label="Mic level meter">
      {levels.map((v, i) => {
        // Idle (no stream) → flat low bars; ready → live data; denied →
        // visibly silent (height 4) so the meter reads as «no signal».
        const h = state === 'ready' ? Math.max(4, Math.round(v * 56)) : 4
        const opacity = state === 'ready' ? 0.65 + v * 0.35 : 0.25
        return (
          <span
            key={i}
            className="w-[6px] rounded-sm bg-text-primary transition-[height] duration-75"
            style={{ height: `${h}px`, opacity }}
          />
        )
      })}
    </div>
  )
}
