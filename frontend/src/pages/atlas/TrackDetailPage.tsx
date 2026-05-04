// /atlas/track/:slug — детали одного learning-track'а (Phase 2e).
//
// Layout:
//   • Hero: name, tagline, description, accent_color stripe, мета (weeks /
//     difficulty / tags / company_focus).
//   • Двухколоночный grid (lg+):
//       - left: vertical stairwell со step-карточками. Текущий step
//         подсвечен accent'ом, completed — success, future — muted.
//       - right: sticky sidebar с CTA «Practice next step» / Join /
//         Pause / Resume + прогресс-стат.
//   • Bottom: Codex pre-reads — все recommended_reading из всех steps,
//     дедуп по slug. Пока статичные ссылки (deep-link на /codex).
//
// Practice CTA (post-pivot 2026-05-01): открывает /mock company picker.
// Раньше создавалось solo lobby + arena match; lobby/arena сервисы дропнуты.

import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Loader2,
  Pause,
  Play,
  PlayCircle,
} from 'lucide-react'
import { AppShellV2 } from '../../components/AppShell'
import { Button } from '../../components/Button'
import {
  difficultyLabel,
  findEnrolment,
  progressPct,
  stepKindLabel,
  useAdvanceStepMutation,
  useJoinTrackMutation,
  usePauseTrackMutation,
  useTrack,
  useUserTracks,
  type LearningTrack,
  type LearningTrackProgress,
  type TrackStep,
} from '../../lib/queries/tracks'

export default function TrackDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()

  const trackQ = useTrack(slug)
  const userQ = useUserTracks()

  const track = trackQ.data?.track
  const steps = trackQ.data?.steps ?? []
  const progress = useMemo(
    () => (track ? findEnrolment(userQ.data, track.id) : undefined),
    [track, userQ.data],
  )

  const join = useJoinTrackMutation()
  const advance = useAdvanceStepMutation()
  const pause = usePauseTrackMutation()
  const [practiceError, setPracticeError] = useState<string | null>(null)

  if (trackQ.isLoading) {
    return (
      <AppShellV2>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
        </div>
      </AppShellV2>
    )
  }

  if (trackQ.isError || !track) {
    return (
      <AppShellV2>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
          <p className="text-sm text-text-secondary">
            Трек не найден или произошла ошибка.
          </p>
          <Button variant="ghost" onClick={() => navigate('/atlas')}>
            ← Каталог
          </Button>
        </div>
      </AppShellV2>
    )
  }

  const enrolled = Boolean(progress)
  const paused = Boolean(progress?.enrolment.paused_at)
  const completed = Boolean(progress?.enrolment.completed_at)
  const currentIdx = progress?.enrolment.current_step ?? 0
  const nextStep = enrolled && !completed ? steps[currentIdx] : undefined

  const accent = track.accent_color || '#A78BFA'
  const practiceRunning = false

  // Practice ведёт в /mock — там юзер выбирает компанию и стартует pipeline.
  // skill_keys / step → не используем (dropped lobby/arena), но передаём
  // через query на случай если /mock начнёт их учитывать.
  const onPractice = () => {
    if (!nextStep) return
    setPracticeError(null)
    const skillKeys = nextStep.skill_keys ?? []
    const qs = skillKeys.length > 0
      ? `?skill=${encodeURIComponent(skillKeys.join(','))}`
      : ''
    navigate(`/mock${qs}`)
  }

  return (
    <AppShellV2>
      <div className="flex flex-col">
        <Hero track={track} progress={progress} accent={accent} />

        <div className="px-4 py-6 sm:px-8 lg:px-20">
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            {/* left — stairwell */}
            <div className="flex flex-col gap-3">
              <h2 className="font-display text-base font-bold text-text-primary">
                Шаги
              </h2>
              {steps.length === 0 ? (
                <div className="rounded-xl border border-border bg-surface-1 p-6 text-center text-sm text-text-secondary">
                  У трека пока нет шагов.
                </div>
              ) : (
                <Stairwell steps={steps} currentIdx={currentIdx} accent={accent} />
              )}
            </div>

            {/* right — sticky sidebar */}
            <aside className="flex flex-col gap-3 lg:sticky lg:top-24 lg:self-start">
              <SidebarCTA
                track={track}
                accent={accent}
                enrolled={enrolled}
                paused={paused}
                completed={completed}
                progress={progress}
                nextStep={nextStep}
                onJoin={() => join.mutate(track.id)}
                onPause={() => pause.mutate(track.id)}
                onAdvance={() => advance.mutate(track.id)}
                onPractice={onPractice}
                joinPending={join.isPending}
                pausePending={pause.isPending}
                advancePending={advance.isPending}
                practicePending={practiceRunning}
                practiceError={practiceError}
              />
            </aside>
          </div>

          <PreReads steps={steps} />
        </div>
      </div>
    </AppShellV2>
  )
}

// ── Hero ─────────────────────────────────────────────────────────────────

function Hero({
  track,
  progress,
  accent,
}: {
  track: LearningTrack
  progress: LearningTrackProgress | undefined
  accent: string
}) {
  return (
    <div
      className="border-b border-border bg-surface-1 px-4 py-6 sm:px-8 lg:px-20 lg:py-8"
      style={{ borderTop: `3px solid ${accent}` }}
    >
      <div className="flex flex-col gap-3">
        <Link
          to="/atlas"
          className="inline-flex items-center gap-1 self-start font-mono text-[11px] text-text-muted transition-colors hover:text-text-primary"
        >
          <ArrowLeft className="h-3 w-3" />
          Каталог
        </Link>
        <h1 className="font-display text-2xl font-bold leading-[1.1] text-text-primary lg:text-[28px]">
          {track.name}
        </h1>
        <p className="max-w-2xl text-sm text-text-secondary">{track.tagline}</p>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-text-muted">
          <span>{track.estimated_weeks} нед</span>
          <span>·</span>
          <span>{difficultyLabel(track.difficulty)}</span>
          {(track.company_focus ?? []).length > 0 && (
            <>
              <span>·</span>
              <span>{(track.company_focus ?? []).join(' / ')}</span>
            </>
          )}
        </div>
        {track.description_md && (
          <p className="mt-2 max-w-3xl whitespace-pre-line text-sm text-text-secondary">
            {track.description_md}
          </p>
        )}
        {progress && (
          <div className="mt-3 flex items-center gap-2 max-w-md">
            <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
              {progress.enrolment.current_step ?? 0}/{progress.steps_total ?? 0}
            </span>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-bg">
              <div
                className="h-full transition-all"
                style={{ width: `${progressPct(progress)}%`, backgroundColor: accent }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Stairwell ────────────────────────────────────────────────────────────

function Stairwell({
  steps,
  currentIdx,
  accent,
}: {
  steps: TrackStep[]
  currentIdx: number
  accent: string
}) {
  return (
    <ol className="flex flex-col gap-2">
      {steps.map((step, i) => {
        const status: 'done' | 'current' | 'future' =
          i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'future'
        return (
          <StepCard
            key={`${step.track_id}-${step.step_index}`}
            step={step}
            status={status}
            accent={accent}
          />
        )
      })}
    </ol>
  )
}

function StepCard({
  step,
  status,
  accent,
}: {
  step: TrackStep
  status: 'done' | 'current' | 'future'
  accent: string
}) {
  const borderClass =
    status === 'current'
      ? 'border-text-primary'
      : status === 'done'
        ? 'border-success/40'
        : 'border-border'
  const bgClass = status === 'current' ? 'bg-surface-2' : 'bg-surface-1'

  return (
    <li
      className={`relative flex gap-4 rounded-xl border p-4 transition-colors ${borderClass} ${bgClass}`}
      style={
        status === 'current'
          ? { boxShadow: `inset 3px 0 0 ${accent}` }
          : undefined
      }
    >
      <StepBullet status={status} accent={accent} index={step.step_index} />
      <div className="flex flex-col gap-2 min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h3
            className={`font-display text-sm font-bold ${
              status === 'future' ? 'text-text-muted' : 'text-text-primary'
            }`}
          >
            {step.title}
          </h3>
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
            {stepKindLabel(step.required_kind)}
            {step.required_count > 1 && ` × ${step.required_count}`}
            {step.estimated_minutes > 0 && ` · ~${step.estimated_minutes} мин`}
          </span>
        </div>
        {step.description_md && (
          <p
            className={`text-xs ${
              status === 'future' ? 'text-text-muted' : 'text-text-secondary'
            }`}
          >
            {step.description_md}
          </p>
        )}
        {(step.skill_keys ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {(step.skill_keys ?? []).map((k) => (
              <span
                key={k}
                className="rounded-full border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted"
              >
                {k}
              </span>
            ))}
          </div>
        )}
      </div>
    </li>
  )
}

function StepBullet({
  status,
  accent,
  index,
}: {
  status: 'done' | 'current' | 'future'
  accent: string
  index: number
}) {
  if (status === 'done') {
    return (
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-success/20 text-success">
        <Check className="h-4 w-4" />
      </span>
    )
  }
  if (status === 'current') {
    return (
      <span
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full font-mono text-[11px] font-bold"
        style={{ backgroundColor: accent, color: '#0A0A0A' }}
      >
        {index + 1}
      </span>
    )
  }
  return (
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border font-mono text-[11px] text-text-muted">
      {index + 1}
    </span>
  )
}

// ── Sidebar CTA ──────────────────────────────────────────────────────────

function SidebarCTA({
  track,
  accent,
  enrolled,
  paused,
  completed,
  progress,
  nextStep,
  onJoin,
  onPause,
  onAdvance,
  onPractice,
  joinPending,
  pausePending,
  advancePending,
  practicePending,
  practiceError,
}: {
  track: LearningTrack
  accent: string
  enrolled: boolean
  paused: boolean
  completed: boolean
  progress: LearningTrackProgress | undefined
  nextStep: TrackStep | undefined
  onJoin: () => void
  onPause: () => void
  onAdvance: () => void
  onPractice: () => void
  joinPending: boolean
  pausePending: boolean
  advancePending: boolean
  practicePending: boolean
  practiceError: string | null
}) {
  if (completed) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-success/40 bg-success/10 p-4 text-center">
        <Check className="mx-auto h-7 w-7 text-success" />
        <div>
          <h3 className="font-display text-sm font-bold text-text-primary">
            Трек пройден
          </h3>
          <p className="mt-1 text-xs text-text-secondary">
            Поздравляем — ты дошёл до конца. Время взять следующий.
          </p>
        </div>
        <Link to="/atlas">
          <Button variant="ghost" size="sm">
            Каталог →
          </Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-1 p-4">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
          {enrolled ? (paused ? 'на паузе' : 'next step') : 'до начала'}
        </span>
        <h3 className="font-display text-sm font-bold text-text-primary">
          {nextStep
            ? nextStep.title
            : enrolled
              ? 'Все шаги выполнены'
              : track.tagline || 'Начни трек, чтобы получить пошаговый план'}
        </h3>
      </div>

      {!enrolled && (
        <Button
          size="md"
          onClick={onJoin}
          disabled={joinPending}
          icon={joinPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          style={{ backgroundColor: accent, color: '#0A0A0A' }}
        >
          Вступить
        </Button>
      )}

      {enrolled && paused && (
        <Button
          size="md"
          onClick={onJoin}
          disabled={joinPending}
          icon={joinPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          style={{ backgroundColor: accent, color: '#0A0A0A' }}
        >
          Возобновить
        </Button>
      )}

      {enrolled && !paused && nextStep && (
        <>
          <button
            type="button"
            onClick={onPractice}
            disabled={practicePending}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 font-sans text-[14px] font-medium text-bg transition-colors hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: accent }}
          >
            {practicePending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PlayCircle className="h-4 w-4" />
            )}
            Practice this step
            <ArrowRight className="h-4 w-4" />
          </button>
          {practiceError && (
            <span className="font-mono text-[10px] text-warn">
              Solo lobby fail — открываем kata вручную…
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onAdvance}
            disabled={advancePending}
            icon={advancePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          >
            Mark step done
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onPause}
            disabled={pausePending}
            icon={pausePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />}
          >
            Pause
          </Button>
        </>
      )}

      {progress && (
        <div className="mt-1 flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
            {progress.enrolment.current_step ?? 0}/{progress.steps_total ?? 0}
          </span>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-bg">
            <div
              className="h-full transition-all"
              style={{ width: `${progressPct(progress)}%`, backgroundColor: accent }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Pre-reads ────────────────────────────────────────────────────────────

function PreReads({ steps }: { steps: TrackStep[] }) {
  const reads = useMemo(() => {
    const seen = new Set<string>()
    const out: { slug: string; stepIdx: number }[] = []
    for (const step of steps) {
      for (const slug of step.recommended_reading ?? []) {
        if (!slug || seen.has(slug)) continue
        seen.add(slug)
        out.push({ slug, stepIdx: step.step_index })
      }
    }
    return out
  }, [steps])

  if (reads.length === 0) return null

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-display text-base font-bold text-text-primary">
          Codex pre-reads
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
          {reads.length} материал{pluralReads(reads.length)}
        </span>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {reads.map((r) => (
          <Link
            key={r.slug}
            to={`/codex?article=${encodeURIComponent(r.slug)}`}
            className="group flex items-start gap-3 rounded-xl border border-border bg-surface-1 p-3 transition-colors hover:border-border-strong"
          >
            <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-text-muted transition-colors group-hover:text-text-primary" />
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-xs text-text-primary line-clamp-1">{r.slug}</span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                step {r.stepIdx + 1}
              </span>
            </div>
            <ArrowRight className="ml-auto h-3 w-3 shrink-0 self-center text-text-muted transition-colors group-hover:text-text-primary" />
          </Link>
        ))}
      </div>
    </section>
  )
}

function pluralReads(n: number): string {
  const last = n % 10
  const lastTwo = n % 100
  if (lastTwo >= 11 && lastTwo <= 14) return 'ов'
  if (last === 1) return ''
  if (last >= 2 && last <= 4) return 'а'
  return 'ов'
}
