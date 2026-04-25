// LiveWaveform — 2-lane bars-style waveform.
//   me  → cyan (top)
//   ai  → pink (bottom mirror)
//
// We don't tap the actual audio stream here (the orchestrator does that and
// owns the AudioContext) — instead the parent passes an `intensity` 0..1 per
// lane, and the bars are deterministic-by-index pseudo-noise scaled by that
// intensity. This keeps the component pure and avoids fighting for the mic.
//
// When both intensities are 0 the bars settle to a faint baseline so the
// canvas never looks "dead" — this is honest because we only ever render
// when an actual session is live.
import { useEffect, useState } from 'react'

interface Props {
  bars?: number
  /** 0..1 — your voice level. Drive from analyser RMS. */
  meIntensity: number
  /** 0..1 — AI voice level. Drive from TTS state (1.0 while speaking). */
  aiIntensity: number
  height?: number
}

// Stable pseudo-noise so bars don't jitter wildly between renders.
function noiseAt(i: number, t: number): number {
  return 0.5 + 0.5 * Math.sin(i * 1.7 + t * 0.004) * Math.cos(i * 0.6 + t * 0.007)
}

export function LiveWaveform({ bars = 64, meIntensity, aiIntensity, height = 96 }: Props) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let raf = 0
    const loop = () => {
      setTick((t) => (t + 1) % 1_000_000)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const half = height / 2
  const baseline = 0.08

  return (
    <div className="flex w-full flex-col items-stretch" style={{ height }}>
      <div className="flex flex-1 items-end justify-center gap-[2px]">
        {Array.from({ length: bars }).map((_, i) => {
          const n = noiseAt(i, tick)
          const v = baseline + (meIntensity || 0) * n * 0.92
          return (
            <span
              key={`me-${i}`}
              className="w-[3px] rounded-t-sm bg-text-primary"
              style={{ height: `${v * half}px`, opacity: 0.55 + (meIntensity || 0) * 0.45 }}
            />
          )
        })}
      </div>
      <div className="h-px w-full bg-border" />
      <div className="flex flex-1 items-start justify-center gap-[2px]">
        {Array.from({ length: bars }).map((_, i) => {
          const n = noiseAt(i + 13, tick + 200)
          const v = baseline + (aiIntensity || 0) * n * 0.92
          return (
            <span
              key={`ai-${i}`}
              className="w-[3px] rounded-b-sm bg-text-primary"
              style={{ height: `${v * half}px`, opacity: 0.55 + (aiIntensity || 0) * 0.45 }}
            />
          )
        })}
      </div>
    </div>
  )
}
