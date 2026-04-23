// InCallScreen — full-bleed immersive call surface.
//
// Layout (desktop):
//   centre  → InterviewerAvatar + LiveWaveform + transcript fade-overlay
//   top-r   → countdown timer
//   top-l   → persona / topic chip + side-panel toggle
//   bottom  → mute / end-call (danger) / settings
//   side    → collapsible full transcript history
//
// Bound to useVoiceSession; the parent decides when to mount this screen.
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, MicOff, PhoneOff, Settings2, MessageSquare, X } from 'lucide-react'
import { useVoiceSession, type TTSVoice } from '../../lib/voice'
import {
  InterviewerAvatar,
  PERSONA_META,
  type InterviewerPersona,
} from '../../components/voice-mock/InterviewerAvatar'
import { LiveWaveform } from '../../components/voice-mock/LiveWaveform'
import { EmptyState } from '../../components/EmptyState'
import type { Topic } from './PreCallScreen'

const TOPIC_LABEL: Record<Topic, string> = {
  algo: 'Алгоритмы',
  sysdesign: 'System design',
  behavioral: 'Behavioral',
}

interface Props {
  sessionId: string
  persona: InterviewerPersona
  topic: Topic
  durationMin: number
  voice: TTSVoice
  onEnd: (summary: { transcript: TranscriptEntry[]; elapsedSec: number }) => void
}

export interface TranscriptEntry {
  who: 'me' | 'ai'
  text: string
  ts: number
}

function formatMMSS(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

export function InCallScreen({
  sessionId,
  persona,
  topic,
  durationMin,
  voice,
  onEnd,
}: Props) {
  const session = useVoiceSession({ sessionId, voice, lang: 'ru-RU' })
  const [muted, setMuted] = useState(false)
  const [sidePanelOpen, setSidePanelOpen] = useState(false)
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [startedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  const lastAiRef = useRef('')
  const lastUserRef = useRef('')

  // Auto-start the session as soon as we mount.
  useEffect(() => {
    session.start()
    return () => session.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Tick the timer once per second.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])

  // Mirror live STT/TTS into the transcript log.
  useEffect(() => {
    if (session.aiText && session.aiText !== lastAiRef.current) {
      lastAiRef.current = session.aiText
      const userTxt = session.transcript.trim()
      setTranscript((prev) => {
        const next = [...prev]
        if (userTxt && userTxt !== lastUserRef.current) {
          lastUserRef.current = userTxt
          next.push({ who: 'me', text: userTxt, ts: Date.now() })
        }
        next.push({ who: 'ai', text: session.aiText, ts: Date.now() })
        return next
      })
    }
  }, [session.aiText, session.transcript])

  const elapsedSec = Math.floor((now - startedAt) / 1000)
  const totalSec = durationMin * 60
  const remainingSec = Math.max(0, totalSec - elapsedSec)
  const overtime = elapsedSec > totalSec

  // Auto-end at 110% of duration
  useEffect(() => {
    if (elapsedSec > totalSec * 1.1) {
      session.stop()
      onEnd({ transcript, elapsedSec })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsedSec, totalSec])

  const meIntensity = !muted && session.state === 'listening' ? 0.85 : 0.05
  const aiIntensity = session.state === 'speaking' ? 0.95 : 0.05

  // Last 3 messages for the on-screen overlay (older ones live in side panel)
  const overlay = useMemo(() => transcript.slice(-3), [transcript])

  const handleEnd = () => {
    session.stop()
    onEnd({ transcript, elapsedSec })
  }

  // If STT is not supported, surface honest error rather than fake the AI side
  if (session.state === 'error' && session.error) {
    return (
      <div className="grid min-h-screen place-items-center bg-bg px-4">
        <div className="max-w-md">
          <EmptyState
            variant="error"
            title="Голосовой канал недоступен"
            body={session.error}
            cta={{ label: 'Завершить', onClick: handleEnd }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-screen min-h-screen flex-col overflow-hidden bg-bg text-text-primary">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-bg/70 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="h-2 w-2 animate-pulse rounded-full bg-cyan" />
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-text-primary">
            VOICE · LIVE
          </span>
          <span className="text-text-muted">·</span>
          <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-text-secondary">
            {TOPIC_LABEL[topic]}
          </span>
          <span className="hidden font-mono text-[10px] uppercase text-text-muted sm:inline">
            {PERSONA_META[persona].label}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={
              'font-display text-2xl font-extrabold tabular-nums ' +
              (overtime ? 'text-warn' : 'text-text-primary')
            }
            aria-label={`Осталось ${formatMMSS(remainingSec)}`}
          >
            {formatMMSS(remainingSec)}
          </span>
          <button
            type="button"
            onClick={() => setSidePanelOpen((o) => !o)}
            className="grid h-9 w-9 place-items-center rounded-md border border-border bg-surface-1 text-text-secondary hover:bg-surface-2"
            aria-label="Транскрипт"
          >
            <MessageSquare className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Main stage */}
      <div className="flex flex-1 flex-col items-center justify-center gap-10 px-4 py-8">
        <InterviewerAvatar persona={persona} size={260} speaking={session.state === 'speaking'} />

        <div className="flex flex-col items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-text-muted">
            {session.state === 'listening'
              ? 'слушает'
              : session.state === 'speaking'
                ? 'отвечает'
                : session.state === 'thinking'
                  ? 'думает'
                  : 'готов'}
          </span>
          <div className="w-full max-w-2xl">
            <LiveWaveform meIntensity={meIntensity} aiIntensity={aiIntensity} bars={56} height={88} />
          </div>
        </div>

        {/* Transcript overlay — last 3, older fade out */}
        <div className="flex w-full max-w-2xl flex-col gap-2">
          <AnimatePresence initial={false}>
            {overlay.map((m) => (
              <motion.div
                key={m.ts}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
                className={
                  'rounded-lg px-3 py-2 text-sm ' +
                  (m.who === 'ai'
                    ? 'border border-pink/30 bg-pink/10 text-text-primary'
                    : 'border border-cyan/30 bg-cyan/10 text-text-primary')
                }
              >
                <div className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                  {m.who === 'ai' ? PERSONA_META[persona].label : 'ты'}
                </div>
                {m.text}
              </motion.div>
            ))}
            {session.transcript && session.state === 'listening' && (
              <motion.div
                key="interim"
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.7 }}
                exit={{ opacity: 0 }}
                className="rounded-lg border border-dashed border-cyan/40 px-3 py-2 text-sm italic text-text-secondary"
              >
                {session.transcript}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Bottom controls */}
      <div className="flex items-center justify-center gap-4 border-t border-border/60 bg-bg/70 px-4 py-5 backdrop-blur">
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          className={
            'grid h-12 w-12 place-items-center rounded-full transition-colors ' +
            (muted ? 'bg-warn/20 text-warn' : 'bg-surface-2 text-text-primary hover:bg-surface-3')
          }
          aria-label={muted ? 'Включить микрофон' : 'Отключить микрофон'}
        >
          {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </button>
        <button
          type="button"
          onClick={handleEnd}
          className="flex h-14 items-center gap-2 rounded-full bg-danger px-6 text-text-primary shadow-[0_10px_40px_rgba(239,68,68,0.45)] transition-transform hover:brightness-110 active:scale-95"
          aria-label="Завершить интервью"
        >
          <PhoneOff className="h-5 w-5" />
          <span className="font-display text-sm font-bold">Завершить</span>
        </button>
        <button
          type="button"
          className="grid h-12 w-12 place-items-center rounded-full bg-surface-2 text-text-secondary hover:bg-surface-3"
          aria-label="Настройки"
        >
          <Settings2 className="h-5 w-5" />
        </button>
      </div>

      {/* Side panel — full transcript */}
      <AnimatePresence>
        {sidePanelOpen && (
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.25 }}
            className="absolute right-0 top-0 flex h-full w-full flex-col border-l border-border bg-surface-1 sm:w-[380px]"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="font-display text-sm font-bold text-text-primary">Транскрипт</h3>
              <button
                type="button"
                onClick={() => setSidePanelOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text-primary"
                aria-label="Закрыть"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {transcript.length === 0 && (
                <p className="text-xs text-text-muted">
                  Транскрипт появится здесь по мере разговора.
                </p>
              )}
              <div className="flex flex-col gap-2">
                {transcript.map((m, i) => (
                  <div
                    key={`${m.ts}-${i}`}
                    className={
                      'rounded-md px-3 py-2 text-[12px] ' +
                      (m.who === 'ai'
                        ? 'bg-pink/10 text-text-primary'
                        : 'bg-cyan/10 text-text-primary')
                    }
                  >
                    <div className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                      {m.who === 'ai' ? PERSONA_META[persona].label : 'ты'}
                    </div>
                    {m.text}
                  </div>
                ))}
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  )
}
