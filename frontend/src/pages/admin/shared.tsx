// Shared admin building blocks: type Tab, Sidebar, StatCard, PanelSkeleton,
// ErrorBox, and the number formatter.
//
// Sidebar redesign Wave-15:
//   - 15 плоских табов сгруппированы в 6 collapsible-секций.
//   - Группа сворачивается, состояние persists в localStorage.
//   - Mock-секция раскрывается дефолтом (admin сюда чаще всего ходит).
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Avatar } from '../../components/Avatar'

export type Tab =
  | 'dashboard'
  | 'users'
  | 'reports'
  | 'codex'
  | 'podcasts'
  | 'ai_models'
  | 'llm_chain'
  | 'personas'
  | 'atlas'
  | 'arena_tasks'
  | 'mock_companies'
  | 'mock_tasks'
  | 'mock_questions'
  | 'mock_strictness'
  | 'quotas'

type Item = { id: Tab; label: string; chip?: string; chipColor?: string }
type Group = { id: string; label: string; defaultOpen: boolean; items: Item[] }

const COLLAPSE_KEY = 'druz9.admin.sidebar.collapsed'

function loadCollapsed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(COLLAPSE_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as string[]
    return new Set(arr)
  } catch {
    return new Set()
  }
}

function saveCollapsed(s: Set<string>) {
  try {
    window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...s]))
  } catch {
    /* ignore */
  }
}

export function Sidebar({ tab, setTab, pendingReports }: { tab: Tab; setTab: (t: Tab) => void; pendingReports: number }) {
  const groups: Group[] = [
    {
      id: 'overview',
      label: 'Overview',
      defaultOpen: true,
      items: [
        { id: 'dashboard', label: 'Dashboard' },
        { id: 'users', label: 'Users' },
        {
          id: 'reports',
          label: 'Reports',
          chip: pendingReports > 0 ? String(pendingReports) : undefined,
          chipColor: 'bg-danger/20 text-danger',
        },
      ],
    },
    {
      id: 'mock',
      label: 'Mock interviews',
      defaultOpen: true,
      items: [
        { id: 'mock_companies', label: 'Компании' },
        { id: 'mock_tasks', label: 'Задачи' },
        { id: 'mock_questions', label: 'Вопросы' },
        { id: 'mock_strictness', label: 'Строгость AI' },
      ],
    },
    {
      id: 'arena',
      label: 'Arena',
      defaultOpen: false,
      items: [{ id: 'arena_tasks', label: 'Задачи' }],
    },
    {
      id: 'content',
      label: 'Content',
      defaultOpen: false,
      items: [
        { id: 'codex', label: 'Codex · статьи' },
        { id: 'podcasts', label: 'Подкасты' },
        { id: 'atlas', label: 'Atlas CMS' },
      ],
    },
    {
      id: 'ai',
      label: 'AI infrastructure',
      defaultOpen: false,
      items: [
        { id: 'ai_models', label: 'Модели' },
        { id: 'llm_chain', label: 'LLM Chain ⚡' },
        { id: 'personas', label: 'Персоны' },
      ],
    },
    {
      id: 'billing',
      label: 'Billing',
      defaultOpen: false,
      items: [{ id: 'quotas', label: 'Subscription · квоты' }],
    },
  ]

  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const stored = loadCollapsed()
    // Если пользователь ещё не трогал сайдбар, инициируем дефолтами
    // (collapsed = НЕ defaultOpen).
    if (stored.size === 0) {
      return new Set(groups.filter((g) => !g.defaultOpen).map((g) => g.id))
    }
    return stored
  })

  // Открыть группу автоматически при выборе таба внутри неё (например,
  // юзер кликает на /admin?tab=quotas из dashboard'а — Billing раскрывается).
  useEffect(() => {
    const owner = groups.find((g) => g.items.some((it) => it.id === tab))
    if (owner && collapsed.has(owner.id)) {
      const next = new Set(collapsed)
      next.delete(owner.id)
      setCollapsed(next)
      saveCollapsed(next)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const toggleGroup = (id: string) => {
    const next = new Set(collapsed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setCollapsed(next)
    saveCollapsed(next)
  }

  return (
    <aside className="flex w-full flex-col border-b border-border bg-surface-1 lg:w-60 lg:border-b-0 lg:border-r">
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
        <span className="grid h-7 w-7 place-items-center rounded-md border border-border-strong bg-surface-2 font-display text-sm font-extrabold text-text-primary">
          9
        </span>
        <span className="font-display text-sm font-bold text-text-primary">druz9 ADMIN</span>
        <span className="ml-auto rounded-full bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] text-text-muted">
          v3.2
        </span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
        {groups.map((g) => {
          const isOpen = !collapsed.has(g.id)
          const hasActive = g.items.some((it) => it.id === tab)
          return (
            <div key={g.id} className="flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => toggleGroup(g.id)}
                className="flex items-center gap-1.5 rounded-md px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted hover:text-text-primary"
              >
                {isOpen ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                <span>{g.label}</span>
                {hasActive && !isOpen && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-text-primary" />
                )}
              </button>
              {isOpen && (
                <div className="flex flex-col gap-0.5 pl-3">
                  {g.items.map((it) => (
                    <button
                      key={it.id}
                      onClick={() => setTab(it.id)}
                      className={`flex items-center justify-between rounded-md px-3 py-1.5 text-[13px] ${
                        it.id === tab
                          ? 'border-l-2 border-text-primary bg-text-primary/5 text-text-primary'
                          : 'text-text-secondary hover:bg-surface-2'
                      }`}
                    >
                      <span className="truncate">{it.label}</span>
                      {it.chip && (
                        <span
                          className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold ${
                            it.chipColor ?? 'bg-surface-2 text-text-secondary'
                          }`}
                        >
                          {it.chip}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        <div className="mt-3 border-t border-border pt-2">
          <Link
            to="/admin/interviewers"
            className="flex items-center justify-between rounded-md px-3 py-1.5 text-[12px] text-text-secondary hover:bg-surface-2"
          >
            <span>Заявки в интервьюеры</span>
            <span className="font-mono text-[9px] text-text-muted">↗</span>
          </Link>
          <Link
            to="/status"
            className="flex items-center justify-between rounded-md px-3 py-1.5 text-[12px] text-text-secondary hover:bg-surface-2"
          >
            <span>Public status</span>
            <span className="font-mono text-[9px] text-text-muted">↗</span>
          </Link>
        </div>
      </nav>
      <div className="flex items-center gap-2.5 border-t border-border px-4 py-3">
        <Avatar size="sm" gradient="pink-violet" initials="A" />
        <div className="flex flex-1 flex-col">
          <span className="text-[12px] font-semibold text-text-primary">admin</span>
          <span className="font-mono text-[10px] text-text-muted">root</span>
        </div>
      </div>
    </aside>
  )
}

export function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface-1 px-4 py-2">
      <span className="font-mono text-[10px] font-semibold tracking-[0.08em] text-text-muted">{label}</span>
      <span className={`font-display text-xl font-extrabold ${color ?? 'text-text-primary'}`}>{value}</span>
    </div>
  )
}

export function PanelSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-5 sm:px-7">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-surface-1" />
      ))}
    </div>
  )
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="mx-4 my-5 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger sm:mx-7">
      {message}
    </div>
  )
}

export function fmt(n: number): string {
  return new Intl.NumberFormat('ru-RU').format(n)
}
