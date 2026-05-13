// Hone остался focus cockpit (taskboard / coach / notes / English drills).
//
// Reads `usePodcastsQuery` + `usePodcastCategoriesQuery` (DB-backed via
// chi-direct REST). Category filter + simple HTML5 audio player per row.
// На finished playback — log activity (kind='reading' с source='podcast').
import { useMemo, useState } from 'react'
import { Headphones, Play, CheckCircle2 } from 'lucide-react'

import { AppShellV2 } from '../components/AppShell'
import { Card } from '../components/Card'
import { DataLoader } from '../components/DataLoader'
import { KnowledgeHubTabs } from '../components/KnowledgeHubTabs'
import { PersonalContextBanner } from '../components/PersonalContextBanner'
import { logActivity } from '../lib/activity'
import {
  usePodcastCategoriesQuery,
  usePodcastsQuery,
  type Podcast,
  type PodcastCategory,
} from '../lib/queries/podcasts'

const ALL = 'all' as const

function Hero({ total }: { total: number }) {
  return (
    <section className="flex flex-col items-start justify-center gap-3 bg-surface-1 px-4 py-8 sm:px-8 lg:px-20">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-text-primary/10 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-text-secondary">
        <Headphones className="h-3 w-3" />
        ПОДКАСТЫ
      </span>
      <h1 className="font-display text-3xl font-bold leading-[1.1] text-text-primary lg:text-[36px]">
        Что слушать в фоне
      </h1>
      <p className="max-w-[640px] text-[15px] text-text-secondary">
        {total > 0 ? `${total} эпизодов` : 'Каталог'} про подготовку к собеседованиям,
        senior IT, ML, English. Слушай в дороге — каждый завершённый эпизод
        логируется в твою trajectory.
      </p>
    </section>
  )
}

function CategoryFilters({
  active,
  onChange,
  categories,
}: {
  active: string
  onChange: (slug: string) => void
  categories: PodcastCategory[]
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-5 sm:px-8 lg:px-20">
      <button
        type="button"
        onClick={() => onChange(ALL)}
        className={
          active === ALL
            ? 'inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3.5 py-1.5 text-[13px] font-semibold text-text-primary'
            : 'inline-flex items-center gap-1.5 rounded-full border border-border bg-bg px-3.5 py-1.5 text-[13px] text-text-secondary hover:border-border-strong hover:text-text-primary'
        }
      >
        Все
      </button>
      {categories.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onChange(c.id)}
          className={
            active === c.id
              ? 'inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3.5 py-1.5 text-[13px] font-semibold text-text-primary'
              : 'inline-flex items-center gap-1.5 rounded-full border border-border bg-bg px-3.5 py-1.5 text-[13px] text-text-secondary hover:border-border-strong hover:text-text-primary'
          }
        >
          {c.name}
        </button>
      ))}
    </div>
  )
}

function PodcastRow({ p }: { p: Podcast }) {
  const [playing, setPlaying] = useState(false)
  const onEnded = () => {
    logActivity({
      kind: 'reading',
      title: p.title,
      source: 'podcast',
      minutes: Math.max(1, Math.round(p.duration_sec / 60)),
    })
    setPlaying(false)
  }
  const duration = useMemo(() => {
    const min = Math.round(p.duration_sec / 60)
    if (min < 60) return `${min} мин`
    const h = Math.floor(min / 60)
    const r = min - h * 60
    return r === 0 ? `${h}ч` : `${h}ч ${r}м`
  }, [p.duration_sec])
  return (
    <Card className="flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            {p.category?.name ?? 'Без категории'}
            {p.episode_num !== undefined && p.episode_num > 0 && (
              <>
                <span>·</span>
                <span>эпизод {p.episode_num}</span>
              </>
            )}
            <span>·</span>
            <span>{duration}</span>
          </div>
          <h3 className="mt-1 font-display text-[15px] font-bold leading-tight text-text-primary">
            {p.title}
          </h3>
          {p.host && (
            <p className="mt-0.5 font-mono text-[11px] text-text-muted">{p.host}</p>
          )}
          {p.description && (
            <p className="mt-2 text-[13px] leading-snug text-text-secondary">{p.description}</p>
          )}
        </div>
        {p.completed && (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-text-secondary"
            title="Прослушан полностью"
          >
            <CheckCircle2 className="h-3 w-3" />
            прослушан
          </span>
        )}
      </div>
      {p.audio_url ? (
        playing ? (
          <audio
            controls
            autoPlay
            src={p.audio_url}
            onEnded={onEnded}
            preload="none"
            className="w-full"
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="inline-flex items-center gap-2 self-start rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[12px] font-semibold text-text-primary transition-colors hover:border-border-strong"
          >
            <Play className="h-3.5 w-3.5" />
            Воспроизвести
          </button>
        )
      ) : (
        <span className="font-mono text-[11px] text-text-muted">audio_url пуст — episode pending</span>
      )}
    </Card>
  )
}

export default function PodcastsPage() {
  const [category, setCategory] = useState<string>(ALL)
  const podcastsQ = usePodcastsQuery({ categoryId: category === ALL ? undefined : category })
  const categoriesQ = usePodcastCategoriesQuery()

  return (
    <AppShellV2>
      <KnowledgeHubTabs active="podcasts" />
      <Hero total={podcastsQ.data?.length ?? 0} />

      <div className="px-4 pt-5 sm:px-8 lg:px-20">
        <PersonalContextBanner />
      </div>

      <DataLoader
        state={categoriesQ}
        section="Категории"
        skeleton={<div className="px-4 py-5 sm:px-8 lg:px-20" />}
      >
        {(cats) => (
          <CategoryFilters
            active={category}
            onChange={setCategory}
            categories={cats}
          />
        )}
      </DataLoader>

      <div className="px-4 pb-12 sm:px-8 lg:px-20">
        <DataLoader
          state={podcastsQ}
          section="Подкасты"
          skeleton={
            <Card className="flex-col gap-1 p-8 text-center">
              <span className="font-display text-base font-bold text-text-primary">
                Загружаем подкасты
              </span>
            </Card>
          }
          empty={(data) => data.length === 0}
          emptyContent={
            <Card className="flex-col gap-1 p-8 text-center">
              <span className="font-display text-base font-bold text-text-primary">
                Эпизодов нет
              </span>
              <span className="text-sm text-text-secondary">
                Каталог пуст или нет совпадений по фильтру.
              </span>
            </Card>
          }
        >
          {(podcasts) => (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {podcasts.map((p) => (
                <PodcastRow key={p.id} p={p} />
              ))}
            </div>
          )}
        </DataLoader>
      </div>
    </AppShellV2>
  )
}
