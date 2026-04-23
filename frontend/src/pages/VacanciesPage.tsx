// /vacancies — каталог реальных вакансий с российских площадок
// (HH, Yandex, Ozon, T-Bank, VK, Sber, Avito, …).
//
// Источник правды — backend services/vacancies. Read-path public, save/track
// требует логина (фронт показывает CTA "Войти, чтобы сохранить" если 401).
//
// Структура:
//   - Hero: заголовок, поле «вставь ссылку → /analyze».
//   - Sidebar: фильтры (источник, скиллы, salary, location).
//   - Grid: карточки с title/company/salary/skill diff vs profile.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Search,
  Briefcase,
  MapPin,
  Wallet,
  Sparkles,
  Bookmark,
  RefreshCw,
  CheckCircle2,
  Clock,
} from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import {
  useVacanciesList,
  useAnalyzeVacancy,
  useSaveVacancy,
  useTriggerVacancySync,
  VACANCY_SOURCES,
  diffSkills,
  type Vacancy,
  type VacancySource,
} from '../lib/queries/vacancies'
import { useProfileQuery } from '../lib/queries/profile'

function formatSalary(min?: number, max?: number, currency?: string): string {
  if (!min && !max) return ''
  const cur = (currency ?? 'RUR').replace('RUR', '₽').replace('RUB', '₽')
  const fmt = (n: number) => new Intl.NumberFormat('ru-RU').format(n)
  if (min && max && min !== max) return `${fmt(min)}–${fmt(max)} ${cur}`
  return `от ${fmt(min ?? max ?? 0)} ${cur}`
}

function SourceBadge({ source }: { source: VacancySource }) {
  const labels: Record<VacancySource, string> = {
    hh: 'HH', yandex: 'Yandex', ozon: 'Ozon', tinkoff: 'T-Bank', vk: 'VK',
    sber: 'Sber', avito: 'Avito', wildberries: 'WB', mts: 'MTS',
    kaspersky: 'Kaspersky', jetbrains: 'JetBrains', lamoda: 'Lamoda',
  }
  return (
    <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase text-text-secondary">
      {labels[source]}
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
  onSave?: (id: number) => void
}) {
  const top = v.normalized_skills.slice(0, 5)
  const { matched, missing } = diffSkills(top, userSkills)
  return (
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
          <Link
            to={`/vacancies/${v.id}`}
            className="font-display text-base font-bold text-text-primary hover:text-accent-hover"
          >
            {v.title}
          </Link>
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
            onClick={() => onSave(v.id)}
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
  )
}

function FilterSidebar({
  sources,
  setSources,
  salaryMin,
  setSalaryMin,
  location,
  setLocation,
}: {
  sources: VacancySource[]
  setSources: (xs: VacancySource[]) => void
  salaryMin: number
  setSalaryMin: (n: number) => void
  location: string
  setLocation: (s: string) => void
}) {
  const toggle = (s: VacancySource) => {
    if (sources.includes(s)) setSources(sources.filter((x) => x !== s))
    else setSources([...sources, s])
  }
  return (
    <Card variant="default" padding="md" className="self-start">
      <h3 className="mb-3 font-display text-sm font-semibold text-text-primary">
        Фильтры
      </h3>
      <div className="mb-4">
        <div className="mb-2 text-xs uppercase text-text-muted">Источники</div>
        <div className="flex flex-wrap gap-1.5">
          {VACANCY_SOURCES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => toggle(s)}
              className={`rounded-full border px-2.5 py-1 text-[11px] uppercase transition-colors ${
                sources.includes(s)
                  ? 'border-accent bg-accent/15 text-text-primary'
                  : 'border-border bg-surface-2 text-text-secondary hover:border-border-strong'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
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
  const [salaryMin, setSalaryMin] = useState(0)
  const [location, setLocation] = useState('')
  const [page, setPage] = useState(1)
  const list = useVacanciesList({
    sources,
    salary_min: salaryMin || undefined,
    location: location || undefined,
    page,
    limit: 30,
  })
  const profile = useProfileQuery()
  const userSkills = useMemo(() => {
    // Фронт пока не имеет нормализованного skill-set'а в profile API; берём
    // skill_nodes названия (если будут) или пустой массив. До тех пор —
    // gap-чипы будут все «жёлтые», но рендер не падает.
    type ProfileBundle = { skill_nodes?: { node_key?: string }[] }
    const b = (profile.data as unknown as ProfileBundle | undefined) ?? {}
    return (b.skill_nodes ?? []).map((n) => n.node_key ?? '').filter(Boolean)
  }, [profile.data])
  const navigate = useNavigate()
  const save = useSaveVacancy()
  const sync = useTriggerVacancySync()

  // Авто-триггер sync при первом пустом ответе. Защита от повторного дёргания
  // в одной сессии — autoTriggeredRef. Без неё useEffect срабатывал бы каждый
  // раз когда после refetch'а data снова пуста (а это всегда первые ~8s).
  const autoTriggeredRef = useRef(false)
  useEffect(() => {
    if (
      !autoTriggeredRef.current &&
      !list.isLoading &&
      !list.error &&
      (list.data?.items.length ?? 0) === 0 &&
      // Только если фильтры не выставлены — пользователь ничего не «отфильтровал».
      sources.length === 0 &&
      salaryMin === 0 &&
      location === ''
    ) {
      autoTriggeredRef.current = true
      sync.mutate()
    }
  }, [list.data, list.isLoading, list.error, sources, salaryMin, location, sync])

  const handleSave = (id: number) => {
    save.mutate({ vacancyId: id }, {
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
            <EmptyState
              onRefresh={() => sync.mutate()}
              syncing={sync.isPending}
              status={sync.data?.status}
              retryAfter={sync.data?.retry_after}
              autoTriggered={autoTriggeredRef.current}
            />
          ) : (
            <>
              <div className="text-xs uppercase text-text-muted">
                {list.data?.total} вакансий · стр. {page}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {list.data?.items.map((v) => (
                  <VacancyCard
                    key={v.id}
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

// SUPPORTED_HOSTS — клиентская валидация ссылки, чтобы пользователь сразу
// видел понятную ошибку, а не молчаливое «ничего не происходит». Список
// синхронизирован с DetectSource в backend/services/vacancies/app/analyze.go.
const SUPPORTED_HOSTS = [
  'hh.ru', 'hh.kz', 'headhunter.ru',
  'yandex', 'ozon', 'tinkoff', 'tbank',
  'vk.com', 'vk.ru', 'sber', 'avito',
  'wildberries', 'wb.ru', 'mts.ru',
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
  // ApiError serializes как `api 400: {"error":{"message":"..."}}` — вытащим
  // человекочитаемое сообщение, иначе вернём raw text без префикса.
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
  const navigate = useNavigate()
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
        'Поддерживаются ссылки только с hh.ru, careers.yandex.ru, job.ozon.ru, tbank.ru, vk.com и других площадок из списка.',
      )
      return
    }
    analyze.mutate(
      { url: trimmed },
      {
        onSuccess: (res) => {
          navigate(`/vacancies/${res.vacancy.id}`)
        },
      },
    )
  }
  const errMsg = clientError ?? (analyze.error ? extractAnalyzeErrorMessage(analyze.error) : null)
  return (
    <div className="relative h-auto overflow-hidden bg-gradient-to-br from-surface-3 to-accent lg:h-[240px]">
      <div className="flex h-full flex-col items-center justify-center gap-4 px-4 py-8 sm:px-8 lg:py-0">
        <h1 className="font-display text-3xl font-extrabold text-text-primary sm:text-4xl">
          Вакансии для прокачки
        </h1>
        <p className="text-center text-sm text-white/80">
          HH, Yandex, Ozon, T-Bank, VK… Один Ctrl+V — мы вытащим стек и
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
            placeholder="Вставь ссылку на вакансию (hh.ru/yandex/ozon…)"
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
        {errMsg && (
          <div role="alert" className="max-w-[720px] text-center text-xs text-danger">
            {errMsg}
          </div>
        )}
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

function EmptyState({
  onRefresh,
  syncing,
  status,
  retryAfter,
  autoTriggered,
}: {
  onRefresh: () => void
  syncing: boolean
  status?: 'started' | 'already_running' | 'throttled'
  retryAfter?: number
  autoTriggered: boolean
}) {
  // Три визуальных состояния empty:
  //   1) Sync уже запущен (status==='started' | 'already_running' или syncing)
  //      — показываем «загружаем последние вакансии, ~10s».
  //   2) Sync затроттлен (status==='throttled') — показываем countdown.
  //   3) Иначе — стандартный «ничего нет, обнови сейчас».
  const inProgress =
    syncing || status === 'started' || status === 'already_running'
  const throttled = status === 'throttled'
  return (
    <Card padding="lg">
      <div className="flex flex-col items-start gap-4">
        {inProgress ? (
          <>
            <div className="flex items-center gap-2 text-sm text-text-primary">
              <RefreshCw className="h-4 w-4 animate-spin text-accent-hover" />
              Подтягиваем свежие вакансии с HH/Yandex/Ozon… обычно ~10 секунд.
            </div>
            <div className="text-xs text-text-muted">
              Страница обновится сама. Если ничего не появилось — нажми кнопку
              ниже ещё раз.
            </div>
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshCw className="h-4 w-4" />}
              loading={syncing}
              onClick={onRefresh}
            >
              Обновить ещё раз
            </Button>
          </>
        ) : throttled ? (
          <>
            <div className="flex items-center gap-2 text-sm text-warn">
              <Clock className="h-4 w-4" />
              Подожди {retryAfter ?? 30} сек — sync уже только что запускался.
            </div>
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshCw className="h-4 w-4" />}
              onClick={onRefresh}
            >
              Попробовать сейчас
            </Button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm text-text-primary">
              {autoTriggered ? (
                <CheckCircle2 className="h-4 w-4 text-success" />
              ) : (
                <Search className="h-4 w-4 text-text-muted" />
              )}
              {autoTriggered
                ? 'Синхронизация прошла, но по фильтрам ничего не нашлось. Сбрось фильтры или повтори.'
                : 'Ничего не найдено. Можно дёрнуть синхронизацию вручную или сбросить фильтры.'}
            </div>
            <Button
              size="sm"
              icon={<RefreshCw className="h-4 w-4" />}
              onClick={onRefresh}
            >
              Обновить сейчас
            </Button>
          </>
        )}
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
