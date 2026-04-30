// /codex — каталог статей-знаний (System Design, алгоритмы, карьера...).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowUpRight, Search } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { KnowledgeHubTabs } from '../components/KnowledgeHubTabs'
import { Card } from '../components/Card'
import {
  pingCodexArticleOpened,
  useCodexArticlesQuery,
  useCodexCategoriesQuery,
  type CodexArticle as DBCodexArticle,
  type CodexCategory as DBCodexCategory,
} from '../lib/queries/codex'

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
  return (
    <section
      className="flex flex-col items-start justify-center gap-3 px-4 py-8 sm:px-8 lg:px-20"
      style={{
        background: 'linear-gradient(180deg, #0A0A0A 0%, #0A0A0F 100%)',
      }}
    >
      <span className="inline-flex items-center gap-1.5 rounded-full bg-text-primary/10 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-text-secondary">
        CODEX · БИБЛИОТЕКА ЗНАНИЙ
      </span>
      <h1 className="font-display text-3xl font-bold leading-[1.1] text-text-primary lg:text-[36px]">
        Что почитать к собесу
      </h1>
      <p className="max-w-[640px] text-[15px] text-text-secondary">
        {total} статей и референсов про System Design, алгоритмы, SQL,
        Go и поведенческие интервью. Все ссылки — на стабильные публичные
        источники: Wikipedia, MDN, RFC, официальные доки.
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
        Все <span className="font-mono text-[11px] text-text-muted">{total}</span>
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
  return (
    <div className="flex w-full max-w-md items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
      <Search className="h-4 w-4 text-text-muted" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Поиск по заголовку или описанию..."
        className="w-full bg-transparent text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none"
      />
    </div>
  )
}

function ArticleCard({
  a,
  highlighted,
  articleRef,
}: {
  a: CodexArticle
  highlighted: boolean
  articleRef: (node: HTMLAnchorElement | null) => void
}) {
  // Coach memory tap: when the user opens an article, ping the backend
  // so the Daily Brief can later say "ты регулярно читаешь sysdesign —
  // попробуй mock этого этапа".
  return (
    <a
      ref={articleRef}
      href={a.href}
      target="_blank"
      rel="noopener noreferrer"
      className={
        highlighted
          ? 'block scroll-mt-24 rounded-xl outline outline-2 outline-offset-4 outline-text-primary/70'
          : 'block scroll-mt-24 rounded-xl'
      }
      onClick={() => {
        if (a.id) pingCodexArticleOpened(a.id)
      }}
    >
      <Card interactive className="flex-col gap-2 p-5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            {a.category.replace('_', ' ')}
          </span>
          <ArrowUpRight className="h-3.5 w-3.5 text-text-muted group-hover:text-text-primary" />
        </div>
        <h4 className="font-sans text-[15px] font-bold leading-tight text-text-primary">
          {a.title}
        </h4>
        <p className="text-[13px] leading-snug text-text-secondary">{a.description}</p>
        <div className="mt-auto flex items-center justify-between pt-2">
          <span className="font-mono text-[11px] text-text-muted">{a.source}</span>
          <span className="font-mono text-[11px] text-text-muted">{a.read_min} мин</span>
        </div>
      </Card>
    </a>
  )
}

export default function CodexPage() {
  // Coach links to /codex?topic=<slug>&article=<slug>.
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTopic = searchParams.get('topic') || ALL
  const [category, setCategory] = useState<string>(initialTopic)
  const [q, setQ] = useState<string>('')
  const articleRefs = useRef(new Map<string, HTMLAnchorElement | null>())

  const handleCategoryChange = (slug: string) => {
    setCategory(slug)
    if (slug === ALL) setSearchParams({}, { replace: true })
    else setSearchParams({ topic: slug }, { replace: true })
  }

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
  const visible = articles.filter((a) => {
    if (category !== ALL && a.category !== category) return false
    if (norm.length === 0) return true
    return (
      a.title.toLowerCase().includes(norm) ||
      a.description.toLowerCase().includes(norm)
    )
  })
  const countsByCat = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of articles) m.set(a.category, (m.get(a.category) ?? 0) + 1)
    return m
  }, [articles])

  return (
    <AppShellV2>
      {/* WAVE-13 — shared "Статьи · Подкасты" tabs unify Codex + Podcasts
          under a single header entry. */}
      <KnowledgeHubTabs active="articles" />
      <Hero total={articles.length} />
      <CategoryFilters
        active={category}
        onChange={handleCategoryChange}
        total={articles.length}
        countsByCat={countsByCat}
        categories={categories}
      />
      <div className="px-4 pb-4 sm:px-8 lg:px-20">
        <SearchBox value={q} onChange={setQ} />
      </div>
      <div className="px-4 pb-12 sm:px-8 lg:px-20">
        {articlesQ.isLoading ? (
          <Card className="flex-col gap-1 p-8 text-center">
            <span className="font-display text-base font-bold text-text-primary">
              Загружаем Codex
            </span>
          </Card>
        ) : articlesQ.isError || categoriesQ.isError ? (
          <Card className="flex-col gap-1 p-8 text-center">
            <span className="font-display text-base font-bold text-text-primary">
              Codex сейчас недоступен
            </span>
            <span className="text-sm text-text-secondary">
              Не удалось загрузить статьи из backend.
            </span>
          </Card>
        ) : visible.length === 0 ? (
          <Card className="flex-col gap-1 p-8 text-center">
            <span className="font-display text-base font-bold text-text-primary">
              Ничего не нашлось
            </span>
            <span className="text-sm text-text-secondary">
              Попробуй убрать фильтр категории или почистить поиск.
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
      </div>
    </AppShellV2>
  )
}
