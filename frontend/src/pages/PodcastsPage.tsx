// /podcasts — каталог подкастов с возможностью прослушивания.
//
// Источник правды — backend services/podcast (см. ports/server.go,
// PodcastServer.ListCatalog). Реальные ответы содержат signed audio URL
// (`audio_url`) — фронт встраивает <audio>-плеер прямо в карточку и
// throttle'ом вызывает PUT /podcast/{id}/progress, чтобы прогресс
// синхронизировался между девайсами.
//
// Структура:
//   - Hero: featured-эпизод (первый из выдачи) с большой кнопкой Play.
//   - Filter chips: «Все», секции (Algorithms / SQL / Go / System Design /
//     Behavioral) — клиентский фильтр поверх полученного каталога.
//   - Search input: подстрочный фильтр по title/description.
//   - Grid: карточки с inline-плеером, длительностью, датой публикации.
//
// Ключевой UX-принцип: ВСЕ кнопки кликабельные. Если audio_url пустой
// (mock или сигнер не настроен), плеер деактивируется, но визуально
// карточка всё равно реагирует на hover/keyboard.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Headphones, Play, Pause, Search, CheckCircle2, Clock, Filter } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Card } from '../components/Card'
import {
  usePodcastsQuery,
  updatePodcastProgress,
  formatDuration,
  formatPublished,
  type Podcast,
} from '../lib/queries/podcasts'

// Discrete section keys mirroring `enums.Section` on the Go side. UI labels
// сидят в i18n `pages.podcasts.sections`.
const SECTION_KEYS = [
  'all',
  'SECTION_ALGORITHMS',
  'SECTION_SQL',
  'SECTION_GO',
  'SECTION_SYSTEM_DESIGN',
  'SECTION_BEHAVIORAL',
  // Mock использует lowercase-формы — поддерживаем оба варианта в фильтре.
  'algorithms',
  'sql',
  'go',
  'system_design',
  'behavioral',
] as const

type SectionKey = (typeof SECTION_KEYS)[number]

// Mapping mock-секций к i18n-ключам — одна и та же подпись для обоих
// вариантов написания.
function sectionI18nKey(s: string): string {
  switch (s.toLowerCase().replace(/^section_/, '')) {
    case 'algorithms':
      return 'algorithms'
    case 'sql':
      return 'sql'
    case 'go':
      return 'go'
    case 'system_design':
      return 'system_design'
    case 'behavioral':
      return 'behavioral'
    default:
      return 'other'
  }
}

function ProgressBar({ podcast }: { podcast: Podcast }) {
  const total = Math.max(1, podcast.duration_sec)
  const pct = Math.min(100, Math.round((podcast.progress_sec / total) * 100))
  if (podcast.progress_sec === 0 && !podcast.completed) return null
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-surface-1">
      <div
        className={podcast.completed ? 'h-full bg-success' : 'h-full bg-accent'}
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

// AudioPlayer — управляемый <audio> с throttled progress sync. Когда
// карточка получает фокус (isActive=true), мы собственно создаём элемент;
// до этого рендерится только Play-кнопка, чтобы не плодить десятки
// одновременно загружающихся аудио-источников при первом рендере страницы.
function AudioPlayer({ podcast, isActive, onActivate }: PlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const lastSyncRef = useRef<number>(0)
  const [playing, setPlaying] = useState(false)

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

  function handleTimeUpdate() {
    const el = audioRef.current
    if (!el) return
    const now = Date.now()
    // Throttle: 1 sync / 10 s, чтобы не заспамить бэкенд.
    if (now - lastSyncRef.current < 10_000) return
    lastSyncRef.current = now
    void updatePodcastProgress({
      podcastId: podcast.id,
      progressSec: el.currentTime,
    }).catch(() => {
      /* network blip — следующий tick попробует снова */
    })
  }

  function handleEnded() {
    void updatePodcastProgress({
      podcastId: podcast.id,
      progressSec: podcast.duration_sec,
      completed: true,
    }).catch(() => {})
    setPlaying(false)
  }

  function togglePlay() {
    onActivate()
    const el = audioRef.current
    if (!el) {
      // Element will be created on next render (because isActive flips); the
      // user's intent gets a small lag of one tick. Schedule a follow-up play.
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

  const disabled = !podcast.audio_url
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={togglePlay}
        disabled={disabled}
        title={disabled ? 'Аудио недоступно' : playing ? 'Пауза' : 'Слушать'}
        aria-label={playing ? 'Пауза' : 'Слушать'}
        className="grid h-10 w-10 place-items-center rounded-full bg-accent text-text-primary transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-text-muted"
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      {isActive && podcast.audio_url && (
        <audio
          ref={audioRef}
          src={podcast.audio_url}
          preload="metadata"
          controls
          className="h-9 w-full max-w-[260px]"
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
          onPause={() => setPlaying(false)}
          onPlay={() => setPlaying(true)}
        />
      )}
    </div>
  )
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
  return (
    <Card variant="elevated" padding="lg" className="flex h-full flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase text-text-secondary">
              {t(`podcasts.sections.${sectionI18nKey(podcast.section)}`, { defaultValue: podcast.section })}
            </span>
            {podcast.completed && (
              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-success">
                <CheckCircle2 className="h-3 w-3" /> {t('podcasts.completed', { defaultValue: 'Прослушан' })}
              </span>
            )}
          </div>
          <h3 className="truncate font-display text-base font-bold text-text-primary">{podcast.title}</h3>
          {podcast.description && (
            <p className="line-clamp-2 text-[13px] text-text-secondary">{podcast.description}</p>
          )}
        </div>
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-gradient-to-br from-pink to-accent">
          <Headphones className="h-5 w-5 text-text-primary" />
        </div>
      </div>
      <div className="mt-auto flex flex-col gap-2">
        <ProgressBar podcast={podcast} />
        <div className="flex items-center justify-between gap-2">
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
  return (
    <Card variant="elevated" padding="lg" className="flex flex-col gap-4 bg-gradient-to-br from-accent/15 via-surface-1 to-pink/10 lg:flex-row lg:items-center">
      <div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-pink to-accent">
        <Headphones className="h-8 w-8 text-text-primary" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
          {t('podcasts.featured', { defaultValue: 'Подкаст недели' })}
        </span>
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

function SectionFilter({
  active,
  onChange,
  sections,
}: {
  active: SectionKey
  onChange: (s: SectionKey) => void
  sections: SectionKey[]
}) {
  const { t } = useTranslation('pages')
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Filter className="h-4 w-4 shrink-0 text-text-muted" />
      <button
        type="button"
        onClick={() => onChange('all')}
        className={
          active === 'all'
            ? 'rounded-full border border-accent bg-accent/15 px-3 py-1 text-[12px] font-semibold text-accent-hover'
            : 'rounded-full border border-border bg-surface-2 px-3 py-1 text-[12px] text-text-secondary hover:border-accent/40'
        }
      >
        {t('podcasts.filter.all', { defaultValue: 'Все' })}
      </button>
      {sections
        .filter((s) => s !== 'all')
        .map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            className={
              active === s
                ? 'rounded-full border border-accent bg-accent/15 px-3 py-1 text-[12px] font-semibold text-accent-hover'
                : 'rounded-full border border-border bg-surface-2 px-3 py-1 text-[12px] text-text-secondary hover:border-accent/40'
            }
          >
            {t(`podcasts.sections.${sectionI18nKey(s)}`, { defaultValue: s })}
          </button>
        ))}
    </div>
  )
}

export default function PodcastsPage() {
  const { t } = useTranslation('pages')
  const { data, isLoading, isError, refetch } = usePodcastsQuery()
  const [section, setSection] = useState<SectionKey>('all')
  const [search, setSearch] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)

  const podcasts = useMemo(() => data ?? [], [data])

  // Derive the section chips from data so we don't show a chip for an empty
  // bucket. The string identity (uppercase vs lowercase) is preserved so the
  // filter predicate just compares with ===.
  const availableSections = useMemo<SectionKey[]>(() => {
    const set = new Set<SectionKey>(['all'])
    for (const p of podcasts) {
      if ((SECTION_KEYS as readonly string[]).includes(p.section)) {
        set.add(p.section as SectionKey)
      }
    }
    return Array.from(set)
  }, [podcasts])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return podcasts.filter((p) => {
      if (section !== 'all' && p.section !== section) return false
      if (!q) return true
      return p.title.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
    })
  }, [podcasts, section, search])

  const featured = filtered[0] ?? podcasts[0] ?? null
  const grid = filtered.slice(featured && filtered.includes(featured) ? 1 : 0)

  return (
    <AppShellV2>
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 py-6 sm:px-8 lg:px-10 lg:py-8">
        <header className="flex flex-col gap-2">
          <h1 className="font-display text-2xl font-bold text-text-primary lg:text-[32px] lg:leading-[1.1]">
            {t('podcasts.title', { defaultValue: 'Подкасты' })}
          </h1>
          <p className="text-sm text-text-secondary">
            {t('podcasts.subtitle', {
              defaultValue: 'Слушай разборы интервью, патчи в системном дизайне и stories из прода.',
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
              {t('podcasts.error', { defaultValue: 'Не удалось загрузить каталог.' })}
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-text-primary hover:bg-accent-hover"
            >
              {t('podcasts.retry', { defaultValue: 'Повторить' })}
            </button>
          </div>
        ) : podcasts.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface-1 p-8 text-center">
            <Headphones className="mx-auto mb-3 h-8 w-8 text-text-muted" />
            <p className="text-sm text-text-secondary">
              {t('podcasts.empty', { defaultValue: 'Пока в каталоге нет ни одного эпизода.' })}
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
              <SectionFilter active={section} onChange={setSection} sections={availableSections} />
              <label className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface-2 px-3 sm:w-[280px]">
                <Search className="h-4 w-4 text-text-muted" aria-hidden />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('podcasts.search_placeholder', { defaultValue: 'Поиск по эпизодам…' }) as string}
                  className="flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted"
                  aria-label={t('podcasts.search_placeholder', { defaultValue: 'Поиск по эпизодам' }) as string}
                />
              </label>
            </div>
            {grid.length === 0 ? (
              <p className="text-sm text-text-muted">
                {t('podcasts.no_match', { defaultValue: 'Ничего не нашлось — попробуй другой фильтр.' })}
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
