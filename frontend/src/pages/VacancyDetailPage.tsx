// /vacancies/:source/:externalId — детальный экран одной вакансии.
//
// Идентификация — композитный ключ (source, external_id), id больше нет.
// Layout идентичен предыдущей версии.

import { useMemo, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { Bookmark, ExternalLink, Sparkles, X } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import {
  useVacancy,
  useSaveVacancy,
  diffSkills,
  type VacancySource,
} from '../lib/queries/vacancies'

function formatSalary(min?: number, max?: number, currency?: string): string {
  if (!min && !max) return ''
  const cur = (currency ?? 'RUR').replace('RUR', '₽').replace('RUB', '₽')
  const fmt = (n: number) => new Intl.NumberFormat('ru-RU').format(n)
  if (min && max && min !== max) return `${fmt(min)}–${fmt(max)} ${cur}`
  return `от ${fmt(min ?? max ?? 0)} ${cur}`
}

export default function VacancyDetailPage() {
  const params = useParams<{ source: string; externalId: string }>()
  const source = params.source as VacancySource | undefined
  const externalId = params.externalId
  const v = useVacancy(source, externalId)
  const save = useSaveVacancy()
  const navigate = useNavigate()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const userSkills = useMemo<string[]>(() => [], [])
  const required = useMemo(() => v.data?.normalized_skills ?? [], [v.data?.normalized_skills])
  const { matched, missing } = useMemo(
    () => diffSkills(required, userSkills),
    [required, userSkills],
  )

  if (v.isLoading) {
    return <AppShellV2><div className="p-8 text-text-muted">Загрузка…</div></AppShellV2>
  }
  if (v.error || !v.data) {
    return (
      <AppShellV2>
        <div className="p-8">
          <div className="text-sm text-danger">Вакансия не найдена.</div>
          <Link to="/vacancies" className="mt-3 inline-block text-sm text-text-primary hover:underline">
            ← К каталогу
          </Link>
        </div>
      </AppShellV2>
    )
  }
  const vac = v.data

  const onSave = () => {
    save.mutate({ source: vac.source, externalId: vac.external_id }, {
      onSuccess: () => navigate('/applications'),
      onError: (err) => {
        if (err instanceof Error && err.message.includes('401')) {
          navigate('/welcome')
        }
      },
    })
  }

  return (
    <AppShellV2>
      <div className="bg-surface-3 border-b border-border-strong">
        <div className="px-4 py-8 sm:px-8 lg:px-20">
          <Link to="/vacancies" className="text-xs text-text-secondary hover:text-text-primary">
            ← К каталогу вакансий
          </Link>
          <h1 className="mt-2 font-display text-3xl font-extrabold text-text-primary sm:text-4xl">
            {vac.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-text-secondary">
            {vac.company && <span>{vac.company}</span>}
            {vac.location && <span>· {vac.location}</span>}
            {vac.experience_level && <span>· {vac.experience_level}</span>}
          </div>
          {(vac.salary_min || vac.salary_max) && (
            <div className="mt-2 font-mono text-base text-success">
              {formatSalary(vac.salary_min, vac.salary_max, vac.currency)}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={onSave} loading={save.isPending} icon={<Bookmark className="h-4 w-4" />}>
              Сохранить
            </Button>
            <a href={vac.url} target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" icon={<ExternalLink className="h-4 w-4" />}>
                Открыть на {vac.source.toUpperCase()}
              </Button>
            </a>
            <Button
              variant="ghost"
              icon={<Sparkles className="h-4 w-4" />}
              onClick={() => setDrawerOpen(true)}
            >
              Подготовиться
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 px-4 py-6 sm:px-8 lg:grid-cols-[1fr_320px] lg:px-20">
        <div className="flex flex-col gap-4">
          {vac.source_only ? (
            <Card padding="lg">
              <h2 className="mb-2 font-display text-base font-semibold text-text-primary">
                Описание недоступно через API
              </h2>
              <p className="text-sm text-text-secondary">
                Источник {vac.source.toUpperCase()} не предоставляет полное описание
                через публичный API. Полная информация доступна на сайте источника.
              </p>
              <a
                href={vac.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-sm text-text-primary hover:underline"
              >
                Открыть полное описание <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Card>
          ) : (
            <>
              {(vac.description_html || vac.description) && (
                <Card padding="lg">
                  <h2 className="mb-3 font-display text-base font-semibold text-text-primary">
                    Описание
                  </h2>
                  {vac.description_html ? (
                    <div
                      className="prose prose-sm max-w-none text-sm text-text-secondary [&_a]:text-text-primary [&_a]:hover:underline [&_h3]:mt-3 [&_h3]:font-display [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-text-primary [&_li]:my-1 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
                      // Sanitised server-side against an HTML tag allow-list.
                      dangerouslySetInnerHTML={{ __html: vac.description_html }}
                    />
                  ) : (
                    <p className="whitespace-pre-line text-sm text-text-secondary">
                      {vac.description}
                    </p>
                  )}
                </Card>
              )}
              {vac.duties && vac.duties.length > 0 && (
                <DetailListCard title="Обязанности" items={vac.duties} />
              )}
              {vac.requirements && vac.requirements.length > 0 && (
                <DetailListCard title="Требования" items={vac.requirements} />
              )}
              {vac.conditions && vac.conditions.length > 0 && (
                <DetailListCard title="Условия" items={vac.conditions} />
              )}
              {vac.our_team && (
                <Card padding="lg">
                  <h2 className="mb-3 font-display text-base font-semibold text-text-primary">
                    О команде
                  </h2>
                  <div
                    className="prose prose-sm max-w-none text-sm text-text-secondary [&_p]:my-2"
                    // Sanitised server-side against an HTML tag allow-list.
                    dangerouslySetInnerHTML={{ __html: vac.our_team }}
                  />
                </Card>
              )}
              {vac.tech_stack && vac.tech_stack.length > 0 && (
                <Card padding="lg">
                  <h2 className="mb-3 font-display text-base font-semibold text-text-primary">
                    Стек
                  </h2>
                  <div className="flex flex-wrap gap-1.5">
                    {vac.tech_stack.map((s) => (
                      <span
                        key={s}
                        className="rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-text-primary"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
        <div className="flex flex-col gap-4">
          <Card padding="lg">
            <h2 className="mb-3 font-display text-sm font-semibold text-text-primary">
              Skill-gap
            </h2>
            {required.length === 0 ? (
              <div className="text-xs text-text-muted">Скиллы ещё не извлечены.</div>
            ) : (
              <>
                <div className="mb-3">
                  <div className="text-[10px] uppercase text-text-muted">Совпало</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {required.filter((s) => matched.has(s.toLowerCase())).map((s) => (
                      <Chip key={s} text={s} kind="matched" />
                    ))}
                    {matched.size === 0 && (
                      <span className="text-xs text-text-muted">—</span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-text-muted">Не хватает</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {required.filter((s) => missing.has(s.toLowerCase())).map((s) => (
                      <Chip key={s} text={s} kind="gap" />
                    ))}
                    {missing.size === 0 && (
                      <span className="text-xs text-text-muted">—</span>
                    )}
                  </div>
                </div>
              </>
            )}
          </Card>
        </div>
      </div>

      {drawerOpen && (
        <PrepDrawer onClose={() => setDrawerOpen(false)} missing={Array.from(missing)} />
      )}
    </AppShellV2>
  )
}

function DetailListCard({ title, items }: { title: string; items: string[] }) {
  return (
    <Card padding="lg">
      <h2 className="mb-3 font-display text-base font-semibold text-text-primary">
        {title}
      </h2>
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-text-secondary">
        {items.map((it, i) => (
          <li key={`${title}-${i}`}>{it}</li>
        ))}
      </ul>
    </Card>
  )
}

function Chip({ text, kind }: { text: string; kind: 'matched' | 'gap' }) {
  const cls =
    kind === 'matched'
      ? 'border-success/40 bg-success/10 text-success'
      : 'border-warning/40 bg-warning/10 text-warning'
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${cls}`}>{text}</span>
  )
}

function PrepDrawer({ onClose, missing }: { onClose: () => void; missing: string[] }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        role="button"
        tabIndex={-1}
        aria-label="Закрыть"
      />
      <div className="relative h-full w-full max-w-[420px] overflow-y-auto bg-surface-1 shadow-card">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h3 className="font-display text-base font-bold text-text-primary">
            План подготовки
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-secondary hover:bg-surface-2"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-col gap-3 p-4">
          {missing.length === 0 ? (
            <div className="text-sm text-text-secondary">
              Все требования уже закрыты. Можно сразу откликаться!
            </div>
          ) : (
            <>
              <p className="text-sm text-text-secondary">
                Рекомендуем ежедневные ката на эти технологии:
              </p>
              <ul className="flex flex-col gap-2">
                {missing.map((s) => (
                  <li key={s}>
                    <Link
                      to={`/arena/kata?skill=${encodeURIComponent(s)}`}
                      className="flex items-center justify-between rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary hover:border-border-strong"
                    >
                      <span className="font-mono">{s}</span>
                      <span className="text-xs text-text-primary">Ката →</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
