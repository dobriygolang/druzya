// PracticePage — solo-mode kata catalogue.
//
// Reached from the Solo Practice card on /arena. The user picks a
// section + difficulty; the page shows all matching active tasks and
// each row links to /arena/kata/{slug} where the existing solve flow
// renders the task body + Monaco editor.
//
// Backed by GET /api/v1/daily/tasks?section=&difficulty= (chi-direct,
// see backend/services/daily/ports/list_tasks_handler.go). 60s
// staleTime — task catalogue rarely changes.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, BookOpen } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { api } from '../lib/apiClient'

type SectionKey = 'algorithms' | 'sql' | 'go' | 'system_design' | 'behavioral'
type DifficultyKey = 'easy' | 'medium' | 'hard'

type PracticeTask = {
  id: string
  slug: string
  title: string
  description: string
  section: string
  difficulty: string
}

const SECTIONS: { id: SectionKey; label: string }[] = [
  { id: 'algorithms', label: 'Algorithms' },
  { id: 'sql', label: 'SQL' },
  { id: 'go', label: 'Go' },
  { id: 'system_design', label: 'System Design' },
  { id: 'behavioral', label: 'Behavioral' },
]

const DIFFS: { id: DifficultyKey; label: string }[] = [
  { id: 'easy', label: 'Easy' },
  { id: 'medium', label: 'Medium' },
  { id: 'hard', label: 'Hard' },
]

function useTasksQuery(section: SectionKey, difficulty: DifficultyKey) {
  return useQuery({
    queryKey: ['practice', 'tasks', section, difficulty],
    queryFn: () =>
      api<{ items: PracticeTask[] }>(
        `/daily/tasks?section=${encodeURIComponent(section)}&difficulty=${encodeURIComponent(difficulty)}`,
      ),
    staleTime: 60_000,
    retry: false,
  })
}

export default function PracticePage() {
  const [section, setSection] = useState<SectionKey>('algorithms')
  const [difficulty, setDifficulty] = useState<DifficultyKey>('easy')
  const list = useTasksQuery(section, difficulty)
  const items = list.data?.items ?? []

  return (
    <AppShellV2>
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-8 lg:py-14">
        <header className="mb-6 flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-text-muted">
            Solo practice
          </span>
          <h1 className="font-display text-3xl font-extrabold text-text-primary sm:text-4xl">
            Pick a kata
          </h1>
          <p className="max-w-xl text-[14px] text-text-secondary">
            Любая задача из базы. Без таймера, без рейтинга — выбор сегмента и
            сложности, дальше открываешь и решаешь в обычном Monaco-редакторе.
          </p>
        </header>

        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
            section
          </span>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              className={[
                'rounded-full px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors',
                section === s.id
                  ? 'bg-text-primary text-bg'
                  : 'border border-border bg-surface-1 text-text-secondary hover:bg-surface-2',
              ].join(' ')}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
            difficulty
          </span>
          {DIFFS.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDifficulty(d.id)}
              className={[
                'rounded-full px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors',
                difficulty === d.id
                  ? 'bg-text-primary text-bg'
                  : 'border border-border bg-surface-1 text-text-secondary hover:bg-surface-2',
              ].join(' ')}
            >
              {d.label}
            </button>
          ))}
        </div>

        {list.isLoading ? (
          <p className="text-[13px] text-text-muted">Загрузка…</p>
        ) : list.isError ? (
          <p className="text-[13px] text-text-muted">
            Не удалось загрузить — попробуй ещё раз.
          </p>
        ) : items.length === 0 ? (
          <p className="text-[13px] text-text-muted">
            В этом сочетании нет задач. Поменяй фильтры.
          </p>
        ) : (
          <ul className="grid gap-3">
            {items.map((t) => (
              <li
                key={t.id}
                className="rounded-lg border border-border bg-surface-1 transition-colors hover:border-border-strong"
              >
                <Link
                  to={`/arena/kata/${encodeURIComponent(t.slug)}`}
                  className="flex items-start gap-3 p-4"
                >
                  <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border bg-surface-2">
                    <BookOpen className="h-4 w-4 text-text-primary" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold text-text-primary">
                      {t.title}
                    </div>
                    {t.description && (
                      <div className="mt-1 line-clamp-2 text-[13px] text-text-secondary">
                        {t.description}
                      </div>
                    )}
                    <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                      <span>{t.section}</span>
                      <span>·</span>
                      <span>{t.difficulty}</span>
                    </div>
                  </div>
                  <ArrowRight className="mt-2 h-4 w-4 text-text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShellV2>
  )
}
