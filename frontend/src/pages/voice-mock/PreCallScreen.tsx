// PreCallScreen — pre-flight checklist before joining the voice interview.
//
// The user picks: persona × topic × duration, with a live mic-level meter
// and an audio output test. Start CTA stays disabled until mic is `ready`
// (anti-fallback: we don't allow entering the call with a denied mic).
import { useState } from 'react'
import { CheckCircle2, Headphones, Mic, MicOff, Play, Volume2 } from 'lucide-react'
import { Card } from '../../components/Card'
import { Button } from '../../components/Button'
import { EmptyState } from '../../components/EmptyState'
import {
  InterviewerAvatar,
  PERSONA_META,
  type InterviewerPersona,
} from '../../components/voice-mock/InterviewerAvatar'
import { MicLevelMeter, type MicState } from '../../components/voice-mock/MicLevelMeter'

export type Topic = 'algo' | 'sysdesign' | 'behavioral'
export type Duration = 20 | 30 | 45

const TOPICS: Array<{ id: Topic; label: string; hint: string }> = [
  { id: 'algo', label: 'Алгоритмы', hint: 'LeetCode-style: graph, DP, two pointers' },
  { id: 'sysdesign', label: 'System design', hint: 'High-level: scaling, queues, storage' },
  { id: 'behavioral', label: 'Behavioral', hint: 'STAR-формат: лидерство, конфликт, провал' },
]

const DURATIONS: Duration[] = [20, 30, 45]

export interface PreCallConfig {
  persona: InterviewerPersona
  topic: Topic
  duration: Duration
}

interface Props {
  initial?: Partial<PreCallConfig>
  onStart: (config: PreCallConfig) => void
}

export function PreCallScreen({ initial, onStart }: Props) {
  const [persona, setPersona] = useState<InterviewerPersona>(initial?.persona ?? 'neutral')
  const [topic, setTopic] = useState<Topic>(initial?.topic ?? 'algo')
  const [duration, setDuration] = useState<Duration>(initial?.duration ?? 30)
  const [micState, setMicState] = useState<MicState>('idle')
  const [outputTested, setOutputTested] = useState(false)
  const [retryKey, setRetryKey] = useState(0)

  const startEnabled = micState === 'ready'

  const playTestTone = () => {
    try {
      const AC: typeof AudioContext =
        (window as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
          .AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new AC()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = 660
      gain.gain.value = 0.08
      osc.connect(gain).connect(ctx.destination)
      osc.start()
      setTimeout(() => {
        osc.stop()
        void ctx.close()
        setOutputTested(true)
      }, 320)
    } catch {
      // If WebAudio isn't available, mark as tested so we don't gate forever
      setOutputTested(true)
    }
  }

  // Mic permission denied → honest empty state with retry. We must NOT
  // proceed with fake audio.
  if (micState === 'denied' || micState === 'unavailable') {
    return (
      <div className="mx-auto max-w-md py-20">
        <EmptyState
          variant="error"
          title={micState === 'denied' ? 'Микрофон заблокирован' : 'Микрофон недоступен'}
          body={
            micState === 'denied'
              ? 'Разреши доступ к микрофону в настройках браузера и повтори. Без живого голоса voice-mock работать не будет.'
              : 'Этот браузер не предоставляет API записи звука. Открой в Chrome / Safari последней версии.'
          }
          cta={{ label: 'Повторить', onClick: () => setRetryKey((k) => k + 1) }}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-10 sm:px-8 lg:py-14">
      <header>
        <div className="font-mono text-[11px] uppercase tracking-wider text-text-muted">pre-call</div>
        <h1 className="mt-1 font-display text-3xl font-bold leading-[1.1] text-text-primary lg:text-[40px]">
          Готов к <span className="bg-gradient-to-r from-pink to-cyan bg-clip-text text-transparent">интервью</span>?
        </h1>
        <p className="mt-2 max-w-xl text-sm text-text-secondary">
          Проверь микрофон, выбери стиль интервьюера и тему. Это не демо — голос, ответы и оценка живые.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Mic check */}
        <Card padding="lg" interactive={false}>
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-text-primary">Микрофон</h2>
            <span
              className={
                'flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase ' +
                (micState === 'ready'
                  ? 'bg-success/20 text-success'
                  : micState === 'requesting'
                    ? 'bg-warn/20 text-warn'
                    : 'bg-surface-3 text-text-muted')
              }
            >
              {micState === 'ready' ? (
                <>
                  <CheckCircle2 className="h-3 w-3" /> ok
                </>
              ) : micState === 'requesting' ? (
                <>
                  <Mic className="h-3 w-3" /> запрашиваем
                </>
              ) : (
                <>
                  <MicOff className="h-3 w-3" /> ожидание
                </>
              )}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-muted">Скажи что-нибудь — должен прыгать индикатор.</p>
          <div className="mt-5">
            <MicLevelMeter key={retryKey} onState={setMicState} />
          </div>
        </Card>

        {/* Output test */}
        <Card padding="lg" interactive={false}>
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-text-primary">Звук</h2>
            <span
              className={
                'flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase ' +
                (outputTested ? 'bg-success/20 text-success' : 'bg-surface-3 text-text-muted')
              }
            >
              {outputTested ? (
                <>
                  <CheckCircle2 className="h-3 w-3" /> ok
                </>
              ) : (
                <>
                  <Headphones className="h-3 w-3" /> не проверено
                </>
              )}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            Включи звук на максимум — AI говорит вслух. Лучше в наушниках, чтобы не было echo.
          </p>
          <div className="mt-5 flex items-center gap-3">
            <Button variant="ghost" icon={<Volume2 className="h-4 w-4" />} onClick={playTestTone}>
              Проиграть тон
            </Button>
            <span className="font-mono text-[11px] text-text-muted">~440 ms · 660 Hz</span>
          </div>
        </Card>
      </div>

      {/* Persona picker */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-lg font-bold text-text-primary">Стиль интервьюера</h2>
          <span className="font-mono text-[11px] text-text-muted">3 варианта</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(['friendly', 'strict', 'neutral'] as InterviewerPersona[]).map((p) => {
            const meta = PERSONA_META[p]
            const active = persona === p
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPersona(p)}
                className={
                  'flex flex-col items-center gap-3 rounded-xl border p-5 text-center transition-colors ' +
                  (active
                    ? 'border-accent bg-accent/10'
                    : 'border-border bg-surface-1 hover:border-border-strong hover:bg-surface-2')
                }
              >
                <InterviewerAvatar persona={p} size={120} idleSpin={false} />
                <div>
                  <div className="font-display text-base font-bold text-text-primary">{meta.label}</div>
                  <div className="mt-1 text-xs text-text-muted">{meta.hint}</div>
                </div>
              </button>
            )
          })}
        </div>
      </section>

      {/* Topic + duration */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <h2 className="mb-3 font-display text-lg font-bold text-text-primary">Тема</h2>
          <div className="flex flex-col gap-2">
            {TOPICS.map((t) => {
              const active = topic === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTopic(t.id)}
                  className={
                    'flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors ' +
                    (active
                      ? 'border-accent bg-accent/10'
                      : 'border-border bg-surface-1 hover:border-border-strong hover:bg-surface-2')
                  }
                >
                  <div>
                    <div className="font-display text-sm font-bold text-text-primary">{t.label}</div>
                    <div className="mt-0.5 text-xs text-text-muted">{t.hint}</div>
                  </div>
                  <span
                    className={
                      'h-3 w-3 rounded-full border ' +
                      (active ? 'border-accent bg-accent' : 'border-border-strong bg-transparent')
                    }
                  />
                </button>
              )
            })}
          </div>
        </section>

        <section>
          <h2 className="mb-3 font-display text-lg font-bold text-text-primary">Длительность</h2>
          <div className="flex flex-col gap-2">
            {DURATIONS.map((d) => {
              const active = duration === d
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDuration(d)}
                  className={
                    'flex items-center justify-between rounded-lg border px-4 py-3 transition-colors ' +
                    (active
                      ? 'border-accent bg-accent/10'
                      : 'border-border bg-surface-1 hover:border-border-strong hover:bg-surface-2')
                  }
                >
                  <span className="font-display text-sm font-bold text-text-primary">{d} мин</span>
                  <span className="font-mono text-[11px] text-text-muted">
                    {d === 20 ? '1 кейс' : d === 30 ? '2 кейса' : '3 кейса'}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      </div>

      {/* Start CTA */}
      <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-4 border-t border-border bg-bg/95 px-4 py-4 backdrop-blur sm:-mx-8 sm:px-8">
        <div className="text-xs text-text-muted">
          {startEnabled
            ? 'Микрофон в порядке. Можем начинать.'
            : 'Дай микрофон поработать пару секунд, чтобы убедиться, что слышно.'}
        </div>
        <Button
          size="lg"
          variant="primary"
          icon={<Play className="h-4 w-4" />}
          disabled={!startEnabled}
          onClick={() => onStart({ persona, topic, duration })}
        >
          Начать интервью
        </Button>
      </div>
    </div>
  )
}
