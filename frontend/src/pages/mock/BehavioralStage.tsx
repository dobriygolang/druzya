// BehavioralStage — R2 dedicated surface для Behavioral стадии mock pipeline'а.
//
// Layout:
//   ┌────────────────────────────────────────────────┐
//   │  Question card (one per attempt)               │
//   │   ├ Prompt                                     │
//   │   ├ Voice recorder bar (Record / Pause / Stop) │
//   │   ├ Textarea (live transcript + manual edits)  │
//   │   ├ [Run rubric] + [Submit] buttons            │
//   │   └ STAR breakdown card (post-rubric / submit) │
//   └────────────────────────────────────────────────┘
//
// Voice flow (D7 2026-05-12):
//   - Web Speech API (SpeechRecognition) streams interim transcript into
//     the textarea — user can edit any time.
//   - MediaRecorder is engaged only to gate UI state (and future audio
//     upload); the actual STAR scoring runs on the textarea text via the
//     existing behavioral_grade UC, so we never upload audio.
//   - Graceful degrade: если Speech Recognition не supported (Firefox /
//     Safari < 14.1) — рендерим badge «Voice not supported, type instead»
//     и textarea остаётся primary input'ом.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Mic,
  MicOff,
  Pause,
  Play,
  Square,
  XCircle,
} from 'lucide-react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import {
  useFinishStageMutation,
  useRunBehavioralMutation,
  useSubmitAnswerMutation,
  type BehavioralVerdict,
  type PipelineAttempt,
  type PipelineStage,
} from '../../lib/queries/mockPipeline'

export function BehavioralStage({
  stage,
  pipelineId,
}: {
  stage: PipelineStage
  pipelineId: string
}) {
  const finishStage = useFinishStageMutation(pipelineId)
  const attempts = stage.attempts ?? []
  const allJudged = attempts.every((a) => a.ai_verdict !== 'pending')

  if (attempts.length === 0) {
    return (
      <Card variant="default" padding="lg" className="text-sm text-text-secondary">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4" style={{ color: 'var(--red)' }} />
          <span>
            Для этого этапа ещё не настроены behavioral-вопросы. Попроси админа
            залить default_questions / company_questions.
          </span>
        </div>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {attempts.map((a, i) => (
        <BehavioralQuestionCard
          key={a.id}
          attempt={a}
          pipelineId={pipelineId}
          ordinal={i + 1}
        />
      ))}
      <div className="flex items-center justify-end gap-3 pt-2">
        {!allJudged && (
          <span className="text-xs text-text-secondary">
            Дождись AI-оценки всех ответов
          </span>
        )}
        <Button
          variant="primary"
          size="md"
          iconRight={<ArrowRight className="h-4 w-4" />}
          onClick={() => finishStage.mutate(stage.id)}
          disabled={!allJudged || finishStage.isPending}
          loading={finishStage.isPending}
        >
          Завершить этап
        </Button>
      </div>
    </div>
  )
}

// ── BehavioralQuestionCard ──────────────────────────────────────────────

function BehavioralQuestionCard({
  attempt,
  pipelineId,
  ordinal,
}: {
  attempt: PipelineAttempt
  pipelineId: string
  ordinal: number
}) {
  const submit = useSubmitAnswerMutation(pipelineId)
  const runRubric = useRunBehavioralMutation()
  const [draft, setDraft] = useState<string>('')
  const [rubric, setRubric] = useState<BehavioralVerdict | null>(null)

  const isAnswered = !!(attempt.user_answer_md && attempt.user_answer_md.length > 0)
  const isJudging = isAnswered && attempt.ai_verdict === 'pending'
  const isJudged = isAnswered && attempt.ai_verdict !== 'pending'

  // attempt.kind === 'voice_answer' раньше блокировал ответ. Теперь это
  // просто маркер «вопрос предполагает голосовой ответ» — UI даёт оба
  // флоу: и микрофон, и textarea (типизация / правка). Грейдинг идёт по
  // тексту, поэтому семантически разница для backend'а нулевая.
  const isVoiceAttempt = attempt.kind === 'voice_answer'

  const voice = useVoiceRecorder({
    onInterim: (text) => {
      // Live-режим: при каждом interim'е переписываем хвост драфта.
      setDraft((prev) => {
        const head = prev.endsWith(' ') || prev.length === 0 ? prev : prev + ' '
        return head + text
      })
    },
    onFinal: (text) => {
      // Финальный chunk — фиксируем как часть драфта; пользователь сможет
      // продолжить запись или править руками.
      setDraft((prev) => {
        const head = prev.endsWith(' ') || prev.length === 0 ? prev : prev + ' '
        return (head + text).trim() + ' '
      })
    },
  })

  const handleRunRubric = () => {
    const body = draft.trim()
    if (!body) return
    runRubric.mutate(
      { attemptId: attempt.id, answerText: body },
      {
        onSuccess: (data) => setRubric(data),
      },
    )
  }

  const handleSubmit = () => {
    const body = draft.trim()
    if (!body) return
    // Если запись ещё активна — гасим перед отправкой.
    if (voice.state !== 'idle') voice.stop()
    submit.mutate({ attemptId: attempt.id, userAnswer: body })
  }

  const stars = useMemo(() => {
    if (!rubric || rubric.unavailable) return null
    return [
      { label: 'S', name: 'Situation', value: rubric.axes.situation },
      { label: 'T', name: 'Task', value: rubric.axes.task },
      { label: 'A', name: 'Action', value: rubric.axes.action },
      { label: 'R', name: 'Result', value: rubric.axes.result },
    ]
  }, [rubric])

  return (
    <Card variant="default" padding="lg" className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
          Q{ordinal}
        </span>
        <h3 className="font-display text-base font-bold text-text-primary whitespace-pre-wrap">
          {attempt.question_body ?? '—'}
        </h3>
        {isVoiceAttempt && (
          <span className="flex items-center gap-1 rounded-full border border-border-strong bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
            <Mic className="h-3 w-3" />
            voice
          </span>
        )}
      </div>

      {!isAnswered && (
        <>
          <VoiceRecorderBar voice={voice} disabled={submit.isPending || runRubric.isPending} />

          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            disabled={submit.isPending || runRubric.isPending}
            placeholder={
              voice.supported
                ? 'Расскажи кейс по STAR — нажми «Записать ответ» или печатай вручную…'
                : 'Расскажи кейс по STAR: Situation → Task → Action → Result…'
            }
            className="w-full resize-y border-0 border-b border-solid bg-transparent p-2 text-sm text-text-primary placeholder:text-text-secondary outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-emphasized)] focus:outline-none"
            style={{ borderBottomColor: 'var(--hair-2)' }}
            onFocus={(e) => {
              e.currentTarget.style.borderBottomColor = 'rgb(var(--ink))'
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderBottomColor = 'var(--hair-2)'
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[10px] tracking-[0.08em] text-text-secondary">
              {draft.length} символов
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                icon={<Play className="h-3.5 w-3.5" />}
                onClick={handleRunRubric}
                disabled={runRubric.isPending || submit.isPending || draft.trim().length === 0}
                loading={runRubric.isPending}
              >
                Run rubric
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSubmit}
                disabled={runRubric.isPending || submit.isPending || draft.trim().length === 0}
                loading={submit.isPending}
              >
                Отправить
              </Button>
            </div>
          </div>

          {/* Rubric verdict (pre-submit dry-run) */}
          {runRubric.isPending && (
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>AI разбирает по STAR…</span>
            </div>
          )}
          {!runRubric.isPending && rubric && rubric.unavailable && (
            <div className="relative flex items-start gap-2 rounded-md border border-border-strong bg-surface-1 p-2 pl-3">
              <span
                aria-hidden
                className="absolute left-0 top-0 h-full w-[1.5px] rounded-l-md"
                style={{ background: 'var(--red)' }}
              />
              <AlertCircle
                className="h-4 w-4 shrink-0 mt-0.5"
                style={{ color: 'var(--red)' }}
              />
              <span className="text-xs text-text-secondary">
                Оценка временно недоступна — попробуй ещё раз.
              </span>
            </div>
          )}
          {!runRubric.isPending && rubric && !rubric.unavailable && stars && (
            <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-1 p-3">
              <div className="flex items-center gap-3 flex-wrap">
                {stars.map((s) => (
                  <div key={s.label} className="flex flex-col items-center">
                    <div className="flex items-baseline gap-1">
                      <span className="font-display text-sm font-bold text-text-primary">
                        {s.label}
                      </span>
                      <span className="font-mono text-base text-text-primary tabular-nums">
                        {s.value}
                      </span>
                      <span className="font-mono text-[10px] text-text-secondary">/5</span>
                    </div>
                    <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-text-secondary">
                      {s.name}
                    </span>
                  </div>
                ))}
                <div className="ml-auto flex flex-col items-end">
                  <span className="font-mono text-base text-text-primary tabular-nums">
                    {rubric.communication_score}/5
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-text-secondary">
                    Communication
                  </span>
                </div>
              </div>
              {rubric.body_md && (
                <div className="text-xs text-text-primary whitespace-pre-wrap">
                  {rubric.body_md}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {isAnswered && (
        <div className="flex flex-col gap-2">
          <div className="rounded-md border border-border bg-surface-1 p-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary mb-0.5">
              Твой ответ
            </div>
            <div className="text-sm text-text-primary whitespace-pre-wrap font-mono">
              {attempt.user_answer_md}
            </div>
          </div>
          {isJudging && (
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>AI оценивает…</span>
            </div>
          )}
          {isJudged && <SubmitVerdictPanel attempt={attempt} />}
        </div>
      )}
    </Card>
  )
}

// ── SubmitVerdictPanel ──────────────────────────────────────────────────

function SubmitVerdictPanel({ attempt }: { attempt: PipelineAttempt }) {
  const v = attempt.ai_verdict
  const passed = v === 'pass'
  const Icon = passed ? CheckCircle2 : XCircle
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-text-primary" />
        <span className="font-display text-sm font-bold uppercase text-text-primary">
          {v}
        </span>
        {attempt.ai_score !== null && (
          <span className="font-mono text-sm text-text-primary tabular-nums">
            · {attempt.ai_score}/100
          </span>
        )}
      </div>
      {attempt.ai_feedback_md && (
        <div className="text-xs text-text-primary whitespace-pre-wrap">
          {attempt.ai_feedback_md}
        </div>
      )}
      {attempt.ai_missing_points.length > 0 && (
        <ul className="list-disc list-inside text-xs text-text-secondary space-y-0.5">
          {attempt.ai_missing_points.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── VoiceRecorderBar ────────────────────────────────────────────────────
//
// UI-полоска над textarea: статус (idle / recording / paused), кнопки
// Record / Pause / Resume / Stop, элапс. Цветная точка — единственный
// red-spot во всём флоу (#FF3B30 через .red-pulse).

function VoiceRecorderBar({
  voice,
  disabled,
}: {
  voice: ReturnType<typeof useVoiceRecorder>
  disabled: boolean
}) {
  if (!voice.supported) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-border bg-surface-1 p-2 text-xs text-text-secondary">
        <MicOff className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          Голосовой ввод не поддерживается в этом браузере (Firefox / Safari
          ниже 14.1). Можно напечатать ответ в поле ниже.
        </span>
      </div>
    )
  }

  const isRecording = voice.state === 'recording'
  const isPaused = voice.state === 'paused'
  const elapsed = formatElapsed(voice.elapsedMs)

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-1 p-2">
      <div className="flex items-center gap-2">
        {isRecording ? (
          <span
            aria-hidden
            className="red-pulse inline-block"
            style={{
              width: 4,
              height: 4,
              borderRadius: 99,
              background: 'var(--red)',
            }}
          />
        ) : (
          <Mic className="h-3.5 w-3.5 text-text-secondary" />
        )}
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary tabular-nums">
          {voice.state === 'idle' && 'Голос'}
          {isRecording && `Запись · ${elapsed}`}
          {isPaused && `Пауза · ${elapsed}`}
        </span>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {voice.state === 'idle' && (
          <Button
            variant="ghost"
            size="sm"
            icon={<Mic className="h-3.5 w-3.5" />}
            onClick={voice.start}
            disabled={disabled}
          >
            Записать ответ
          </Button>
        )}
        {isRecording && (
          <>
            <Button
              variant="ghost"
              size="sm"
              icon={<Pause className="h-3.5 w-3.5" />}
              onClick={voice.pause}
              disabled={disabled}
            >
              Пауза
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Square className="h-3.5 w-3.5" />}
              onClick={voice.stop}
              disabled={disabled}
            >
              Стоп
            </Button>
          </>
        )}
        {isPaused && (
          <>
            <Button
              variant="ghost"
              size="sm"
              icon={<Mic className="h-3.5 w-3.5" />}
              onClick={voice.resume}
              disabled={disabled}
            >
              Продолжить
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Square className="h-3.5 w-3.5" />}
              onClick={voice.stop}
              disabled={disabled}
            >
              Стоп
            </Button>
          </>
        )}
      </div>

      {voice.error && (
        <div className="basis-full text-xs" style={{ color: 'var(--red)' }}>
          {voice.error}
        </div>
      )}
    </div>
  )
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

// ── useVoiceRecorder ────────────────────────────────────────────────────
//
// Тонкая обёртка над Web Speech API (SpeechRecognition) + MediaRecorder.
//   - SpeechRecognition даёт live transcript (interim + final).
//   - MediaRecorder нужен только для микрофонного gesture (нативный
//     permission prompt + индикатор записи в браузере). Аудио НЕ
//     аплоадим — грейдинг по тексту.
//   - Browser support: Chrome / Edge / Opera полностью; Safari 14.1+
//     supports SpeechRecognition но prefixed webkit. Firefox не
//     supports — graceful degrade на typing-only.

type VoiceState = 'idle' | 'recording' | 'paused'

interface UseVoiceRecorderProps {
  onInterim?: (text: string) => void
  onFinal?: (text: string) => void
}

function useVoiceRecorder({ onInterim, onFinal }: UseVoiceRecorderProps) {
  const supported = useMemo(() => isSpeechRecognitionSupported(), [])
  const [state, setState] = useState<VoiceState>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const startTsRef = useRef<number | null>(null)
  const accumulatedMsRef = useRef<number>(0)
  const tickRef = useRef<number | null>(null)
  // Stash latest callbacks so the recognition handler always sees fresh
  // closures без необходимости пересоздавать SpeechRecognition.
  const onInterimRef = useRef(onInterim)
  const onFinalRef = useRef(onFinal)
  useEffect(() => {
    onInterimRef.current = onInterim
    onFinalRef.current = onFinal
  }, [onInterim, onFinal])

  // Стейт держим в ref, чтобы recognition.onend мог решать «нужно ли
  // авто-рестарт» по актуальному значению, а не по closure'ному.
  const stateRef = useRef<VoiceState>('idle')
  useEffect(() => {
    stateRef.current = state
  }, [state])

  // Timer.
  useEffect(() => {
    if (state !== 'recording') {
      if (tickRef.current !== null) {
        window.clearInterval(tickRef.current)
        tickRef.current = null
      }
      return
    }
    tickRef.current = window.setInterval(() => {
      const base = accumulatedMsRef.current
      const since = startTsRef.current ? Date.now() - startTsRef.current : 0
      setElapsedMs(base + since)
    }, 250)
    return () => {
      if (tickRef.current !== null) {
        window.clearInterval(tickRef.current)
        tickRef.current = null
      }
    }
  }, [state])

  const cleanup = () => {
    try {
      recognitionRef.current?.stop()
    } catch {
      // ignore — recognition might already be stopped
    }
    recognitionRef.current = null
    try {
      recorderRef.current?.stop()
    } catch {
      // ignore
    }
    recorderRef.current = null
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop())
    mediaStreamRef.current = null
  }

  useEffect(() => cleanup, [])

  const start = async () => {
    if (!supported) {
      setError('Голосовой ввод не поддерживается этим браузером')
      return
    }
    setError(null)
    try {
      // Request microphone (triggers permission prompt + browser recording indicator).
      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true })
      try {
        // MediaRecorder строго не нужен для текста, но создание объекта
        // ничего не стоит и даёт нам канал для будущего audio upload.
        recorderRef.current = new MediaRecorder(mediaStreamRef.current)
        recorderRef.current.start()
      } catch {
        // MediaRecorder может отсутствовать в старых браузерах — это ок,
        // мы всё ещё имеем стрим и SpeechRecognition.
        recorderRef.current = null
      }

      // SpeechRecognition.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctor =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).SpeechRecognition ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).webkitSpeechRecognition
      const rec = new Ctor()
      rec.lang = pickLang()
      rec.continuous = true
      rec.interimResults = true
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rec.onresult = (e: any) => {
        let interimChunk = ''
        let finalChunk = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]
          if (r.isFinal) finalChunk += r[0].transcript
          else interimChunk += r[0].transcript
        }
        if (finalChunk) onFinalRef.current?.(finalChunk)
        else if (interimChunk) onInterimRef.current?.(interimChunk)
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rec.onerror = (e: any) => {
        // 'no-speech' / 'aborted' — мягкие, не выводим юзеру.
        if (e.error && e.error !== 'no-speech' && e.error !== 'aborted') {
          setError(`Ошибка распознавания: ${e.error}`)
        }
      }
      rec.onend = () => {
        // Авто-end: если мы всё ещё в recording — перезапускаем,
        // иначе оставляем state как есть.
        if (recognitionRef.current === rec && stateRef.current === 'recording') {
          try {
            rec.start()
          } catch {
            // ignore — recognition could already be restarted by browser
          }
        }
      }
      recognitionRef.current = rec
      rec.start()

      accumulatedMsRef.current = 0
      startTsRef.current = Date.now()
      setElapsedMs(0)
      setState('recording')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setError(e?.message ?? 'Не удалось включить микрофон')
      cleanup()
      setState('idle')
    }
  }

  const pause = () => {
    if (state !== 'recording') return
    try {
      recognitionRef.current?.stop()
    } catch {
      // ignore
    }
    try {
      recorderRef.current?.pause?.()
    } catch {
      // ignore — recorder may not support pause
    }
    if (startTsRef.current !== null) {
      accumulatedMsRef.current += Date.now() - startTsRef.current
      startTsRef.current = null
    }
    setState('paused')
  }

  const resume = () => {
    if (state !== 'paused') return
    try {
      recognitionRef.current?.start()
    } catch {
      // already started
    }
    try {
      recorderRef.current?.resume?.()
    } catch {
      // ignore
    }
    startTsRef.current = Date.now()
    setState('recording')
  }

  const stop = () => {
    cleanup()
    if (startTsRef.current !== null) {
      accumulatedMsRef.current += Date.now() - startTsRef.current
      startTsRef.current = null
    }
    setState('idle')
  }

  return { state, elapsedMs, error, supported, start, pause, resume, stop }
}

function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false
  return !!(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).SpeechRecognition ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).webkitSpeechRecognition
  )
}

function pickLang(): string {
  if (typeof navigator === 'undefined') return 'ru-RU'
  // Default to ru-RU for druz9 audience; fallback to en-US.
  const nav = navigator.language || 'ru-RU'
  if (nav.toLowerCase().startsWith('ru')) return 'ru-RU'
  if (nav.toLowerCase().startsWith('en')) return 'en-US'
  return 'ru-RU'
}
