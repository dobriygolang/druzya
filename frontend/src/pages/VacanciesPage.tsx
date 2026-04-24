// /vacancies — каталог реальных вакансий с российских площадок
// (Yandex, Ozon, VK, MTS, Wildberries).
//
// Источник правды — backend services/vacancies. Phase 3 модель:
//
//   - Парсеры пишут в in-memory cache на бэкенде (тиком 15 минут).
//   - Идентификация: композитный ключ (source, external_id), нет числового id.
//   - Фасеты грузим отдельным /vacancies/facets-запросом и рендерим в виде
//     чекбокс-секций: Компания, Направление, Источник.
//   - Save требует логина; Snapshot вакансии замораживается на бэке в saved_vacancies.

import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Search,
  Briefcase,
  MapPin,
  Wallet,
  Sparkles,
  Bookmark,
  X,
} from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import {
  useVacanciesList,
  useFacetsQuery,
  useAnalyzeVacancy,
  useSaveVacancy,
  VACANCY_SOURCES,
  VACANCY_CATEGORIES,
  CATEGORY_LABEL,
  diffSkills,
  type Vacancy,
  type VacancySource,
  type VacancyCategory,
  type FacetEntry,
  type AnalyzeResponse,
} from '../lib/queries/vacancies'
import { useProfileQuery } from '../lib/queries/profile'
import { useAIVacanciesModelQuery } from '../lib/queries/settings'

function formatSalary(min?: number, max?: number, currency?: string): string {
  if (!min && !max) return ''
  const cur = (currency ?? 'RUR').replace('RUR', '₽').replace('RUB', '₽')
  const fmt = (n: number) => new Intl.NumberFormat('ru-RU').format(n)
  if (min && max && min !== max) return `${fmt(min)}–${fmt(max)} ${cur}`
  return `от ${fmt(min ?? max ?? 0)} ${cur}`
}

const SOURCE_LABEL: Record<VacancySource, string> = {
  yandex: 'Yandex',
  ozon: 'Ozon',
  ozontech: 'Ozon Tech',
  tinkoff: 'T-Bank',
  vk: 'VK',
  sber: 'Sber',
  avito: 'Avito',
  wildberries: 'WB',
  mts: 'MTS',
  kaspersky: 'Kaspersky',
  jetbrains: 'JetBrains',
  lamoda: 'Lamoda',
}

function SourceBadge({ source }: { source: VacancySource }) {
  return (
    <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase text-text-secondary">
      {SOURCE_LABEL[source] ?? source}
    </span>
  )
}

function SkillChip({ s, state }: { s: string; state: 'matched' | 'gap' | 'extra' }) {
  const cls =
    state === 'matched' ? 'border-success/40 bg-success/10 text-success' :
    state === 'gap' ? 'border-warning/40 bg-warning/10 text-warning' :
    'border-border bg-surface-2 text-text-secondary'
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${cls}`}>{s}</span>
  )
}

function VacancyCard({
  v,
  userSkills,
  onSave,
}: {
  v: Vacancy
  userSkills: string[]
  onSave?: (source: VacancySource, externalId: string) => void
}) {
  const top = v.normalized_skills.slice(0, 5)
  const { matched, missing } = diffSkills(top, userSkills)
  // Whole-card link: clicking anywhere in the card navigates to detail.
  // Nested interactives (Сохранить) call e.preventDefault() + stopPropagation()
  // so the bookmark button doesn't also fire navigation. `group` enables
  // group-hover on the title (colour shift on entire-card hover).
  return (
    <Link
      to={`/vacancies/${v.source}/${encodeURIComponent(v.external_id)}`}
      className="group block rounded-xl no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      <Card variant="elevated" interactive padding="lg">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <SourceBadge source={v.source} />
              {v.experience_level && (
                <span className="font-mono text-[10px] uppercase text-text-muted">
                  {v.experience_level}
                </span>
              )}
            </div>
            <span className="font-display text-base font-bold text-text-primary transition-colors group-hover:text-accent">
              {v.title}
            </span>
            {v.company && (
              <div className="flex items-center gap-1 text-xs text-text-secondary">
                <Briefcase className="h-3 w-3" /> {v.company}
              </div>
            )}
            {v.location && (
              <div className="flex items-center gap-1 text-xs text-text-muted">
                <MapPin className="h-3 w-3" /> {v.location}
              </div>
            )}
          </div>
          {onSave && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Bookmark className="h-4 w-4" />}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onSave(v.source, v.external_id)
              }}
            >
              Сохранить
            </Button>
          )}
        </div>
        {(v.salary_min || v.salary_max) && (
          <div className="mt-3 flex items-center gap-1 text-sm text-success">
            <Wallet className="h-4 w-4" />
            {formatSalary(v.salary_min, v.salary_max, v.currency)}
          </div>
        )}
        {top.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {top.map((s) => (
              <SkillChip
                key={s}
                s={s}
                state={matched.has(s.toLowerCase()) ? 'matched' : missing.has(s.toLowerCase()) ? 'gap' : 'extra'}
              />
            ))}
          </div>
        )}
      </Card>
    </Link>
  )
}

// CheckboxFacetSection — переиспользуемая секция сайдбара с чекбоксами и
// counter-бейджами. Сворачивает список после 10 элементов с «Показать все».
function CheckboxFacetSection<T extends string>({
  title,
  options,
  selected,
  onToggle,
  labelOf,
}: {
  title: string
  options: FacetEntry[]
  selected: T[]
  onToggle: (value: T) => void
  labelOf?: (value: string) => string
}) {
  const [expanded, setExpanded] = useState(false)
  if (options.length === 0) return null
  const visible = expanded ? options : options.slice(0, 10)
  const hidden = options.length - visible.length
  return (
    <div className="mb-4">
      <div className="mb-2 text-xs uppercase text-text-muted">{title}</div>
      <div className="flex flex-col gap-1.5">
        {visible.map((o) => {
          const checked = (selected as string[]).includes(o.name)
          return (
            <label
              key={o.name}
              className={`flex cursor-pointer items-center justify-between gap-2 rounded-md border px-2.5 py-1 text-xs transition-colors ${
                checked
                  ? 'border-accent bg-accent/15 text-text-primary'
                  : 'border-border bg-surface-2 text-text-secondary hover:border-border-strong'
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(o.name as T)}
                  className="h-3.5 w-3.5 shrink-0 accent-accent"
                />
                <span className="truncate">{labelOf ? labelOf(o.name) : o.name}</span>
              </span>
              <span className="font-mono text-[10px] text-text-muted">{o.count}</span>
            </label>
          )
        })}
      </div>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 text-[11px] text-accent-hover hover:underline"
        >
          Показать все ({options.length})
        </button>
      )}
      {expanded && options.length > 10 && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-2 text-[11px] text-text-muted hover:underline"
        >
          Свернуть
        </button>
      )}
    </div>
  )
}

function FilterSidebar({
  facetsCompanies,
  facetsCategories,
  facetsSources,
  companies,
  setCompanies,
  categories,
  setCategories,
  sources,
  setSources,
  salaryMin,
  setSalaryMin,
  location,
  setLocation,
}: {
  facetsCompanies: FacetEntry[]
  facetsCategories: FacetEntry[]
  facetsSources: FacetEntry[]
  companies: string[]
  setCompanies: (xs: string[]) => void
  categories: VacancyCategory[]
  setCategories: (xs: VacancyCategory[]) => void
  sources: VacancySource[]
  setSources: (xs: VacancySource[]) => void
  salaryMin: number
  setSalaryMin: (n: number) => void
  location: string
  setLocation: (s: string) => void
}) {
  const toggle = <T extends string>(xs: T[], set: (n: T[]) => void, x: T) => {
    if (xs.includes(x)) set(xs.filter((y) => y !== x))
    else set([...xs, x])
  }

  // Категории: рендерим в каноническом порядке VACANCY_CATEGORIES, чтобы UI
  // не прыгал между обновлениями фасетов. Подмешиваем count из бэка.
  const categoryFacetByName = new Map(facetsCategories.map((e) => [e.name, e.count]))
  const orderedCategoryFacets: FacetEntry[] = VACANCY_CATEGORIES.map((c) => ({
    name: c,
    count: categoryFacetByName.get(c) ?? 0,
  }))

  // Источники: оставляем только те, что фактически есть в фасете И
  // присутствуют в нашем frontend-allowlist.
  const sourceFacetByName = new Map(facetsSources.map((e) => [e.name, e.count]))
  const orderedSourceFacets: FacetEntry[] = VACANCY_SOURCES
    .filter((s) => sourceFacetByName.has(s))
    .map((s) => ({ name: s, count: sourceFacetByName.get(s) ?? 0 }))

  return (
    <Card variant="default" padding="md" className="self-start">
      <h3 className="mb-3 font-display text-sm font-semibold text-text-primary">
        Фильтры
      </h3>
      <CheckboxFacetSection<string>
        title="Компания"
        options={facetsCompanies}
        selected={companies}
        onToggle={(x) => toggle(companies, setCompanies, x)}
      />
      <CheckboxFacetSection<VacancyCategory>
        title="Направление"
        options={orderedCategoryFacets}
        selected={categories}
        onToggle={(x) => toggle(categories, setCategories, x)}
        labelOf={(name) => CATEGORY_LABEL[name as VacancyCategory] ?? name}
      />
      <CheckboxFacetSection<VacancySource>
        title="Источник"
        options={orderedSourceFacets}
        selected={sources}
        onToggle={(x) => toggle(sources, setSources, x)}
        labelOf={(name) => SOURCE_LABEL[name as VacancySource] ?? name}
      />
      <div className="mb-4">
        <label className="mb-1 block text-xs uppercase text-text-muted" htmlFor="salaryMin">
          Зарплата от, ₽
        </label>
        <input
          id="salaryMin"
          type="number"
          value={salaryMin || ''}
          onChange={(e) => setSalaryMin(Number(e.target.value) || 0)}
          placeholder="0"
          className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs uppercase text-text-muted" htmlFor="location">
          Город
        </label>
        <input
          id="location"
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Москва"
          className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
        />
      </div>
    </Card>
  )
}

export default function VacanciesPage() {
  const [sources, setSources] = useState<VacancySource[]>([])
  const [companies, setCompanies] = useState<string[]>([])
  const [categories, setCategories] = useState<VacancyCategory[]>([])
  const [salaryMin, setSalaryMin] = useState(0)
  const [location, setLocation] = useState('')
  const [page, setPage] = useState(1)
  const list = useVacanciesList({
    sources: sources.length ? sources : undefined,
    companies: companies.length ? companies : undefined,
    categories: categories.length ? categories : undefined,
    salary_min: salaryMin || undefined,
    location: location || undefined,
    page,
    limit: 30,
  })
  const facets = useFacetsQuery()
  const profile = useProfileQuery()
  const userSkills = useMemo(() => {
    type ProfileBundle = { skill_nodes?: { node_key?: string }[] }
    const b = (profile.data as unknown as ProfileBundle | undefined) ?? {}
    return (b.skill_nodes ?? []).map((n) => n.node_key ?? '').filter(Boolean)
  }, [profile.data])
  const navigate = useNavigate()
  const save = useSaveVacancy()

  const handleSave = (source: VacancySource, externalId: string) => {
    save.mutate({ source, externalId }, {
      onError: (err) => {
        if (err instanceof Error && err.message.includes('401')) {
          navigate('/welcome')
        }
      },
    })
  }

  return (
    <AppShellV2>
      <Hero />
      <div className="grid grid-cols-1 gap-6 px-4 py-6 sm:px-8 lg:grid-cols-[280px_1fr] lg:px-20">
        <FilterSidebar
          facetsCompanies={facets.data?.companies ?? []}
          facetsCategories={facets.data?.categories ?? []}
          facetsSources={facets.data?.sources ?? []}
          companies={companies}
          setCompanies={setCompanies}
          categories={categories}
          setCategories={setCategories}
          sources={sources}
          setSources={setSources}
          salaryMin={salaryMin}
          setSalaryMin={setSalaryMin}
          location={location}
          setLocation={setLocation}
        />
        <div className="flex flex-col gap-4">
          {list.isLoading ? (
            <ListSkeleton />
          ) : list.error ? (
            <ErrorState />
          ) : (list.data?.items.length ?? 0) === 0 ? (
            <EmptyState />
          ) : (
            <>
              <div className="text-xs uppercase text-text-muted">
                {list.data?.total} вакансий · стр. {page}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {list.data?.items.map((v) => (
                  <VacancyCard
                    key={`${v.source}|${v.external_id}`}
                    v={v}
                    userSkills={userSkills}
                    onSave={handleSave}
                  />
                ))}
              </div>
              <Pagination
                page={page}
                total={list.data?.total ?? 0}
                limit={list.data?.limit ?? 30}
                onChange={setPage}
              />
            </>
          )}
        </div>
      </div>
    </AppShellV2>
  )
}

// SUPPORTED_HOSTS — клиентская валидация ссылки. Список синхронизирован с
// DetectSource в backend/services/vacancies/app/analyze.go.
const SUPPORTED_HOSTS = [
  'yandex', 'ozon', 'tinkoff', 'tbank',
  'vk.com', 'vk.ru', 'vk.company', 'sber', 'avito',
  'wildberries', 'wb.ru', 'rwb.ru', 'mts.ru',
  'kaspersky', 'jetbrains', 'lamoda',
]

function isSupportedVacancyURL(raw: string): boolean {
  try {
    const u = new URL(raw.trim())
    const host = u.host.replace(/^www\./, '').toLowerCase()
    return SUPPORTED_HOSTS.some((h) => host.includes(h))
  } catch {
    return false
  }
}

function extractAnalyzeErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'Не удалось разобрать ссылку.'
  const msg = err.message || ''
  const jsonStart = msg.indexOf('{')
  if (jsonStart >= 0) {
    try {
      const body = JSON.parse(msg.slice(jsonStart)) as { error?: { message?: string } }
      const m = body.error?.message
      if (m) return m
    } catch {
      /* fall through */
    }
  }
  return msg || 'Не удалось разобрать ссылку.'
}

function Hero() {
  const [url, setUrl] = useState('')
  const [clientError, setClientError] = useState<string | null>(null)
  const analyze = useAnalyzeVacancy()
  const { data: modelChoice } = useAIVacanciesModelQuery()
  const modelLabel = modelChoice?.model_id
    ? modelChoice.model_id
    : 'qwen/qwen3-coder:free (по умолчанию)'
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setClientError(null)
    const trimmed = url.trim()
    if (!trimmed) {
      setClientError('Вставь ссылку на вакансию.')
      return
    }
    if (!isSupportedVacancyURL(trimmed)) {
      setClientError(
        'Поддерживаются ссылки только с careers.yandex.ru, career.ozon.ru, team.vk.company, job.mts.ru, career.rwb.ru.',
      )
      return
    }
    analyze.mutate({ url: trimmed })
  }
  const errMsg = clientError ?? (analyze.error ? extractAnalyzeErrorMessage(analyze.error) : null)
  const reset = () => {
    analyze.reset()
    setUrl('')
  }
  return (
    <div className="relative overflow-hidden bg-gradient-to-br from-surface-3 to-accent">
      <div className="flex flex-col items-center justify-center gap-4 px-4 py-8 sm:px-8">
        <h1 className="font-display text-3xl font-extrabold text-text-primary sm:text-4xl">
          Вакансии для прокачки
        </h1>
        <p className="text-center text-sm text-white/80">
          Yandex, Ozon, VK, MTS, Wildberries… Один Ctrl+V — мы вытащим стек и
          сравним с твоим профилем.
        </p>
        <form
          onSubmit={submit}
          className="flex h-12 w-full max-w-[720px] items-center gap-3 rounded-xl border border-white/20 bg-bg/60 px-4 backdrop-blur"
        >
          <Search className="h-5 w-5 shrink-0 text-text-muted" />
          <input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              if (clientError) setClientError(null)
            }}
            placeholder="Вставь ссылку на вакансию (yandex/ozon/vk/mts/wb…)"
            className="min-w-0 flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
            aria-invalid={errMsg ? true : undefined}
          />
          <Button
            type="submit"
            size="sm"
            loading={analyze.isPending}
            disabled={analyze.isPending || !url.trim()}
            icon={<Sparkles className="h-4 w-4" />}
          >
            Разобрать
          </Button>
        </form>
        {/* Transparency: show which LLM will crunch the vacancy + deep-link
            to the picker in Settings. Clicking the model id goes straight
            to the AI tab so users don't hunt for the control. */}
        <div className="flex max-w-[720px] flex-wrap items-center gap-1.5 text-[11px] text-white/70">
          <span>Модель разбора:</span>
          <span className="font-mono text-white">{modelLabel}</span>
          <span>·</span>
          <Link
            to="/settings"
            className="font-semibold text-accent hover:underline"
          >
            Изменить в настройках →
          </Link>
        </div>
        {errMsg && (
          <div role="alert" className="max-w-[720px] text-center text-xs text-danger">
            {errMsg}
          </div>
        )}
        {analyze.isPending && <AnalyzeSkeleton />}
        {analyze.data && !analyze.isPending && (
          <AnalyzeResultCard res={analyze.data} onReset={reset} />
        )}
      </div>
    </div>
  )
}

// AnalyzeSkeleton — placeholder while the LLM extractor + resolver run.
// Sits in the same slot as the real result card so the layout doesn't
// jump on completion.
function AnalyzeSkeleton() {
  return (
    <div className="w-full max-w-[720px] animate-pulse rounded-xl border border-border bg-surface-1 p-4">
      <div className="mb-3 h-4 w-32 rounded bg-surface-2" />
      <div className="mb-2 h-2 w-full rounded bg-surface-2" />
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-5 w-16 rounded-full bg-surface-2" />
        ))}
      </div>
    </div>
  )
}

// scoreColor maps match-score onto the design-system status palette:
// <40 = error/red, 40-69 = warning/amber, 70+ = success/green.
function scoreColor(score: number): { text: string; bar: string } {
  if (score >= 70) return { text: 'text-success', bar: 'bg-success' }
  if (score >= 40) return { text: 'text-warning', bar: 'bg-warning' }
  return { text: 'text-danger', bar: 'bg-danger' }
}

// AnalyzeResultCard renders the Phase-5 match-score + matched/missing/extra
// chip rows below the search bar. Empty user_profile.skills triggers the
// "play matches / level up Atlas" banner instead of a misleading 0% score.
function AnalyzeResultCard({ res, onReset }: { res: AnalyzeResponse; onReset: () => void }) {
  const hasUserStack = res.user_profile.skills.length > 0
  const c = scoreColor(res.match_score)
  return (
    <div className="w-full max-w-[720px] rounded-xl border border-border bg-surface-1 p-4 text-left shadow-lg">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-display text-sm font-semibold text-text-primary">
            {res.vacancy.title}
          </div>
          {res.vacancy.company && (
            <div className="text-xs text-text-muted">{res.vacancy.company}</div>
          )}
        </div>
        <button
          type="button"
          onClick={onReset}
          className="shrink-0 rounded p-1 text-text-muted hover:text-text-primary"
          aria-label="Сбросить"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {hasUserStack ? (
        <>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className={`font-display text-lg font-bold ${c.text}`}>
              Совпадение {res.match_score}%
            </span>
            <span className="font-mono text-[10px] uppercase text-text-muted">
              {res.gap.matched.length} из {res.gap.required.length} навыков
            </span>
          </div>
          <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
            <div
              className={`h-full ${c.bar} transition-all`}
              style={{ width: `${Math.max(2, res.match_score)}%` }}
            />
          </div>

          {res.gap.matched.length > 0 && (
            <ChipRow label="Уже умеешь" skills={res.gap.matched} state="matched" />
          )}
          {res.gap.missing.length > 0 && (
            <ChipRow label="Чему стоит подучиться" skills={res.gap.missing} state="gap" />
          )}
          {res.gap.extra.length > 0 && (
            <div className="mt-2 text-[11px] text-text-muted">
              <span className="uppercase">Бонус: </span>
              {res.gap.extra.join(', ')}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mb-3 rounded-md border border-border bg-surface-2 p-3 text-xs text-text-secondary">
            Сыграй несколько матчей или прокачай Атлас, чтобы я знал твой стек.
            Пока что просто покажу, что нужно для этой вакансии:
          </div>
          {res.gap.required.length > 0 ? (
            <ChipRow label="Что нужно для этой вакансии" skills={res.gap.required} state="gap" />
          ) : (
            <div className="text-xs text-text-muted">Не удалось извлечь требования.</div>
          )}
        </>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
        <Link
          to={`/vacancies/${res.vacancy.source}/${encodeURIComponent(res.vacancy.external_id)}`}
          className="text-xs font-semibold text-accent hover:underline"
        >
          Открыть вакансию →
        </Link>
        <button
          type="button"
          onClick={onReset}
          className="text-[11px] text-text-muted hover:text-text-primary hover:underline"
        >
          Сбросить
        </button>
      </div>
    </div>
  )
}

function ChipRow({
  label,
  skills,
  state,
}: {
  label: string
  skills: string[]
  state: 'matched' | 'gap' | 'extra'
}) {
  return (
    <div className="mb-2">
      <div className="mb-1 text-[10px] uppercase text-text-muted">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {skills.map((s) => (
          <SkillChip key={s} s={s} state={state} />
        ))}
      </div>
    </div>
  )
}

function Pagination({
  page,
  total,
  limit,
  onChange,
}: {
  page: number
  total: number
  limit: number
  onChange: (n: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / limit))
  if (pages <= 1) return null
  return (
    <div className="flex items-center justify-center gap-2 py-4">
      <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Назад
      </Button>
      <span className="font-mono text-sm text-text-secondary">
        {page} / {pages}
      </span>
      <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        Вперёд
      </Button>
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-40 animate-pulse rounded-xl border border-border bg-surface-1" />
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <Card padding="lg">
      <div className="flex flex-col items-start gap-3">
        <div className="flex items-center gap-2 text-sm text-text-primary">
          <Search className="h-4 w-4 text-text-muted" />
          По текущим фильтрам ничего не нашлось. Сбрось часть критериев.
        </div>
        <div className="text-xs text-text-muted">
          Каталог обновляется на бэкенде каждые 15 минут — данные живут в кэше,
          никаких ручных синхронизаций.
        </div>
      </div>
    </Card>
  )
}

function ErrorState() {
  return (
    <Card padding="lg">
      <div className="text-sm text-danger">Не удалось загрузить вакансии.</div>
    </Card>
  )
}
