// /applications — kanban-доска отслеживаемых вакансий пользователя.
//
// 5 колонок: saved → applied → interviewing → rejected / offer.
// V1: смена статуса через select; drag-drop оставлен на v2.

import { Link } from 'react-router-dom'
import { useMemo } from 'react'
import { Trash2 } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import {
  useSavedVacancies,
  useUpdateSavedStatus,
  useDeleteSaved,
  SAVED_STATUSES,
  type SavedStatus,
  type SavedVacancy,
} from '../lib/queries/vacancies'

const STATUS_LABEL: Record<SavedStatus, string> = {
  saved: 'Сохранено',
  applied: 'Откликнулся',
  interviewing: 'Собес',
  rejected: 'Отказ',
  offer: 'Оффер',
}

const STATUS_COLOR: Record<SavedStatus, string> = {
  saved: 'border-border bg-surface-2',
  applied: 'border-accent/40 bg-accent/10',
  interviewing: 'border-cyan/40 bg-cyan/10',
  rejected: 'border-danger/40 bg-danger/10',
  offer: 'border-success/40 bg-success/10',
}

export default function ApplicationsPage() {
  const list = useSavedVacancies()
  const updateStatus = useUpdateSavedStatus()
  const remove = useDeleteSaved()

  const grouped = useMemo(() => {
    const m: Record<SavedStatus, SavedVacancy[]> = {
      saved: [], applied: [], interviewing: [], rejected: [], offer: [],
    }
    for (const s of list.data?.items ?? []) {
      ;(m[s.status] ?? m.saved).push(s)
    }
    return m
  }, [list.data])

  return (
    <AppShellV2>
      <div className="bg-gradient-to-br from-surface-3 to-accent">
        <div className="px-4 py-8 sm:px-8 lg:px-20">
          <h1 className="font-display text-3xl font-extrabold text-text-primary sm:text-4xl">
            Мои отклики
          </h1>
          <p className="mt-2 text-sm text-white/85">
            Воронка подготовки: что сохранил → куда откликнулся → где сейчас собес.
          </p>
        </div>
      </div>

      <div className="px-4 py-6 sm:px-8 lg:px-20">
        {list.isLoading ? (
          <div className="text-text-muted">Загрузка…</div>
        ) : list.error ? (
          <div className="text-danger">Не удалось загрузить.</div>
        ) : (list.data?.items.length ?? 0) === 0 ? (
          <Empty />
        ) : (
          <div className="grid gap-4 lg:grid-cols-5">
            {SAVED_STATUSES.map((st) => (
              <div key={st} className="flex flex-col gap-3">
                <div className={`rounded-md border px-3 py-1.5 text-xs uppercase ${STATUS_COLOR[st]}`}>
                  {STATUS_LABEL[st]} · {grouped[st].length}
                </div>
                {grouped[st].map((s) => (
                  <Card key={s.id} variant="elevated" padding="md">
                    <Link
                      to={`/vacancies/${s.vacancy.source}/${encodeURIComponent(s.vacancy.external_id)}`}
                      className="font-display text-sm font-bold text-text-primary hover:text-accent-hover"
                    >
                      {s.vacancy.title}
                    </Link>
                    {s.vacancy.company && (
                      <div className="mt-0.5 text-xs text-text-secondary">
                        {s.vacancy.company}
                      </div>
                    )}
                    {(s.vacancy.salary_min || s.vacancy.salary_max) && (
                      <div className="mt-1 text-xs text-success">
                        {[s.vacancy.salary_min, s.vacancy.salary_max].filter(Boolean).join('–')}{' '}
                        {(s.vacancy.currency ?? 'RUR').replace('RUR', '₽').replace('RUB', '₽')}
                      </div>
                    )}
                    <div className="mt-3 flex items-center gap-2">
                      <select
                        value={s.status}
                        onChange={(e) =>
                          updateStatus.mutate({
                            savedId: s.id,
                            status: e.target.value as SavedStatus,
                            notes: s.notes ?? '',
                          })
                        }
                        className="flex-1 rounded-md border border-border bg-bg px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
                      >
                        {SAVED_STATUSES.map((x) => (
                          <option key={x} value={x}>
                            {STATUS_LABEL[x]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => remove.mutate(s.id)}
                        className="rounded-md border border-border p-1.5 text-text-muted hover:border-danger hover:text-danger"
                        aria-label="Удалить"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </Card>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShellV2>
  )
}

function Empty() {
  return (
    <Card padding="lg">
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <h2 className="font-display text-xl font-bold text-text-primary">
          Воронка пока пустая
        </h2>
        <p className="max-w-md text-sm text-text-secondary">
          Зайди в каталог вакансий и сохраняй интересные — они появятся здесь
          с возможностью отслеживать стадию.
        </p>
        <Link to="/vacancies">
          <Button>К вакансиям</Button>
        </Link>
      </div>
    </Card>
  )
}
