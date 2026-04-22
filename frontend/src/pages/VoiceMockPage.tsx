// VoiceMockPage — two-way voice interview UI wired to useVoiceSession.
// Visual structure (header / left transcript / center orb / right panel) is
// preserved from the original mock; only the dynamic bits (mic, orb, voice
// chips, transcript) are wired to live state.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Lightbulb,
  Lock,
  Mic,
  MicOff,
  SkipBack,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react'
import { Avatar } from '../components/Avatar'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { useProfileQuery } from '../lib/queries/profile'
import { isPremiumTTSAvailable, useVoiceSession, type TTSVoice } from '../lib/voice'

interface ChatMsg {
  who: 'ai' | 'me'
  text: string
  t: string
}

function nowStamp(): string {
  const d = new Date()
  return `${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
}

function VoiceHeader({
  voice,
  setVoice,
  premiumOk,
  onEnd,
}: {
  voice: TTSVoice
  setVoice: (v: TTSVoice) => void
  premiumOk: boolean
  onEnd: () => void
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border bg-surface-1 px-4 py-3 sm:px-6 lg:h-16 lg:flex-row lg:items-center lg:justify-between lg:py-0">
      <div className="flex items-center gap-3">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" />
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-primary">
          VOICE MOCK · LIVE
        </span>
        <span className="text-text-muted">·</span>
        <span className="font-mono text-xs text-text-secondary">Question 2 of 4</span>
      </div>
      <span className="font-display text-2xl font-extrabold text-text-primary">32:14</span>
      <div className="flex items-center gap-2">
        <VoicePicker voice={voice} setVoice={setVoice} premiumOk={premiumOk} />
        <Button variant="ghost" size="sm" icon={<Lightbulb className="h-3.5 w-3.5" />}>
          Подсказка
        </Button>
        <Button variant="danger" size="sm" icon={<X className="h-3.5 w-3.5" />} onClick={onEnd}>
          Завершить
        </Button>
      </div>
    </div>
  )
}

function VoicePicker({
  voice,
  setVoice,
  premiumOk,
}: {
  voice: TTSVoice
  setVoice: (v: TTSVoice) => void
  premiumOk: boolean
}) {
  const opts: { id: TTSVoice; label: string; premium: boolean }[] = [
    { id: 'browser', label: 'Browser', premium: false },
    { id: 'premium-male', label: '♂ Premium', premium: true },
    { id: 'premium-female', label: '♀ Premium', premium: true },
  ]
  return (
    <div className="flex items-center gap-1 rounded-full bg-surface-2 p-1">
      {premiumOk ? (
        <span className="flex items-center gap-1 rounded-full bg-warn/20 px-2 py-0.5 font-mono text-[10px] font-bold text-warn">
          <Sparkles className="h-3 w-3" /> Premium Voice
        </span>
      ) : (
        <span className="flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] font-bold text-text-muted">
          <Lock className="h-3 w-3" /> Premium
        </span>
      )}
      {opts.map((o) => {
        const disabled = o.premium && !premiumOk
        const active = voice === o.id
        return (
          <button
            key={o.id}
            type="button"
            disabled={disabled}
            title={disabled ? 'Доступно с Premium' : o.label}
            onClick={() => setVoice(o.id)}
            className={
              'rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold transition-colors ' +
              (active
                ? 'bg-accent text-text-primary'
                : disabled
                  ? 'cursor-not-allowed text-text-muted opacity-60'
                  : 'text-text-secondary hover:bg-surface-3 hover:text-text-primary')
            }
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function LeftTranscript({
  messages,
  interim,
  listening,
}: {
  messages: ChatMsg[]
  interim: string
  listening: boolean
}) {
  return (
    <div className="flex w-full flex-col gap-4 border-b border-border bg-surface-1 lg:w-[380px] lg:border-b-0 lg:border-r">
      <div className="border-b border-border p-5">
        <span className="rounded-full bg-accent/15 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-accent-hover">
          ВОПРОС 2/4
        </span>
        <h2 className="mt-2 font-display text-lg font-bold text-text-primary">
          Расскажи о реализации LRU Cache
        </h2>
        <p className="mt-1 text-xs text-text-muted">
          Объясни структуру, основные операции и сложность.
        </p>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-auto px-5">
        <h3 className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">
          ТРАНСКРИПТ
        </h3>
        {messages.length === 0 && !interim && (
          <p className="text-[12px] text-text-muted">
            Нажми на микрофон и начни говорить — AI услышит и ответит голосом.
          </p>
        )}
        {messages.map((m, i) =>
          m.who === 'ai' ? (
            <div key={i} className="flex items-start gap-2">
              <Avatar size="sm" gradient="violet-cyan" initials="AI" />
              <div className="flex-1 rounded-lg bg-surface-2 p-3">
                <p className="text-[12px] text-text-secondary">{m.text}</p>
                <span className="mt-1 block font-mono text-[10px] text-text-muted">{m.t}</span>
              </div>
            </div>
          ) : (
            <div key={i} className="flex items-start gap-2">
              <div className="flex-1 rounded-lg bg-accent/20 p-3">
                <p className="text-[12px] text-text-primary">{m.text}</p>
                <span className="mt-1 block font-mono text-[10px] text-text-muted">{m.t}</span>
              </div>
              <Avatar size="sm" gradient="pink-violet" initials="Я" />
            </div>
          ),
        )}
        {interim && (
          <div className="flex items-start gap-2 opacity-70">
            <div className="flex-1 rounded-lg border border-dashed border-accent/40 p-3">
              <p className="text-[12px] italic text-text-secondary">{interim}</p>
            </div>
            <Avatar size="sm" gradient="pink-violet" initials="Я" />
          </div>
        )}
      </div>
      <div className="flex h-14 items-center justify-between border-t border-border bg-surface-2 px-4">
        <div className={'flex items-end gap-1 ' + (listening ? 'voice-bars-listening' : '')}>
          {[10, 18, 14, 22, 12].map((h, i) => (
            <span
              key={i}
              className="w-1 rounded-full bg-accent-hover"
              style={{
                height: `${h}px`,
                animation: listening ? `voicePulse 1s ease-in-out ${i * 0.1}s infinite` : 'none',
              }}
            />
          ))}
        </div>
        <span className="font-mono text-[11px] text-accent-hover">
          {listening ? 'Слушаю...' : 'Микрофон выключен'}
        </span>
      </div>
      <style>{`
        @keyframes voicePulse {
          0%, 100% { transform: scaleY(0.5); }
          50% { transform: scaleY(1.4); }
        }
      `}</style>
    </div>
  )
}

function CenterOrb({
  state,
  onToggle,
  modelLabel,
}: {
  state: 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'
  onToggle: () => void
  modelLabel: string
}) {
  const bars = Array.from({ length: 30 }).map((_, i) => 8 + Math.abs(((i * 9) % 24) - 4))
  const labelMap: Record<string, string> = {
    idle: 'Готов',
    listening: 'Слушает',
    thinking: 'Думает',
    speaking: 'Говорит',
    error: 'Ошибка',
  }
  const speaking = state === 'speaking'
  const listening = state === 'listening'
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-surface-1 p-6 lg:gap-8 lg:p-10">
      <div
        className="grid h-56 w-56 place-items-center rounded-full sm:h-72 sm:w-72 lg:h-80 lg:w-80"
        style={{
          background: 'linear-gradient(135deg, #582CFF 0%, #F472B6 100%)',
          boxShadow: '0 20px 80px rgba(88,44,255,0.6)',
          animation: speaking ? 'orbPulse 1.2s ease-in-out infinite' : 'none',
        }}
      >
        <div
          className="grid h-44 w-44 place-items-center rounded-full sm:h-56 sm:w-56 lg:h-60 lg:w-60"
          style={{ background: '#00000060' }}
        >
          <div className="flex flex-col items-center gap-1.5">
            <span className="font-mono text-[11px] tracking-[0.15em] text-text-muted">AI INTERVIEWER</span>
            <span className="font-display text-[32px] font-extrabold text-text-primary">{labelMap[state]}</span>
            <span className="font-mono text-[11px] text-text-secondary">{modelLabel}</span>
          </div>
        </div>
      </div>
      <div className="flex h-12 items-end gap-1.5">
        {bars.map((h, i) => (
          <span
            key={i}
            className="w-1 rounded-full bg-cyan opacity-80"
            style={{
              height: `${h * 1.5}px`,
              animation: listening ? `voicePulse 0.7s ease-in-out ${i * 0.04}s infinite` : 'none',
            }}
          />
        ))}
      </div>
      <span className="text-xs text-text-secondary">
        {listening
          ? 'Говори свободно — AI запишет и оценит'
          : state === 'speaking'
            ? 'AI отвечает...'
            : state === 'thinking'
              ? 'AI обрабатывает...'
              : 'Нажми микрофон, чтобы начать'}
      </span>
      <div className="flex items-center gap-5">
        <button className="grid h-14 w-14 place-items-center rounded-full bg-surface-2 text-text-secondary hover:bg-surface-3">
          <SkipBack className="h-5 w-5" />
        </button>
        <button
          onClick={onToggle}
          className={
            'grid h-20 w-20 place-items-center rounded-full text-text-primary transition-transform active:scale-95 ' +
            (state === 'idle' || state === 'error' ? 'bg-accent' : 'bg-danger')
          }
          style={{ boxShadow: '0 10px 40px rgba(88,44,255,0.6)' }}
          aria-label={state === 'idle' ? 'Start' : 'Stop'}
        >
          {state === 'idle' || state === 'error' ? (
            <Mic className="h-7 w-7" />
          ) : (
            <MicOff className="h-7 w-7" />
          )}
        </button>
        <button className="grid h-14 w-14 place-items-center rounded-full bg-surface-2 text-text-secondary hover:bg-surface-3">
          <Volume2 className="h-5 w-5" />
        </button>
      </div>
      <span className="font-mono text-[10px] text-text-muted">Tab — пауза, Esc — закрыть</span>
      <style>{`
        @keyframes orbPulse {
          0%, 100% { transform: scale(1); box-shadow: 0 20px 80px rgba(88,44,255,0.6); }
          50% { transform: scale(1.05); box-shadow: 0 30px 120px rgba(244,114,182,0.85); }
        }
      `}</style>
    </div>
  )
}

function RightPanel() {
  const notes = [
    { i: <CheckCircle2 className="h-4 w-4 text-success" />, t: 'Упомянул hash map + linked list' },
    { i: <CheckCircle2 className="h-4 w-4 text-success" />, t: 'Объяснил O(1) сложность' },
    { i: <AlertTriangle className="h-4 w-4 text-warn" />, t: 'Не упомянул thread safety' },
  ]
  const metrics = [
    ['Понимание', 9.0, 'bg-success'],
    ['Объяснение', 8.5, 'bg-cyan'],
    ['Скорость', 7.5, 'bg-warn'],
    ['Глубина', 8.0, 'bg-accent'],
  ] as const
  const actions = [
    'Задать follow-up вопрос',
    'Перейти к следующему',
    'Сменить тему',
    'Сделать паузу',
  ]
  return (
    <div className="flex w-full flex-col gap-4 border-t border-border bg-surface-1 p-5 lg:w-[320px] lg:border-l lg:border-t-0">
      <Card className="flex-col gap-3 p-4" interactive={false}>
        <h3 className="font-display text-sm font-bold text-text-primary">Live notes</h3>
        {notes.map((n, i) => (
          <div key={i} className="flex items-center gap-2">
            {n.i}
            <span className="text-[12px] text-text-secondary">{n.t}</span>
          </div>
        ))}
      </Card>
      <Card className="flex-col gap-3 p-4" interactive={false}>
        <h3 className="font-display text-sm font-bold text-text-primary">Live evaluation</h3>
        {metrics.map(([k, v, c]) => (
          <div key={k} className="flex flex-col gap-1">
            <div className="flex justify-between font-mono text-[11px]">
              <span className="text-text-secondary">{k}</span>
              <span className="text-text-primary">{v.toFixed(1)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className={`h-full ${c}`} style={{ width: `${v * 10}%` }} />
            </div>
          </div>
        ))}
      </Card>
      <Card className="flex-col gap-2 p-4" interactive={false}>
        <h3 className="font-display text-sm font-bold text-text-primary">Quick actions</h3>
        {actions.map((a) => (
          <button
            key={a}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-[12px] text-text-secondary hover:bg-surface-2"
          >
            <Circle className="h-3 w-3 text-accent-hover" />
            {a}
          </button>
        ))}
      </Card>
    </div>
  )
}

export default function VoiceMockPage() {
  const { data: profile } = useProfileQuery()
  const tier = profile?.tier ?? 'free'
  const premiumOk = isPremiumTTSAvailable(tier)
  const [voice, setVoice] = useState<TTSVoice>('browser')
  const [chat, setChat] = useState<ChatMsg[]>([])
  // Stable session id for the lifetime of the page mount.
  const sessionId = useMemo(() => `voice-${Math.random().toString(36).slice(2, 10)}`, [])

  const session = useVoiceSession({ sessionId, voice, lang: 'ru-RU' })

  // Mirror voice-session events into the visible transcript. useEffect runs
  // after commit, so we never trigger a setState during render.
  const lastAiRef = useRef('')
  const lastUserRef = useRef('')
  useEffect(() => {
    if (session.aiText && session.aiText !== lastAiRef.current) {
      lastAiRef.current = session.aiText
      const userTxt = session.transcript.trim()
      setChat((prev) => {
        const next = [...prev]
        if (userTxt && userTxt !== lastUserRef.current) {
          lastUserRef.current = userTxt
          next.push({ who: 'me', text: userTxt, t: nowStamp() })
        }
        next.push({ who: 'ai', text: session.aiText, t: nowStamp() })
        return next
      })
    }
  }, [session.aiText, session.transcript])

  const onToggle = () => {
    if (session.state === 'idle' || session.state === 'error') {
      setChat([])
      session.start()
    } else {
      session.stop()
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text-primary">
      <VoiceHeader voice={voice} setVoice={setVoice} premiumOk={premiumOk} onEnd={session.stop} />
      <div className="flex flex-1 flex-col lg:flex-row">
        <LeftTranscript
          messages={chat}
          interim={session.transcript}
          listening={session.state === 'listening'}
        />
        <CenterOrb
          state={session.state}
          onToggle={onToggle}
          modelLabel={voice === 'browser' ? 'Browser TTS · Web Speech' : `Premium · ${voice}`}
        />
        <RightPanel />
      </div>
      {session.error && (
        <div className="border-t border-danger/40 bg-danger/10 px-4 py-2 font-mono text-[11px] text-danger">
          {session.error}
        </div>
      )}
    </div>
  )
}

