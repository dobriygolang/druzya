// /podcasts — каталог подкастов с возможностью прослушивания.
//
// Источник правды — backend services/podcast/ports/cms_handler.go (REST CMS).
// Категории и сами подкасты приходят из БД (нет хардкода). Аудио проксируется
// через MinIO presigned GET URL — фронт встраивает <audio>-плеер прямо в
// карточку и throttle'ом вызывает PUT /podcast/{id}/progress.
//
// Структура:
//   - Hero: featured-эпизод (первый из выдачи) с большой кнопкой Play.
//   - Filter chips: «Все» + категории, загруженные из API.
//   - Search input: подстрочный фильтр по title/description.
//   - Grid: карточки с inline-плеером, длительностью, датой публикации.
//   - Empty state: дружелюбное сообщение, когда ни одной публикации нет.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Headphones,
  Play,
  Pause,
  Search,
  CheckCircle2,
  Clock,
  Filter,
  Volume2,
  VolumeX,
  RotateCcw,
  RotateCw,
} from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { KnowledgeHubTabs } from '../components/KnowledgeHubTabs'
import { Card } from '../components/Card'
import {
  usePodcastsQuery,
  usePodcastCategoriesQuery,
  useUpdatePodcastProgressMutation,
  formatDuration,
  formatPublished,
  type Podcast,
  type PodcastCategory,
} from '../lib/queries/podcasts'

function ProgressBar({ podcast }: { podcast: Podcast }) {
  const total = Math.max(1, podcast.duration_sec)
  const pct = Math.min(100, Math.round((podcast.progress_sec / total) * 100))
  if (podcast.progress_sec === 0 && !podcast.completed) return null
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-surface-1">
      <div
        className={podcast.completed ? 'h-full bg-success' : 'h-full bg-text-primary'}
        style={{ width: `${podcast.completed ? 100 : pct}%` }}
      />
    </div>
  )
}

interface PlayerProps {
  podcast: Podcast
  isActive: boolean
  onActivate: () => void
}

function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const total = Math.floor(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

function AudioPlayer({ podcast, isActive, onActivate }: PlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const seekRef = useRef<HTMLDivElement | null>(null)
  const lastSyncRef = useRef<number>(0)
  const progressMut = useUpdatePodcastProgressMutation()
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(podcast.progress_sec || 0)
  const [duration, setDuration] = useState(podcast.duration_sec || 0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [volumeOpen, setVolumeOpen] = useState(false)
  const [seeking, setSeeking] = useState(false)

  useEffect(() => {
    if (!isActive) return
    const el = audioRef.current
    if (!el) return
    if (podcast.progress_sec > 0 && el.currentTime < podcast.progress_sec) {
      try {
        el.currentTime = podcast.progress_sec
      } catch {
        /* some browsers throw if seeking before metadata loaded */
      }
    }
  }, [isActive, podcast.progress_sec])

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    el.volume = muted ? 0 : volume
  }, [volume, muted, isActive])

  function handleTimeUpdate() {
    const el = audioRef.current
    if (!el) return
    if (!seeking) setCurrentTime(el.currentTime)
    const now = Date.now()
    if (now - lastSyncRef.current < 10_000) return
    lastSyncRef.current = now
    progressMut.mutate({
      podcastId: podcast.id,
      progressSec: el.currentTime,
    })
  }

  function handleLoadedMetadata() {
    const el = audioRef.current
    if (!el) return
    if (Number.isFinite(el.duration) && el.duration > 0) setDuration(el.duration)
  }

  function handleEnded() {
    progressMut.mutate({
      podcastId: podcast.id,
      progressSec: podcast.duration_sec,
      completed: true,
    })
    setPlaying(false)
  }

  function togglePlay() {
    onActivate()
    const el = audioRef.current
    if (!el) {
      window.setTimeout(() => {
        const next = audioRef.current
        if (next) void next.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
      }, 0)
      return
    }
    if (el.paused) {
      void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    } else {
      el.pause()
      setPlaying(false)
    }
  }

  function skip(deltaSec: number) {
    const el = audioRef.current
    if (!el) return
    const next = Math.max(0, Math.min(duration || el.duration || 0, el.currentTime + deltaSec))
    try {
      el.currentTime = next
      setCurrentTime(next)
    } catch {
      /* ignore */
    }
  }

  function seekTo(clientX: number) {
    const el = audioRef.current
    const bar = seekRef.current
    if (!el || !bar || !Number.isFinite(duration) || duration <= 0) return
    const rect = bar.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const t = ratio * duration
    try {
      el.currentTime = t
      setCurrentTime(t)
    } catch {
      /* ignore */
    }
  }

  function handleSeekMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    setSeeking(true)
    seekTo(e.clientX)
    const onMove = (mv: MouseEvent) => seekTo(mv.clientX)
    const onUp = () => {
      setSeeking(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const disabled = !podcast.audio_url
  const total = duration || podcast.duration_sec || 0
  const pct = total > 0 ? Math.min(100, (currentTime / total) * 100) : 0

  if (!isActive || !podcast.audio_url) {
    return (
      <button
        type="button"
        onClick={togglePlay}
        disabled={disabled}
        title={disabled ? 'Аудио недоступно' : 'Слушать'}
        aria-label="Слушать"
        className="grid h-10 w-10 place-items-center rounded-full bg-text-primary text-bg transition hover:bg-text-primary-hover disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-text-muted"
      >
        <Play className="h-4 w-4" />
      </button>
    )
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-2 rounded-xl border border-border bg-surface-2/60 p-2 backdrop-blur">
      <audio
        ref={audioRef}
        src={podcast.audio_url}
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        onDurationChange={handleLoadedMetadata}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => skip(-15)}
          aria-label="Назад 15 секунд"
          title="Назад 15 секунд"
          className="grid h-8 w-8 place-items-center rounded-full border border-border bg-surface-1 text-text-secondary transition hover:border-border-strong hover:text-text-primary"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? 'Пауза' : 'Слушать'}
          title={playing ? 'Пауза' : 'Слушать'}
          className="grid h-10 w-10 place-items-center rounded-full bg-text-primary text-bg transition hover:bg-text-primary-hover"
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => skip(15)}
          aria-label="Вперёд 15 секунд"
          title="Вперёд 15 секунд"
          className="grid h-8 w-8 place-items-center rounded-full border border-border bg-surface-1 text-text-secondary transition hover:border-border-strong hover:text-text-primary"
        >
          <RotateCw className="h-3.5 w-3.5" />
        </button>
        <span className="ml-1 font-mono text-[11px] tabular-nums text-text-muted">
          {formatClock(currentTime)} / {formatClock(total)}
        </span>
        <div
          className="relative ml-auto"
          onMouseEnter={() => setVolumeOpen(true)}
          onMouseLeave={() => setVolumeOpen(false)}
        >
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? 'Включить звук' : 'Выключить звук'}
            title={muted ? 'Включить звук' : 'Выключить звук'}
            className="grid h-8 w-8 place-items-center rounded-full border border-border bg-surface-1 text-text-secondary transition hover:border-border-strong hover:text-text-primary"
          >
            {muted || volume === 0 ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </button>
          {volumeOpen && (
            <div className="absolute bottom-full right-0 mb-2 rounded-md border border-border bg-surface-1 px-2 py-2 shadow-lg">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setVolume(v)
                  if (v > 0 && muted) setMuted(false)
                }}
                aria-label="Громкость"
                className="h-1 w-24 cursor-pointer accent-accent"
              />
            </div>
          )}
        </div>
      </div>
      <div
        ref={seekRef}
        role="slider"
        aria-label="Перемотка"
        aria-valuemin={0}
        aria-valuemax={Math.max(1, Math.floor(total))}
        aria-valuenow={Math.floor(currentTime)}
        tabIndex={0}
        onMouseDown={handleSeekMouseDown}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') skip(5)
          else if (e.key === 'ArrowLeft') skip(-5)
        }}
        className="group relative h-1.5 w-full cursor-pointer overflow-visible rounded-full bg-surface-1"
      >
        <div
          className={podcast.completed ? 'h-full rounded-full bg-success' : 'h-full rounded-full bg-text-primary'}
          style={{ width: `${pct}%` }}
        />
        <div
          className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-bg bg-text-primary opacity-0 transition group-hover:opacity-100"
          style={{ left: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function categoryLabel(podcast: Podcast): { name: string; color: string } | null {
  if (podcast.category) {
    return { name: podcast.category.name, color: podcast.category.color }
  }
  if (podcast.section) {
    return { name: podcast.section, color: '#6c7af0' }
  }
  return null
}

function PodcastCard({
  podcast,
  isActive,
  onActivate,
}: {
  podcast: Podcast
  isActive: boolean
  onActivate: () => void
}) {
  const { t } = useTranslation('pages')
  const cat = categoryLabel(podcast)
  return (
    <Card variant="elevated" padding="lg" className="flex h-full flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            {cat && (
              <span
                className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase"
                style={{ backgroundColor: `${cat.color}22`, color: cat.color }}
              >
                {cat.name}
              </span>
            )}
            {podcast.completed && (
              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-success">
                <CheckCircle2 className="h-3 w-3" /> {t('podcasts.completed')}
              </span>
            )}
          </div>
          <h3 className="truncate font-display text-base font-bold text-text-primary">{podcast.title}</h3>
          {podcast.host && (
            <p className="font-mono text-[11px] text-text-muted">{podcast.host}</p>
          )}
          {podcast.description && (
            <p className="line-clamp-2 text-[13px] text-text-secondary">{podcast.description}</p>
          )}
        </div>
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-surface-2 border border-border-strong">
          <Headphones className="h-5 w-5 text-text-primary" />
        </div>
      </div>
      <div className="mt-auto flex flex-col gap-2">
        {!isActive && <ProgressBar podcast={podcast} />}
        <div className={isActive ? 'flex flex-col gap-2' : 'flex items-center justify-between gap-2'}>
          <div className="flex items-center gap-3 text-[12px] text-text-muted">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> {formatDuration(podcast.duration_sec)}
            </span>
            {podcast.published_at && <span>{formatPublished(podcast.published_at)}</span>}
          </div>
          <AudioPlayer podcast={podcast} isActive={isActive} onActivate={onActivate} />
        </div>
      </div>
    </Card>
  )
}

function HeroFeatured({
  podcast,
  isActive,
  onActivate,
}: {
  podcast: Podcast | null
  isActive: boolean
  onActivate: () => void
}) {
  const { t } = useTranslation('pages')
  if (!podcast) return null
  const cat = categoryLabel(podcast)
  return (
    <Card variant="elevated" padding="lg" className="flex flex-col gap-4 lg:flex-row lg:items-center">
      <div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-surface-2 border border-border-strong">
        <Headphones className="h-8 w-8 text-text-primary" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
          {t('podcasts.featured')}
        </span>
        {cat && (
          <span
            className="self-start rounded-full px-2 py-0.5 font-mono text-[10px] uppercase"
            style={{ backgroundColor: `${cat.color}22`, color: cat.color }}
          >
            {cat.name}
          </span>
        )}
        <h2 className="font-display text-xl font-bold text-text-primary lg:text-2xl">{podcast.title}</h2>
        {podcast.description && (
          <p className="text-[13px] text-text-secondary">{podcast.description}</p>
        )}
        <div className="flex items-center gap-3 text-[12px] text-text-muted">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" /> {formatDuration(podcast.duration_sec)}
          </span>
          {podcast.published_at && <span>{formatPublished(podcast.published_at)}</span>}
        </div>
        <div className="mt-1">
          <AudioPlayer podcast={podcast} isActive={isActive} onActivate={onActivate} />
        </div>
      </div>
    </Card>
  )
}

function CategoryFilter({
  active,
  onChange,
  categories,
}: {
  active: string | null
  onChange: (categoryId: string | null) => void
  categories: PodcastCategory[]
}) {
  const { t } = useTranslation('pages')
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Filter className="h-4 w-4 shrink-0 text-text-muted" />
      <button
        type="button"
        onClick={() => onChange(null)}
        className={
          active === null
            ? 'rounded-full border border-text-primary bg-text-primary/15 px-3 py-1 text-[12px] font-semibold text-text-primary'
            : 'rounded-full border border-border bg-surface-2 px-3 py-1 text-[12px] text-text-secondary hover:border-border-strong'
        }
      >
        {t('podcasts.filter.all')}
      </button>
      {categories.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onChange(c.id)}
          className={
            active === c.id
              ? 'rounded-full border border-text-primary bg-text-primary/15 px-3 py-1 text-[12px] font-semibold text-text-primary'
              : 'rounded-full border border-border bg-surface-2 px-3 py-1 text-[12px] text-text-secondary hover:border-border-strong'
          }
          style={
            active === c.id
              ? { borderColor: c.color, color: c.color, backgroundColor: `${c.color}22` }
              : undefined
          }
        >
          {c.name}
        </button>
      ))}
    </div>
  )
}

export default function PodcastsPage() {
  const { t } = useTranslation('pages')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)

  const categoriesQuery = usePodcastCategoriesQuery()
  const { data, isLoading, isError, refetch } = usePodcastsQuery({
    categoryId: activeCategory ?? undefined,
  })

  const podcasts = useMemo(() => data ?? [], [data])
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return podcasts
    return podcasts.filter((p) => {
      return (
        p.title.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q) ||
        (p.host ?? '').toLowerCase().includes(q)
      )
    })
  }, [podcasts, search])

  const featured = filtered[0] ?? podcasts[0] ?? null
  const grid = filtered.slice(featured && filtered.includes(featured) ? 1 : 0)

  return (
    <AppShellV2>
      {/* WAVE-13 — same shared knowledge-hub tab strip as /codex; switching
          back to Articles re-mounts the Codex page without a full reload. */}
      <KnowledgeHubTabs active="podcasts" />
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 py-6 sm:px-8 lg:px-10 lg:py-8">
        <header className="flex flex-col gap-2">
          <h1 className="font-display text-2xl font-bold text-text-primary lg:text-[32px] lg:leading-[1.1]">
            {t('podcasts.title')}
          </h1>
          <p className="text-sm text-text-secondary">
            {t('podcasts.subtitle', {
            })}
          </p>
        </header>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[180px] animate-pulse rounded-2xl bg-surface-2" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-start gap-3 rounded-2xl border border-danger/40 bg-surface-1 p-5">
            <p className="text-sm text-text-secondary">
              {t('podcasts.error')}
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="rounded-md bg-text-primary px-3 py-1.5 text-sm font-semibold text-text-primary hover:bg-text-primary-hover"
            >
              {t('podcasts.retry')}
            </button>
          </div>
        ) : podcasts.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface-1 p-8 text-center">
            <Headphones className="mx-auto mb-3 h-8 w-8 text-text-muted" />
            <p className="text-sm text-text-secondary">
              {t('podcasts.empty')}
            </p>
            <p className="mt-2 font-mono text-[11px] text-text-muted">
              {t('podcasts.empty_hint', {
              })}
            </p>
          </div>
        ) : (
          <>
            <HeroFeatured
              podcast={featured}
              isActive={featured?.id === activeId}
              onActivate={() => featured && setActiveId(featured.id)}
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CategoryFilter
                active={activeCategory}
                onChange={setActiveCategory}
                categories={categories}
              />
              <label className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface-2 px-3 sm:w-[280px]">
                <Search className="h-4 w-4 text-text-muted" aria-hidden />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('podcasts.search_placeholder') as string}
                  className="flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted"
                  aria-label={t('podcasts.search_placeholder') as string}
                />
              </label>
            </div>
            {grid.length === 0 ? (
              <p className="text-sm text-text-muted">
                {t('podcasts.no_match')}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {grid.map((p) => (
                  <PodcastCard
                    key={p.id}
                    podcast={p}
                    isActive={p.id === activeId}
                    onActivate={() => setActiveId(p.id)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </AppShellV2>
  )
}
