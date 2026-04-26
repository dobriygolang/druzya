// /codex — каталог статей-знаний (System Design, алгоритмы, карьера...).
//
// Это контент-страница, не runtime: каталог хранится в src/content/codex.ts
// и попадает в bundle на build. Никакого backend-запроса здесь не делаем —
// раньше был placeholder с фейковыми "12480 прослушиваний" и хардкоженным
// плеером; то и другое снято, потому что подкастов как продукта пока нет.
// Когда заведём собственный CMS или blog — заменить импорт CODEX_ARTICLES
// на useQuery (см. content/codex.ts header).
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowUpRight, Search } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { KnowledgeHubTabs } from '../components/KnowledgeHubTabs'
import { Card } from '../components/Card'
import {
  CODEX_ARTICLES as CODEX_FALLBACK,
  codexCategoriesWithCounts,
  type CodexArticle as StaticCodexArticle,
} from '../content/codex'
import { useCodexArticlesQuery, type CodexArticle as DBCodexArticle } from '../lib/queries/codex'

// Унифицированный тип для рендера: фронтовый StaticCodexArticle (id,
// read_min, href, source) совпадает с DBCodexArticle по форме после
// нормализации, поэтому компоненты ниже работают с обоими.
type CodexArticle = StaticCodexArticle | DBCodexArticle

const ALL = 'all' as const

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
}: {
  active: string
  onChange: (slug: string) => void
  total: number
  countsByCat: Map<string, number>
}) {
  const cats = codexCategoriesWithCounts().map((c) => ({
    ...c,
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

function ArticleCard({ a }: { a: CodexArticle }) {
  return (
    <a
      href={a.href}
      target="_blank"
      rel="noopener noreferrer"
      className="block"
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
  // Coach links to /codex?topic=<slug> для конкретной категории. Парсим
  // initial state из URL чтобы открытие из brief'а сразу filter'ило.
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTopic = searchParams.get('topic') || ALL
  const [category, setCategory] = useState<string>(initialTopic)
  const [q, setQ] = useState<string>('')

  useEffect(() => {
    // Sync URL ↔ state в обе стороны: external nav (Coach link) → setCategory;
    // user click filter → URL.
    const fromURL = searchParams.get('topic') || ALL
    if (fromURL !== category) setCategory(fromURL)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const handleCategoryChange = (slug: string) => {
    setCategory(slug)
    if (slug === ALL) setSearchParams({}, { replace: true })
    else setSearchParams({ topic: slug }, { replace: true })
  }

  // Backend → fallback to compiled-in seed when API hasn't responded
  // yet OR returned an error (offline/dev-without-MSW). The static set
  // is the same 22 entries that seeded the DB so the UX degrades to
  // "looks identical" rather than "broken".
  const articlesQ = useCodexArticlesQuery()
  const articles: CodexArticle[] = articlesQ.data && articlesQ.data.length > 0
    ? articlesQ.data
    : CODEX_FALLBACK
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
      />
      <div className="px-4 pb-4 sm:px-8 lg:px-20">
        <SearchBox value={q} onChange={setQ} />
      </div>
      <div className="px-4 pb-12 sm:px-8 lg:px-20">
        {visible.length === 0 ? (
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
              <ArticleCard key={a.id} a={a} />
            ))}
          </div>
        )}
      </div>
    </AppShellV2>
  )
}
