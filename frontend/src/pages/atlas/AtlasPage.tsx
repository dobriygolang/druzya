// /atlas — Tracks ribbon (Phase 2e).
//
// Главная страница атласа после Phase 2 — горизонтальный список curated
// learning tracks. Что было раньше (skill-graph PoE) переехало в
// /atlas/explore (см. AtlasExplorePage).
//
// Контракт UI:
//   • Hero — заголовок «Tracks» + sub: «curated programmes to ship for
//     interview/promo». Кнопка «explore atlas» ведёт на /atlas/explore.
//   • Active strip (опционально) — карточка активного трека с прогрессом
//     и CTA «продолжить → step N».
//   • Catalogue ribbon — карточки всех активных треков. Каждая показывает:
//     name, tagline, accent_color stripe, estimated_weeks, difficulty, tags
//     и пометку enrolled / not enrolled.
//
// Empty / error / loading — единая шапка одинакового размера, чтобы layout
// не прыгал.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Compass, Loader2, Plus, Sparkles, Check } from 'lucide-react'
import { AppShellV2 } from '../../components/AppShell'
import { Button } from '../../components/Button'
import { ErrorBoundary } from '../../components/ErrorBoundary'
import { DataLoader } from '../../components/DataLoader'
import { PersonalContextBanner } from '../../components/PersonalContextBanner'
import {
  activeEnrolment,
  difficultyLabel,
  findEnrolment,
  progressPct,
  useTracksCatalogue,
  useUserTracks,
  type LearningTrack,
  type LearningTrackProgress,
} from '../../lib/queries/tracks'
import {
  useClassifyAtlasTodoMutation,
  type ClassifyAtlasTodoResponse,
} from '../../lib/queries/profile'

export default function AtlasPage() {
  const catalogue = useTracksCatalogue()
  const userTracks = useUserTracks()

  const active = activeEnrolment(userTracks.data)

  return (
    <AppShellV2>
      <div className="flex flex-col">
        <Hero />
        <div className="px-4 py-6 sm:px-8 lg:px-20">
          {/* R3+F4 (2026-05-12): Personal context banner reads F2 goal + F5
              activity, рендерит state-aware hint. На AtlasPage главное —
              guide юзера к diagnostic если нет goal, или подсказать активность
              если goal есть но logging пустой. */}
          <div className="mb-5">
            <PersonalContextBanner />
          </div>

          {active && (
            <ErrorBoundary section="Активный трек">
              <ActiveTrackStrip progress={active} />
            </ErrorBoundary>
          )}

          <ErrorBoundary section="Atlas todo">
            <AddAtlasTodoCard />
          </ErrorBoundary>

          <CatalogueHeader
            count={catalogue.data?.length ?? 0}
            isLoading={catalogue.isLoading}
            isError={catalogue.isError}
          />

          <ErrorBoundary section="Каталог треков">
            <DataLoader
              state={catalogue}
              section="Каталог треков"
              skeleton={<SkeletonRibbon />}
              empty={(d) => (d?.length ?? 0) === 0}
              emptyContent={<EmptyCatalogue />}
              errorContent={(_e, retry) => <ErrorBlock onRetry={retry} />}
            >
              {(tracks) => (
                <Ribbon tracks={tracks ?? []} enrolments={userTracks.data} />
              )}
            </DataLoader>
          </ErrorBoundary>
        </div>
      </div>
    </AppShellV2>
  )
}

// ── Hero ─────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <div className="flex flex-col items-start gap-4 border-b border-border bg-surface-1 px-4 py-6 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-20 lg:py-8">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold leading-[1.1] text-text-primary lg:text-[28px]">
          Tracks
        </h1>
        <p className="max-w-xl text-sm text-text-secondary">
          Курируемые программы под собес/промо. Шаги выстроены в порядке —
          бери трек и идёшь по чек-листу до конца.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Link to="/atlas/explore">
          <Button variant="ghost" size="sm" icon={<Compass className="h-3.5 w-3.5" />}>
            explore atlas
          </Button>
        </Link>
      </div>
    </div>
  )
}

// ── Active strip ─────────────────────────────────────────────────────────

function ActiveTrackStrip({ progress }: { progress: LearningTrackProgress }) {
  const pct = progressPct(progress)
  const stepLabel = `${progress.enrolment.current_step ?? 0}/${progress.steps_total ?? 0}`
  return (
    <Link
      to={`/atlas/track/${encodeURIComponent(progress.track.slug)}`}
      className="card-lift group relative mb-6 block rounded-xl border border-border bg-surface-1 p-4 hover:border-border-strong"
    >
      {/* Hero-treatment: red signal stripe denotes the live/active track. */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          width: '1.5px',
          height: '24px',
          background: 'var(--red)',
        }}
      />
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-text-muted">
            <Sparkles className="h-3 w-3" />
            <span>active track</span>
          </div>
          <h2 className="font-display text-lg font-bold text-text-primary truncate">
            {progress.track.name}
          </h2>
          <p className="text-xs text-text-secondary truncate">
            {progress.track.tagline}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className="font-mono text-xs text-text-secondary">
            step {stepLabel}
          </span>
          <span className="text-text-muted transition-colors group-hover:text-text-primary">
            <ArrowRight className="h-4 w-4" />
          </span>
        </div>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-bg">
        <div
          className="h-full transition-all"
          style={{
            width: `${pct}%`,
            background: 'var(--ink)',
          }}
        />
      </div>
    </Link>
  )
}

// ── Catalogue header / ribbon ────────────────────────────────────────────

function CatalogueHeader({
  count,
  isLoading,
  isError,
}: {
  count: number
  isLoading: boolean
  isError: boolean
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between">
      <h2 className="font-display text-base font-bold text-text-primary">
        Каталог
      </h2>
      <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
        {isError ? 'ошибка' : isLoading ? 'загружаем…' : `${count} трек${pluralEnding(count)}`}
      </span>
    </div>
  )
}

function pluralEnding(n: number): string {
  const last = n % 10
  const lastTwo = n % 100
  if (lastTwo >= 11 && lastTwo <= 14) return 'ов'
  if (last === 1) return ''
  if (last >= 2 && last <= 4) return 'а'
  return 'ов'
}

function Ribbon({
  tracks,
  enrolments,
}: {
  tracks: LearningTrack[]
  enrolments: LearningTrackProgress[] | undefined
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {tracks.map((t) => (
        <TrackCard
          key={t.id}
          track={t}
          progress={findEnrolment(enrolments, t.id)}
        />
      ))}
    </div>
  )
}

function TrackCard({
  track,
  progress,
}: {
  track: LearningTrack
  progress: LearningTrackProgress | undefined
}) {
  const enrolled = Boolean(progress)
  const paused = Boolean(progress?.enrolment.paused_at)
  const completed = Boolean(progress?.enrolment.completed_at)
  const pct = progressPct(progress)
  const stepLabel = progress
    ? `${progress.enrolment.current_step ?? 0}/${progress.steps_total ?? 0}`
    : null

  return (
    <Link
      to={`/atlas/track/${encodeURIComponent(track.slug)}`}
      className="card-lift group relative flex flex-col gap-3 rounded-xl border border-border bg-surface-1 p-4 hover:border-border-strong"
    >
      {enrolled && !completed && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            width: '1.5px',
            height: '24px',
            background: 'var(--red)',
          }}
        />
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">
            <span>{track.estimated_weeks} нед</span>
            <span>·</span>
            <span>{difficultyLabel(track.difficulty)}</span>
          </div>
          <h3 className="font-display text-base font-bold text-text-primary line-clamp-2">
            {track.name}
          </h3>
        </div>
        <EnrolmentBadge
          enrolled={enrolled}
          paused={paused}
          completed={completed}
        />
      </div>
      <p className="text-xs text-text-secondary line-clamp-2 min-h-[2.4rem]">
        {track.tagline}
      </p>

      {track.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {track.tags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {enrolled && (
        <div className="flex items-center gap-2 mt-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted shrink-0">
            step {stepLabel}
          </span>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-bg">
            <div
              className="h-full transition-all"
              style={{ width: `${pct}%`, background: 'var(--ink)' }}
            />
          </div>
        </div>
      )}

      <div className="mt-auto flex items-center justify-end gap-1 font-mono text-[11px] text-text-muted transition-colors group-hover:text-text-primary">
        <span>{enrolled ? 'continue' : 'open'}</span>
        <ArrowRight className="h-3 w-3" />
      </div>
    </Link>
  )
}

function EnrolmentBadge({
  enrolled,
  paused,
  completed,
}: {
  enrolled: boolean
  paused: boolean
  completed: boolean
}) {
  if (completed) {
    return (
      <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-success shrink-0">
        done
      </span>
    )
  }
  if (paused) {
    return (
      <span className="rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-warn shrink-0">
        paused
      </span>
    )
  }
  if (enrolled) {
    return (
      <span className="rounded-full border border-text-primary/40 bg-text-primary/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-primary shrink-0">
        joined
      </span>
    )
  }
  return null
}

// ── Skeleton / Empty / Error ─────────────────────────────────────────────

function SkeletonRibbon() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-[180px] animate-pulse rounded-xl border border-border bg-surface-1"
        />
      ))}
    </div>
  )
}

function EmptyCatalogue() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface-1 p-8 text-center">
      <Sparkles className="h-7 w-7 text-text-muted" />
      <p className="text-sm text-text-secondary">
        Каталог пока пуст. Кураторы готовят первые программы — загляни
        чуть позже.
      </p>
    </div>
  )
}

function ErrorBlock({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-danger/40 bg-surface-1 p-8 text-center">
      <Loader2 className="h-7 w-7 text-danger" />
      <p className="text-sm text-text-secondary">
        Не удалось загрузить треки. Попробуй обновить.
      </p>
      <Button size="sm" onClick={onRetry}>
        Повторить
      </Button>
    </div>
  )
}

// ── Phase 3.1: free-form TODO → atlas node ─────────────────────────────
function AddAtlasTodoCard() {
  const [todo, setTodo] = useState('')
  const [result, setResult] = useState<ClassifyAtlasTodoResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const m = useClassifyAtlasTodoMutation()

  const submit = async () => {
    setError(null)
    setResult(null)
    const t = todo.trim()
    if (t.length < 3) return
    try {
      const res = await m.mutateAsync(t)
      setResult(res)
      setTodo('')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/unimplemented/i.test(msg)) {
        setError('AI-классификатор пока недоступен (LLM не сконфигурён).')
      } else {
        setError(msg)
      }
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-dashed border-border bg-surface-1 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent" />
        <h2 className="font-display text-sm font-bold">Добавить тему в атлас</h2>
      </div>
      <p className="mb-3 text-[12px] leading-relaxed text-text-secondary">
        Опиши что хочешь изучить («Транзакции в Postgres», «Diffusion-модели»).
        AI либо найдёт подходящий узел в curated-атласе, либо заведёт новый
        в твоём личном слое.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={todo}
          onChange={(e) => setTodo(e.target.value)}
          placeholder="Например: транзакции в Postgres"
          className="atlas-underline-input flex-1 bg-transparent px-1 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none"
          style={{
            border: 'none',
            borderBottom: '1px solid var(--hair-2)',
            transition:
              'border-color var(--motion-dur-small) var(--motion-ease-standard)',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderBottom = '1.5px solid rgb(var(--ink))'
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderBottom = '1px solid var(--hair-2)'
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        <Button
          size="sm"
          variant="primary"
          disabled={todo.trim().length < 3 || m.isPending}
          icon={
            m.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )
          }
          onClick={submit}
        >
          Добавить
        </Button>
      </div>
      {error && (
        <div className="mt-3 rounded-md border border-warn/40 bg-surface-2 px-3 py-2 text-[12px] text-text-secondary">
          {error}
        </div>
      )}
      {result && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-accent/40 bg-surface-2 px-3 py-2 text-[12px]">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
          <div className="text-text-primary">
            {result.matched_key ? (
              <>
                Тема уже есть в атласе:{' '}
                <code className="font-mono text-[11px] text-accent">
                  {result.matched_key}
                </code>
                . Прогресс по ней пойдёт сразу.
              </>
            ) : result.new_node ? (
              <>
                Создан новый узел{' '}
                <b className="text-text-primary">{result.new_node.title}</b>{' '}
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                  · {result.new_node.section} / {result.new_node.cluster}
                </span>
              </>
            ) : (
              'Готово.'
            )}
          </div>
        </div>
      )}
    </section>
  )
}
