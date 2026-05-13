// Two flavours:
//   • <AudioPlayer src="..."> — plays backend-served TTS asset.
//   • <BlobPlayer blob={blob}> — plays local recording.
//
// TTS fallback: when src пустой, fallback на window.speechSynthesis (cross-
// browser available, никаких API ключей). Quality uneven, но альтернатива —
// silent button.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const
type Speed = (typeof SPEEDS)[number]

interface CommonProps {
  compact?: boolean
  disabled?: boolean
}

interface AudioPlayerProps extends CommonProps {
  src: string
  /** Fallback text to speak via speechSynthesis when src is empty. */
  prompt?: string
}

export function AudioPlayer({ src, prompt = '', compact = false, disabled = false }: AudioPlayerProps) {
  const [speed, setSpeed] = useState<Speed>(1)
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const ssuRef = useRef<SpeechSynthesisUtterance | null>(null)

  const hasSrc = src.trim() !== ''
  const ttsAvailable =
    !hasSrc && typeof window !== 'undefined' && 'speechSynthesis' in window && prompt.trim() !== ''

  useEffect(() => {
    return () => {
      try {
        window.speechSynthesis?.cancel()
      } catch {
        /* speechSynthesis may be unavailable */
      }
    }
  }, [])

  const handlePlay = useCallback(() => {
    if (disabled) return
    if (hasSrc) {
      const el = audioRef.current
      if (!el) return
      el.playbackRate = speed
      el.currentTime = 0
      void el.play()
      setPlaying(true)
    } else if (ttsAvailable) {
      try {
        window.speechSynthesis.cancel()
      } catch {
        /* ignore */
      }
      const ssu = new SpeechSynthesisUtterance(prompt)
      ssu.lang = 'en-US'
      ssu.rate = speed
      ssu.onend = () => setPlaying(false)
      ssu.onerror = () => setPlaying(false)
      ssuRef.current = ssu
      window.speechSynthesis.speak(ssu)
      setPlaying(true)
    }
  }, [disabled, hasSrc, ttsAvailable, prompt, speed])

  const stop = useCallback(() => {
    if (hasSrc) {
      audioRef.current?.pause()
    } else {
      try {
        window.speechSynthesis.cancel()
      } catch {
        /* ignore */
      }
    }
    setPlaying(false)
  }, [hasSrc])

  const cycleSpeed = useCallback(() => {
    const idx = SPEEDS.indexOf(speed)
    const next = SPEEDS[(idx + 1) % SPEEDS.length] ?? 1
    setSpeed(next)
    if (hasSrc && audioRef.current) {
      audioRef.current.playbackRate = next
    }
  }, [speed, hasSrc])

  const canPlay = hasSrc || ttsAvailable

  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={playing ? stop : handlePlay}
        disabled={disabled || !canPlay}
        aria-label={playing ? 'Stop playback' : 'Play reference audio'}
        className="inline-flex items-center gap-1 rounded-full border border-border-strong bg-transparent px-3 py-1.5 text-xs text-text-primary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {playing ? <StopIcon /> : <PlayIcon />}
        {!compact && <span className="ml-1.5">{playing ? 'Stop' : 'Listen'}</span>}
      </button>
      <button
        type="button"
        onClick={cycleSpeed}
        disabled={disabled || !canPlay}
        aria-label={`Playback speed ${speed}×`}
        title="Cycle playback speed"
        className="inline-flex items-center justify-center rounded-full border border-border bg-transparent px-2.5 py-1 text-text-secondary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="font-mono text-[10px] tracking-tight">{speed === 1 ? '1×' : `${speed}×`}</span>
      </button>
      {hasSrc && (
        <audio
          ref={audioRef}
          src={src}
          onEnded={() => setPlaying(false)}
          preload="auto"
          className="hidden"
        />
      )}
    </div>
  )
}

interface BlobPlayerProps extends CommonProps {
  blob: Blob | null
}

export function BlobPlayer({ blob, compact = false, disabled = false }: BlobPlayerProps) {
  const objectUrl = useMemo(() => (blob ? URL.createObjectURL(blob) : ''), [blob])
  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [objectUrl])
  if (!blob) return null
  return <AudioPlayer src={objectUrl} compact={compact} disabled={disabled} />
}

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M3 2 L10 6 L3 10 Z" fill="currentColor" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <rect x="3" y="3" width="6" height="6" fill="currentColor" />
    </svg>
  )
}
