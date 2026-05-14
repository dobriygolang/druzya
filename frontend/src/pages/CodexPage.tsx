// /codex — каталог статей-знаний (System Design, алгоритмы, карьера...).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowUpRight, Search, Sparkles, ChevronDown } from 'lucide-react'
import { useTranslation, Trans } from 'react-i18next'
import { AppShellV2 } from '../components/AppShell'
import { KnowledgeHubTabs } from '../components/KnowledgeHubTabs'
import { Card } from '../components/Card'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { DataLoader } from '../components/DataLoader'
import { PersonalContextBanner } from '../components/PersonalContextBanner'
import {
  pingCodexArticleOpened,
  useCodexArticlesQuery,
  useCodexCategoriesQuery,
  type CodexArticle as DBCodexArticle,
  type CodexCategory as DBCodexCategory,
} from '../lib/queries/codex'
import {
  getSourceIcon,
  pickRecommendedArticles,
  sortArticles,
  getSortLabel,
  SORT_MODES,
  type CodexSortMode,
} from '../lib/codexHelpers'
import { loadProgress } from '../lib/diagnostic'
import { TrackFilterChips } from '../components/TrackFilterChips'
import { useTrackFilter } from '../lib/useTrackFilter'
import { classifyCodexCategory, itemMatchesFilter } from '../lib/trackFilter'

type CodexArticle = DBCodexArticle

const ALL = 'all' as const

type RenderCategory = Pick<DBCodexCategory, 'slug' | 'label'>

function articleSlug(a: CodexArticle): string {
  return a.slug
}

function visibleArticleKey(a: CodexArticle): string {
  return `${a.category}:${articleSlug(a)}`
}

function categoriesFromArticles(articles: CodexArticle[]): RenderCategory[] {
  const seen = new Set<string>()
  const out: RenderCategory[] = []
  for (const a of articles) {
    if (!a.category || seen.has(a.category)) continue
    seen.add(a.category)
    out.push({ slug: a.category, label: a.category.replace(/_/g, ' ') })
  }
  return out
}

function Hero({ total }: { total: number }) {
  const { t } = useTranslation('codex')
  return (
    <section
      className="flex flex-col items-start justify-center gap-3 bg-surface-1 px-4 py-10 sm:px-8 lg:px-20 lg:py-12"
      style={{ borderBottom: '1px solid var(--hair)' }}
    >
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em]"
        style={{
          background: 'rgba(var(--ink), 0.06)',
          color: 'var(--ink-60)',
        }}
      >
        <span
          className="inline-block h-1 w-1 rounded-full"
          style={{ background: 'var(--red)' }}
          aria-hidden
        />
        {t('hero.eyebrow')}
      </span>
      <h1 className="font-display text-3xl font-bold leading-[1.1] lg:text-[40px]"
        style={{ color: 'rgb(var(--ink))' }}
      >
        {t('hero.title')}
      </h1>
      <p
        className="max-w-[640px] text-[15px] leading-relaxed"
        style={{ color: 'var(--ink-60)' }}
      >
        <Trans
          ns="codex"
          i18nKey="hero.description_html"
          values={{ total }}
          components={{
            1: <span className="font-display tabular-nums" style={{ color: 'rgb(var(--ink))' }} />,
          }}
        />
      </p>
    </section>
  )
}

function CategoryFilters({
  active,
  onChange,
  total,
  countsByCat,
  categories,
}: {
  active: string
  onChange: (slug: string) => void
  total: number
  countsByCat: Map<string, number>
  categories: RenderCategory[]
}) {
  const { t } = useTranslation('codex')
  const cats = categories.map((c) => ({
    slug: c.slug,
    label: c.label,
    count: countsByCat.get(c.slug) ?? 0,
  }))
  void total
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
        {t('filters.all')} <span className="font-mono text-[11px] text-text-muted">{total}</span>
      </button>
      {cats.map((c) => (
        <button
          key={c.slug}
          type="button"
          onClick={() => onChange(c.slug)}
          className={
            active === c.slug
              ? 'inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3.5 py-1.5 text-[13px] font-semibold text-text-primary'
              : 'inline-flex items-center gap-1.5 rounded-full border border-border bg-bg px-3.5 py-1.5 text-[13px] text-text-secondary hover:border-border-strong hover:text-text-primary'
          }
        >
          {c.label} <span className="font-mono text-[11px] text-text-muted">{c.count}</span>
        </button>
      ))}
    </div>
  )
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation('codex')
  // Underline-only form field — foundation style. Border-bottom only,
  // no surface fill / box outline. Focus ramps the underline to full ink.
  return (
    <div
      className="flex w-full max-w-md items-center gap-2 px-1 py-1.5"
      style={{
        borderBottom: '1px solid var(--hair-2)',
        transition: 'border-color var(--motion-dur-small) var(--motion-ease-standard)',
      }}
    >
      <Search className="h-4 w-4" style={{ color: 'var(--ink-40)' }} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('search.placeholder')}
        className="w-full bg-transparent text-[13px] focus:outline-none"
        style={{ color: 'rgb(var(--ink))' }}
      />
    </div>
  )
}

function ArticleCard({
  a,
  highlighted,
  articleRef,
  recommended,
}: {
  a: CodexArticle
  highlighted: boolean
  articleRef: (node: HTMLAnchorElement | null) => void
  /** Marked если попал в «Для тебя» секцию — мелкий sparkle перед источником. */
  recommended?: boolean
}) {
  const { t } = useTranslation('codex')
  // Coach memory tap: when the user opens an article, ping the backend
  // so the Daily Brief can later say "ты регулярно читаешь sysdesign —
  // попробуй mock этого этапа".
  const SourceIcon = getSourceIcon(a.source)
  return (
    <a
      ref={articleRef}
      href={a.href}
      target="_blank"
      rel="noopener noreferrer"
      className="relative block scroll-mt-24 rounded-xl"
      onClick={() => {
        if (a.id) pingCodexArticleOpened(a.id)
      }}
    >
      {highlighted && (
        // Red signal stripe — active card selection marker. 1.5px left
        // rail; b/w rule: red is the only allowed accent and only as
        // signal (not bg/fill/gradient).
        <span
          aria-hidden
          className="pointer-events-none absolute -left-[3px] top-3 bottom-3 w-[1.5px] rounded-full"
          style={{ background: 'var(--red)' }}
        />
      )}
      <Card interactive className="flex-col gap-2 p-5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: 'var(--ink-40)' }}
          >
            {a.category.replace('_', ' ')}
          </span>
          <ArrowUpRight
            className="h-3.5 w-3.5"
            style={{ color: 'var(--ink-40)' }}
          />
        </div>
        <h4 className="font-sans text-[15px] font-bold leading-tight" style={{ color: 'rgb(var(--ink))' }}>
          {a.title}
        </h4>
        <p className="text-[13px] leading-snug" style={{ color: 'var(--ink-60)' }}>{a.description}</p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px]"
            style={{ color: 'var(--ink-40)' }}
          >
            {recommended && (
              <Sparkles className="h-3 w-3" style={{ color: 'rgb(var(--ink))' }} aria-label={t('filter.for_you_aria')} />
            )}
            <SourceIcon className="h-3 w-3" aria-hidden />
            {a.source}
          </span>
          <span className="font-mono text-[11px]" style={{ color: 'var(--ink-40)' }}>{t('filter.minutes', { count: a.read_min })}</span>
        </div>
      </Card>
    </a>
  )
}

// SortPicker — R1 ranking-proxy dropdown. Native <select> для keyboard a11y +
// mobile native picker. Inline в toolbar над SearchBox.
function SortPicker({ value, onChange }: { value: CodexSortMode; onChange: (v: CodexSortMode) => void }) {
  const { t } = useTranslation('codex')
  return (
    <label className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-[12.5px] text-text-secondary">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
        {t('filter.sort')}
      </span>
      <span className="relative inline-flex items-center">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as CodexSortMode)}
          className="appearance-none bg-transparent pr-6 text-[12.5px] font-semibold text-text-primary focus:outline-none"
        >
          {SORT_MODES.map((mode) => (
            <option key={mode} value={mode} className="bg-bg text-text-primary">
              {getSortLabel(mode)}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-0 h-3.5 w-3.5 text-text-muted" />
      </span>
    </label>
  )
}

// RecommendedSection — F9 diagnostic-driven «Для тебя». Hidden если нет
// answers или ни одной article под weakest area (anti-fallback: не симулируем
// случайные советы).
function RecommendedSection({
  articles,
  highlightedSlug,
  articleRef,
}: {
  articles: CodexArticle[]
  highlightedSlug: string
  articleRef: (slug: string, node: HTMLAnchorElement | null) => void
}) {
  const { t } = useTranslation('codex')
  if (articles.length === 0) return null
  return (
    <section className="px-4 pb-2 pt-4 sm:px-8 lg:px-20">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-text-primary" />
          <h2 className="font-display text-base font-bold leading-tight text-text-primary">
            {t('recommended.title')}
          </h2>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          {t('recommended.weakest_caption', { count: articles.length })}
        </span>
      </header>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {articles.map((a) => (
          <ArticleCard
            key={`rec-${a.category}-${a.slug}`}
            a={a}
            recommended
            highlighted={highlightedSlug === a.slug}
            articleRef={(node) => articleRef(a.slug, node)}
          />
        ))}
      </div>
    </section>
  )
}

export default function CodexPage() {
  const { t } = useTranslation('codex')
  // Coach links to /codex?topic=<slug>&article=<slug>.
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTopic = searchParams.get('topic') || ALL
  const [category, setCategory] = useState<string>(initialTopic)
  const [q, setQ] = useState<string>('')
  const [sortMode, setSortMode] = useState<CodexSortMode>('default')
  const articleRefs = useRef(new Map<string, HTMLAnchorElement | null>())

  const handleCategoryChange = (slug: string) => {
    setCategory(slug)
    if (slug === ALL) setSearchParams({}, { replace: true })
    else setSearchParams({ topic: slug }, { replace: true })
  }

  // ?tracks=ml so a coach link «check this ML reading» can scope the
  // surface in one go.
  const { selected: selectedTracks, setSelected: setSelectedTracks } = useTrackFilter({
    persistKey: 'codex:track-filter:v1',
    defaultFromPrimaryGoal: true,
  })

  const articlesQ = useCodexArticlesQuery()
  const categoriesQ = useCodexCategoriesQuery()
  const articles: CodexArticle[] = useMemo(() => articlesQ.data ?? [], [articlesQ.data])
  const categories: RenderCategory[] = categoriesQ.data && categoriesQ.data.length > 0
    ? categoriesQ.data
    : categoriesFromArticles(articles)
  const requestedArticle = searchParams.get('article') || ''
  const requestedTopic = searchParams.get('topic') || ALL
  const targetArticle = requestedArticle
    ? articles.find((a) => articleSlug(a) === requestedArticle)
    : undefined
  const targetArticleKey = targetArticle ? visibleArticleKey(targetArticle) : ''

  useEffect(() => {
    const nextCategory = targetArticle?.category || requestedTopic
    setCategory((current) => (current === nextCategory ? current : nextCategory))
  }, [requestedTopic, targetArticle?.category])

  useEffect(() => {
    if (!requestedArticle || !targetArticleKey) return
    const node = articleRefs.current.get(requestedArticle)
    if (!node) return
    const timer = window.setTimeout(() => {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' })
      node.focus({ preventScroll: true })
    }, 50)
    return () => window.clearTimeout(timer)
  }, [requestedArticle, targetArticleKey])

  const norm = q.trim().toLowerCase()
  const filtered = articles.filter((a) => {
    if (selectedTracks.size > 0) {
      const track = classifyCodexCategory(a.category)
      if (!itemMatchesFilter(track, selectedTracks)) return false
    }
    if (category !== ALL && a.category !== category) return false
    if (norm.length === 0) return true
    return (
      a.title.toLowerCase().includes(norm) ||
      a.description.toLowerCase().includes(norm)
    )
  })
  const visible = useMemo(() => sortArticles(filtered, sortMode), [filtered, sortMode])
  const countsByCat = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of articles) m.set(a.category, (m.get(a.category) ?? 0) + 1)
    return m
  }, [articles])

  // R1 «Для тебя» — recommended top на основе F9 diagnostic weakest. Скрыт
  // когда: diagnostic не пройден ИЛИ юзер активно фильтрует (category или
  // search) — это «дай по умолчанию», не «навязать рекомендации».
  const [diagnosticWeakest, setDiagnosticWeakest] = useState<string | null>(() => {
    const answers = loadProgress()
    return (answers.weakest as string | undefined) ?? null
  })
  useEffect(() => {
    // Refresh weakest если юзер прошёл diagnostic в другом таб'е. localStorage
    // event fires только в чужих tab'ах — наш текущий tab подхватит после reload.
    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key.startsWith('druz9.diagnostic.answers')) {
        const answers = loadProgress()
        setDiagnosticWeakest((answers.weakest as string | undefined) ?? null)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const showRecommended = category === ALL && norm.length === 0
  const recommendedArticles = useMemo(() => {
    if (!showRecommended) return []
    const pool =
      selectedTracks.size > 0
        ? articles.filter((a) => itemMatchesFilter(classifyCodexCategory(a.category), selectedTracks))
        : articles
    return pickRecommendedArticles(pool, diagnosticWeakest, 3)
  }, [showRecommended, articles, diagnosticWeakest, selectedTracks])

  return (
    <AppShellV2>
      {/* WAVE-13 — shared "Статьи · Подкасты" tabs unify Codex + Podcasts
          under a single header entry. */}
      <KnowledgeHubTabs active="articles" />
      <Hero total={articles.length} />
      {/* Personal context banner — reuses /atlas pattern. Encourages
          juзера сначала пройти diagnostic / посмотреть план перед blind
          чтением Codex articles. F2 + F5 reactive. */}
      <div className="px-4 pt-5 sm:px-8 lg:px-20">
        <PersonalContextBanner />
      </div>
      {/* Track filter chips — Phase K 6.1. Coarse «3 equal tracks»
          pre-filter above the per-category chips. Selecting «ML» narrows
          both the recommended section и the main feed. */}
      <div className="flex flex-wrap items-center gap-3 px-4 pt-5 sm:px-8 lg:px-20">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          {t('filter.track_label')}
        </span>
        <TrackFilterChips
          selected={selectedTracks}
          onChange={setSelectedTracks}
          persistKey="codex:track-filter:v1"
          ariaLabel={t('filter.track_aria')}
        />
      </div>
      <CategoryFilters
        active={category}
        onChange={handleCategoryChange}
        total={articles.length}
        countsByCat={countsByCat}
        categories={categories}
      />
      <RecommendedSection
        articles={recommendedArticles}
        highlightedSlug={requestedArticle}
        articleRef={(slug, node) => {
          if (node) articleRefs.current.set(`rec-${slug}`, node)
          else articleRefs.current.delete(`rec-${slug}`)
        }}
      />
      <div className="flex flex-wrap items-center gap-3 px-4 pb-4 sm:px-8 lg:px-20">
        <SearchBox value={q} onChange={setQ} />
        <SortPicker value={sortMode} onChange={setSortMode} />
      </div>
      <div className="px-4 pb-12 sm:px-8 lg:px-20">
        <ErrorBoundary section="Codex">
          <DataLoader
            state={articlesQ}
            section="Codex"
            skeleton={
              <Card className="flex-col gap-1 p-8 text-center">
                <span className="font-display text-base font-bold text-text-primary">
                  {t('loading_card')}
                </span>
              </Card>
            }
            errorContent={() => (
              <Card className="flex-col gap-1 p-8 text-center">
                <span className="font-display text-base font-bold text-text-primary">
                  {t('unavailable_card')}
                </span>
                <span className="text-sm text-text-secondary">
                  {t('unavailable_desc')}
                </span>
              </Card>
            )}
          >
            {() => (
              <>
                {categoriesQ.isError && (
                  <Card className="flex-col gap-1 p-4 text-center">
                    <span className="text-sm text-text-secondary">
                      {t('categories_fallback')}
                    </span>
                  </Card>
                )}
                {visible.length === 0 ? (
                  <Card className="flex-col gap-1 p-8 text-center">
                    <span className="font-display text-base font-bold text-text-primary">
                      {t('empty_title')}
                    </span>
                    <span className="text-sm text-text-secondary">
                      {t('empty_desc')}
                    </span>
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {visible.map((a) => (
                      <ArticleCard
                        key={visibleArticleKey(a)}
                        a={a}
                        highlighted={requestedArticle === articleSlug(a)}
                        articleRef={(node) => {
                          const slug = articleSlug(a)
                          if (node) articleRefs.current.set(slug, node)
                          else articleRefs.current.delete(slug)
                        }}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </DataLoader>
        </ErrorBoundary>
      </div>
    </AppShellV2>
  )
}
