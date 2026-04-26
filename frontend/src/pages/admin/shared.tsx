// Shared admin building blocks: type Tab, Sidebar, StatCard, PanelSkeleton,
// ErrorBox, and the number formatter.

import { Link } from 'react-router-dom'
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

export function Sidebar({ tab, setTab, pendingReports }: { tab: Tab; setTab: (t: Tab) => void; pendingReports: number }) {
  const items: Array<{ id: Tab; label: string; chip?: string; chipColor?: string }> = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'users', label: 'Users' },
    {
      id: 'reports',
      label: 'Reports',
      chip: pendingReports > 0 ? String(pendingReports) : undefined,
      chipColor: 'bg-danger/20 text-danger',
    },
    { id: 'podcasts', label: 'Подкасты' },
    { id: 'codex', label: 'Codex · статьи' },
    { id: 'atlas', label: 'Atlas CMS' },
    { id: 'ai_models', label: 'AI Modельки' },
    { id: 'llm_chain', label: 'LLM Chain ⚡' },
    { id: 'personas', label: 'Персоны' },
    { id: 'arena_tasks', label: 'Arena · задачи' },
    { id: 'mock_companies', label: 'Mock · компании' },
    { id: 'mock_tasks', label: 'Mock · задачи' },
    { id: 'mock_questions', label: 'Mock · вопросы' },
    { id: 'mock_strictness', label: 'Mock · строгость AI' },
    { id: 'quotas', label: 'Subscription · квоты' },
  ]
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
      <nav className="flex flex-1 flex-row gap-2 overflow-x-auto px-3 py-4 lg:flex-col lg:gap-1">
        {items.map((it) => (
          <button
            key={it.id}
            onClick={() => setTab(it.id)}
            className={`flex items-center justify-between rounded-md px-3 py-1.5 text-[13px] ${
              it.id === tab
                ? 'border-l-2 border-text-primary bg-text-primary/5 text-text-primary'
                : 'text-text-secondary hover:bg-surface-2'
            }`}
          >
            <span>{it.label}</span>
            {it.chip && (
              <span className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold ${it.chipColor ?? 'bg-surface-2 text-text-secondary'}`}>
                {it.chip}
              </span>
            )}
          </button>
        ))}
        {/* External admin sub-routes — interviewer-application moderation
            queue lives at its own URL because it's a public page (admin
            actions audited via backend), not a Tab here. */}
        <Link
          to="/admin/interviewers"
          className="mt-2 flex items-center justify-between rounded-md px-3 py-1.5 text-[13px] text-text-secondary hover:bg-surface-2"
        >
          <span>Заявки в интервьюеры</span>
          <span className="font-mono text-[9px] text-text-muted">↗</span>
        </Link>
        <Link
          to="/status"
          className="flex items-center justify-between rounded-md px-3 py-1.5 text-[13px] text-text-secondary hover:bg-surface-2"
        >
          <span>Public status</span>
          <span className="font-mono text-[9px] text-text-muted">↗</span>
        </Link>
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
