// DiagnosticPage — F8 (Phase D) Mock diagnostic mode.
//
// Route: /mock/diagnostic
//
// Flow:
//   1. Intro — explain what + budget + track picker (default goal-track)
//   2. Algo — multi-choice question, no clock pressure (juзер сам контролит)
//   3. SysDesign — open-text answer, hint visible, keyword-based grading
//   4. Result — composite score, factor contribution, CTA back to /today
//
// MVP design: minimal cognitive load. Юзер не должен «провалить» mini-mock —
// цель собрать signal, не stress test. Поэтому без countdown timer
// (опционально может появиться в future), feedback после каждого answer'а,
// и положительный tone в result page даже при low score.
//
// Identity: «we ranking-proxy» — questions handpicked, не свой content в
// classroom sense. Mini-mock — evaluation, not learning surface.

import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Brain, CheckCircle, Sparkles, Target } from 'lucide-react'

import { AppShellV2 } from '../../components/AppShell'
import { Button } from '../../components/Button'
import {
  gradeAlgo,
  gradeSysDesign,
  pickQuestions,
  saveResult,
  type MiniMockResult,
  type MiniMockTrack,
} from '../../lib/miniMock'

type Step = 'intro' | 'algo' | 'sysdesign' | 'result'

const TRACK_LABELS: Record<MiniMockTrack, string> = {
  go: 'Go senior',
  ml: 'ML engineering',
  english: 'English fluency',
}

export default function DiagnosticPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('intro')
  const [track, setTrack] = useState<MiniMockTrack>('go')

  // Lock the picked questions once mock starts (так что page reload не
  // ротатит вопросы в середине прохождения).
  const [questions, setQuestions] = useState(() => pickQuestions(track))

  // Algo state
  const [algoChosen, setAlgoChosen] = useState<number | null>(null)
  const [algoReveal, setAlgoReveal] = useState(false)
  // SysDesign state
  const [sdAnswer, setSdAnswer] = useState('')
  // Result
  const [result, setResult] = useState<MiniMockResult | null>(null)

  const start = (t: MiniMockTrack) => {
    setTrack(t)
    setQuestions(pickQuestions(t))
    setStep('algo')
  }

  const submitAlgo = () => {
    if (algoChosen === null) return
    setAlgoReveal(true)
  }

  const goSysDesign = () => {
    setStep('sysdesign')
  }

  const finish = () => {
    const algoScore = gradeAlgo(questions.algo, algoChosen ?? -1)
    const sd = gradeSysDesign(questions.sysdesign, sdAnswer)
    const overall = (algoScore + sd.score) / 2
    const now = Date.now()
    const today = new Date()
    const composed: MiniMockResult = {
      takenOn: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
      takenAt: now,
      track,
      algo: {
        questionId: questions.algo.id,
        chosenIndex: algoChosen ?? -1,
        correct: algoChosen === questions.algo.correctIndex,
        score: algoScore,
      },
      sysdesign: {
        questionId: questions.sysdesign.id,
        answerText: sdAnswer,
        hits: sd.hits,
        total: sd.total,
        score: sd.score,
      },
      overallScore: Math.round(overall * 10) / 10,
    }
    saveResult(composed)
    setResult(composed)
    setStep('result')
  }

  return (
    <AppShellV2>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 sm:px-8 sm:py-14">
        <Stepper step={step} />
        {step === 'intro' && <IntroPanel onStart={start} />}
        {step === 'algo' && (
          <AlgoPanel
            q={questions.algo}
            chosen={algoChosen}
            onChoose={setAlgoChosen}
            reveal={algoReveal}
            onSubmit={submitAlgo}
            onNext={goSysDesign}
          />
        )}
        {step === 'sysdesign' && (
          <SysDesignPanel
            q={questions.sysdesign}
            value={sdAnswer}
            onChange={setSdAnswer}
            onFinish={finish}
          />
        )}
        {step === 'result' && result && (
          <ResultPanel result={result} onDone={() => navigate('/today')} />
        )}
      </div>
    </AppShellV2>
  )
}

// ────────────────────────────────────────────────────────────────────────

function Stepper({ step }: { step: Step }) {
  const stages: Step[] = ['intro', 'algo', 'sysdesign', 'result']
  const labels: Record<Step, string> = {
    intro: 'Intro',
    algo: 'Algo',
    sysdesign: 'SysDesign',
    result: 'Результат',
  }
  const currentIdx = stages.indexOf(step)
  return (
    <ol className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em]">
      {stages.map((s, i) => (
        <li
          key={s}
          className={`flex items-center gap-2 ${
            i === currentIdx
              ? 'text-text-primary'
              : i < currentIdx
                ? 'text-text-secondary'
                : 'text-text-muted'
          }`}
        >
          <span
            className={`grid h-5 w-5 place-items-center rounded-full border text-[9px] ${
              i === currentIdx
                ? 'border-text-primary text-text-primary'
                : i < currentIdx
                  ? 'border-text-secondary text-text-secondary'
                  : 'border-border text-text-muted'
            }`}
          >
            {i < currentIdx ? '✓' : i + 1}
          </span>
          {labels[s]}
          {i < stages.length - 1 && <span className="text-text-muted">·</span>}
        </li>
      ))}
    </ol>
  )
}

function IntroPanel({ onStart }: { onStart: (t: MiniMockTrack) => void }) {
  return (
    <section className="flex flex-col gap-5 rounded-xl border border-border bg-surface-1 p-6">
      <header className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-text-primary" />
        <h1 className="font-display text-xl font-bold leading-tight">
          Mini-mock · self-check
        </h1>
      </header>
      <p className="text-[13.5px] leading-relaxed text-text-secondary">
        Один algo вопрос + один sysdesign в формате честной самооценки.
        Бюджет — 20 минут. Никакого таймера, никакого «провалил/прошёл».
        Цель — дать AI правдивый сигнал о текущем уровне, чтобы
        readiness и daily план учитывали реальность, не угадайки.
      </p>
      <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          Выбери трек
        </span>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(TRACK_LABELS) as MiniMockTrack[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onStart(t)}
              className="rounded-md border border-border bg-bg px-4 py-2 text-[13px] font-semibold text-text-primary transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-emphasized)] hover:border-border-strong"
            >
              {TRACK_LABELS[t]}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[11.5px] italic text-text-muted">
        Результат повлияет на твою F3 readiness (±10–15%) и daily plan
        на 14 дней. Дальше можно перепройти когда захочешь — новый
        результат заменит старый.
      </p>
    </section>
  )
}

function AlgoPanel({
  q,
  chosen,
  onChoose,
  reveal,
  onSubmit,
  onNext,
}: {
  q: ReturnType<typeof pickQuestions>['algo']
  chosen: number | null
  onChoose: (i: number) => void
  reveal: boolean
  onSubmit: () => void
  onNext: () => void
}) {
  const isCorrect = chosen === q.correctIndex
  return (
    <section className="flex flex-col gap-5 rounded-xl border border-border bg-surface-1 p-6">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            Algo · 1 из 2 · {q.difficulty}
          </span>
          <h2 className="font-display text-base font-bold leading-snug">{q.prompt}</h2>
        </div>
      </header>
      <ol className="flex flex-col gap-2">
        {q.options.map((opt, i) => {
          const picked = chosen === i
          const correct = reveal && i === q.correctIndex
          const wrong = reveal && picked && i !== q.correctIndex
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => !reveal && onChoose(i)}
                disabled={reveal}
                className={`relative w-full rounded-md border px-4 py-3 text-left text-[13.5px] transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-emphasized)] ${
                  correct
                    ? 'border-border-strong bg-text-primary/10 text-text-primary'
                    : wrong
                      ? 'border-border bg-surface-2 text-text-secondary line-through'
                      : picked
                        ? 'border-border-strong bg-text-primary/5 text-text-primary'
                        : 'border-border bg-surface-2 text-text-secondary hover:border-border-strong hover:text-text-primary'
                }`}
              >
                {picked && !reveal && (
                  <span
                    aria-hidden
                    className="absolute left-0 top-0 h-full w-[1.5px] rounded-l-md"
                    style={{ background: 'var(--red)' }}
                  />
                )}
                <span className="font-mono text-[10px] tracking-[0.08em] text-text-muted">
                  {String.fromCharCode(65 + i)}.
                </span>{' '}
                {opt}
              </button>
            </li>
          )
        })}
      </ol>
      {reveal && (
        <div
          className={`relative rounded-md border bg-surface-2 p-4 ${
            isCorrect ? 'border-border' : 'border-border'
          }`}
        >
          {!isCorrect && (
            <span
              aria-hidden
              className="absolute left-0 top-0 h-full w-[1.5px] rounded-l-md"
              style={{ background: 'var(--red)' }}
            />
          )}
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            {isCorrect ? '✓ верно' : 'правильный — ' + String.fromCharCode(65 + q.correctIndex)}
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-text-primary">{q.explanation}</p>
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/today"
          className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted hover:text-text-primary"
        >
          ← отменить
        </Link>
        {!reveal ? (
          <Button variant="primary" size="sm" onClick={onSubmit} disabled={chosen === null}>
            Ответить
          </Button>
        ) : (
          <Button variant="primary" size="sm" iconRight={<ArrowRight className="h-3.5 w-3.5" />} onClick={onNext}>
            Дальше · SysDesign
          </Button>
        )}
      </div>
    </section>
  )
}

function SysDesignPanel({
  q,
  value,
  onChange,
  onFinish,
}: {
  q: ReturnType<typeof pickQuestions>['sysdesign']
  value: string
  onChange: (v: string) => void
  onFinish: () => void
}) {
  const wordCount = useMemo(() => value.trim().split(/\s+/).filter(Boolean).length, [value])
  const isShort = wordCount < 20
  return (
    <section className="flex flex-col gap-5 rounded-xl border border-border bg-surface-1 p-6">
      <header className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          SysDesign · 2 из 2 · open-text
        </span>
        <h2 className="font-display text-base font-bold leading-snug">{q.prompt}</h2>
      </header>
      <p className="rounded-md border border-dashed border-border bg-surface-2 p-3 text-[12px] italic text-text-muted">
        Hint · {q.hint}
      </p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Распиши подход. Можешь по пунктам — bullet'ы / связный текст. Грейдинг идёт по ключевым концептам, не по красоте."
        rows={10}
        className="w-full resize-none border-0 border-b border-solid bg-transparent px-1 py-2.5 text-[13px] leading-relaxed text-text-primary placeholder:text-text-muted outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-emphasized)] focus:outline-none"
        style={{ borderBottomColor: 'var(--hair-2)' }}
        onFocus={(e) => {
          e.currentTarget.style.borderBottomColor = 'rgb(var(--ink))'
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderBottomColor = 'var(--hair-2)'
        }}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[11px] text-text-muted">
          {wordCount} {pluralWords(wordCount)}
          {isShort && ' · короткий ответ → low coverage'}
        </span>
        <Button
          variant="primary"
          size="sm"
          iconRight={<CheckCircle className="h-3.5 w-3.5" />}
          onClick={onFinish}
          disabled={value.trim().length === 0}
        >
          Завершить mini-mock
        </Button>
      </div>
    </section>
  )
}

function ResultPanel({ result, onDone }: { result: MiniMockResult; onDone: () => void }) {
  const total = result.overallScore
  const tier =
    total >= 4
      ? 'solid'
      : total >= 3
        ? 'baseline'
        : total >= 2
          ? 'gaps'
          : 'critical'
  const tierColor = tier === 'solid' || tier === 'baseline' ? 'text-text-primary' : 'text-text-secondary'
  return (
    <section className="flex flex-col gap-5 rounded-xl border border-border bg-surface-1 p-6">
      <header className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-text-primary" />
        <h1 className="font-display text-xl font-bold leading-tight">Mini-mock завершён</h1>
      </header>
      <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className={`font-display text-4xl font-bold tabular-nums ${tierColor}`}>
            {total.toFixed(1)}
            <span className="text-text-muted">/5</span>
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            {tier}
          </span>
        </div>
        <div className="text-[12.5px] text-text-secondary">
          Algo {result.algo.score.toFixed(1)}/5
          {result.algo.correct ? ' · верно' : ' · мимо'}
          {' · '}
          SysDesign {result.sysdesign.score.toFixed(1)}/5
          {result.sysdesign.total > 0 && ` · ${result.sysdesign.hits.length}/${result.sysdesign.total} ключевых пунктов`}
        </div>
      </div>

      {result.sysdesign.hits.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            Покрыл
          </span>
          <div className="flex flex-wrap gap-1.5">
            {result.sysdesign.hits.map((h) => (
              <span
                key={h}
                className="inline-flex items-center rounded-sm border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-text-primary"
              >
                {h}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-md border border-border bg-surface-2 p-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          F3 readiness
        </span>
        <p className="mt-1 text-[13px] leading-relaxed text-text-primary">
          {factorExplanation(total)} Сигнал держится 14 дней, потом устаревает —
          перепрой mini-mock когда захочешь обновить.
        </p>
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button variant="primary" size="sm" iconRight={<Target className="h-3.5 w-3.5" />} onClick={onDone}>
          Вернуться на Today
        </Button>
      </div>
    </section>
  )
}

function factorExplanation(score: number): string {
  if (score >= 4) return `Strong baseline +15% к readiness — fundamentals на месте.`
  if (score >= 3) return `OK baseline +5% — есть с чем работать, но не критично.`
  if (score >= 2) return `Gaps выявлены −5% — daily план поставит акценты на слабые места.`
  return `Критический gap −10% — рекомендуем плотно зайти в фокусную тему до следующего mini-mock.`
}

function pluralWords(n: number): string {
  if (n === 1) return 'слово'
  if (n >= 2 && n <= 4) return 'слова'
  return 'слов'
}
