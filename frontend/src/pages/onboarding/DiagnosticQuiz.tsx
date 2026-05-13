// Flow:
//   /diagnostic       → quiz step (progress bar + Q + 4-option picker)
//   on answer 8       → resolve() → store result + suggest goal preset
//   /diagnostic/done  → 3 action cards + goal preset acceptance CTA
//
// Persistence: answers progress-saved on each pick (юзер может закрыть таб
// и вернуться). Result + accepted goal flow в localStorage F2 store
// (см lib/goal.ts), не теряются после accept.
//
// Done step: hairline goal card + hairline action cards.

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, BookOpen, Sparkles, Map as MapIcon, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  getQuestionsForTrack,
  resolveDiagnostic,
  saveProgress,
  loadProgress,
  clearProgress,
  saveResult,
  loadResult,
  saveTrack,
  loadTrack,
  clearTrack,
  TRACK_LABELS,
  type AnswerMap,
  type DiagnosticAction,
  type DiagnosticQuestion,
  type DiagnosticResult,
  type DiagnosticTrack,
} from '../../lib/diagnostic'
import { setGoal, formatGoal, type UserGoal } from '../../lib/goal'

const KIND_ICON: Record<DiagnosticAction['kind'], typeof Sparkles> = {
  mock: Sparkles,
  atlas: MapIcon,
  codex: BookOpen,
  external: ExternalLink,
}

const captionMono: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-40)',
}

const primaryPill: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 22px',
  background: 'rgb(var(--ink))',
  color: 'rgb(var(--color-bg))',
  border: 0,
  borderRadius: 'var(--radius-inner)',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
  textDecoration: 'none',
  transition:
    'background-color var(--motion-dur-small) var(--motion-ease-standard), opacity var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
}

const ghostPill: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 18px',
  background: 'transparent',
  color: 'var(--ink-60)',
  border: '1px solid var(--hair-2)',
  borderRadius: 'var(--radius-inner)',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
  textDecoration: 'none',
  transition:
    'background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
}

// MinimalShell — onboarding-style layout без auth-gated AppShellV2.
// DiagnosticQuiz интенциально работает для unauth юзера (new user funnel):
// AppShellV2 дёргает useAdminDashboardQuery / useUnreadCountQuery, обе
// требуют bearer'а → 401 → apiClient редиректит на /welcome. F9 — pure
// client-side flow поверх localStorage, auth ему не нужен.
function MinimalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen text-text-primary" style={{ background: 'rgb(var(--color-bg))' }}>
      <header
        className="flex items-center px-4 sm:px-8 lg:px-20"
        style={{ height: 64, borderBottom: '1px solid var(--hair)' }}
      >
        <Link to="/" className="flex items-center gap-2.5 focus-ring">
          <span
            className="grid place-items-center"
            style={{
              width: 28,
              height: 28,
              border: '1px solid var(--hair-2)',
              borderRadius: 8,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontWeight: 600,
              fontSize: 14,
              color: 'rgb(var(--ink))',
            }}
          >
            9
          </span>
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: '-0.005em',
              color: 'rgb(var(--ink))',
            }}
          >
            druz9
          </span>
        </Link>
      </header>
      {children}
    </div>
  )
}

export default function DiagnosticQuiz() {
  const { t } = useTranslation('onboarding')
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const step = params.get('step') // 'done' OR 'pick-track' OR null (quiz mode)

  // F9 multi-track: hydrate track из localStorage. URL ?track= override
  // (для deep-link); если нет ни того ни другого → показываем picker.
  const urlTrack = params.get('track') as DiagnosticTrack | null
  const VALID_TRACKS: DiagnosticTrack[] = ['go', 'ml', 'english']
  const initialTrack: DiagnosticTrack | null =
    urlTrack && VALID_TRACKS.includes(urlTrack) ? urlTrack : loadTrack()
  const [track, setTrack] = useState<DiagnosticTrack | null>(initialTrack)

  // Hydrate from localStorage so reload mid-quiz не теряет прогресс.
  const [answers, setAnswers] = useState<AnswerMap>(() => loadProgress())
  const [idx, setIdx] = useState(0)
  const [result, setResult] = useState<DiagnosticResult | null>(() => loadResult())

  // Restart on visit if прошлый result уже принят — let user retake.
  const isDoneMode = step === 'done'
  const needsTrackPicker = !track && !isDoneMode

  useEffect(() => {
    saveProgress(answers)
  }, [answers])

  const onPickTrack = (next: DiagnosticTrack) => {
    setTrack(next)
    saveTrack(next)
    // Reset progress если меняем track (вопросы разные — старые ответы
    // могут поломать resolver на ML/English).
    clearProgress()
    setAnswers({})
    setIdx(0)
  }

  // Track-aware questions. Если track ещё не выбран — пустой array
  // (мы покажем picker, не вопросы). Wrapped in useMemo чтобы reference
  // stable между renders (иначе allAnswered useMemo дёргается зря).
  const questions = useMemo(
    () => (track ? getQuestionsForTrack(track) : []),
    [track],
  )
  const question = questions[idx]
  const total = questions.length
  const picked = question ? answers[question.id] : undefined
  const isLast = total > 0 && idx === total - 1
  const allAnswered = useMemo(
    () => total > 0 && questions.every((q) => answers[q.id]),
    [answers, questions, total],
  )

  const onPick = (qid: string, optionId: string) => {
    setAnswers((prev) => ({ ...prev, [qid]: optionId }))
  }

  const goNext = () => {
    if (!picked || !track) return
    if (isLast) {
      // All 8 answered → resolve + persist result + jump to done step.
      const resolved = resolveDiagnostic(answers, track)
      saveResult(resolved)
      setResult(resolved)
      navigate('/diagnostic?step=done', { replace: false })
    } else {
      setIdx((i) => Math.min(total - 1, i + 1))
    }
  }

  const goBack = () => setIdx((i) => Math.max(0, i - 1))

  const onRetake = () => {
    clearProgress()
    clearTrack()
    setAnswers({})
    setResult(null)
    setIdx(0)
    setTrack(null)
    navigate('/diagnostic', { replace: true })
  }

  if (isDoneMode) {
    if (!result) {
      // Direct nav к /diagnostic?step=done без прохождения — bounce обратно.
      return (
        <MinimalShell>
          <div className="mx-auto px-4 py-10" style={{ maxWidth: 640 }}>
            <p style={{ fontSize: 14, color: 'var(--ink-60)' }}>{t('quiz.no_result_msg')}</p>
            <div style={{ marginTop: 16 }}>
              <button
                type="button"
                onClick={() => navigate('/diagnostic', { replace: true })}
                className="focus-ring motion-press"
                style={primaryPill}
              >
                {t('quiz.no_result_cta')}
              </button>
            </div>
          </div>
        </MinimalShell>
      )
    }
    return <DoneStep result={result} onRetake={onRetake} />
  }

  // F9 multi-track: показываем picker если track ещё не выбран. Иначе
  // обычный quiz flow с track-specific вопросами.
  if (needsTrackPicker) {
    return <TrackPickerStep onPick={onPickTrack} />
  }

  return (
    <MinimalShell>
      <div className="mx-auto flex w-full flex-col px-4 py-10 sm:py-14" style={{ maxWidth: 640, gap: 24 }}>
        <header className="flex flex-col" style={{ gap: 10 }}>
          <Link
            to="/today"
            className="focus-ring"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              alignSelf: 'flex-start',
              fontSize: 12,
              color: 'var(--ink-60)',
              textDecoration: 'none',
              padding: '4px 8px',
              borderRadius: 6,
              transition: 'color var(--motion-dur-small) var(--motion-ease-standard)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'rgb(var(--ink))')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-60)')}
          >
            <ArrowLeft style={{ width: 12, height: 12 }} /> Today
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <h1
              style={{
                margin: 0,
                fontSize: 'var(--type-h1-size)',
                lineHeight: 'var(--type-h1-lh)',
                letterSpacing: 'var(--type-h1-ls)',
                fontWeight: 'var(--type-h1-weight)',
                color: 'rgb(var(--ink))',
              }}
            >
              {track ? t('quiz.title_with_track', { label: TRACK_LABELS[track].label }) : t('quiz.title_base')}
            </h1>
            {track && (
              <button
                type="button"
                onClick={() => {
                  clearTrack()
                  clearProgress()
                  setAnswers({})
                  setIdx(0)
                  setTrack(null)
                }}
                className="focus-ring"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--hair-2)',
                  borderRadius: 6,
                  padding: '4px 10px',
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-60)',
                  cursor: 'pointer',
                }}
                title={t('quiz.change_track_tooltip')}
              >
                {t('quiz.change_track_cta')}
              </button>
            )}
          </div>
          <p style={{ margin: 0, fontSize: 'var(--type-body-size)', lineHeight: 'var(--type-body-lh)', color: 'var(--ink-60)' }}>
            {t('quiz.subhead')}
          </p>
          <ProgressBar current={idx + 1} total={total} answered={Object.keys(answers).length} />
        </header>

        {question && (
          <QuestionCard
            question={question}
            picked={picked}
            onPick={(opt) => onPick(question.id, opt)}
          />
        )}

        <footer className="flex-wrap-row" style={{ alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <button
            type="button"
            onClick={goBack}
            disabled={idx === 0}
            className="focus-ring motion-press"
            style={{ ...ghostPill, opacity: idx === 0 ? 0.5 : 1, cursor: idx === 0 ? 'not-allowed' : 'pointer' }}
          >
            <ArrowLeft style={{ width: 16, height: 16 }} /> {t('quiz.btn_back')}
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={!picked}
            className="focus-ring motion-press"
            style={{ ...primaryPill, opacity: !picked ? 0.5 : 1, cursor: !picked ? 'not-allowed' : 'pointer' }}
          >
            {isLast ? t('quiz.btn_get_plan') : t('quiz.btn_next', { current: idx + 1, total })} <ArrowRight style={{ width: 16, height: 16 }} />
          </button>
        </footer>

        {allAnswered && !isLast && (
          <p style={{ margin: 0, textAlign: 'center', fontSize: 12, color: 'var(--ink-40)' }}>
            {t('quiz.all_answered_pre')}{' '}
            <button
              type="button"
              onClick={() => setIdx(total - 1)}
              className="focus-ring"
              style={{
                background: 'transparent',
                border: 0,
                padding: '2px 4px',
                color: 'var(--ink-60)',
                textDecoration: 'underline',
                cursor: 'pointer',
                fontSize: 'inherit',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'rgb(var(--ink))')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-60)')}
            >
              {t('quiz.all_answered_link')}
            </button>
            .
          </p>
        )}
      </div>
    </MinimalShell>
  )
}

// F9 multi-track: track picker step. Renders 3 cards (Go / ML / English)
// with hairline visual treatment matching new quiz design. Active card
// gets red 1.5px top stripe per B/W rule.
function TrackPickerStep({ onPick }: { onPick: (track: DiagnosticTrack) => void }) {
  const { t } = useTranslation('onboarding')
  return (
    <MinimalShell>
      <div className="mx-auto flex w-full flex-col px-4 py-10 sm:py-14" style={{ maxWidth: 640, gap: 24 }}>
        <header className="flex flex-col" style={{ gap: 10 }}>
          <span style={captionMono}>{t('quiz.picker_eyebrow')}</span>
          <h1
            style={{
              margin: 0,
              fontSize: 'var(--type-h1-size)',
              lineHeight: 'var(--type-h1-lh)',
              letterSpacing: 'var(--type-h1-ls)',
              fontWeight: 'var(--type-h1-weight)',
              color: 'rgb(var(--ink))',
            }}
          >
            {t('quiz.picker_title')}
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-lh)',
              color: 'var(--ink-60)',
            }}
          >
            {t('quiz.picker_subtitle')}
          </p>
        </header>

        <div className="flex flex-col" style={{ gap: 10 }}>
          {(Object.entries(TRACK_LABELS) as [DiagnosticTrack, { label: string; hint: string }][]).map(
            ([id, info]) => (
              <button
                key={id}
                type="button"
                onClick={() => onPick(id)}
                className="focus-ring motion-press"
                style={{
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 6,
                  padding: '14px 16px',
                  background: 'transparent',
                  border: '1px solid var(--hair-2)',
                  borderRadius: 'var(--radius-inner)',
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: 'rgb(var(--ink))',
                  transition:
                    'border-color var(--motion-dur-small) var(--motion-ease-standard), background-color var(--motion-dur-small) var(--motion-ease-standard)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.22)'
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--hair-2)'
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.005em' }}>
                  {info.label}
                </span>
                <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--ink-60)' }}>
                  {info.hint}
                </span>
              </button>
            ),
          )}
        </div>
      </div>
    </MinimalShell>
  )
}

function ProgressBar({ current, total, answered }: { current: number; total: number; answered: number }) {
  const { t } = useTranslation('onboarding')
  const pct = Math.round((answered / total) * 100)
  return (
    <div className="flex flex-col" style={{ gap: 6 }}>
      <div className="flex items-center justify-between" style={{ ...captionMono, fontSize: 10 }}>
        <span>{t('quiz.progress_question', { current, total })}</span>
        <span>{t('quiz.progress_answered', { answered, total })}</span>
      </div>
      <div style={{ height: 2, width: '100%', overflow: 'hidden', borderRadius: 999, background: 'var(--hair-2)' }}>
        <div
          style={{
            height: '100%',
            background: 'rgb(var(--ink))',
            transition: 'width var(--motion-dur-medium) var(--motion-ease-emphasized)',
            width: `${pct}%`,
          }}
        />
      </div>
    </div>
  )
}

function QuestionCard({
  question,
  picked,
  onPick,
}: {
  question: DiagnosticQuestion
  picked: string | undefined
  onPick: (optionId: string) => void
}) {
  return (
    <div
      style={{
        padding: 24,
        border: '1px solid var(--hair-2)',
        borderRadius: 'var(--radius-outer)',
        background: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: 'var(--type-h3-size)',
          lineHeight: 'var(--type-h3-lh)',
          letterSpacing: 'var(--type-h3-ls)',
          fontWeight: 'var(--type-h3-weight)',
          color: 'rgb(var(--ink))',
        }}
      >
        {question.text}
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
        {question.options.map((opt) => {
          const active = picked === opt.id
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onPick(opt.id)}
              aria-pressed={active}
              className="focus-ring motion-press"
              style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 4,
                padding: '12px 16px',
                borderRadius: 'var(--radius-inner)',
                border: active ? '1.5px solid rgb(var(--ink))' : '1px solid var(--hair-2)',
                background: active ? 'rgba(255, 255, 255, 0.04)' : 'transparent',
                textAlign: 'left',
                cursor: 'pointer',
                color: 'rgb(var(--ink))',
                transition:
                  'background-color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
              }}
            >
              {active && (
                <span
                  aria-hidden="true"
                  style={{ position: 'absolute', top: 12, right: 16, width: 24, height: 1.5, background: 'var(--red)' }}
                />
              )}
              <span style={{ fontSize: 14, fontWeight: 500, letterSpacing: '-0.005em', color: 'rgb(var(--ink))' }}>
                {opt.label}
              </span>
              {opt.hint && (
                <span style={{ fontSize: 12, color: 'var(--ink-60)', lineHeight: 1.5 }}>{opt.hint}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function DoneStep({ result, onRetake }: { result: DiagnosticResult; onRetake: () => void }) {
  const { t } = useTranslation('onboarding')
  const navigate = useNavigate()
  const [goalAccepted, setGoalAccepted] = useState(false)

  const proposedGoal: UserGoal = useMemo(
    () => ({
      ...result.goalDraft,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
    [result.goalDraft],
  )

  const acceptGoal = () => {
    setGoal(proposedGoal)
    setGoalAccepted(true)
  }

  return (
    <MinimalShell>
      <div className="mx-auto flex w-full flex-col px-4 py-10 sm:py-14" style={{ maxWidth: 640, gap: 24 }}>
        <header className="flex flex-col" style={{ gap: 10 }}>
          <div style={{ ...captionMono, display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            {/* Red signal dot — quiz complete, live state. */}
            <span aria-hidden="true" style={{ display: 'inline-block', width: 5, height: 5, borderRadius: 999, background: 'var(--red)' }} />
            <span>{t('quiz.done_eyebrow')}</span>
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 'var(--type-h1-size)',
              lineHeight: 'var(--type-h1-lh)',
              letterSpacing: 'var(--type-h1-ls)',
              fontWeight: 'var(--type-h1-weight)',
              color: 'rgb(var(--ink))',
            }}
          >
            {t('quiz.done_title')}
          </h1>
          <p style={{ margin: 0, fontSize: 'var(--type-body-size)', lineHeight: 'var(--type-body-lh)', color: 'var(--ink-60)' }}>
            {t('quiz.done_subtitle')}
          </p>
        </header>

        {/* Goal preset */}
        <div
          style={{
            padding: 20,
            border: '1px solid var(--hair-2)',
            borderRadius: 'var(--radius-outer)',
            background: 'transparent',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div className="flex-wrap-row" style={{ alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ ...captionMono, fontSize: 10 }}>{t('quiz.proposed_goal_eyebrow')}</span>
            {goalAccepted && (
              <span style={{ ...captionMono, fontSize: 10, color: 'var(--ink-60)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span aria-hidden="true" style={{ display: 'inline-block', width: 5, height: 5, borderRadius: 999, background: 'var(--red)' }} />
                {t('quiz.proposed_goal_accepted')}
              </span>
            )}
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: '-0.012em',
              color: 'rgb(var(--ink))',
            }}
          >
            {formatGoal(proposedGoal)}
          </p>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-60)', lineHeight: 1.55 }}>
            {t('quiz.proposed_goal_hint')}
          </p>
          <div className="flex-wrap-row" style={{ alignItems: 'center', gap: 10 }}>
            {!goalAccepted ? (
              <button
                type="button"
                onClick={acceptGoal}
                className="focus-ring motion-press"
                style={primaryPill}
              >
                {t('quiz.accept_goal')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => navigate('/today')}
                className="focus-ring motion-press"
                style={ghostPill}
              >
                {t('quiz.open_plan')}
              </button>
            )}
            <button
              type="button"
              onClick={onRetake}
              className="focus-ring"
              style={{
                ...captionMono,
                background: 'transparent',
                border: 0,
                padding: '4px 8px',
                cursor: 'pointer',
                transition: 'color var(--motion-dur-small) var(--motion-ease-standard)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ink-60)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-40)')}
            >
              {t('quiz.retake')}
            </button>
          </div>
        </div>

        {/* 3 action cards */}
        <div className="flex flex-col" style={{ gap: 12 }}>
          <span style={{ ...captionMono, fontSize: 10 }}>{t('quiz.actions_heading')}</span>
          {result.actions.map((action, i) => (
            <ActionCard key={action.id} index={i + 1} action={action} />
          ))}
        </div>
      </div>
    </MinimalShell>
  )
}

function ActionCard({ index, action }: { index: number; action: DiagnosticAction }) {
  const Icon = KIND_ICON[action.kind]
  const isExternal = action.href.startsWith('http')

  const body = (
    <div className="flex" style={{ width: '100%', alignItems: 'flex-start', gap: 12 }}>
      <span
        className="grid place-items-center"
        style={{
          width: 32,
          height: 32,
          flex: '0 0 auto',
          borderRadius: 'var(--radius-inner)',
          border: '1px solid var(--hair-2)',
          background: 'transparent',
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 12,
          fontWeight: 600,
          color: 'rgb(var(--ink))',
        }}
      >
        {index}
      </span>
      <div className="flex flex-col" style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'rgb(var(--ink))' }}>
          <Icon style={{ width: 14, height: 14, color: 'var(--ink-60)' }} />
          <span style={{ fontSize: 14, fontWeight: 500, letterSpacing: '-0.005em', color: 'rgb(var(--ink))' }}>
            {action.title}
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-60)', lineHeight: 1.55 }}>{action.rationale}</p>
      </div>
      <ArrowRight style={{ marginTop: 8, width: 16, height: 16, flex: '0 0 auto', color: 'var(--ink-40)' }} />
    </div>
  )

  const linkStyle: React.CSSProperties = {
    display: 'block',
    padding: 14,
    border: '1px solid var(--hair-2)',
    borderRadius: 'var(--radius-inner)',
    background: 'transparent',
    textDecoration: 'none',
    transition:
      'background-color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
  }

  const onEnter = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'
    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.18)'
  }
  const onLeave = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.background = 'transparent'
    e.currentTarget.style.borderColor = 'var(--hair-2)'
  }

  if (isExternal) {
    return (
      <a
        href={action.href}
        target="_blank"
        rel="noopener noreferrer"
        className="focus-ring motion-press"
        style={linkStyle}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      >
        {body}
      </a>
    )
  }
  return (
    <Link to={action.href} className="focus-ring motion-press" style={linkStyle} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {body}
    </Link>
  )
}
