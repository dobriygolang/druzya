// TODO i18n
import { Search, MoreHorizontal, Plus } from 'lucide-react'
import { Button } from '../components/Button'
import { Avatar } from '../components/Avatar'

function Sidebar() {
  const sections: Array<{ title: string; items: Array<{ name: string; chip?: string; chipColor?: string; active?: boolean; sub?: string }> }> = [
    {
      title: 'ОПЕРАЦИИ',
      items: [
        { name: 'Dashboard' },
        { name: 'Tasks', chip: '1.2k', chipColor: 'bg-surface-3 text-text-secondary', active: true },
        { name: 'Companies' },
        { name: 'Test Cases' },
        { name: 'Podcasts' },
      ],
    },
    {
      title: 'МОДЕРАЦИЯ',
      items: [
        { name: 'Anti-Cheat', chip: '23', chipColor: 'bg-danger/20 text-danger' },
        { name: 'Reports' },
        { name: 'Banned' },
      ],
    },
    {
      title: 'СИСТЕМА',
      items: [
        { name: 'Dynamic Config' },
        { name: 'Notifications' },
        { name: 'LLM Configs' },
        { name: 'Status', chip: '●', chipColor: 'bg-success/20 text-success' },
      ],
    },
  ]
  return (
    <aside className="flex w-full flex-col border-b border-border bg-surface-1 lg:w-60 lg:border-b-0 lg:border-r">
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-accent to-cyan font-display text-sm font-extrabold text-text-primary">
          9
        </span>
        <span className="font-display text-sm font-bold text-text-primary">druz9 ADMIN</span>
        <span className="ml-auto rounded-full bg-surface-3 px-1.5 py-0.5 font-mono text-[9px] text-text-muted">
          v3.2
        </span>
      </div>
      <nav className="flex flex-1 flex-row gap-5 overflow-x-auto px-3 py-4 lg:flex-col">
        {sections.map((s) => (
          <div key={s.title} className="flex flex-col gap-1">
            <span className="px-3 font-mono text-[10px] font-semibold tracking-[0.1em] text-text-muted">
              {s.title}
            </span>
            {s.items.map((it) => (
              <button
                key={it.name}
                className={`flex items-center justify-between rounded-md px-3 py-1.5 text-[13px] ${
                  it.active
                    ? 'border-l-2 border-accent bg-accent/10 text-text-primary'
                    : 'text-text-secondary hover:bg-surface-2'
                }`}
              >
                <span>{it.name}</span>
                {it.chip && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold ${
                      it.chipColor ?? 'bg-surface-3 text-text-secondary'
                    }`}
                  >
                    {it.chip}
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
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

function TopBar() {
  return (
    <div className="flex h-auto flex-col gap-3 border-b border-border bg-bg px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-7 sm:py-0 lg:h-14">
      <div className="flex flex-col">
        <h1 className="font-display text-lg font-bold text-text-primary">Tasks</h1>
        <span className="font-mono text-[11px] text-text-muted">Управление задачами и каталогом</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-64 items-center gap-2 rounded-md border border-border bg-surface-1 px-3">
          <Search className="h-3.5 w-3.5 text-text-muted" />
          <span className="font-sans text-[12px] text-text-muted">Search…</span>
        </div>
        <Button variant="primary" size="sm" icon={<Plus className="h-3.5 w-3.5" />}>
          Создать задачу
        </Button>
      </div>
    </div>
  )
}

function StatsStrip() {
  const stats = [
    ['Всего', '1247', 'text-text-primary'],
    ['Активные', '1184', 'text-success'],
    ['Drafts', '47', 'text-warn'],
    ['Архив', '16', 'text-text-muted'],
  ] as const
  return (
    <div className="grid grid-cols-2 gap-3 px-4 pt-4 sm:px-7 lg:flex lg:h-20 lg:grid-cols-none">
      {stats.map(([k, v, c]) => (
        <div key={k} className="flex flex-1 flex-col rounded-lg border border-border bg-surface-1 px-4 py-2">
          <span className="font-mono text-[10px] font-semibold tracking-[0.08em] text-text-muted">
            {k}
          </span>
          <span className={`font-display text-xl font-extrabold ${c}`}>{v}</span>
        </div>
      ))}
    </div>
  )
}

function FiltersBar() {
  const filters = ['Раздел ▾', 'Сложность ▾', 'Статус ▾', 'Author ▾', 'Tag ▾']
  return (
    <div className="flex h-auto flex-col gap-3 border-y border-border bg-surface-1 px-4 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-7 sm:py-0 lg:h-12">
      <div className="flex gap-2 overflow-x-auto">
        {filters.map((f) => (
          <button key={f} className="rounded-md border border-border bg-bg px-2.5 py-1 font-mono text-[11px] text-text-secondary hover:bg-surface-2">
            {f}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono text-[11px] text-text-muted">Выбрано: 0</span>
        <button className="rounded-md border border-border bg-bg px-2.5 py-1 font-mono text-[11px] text-text-secondary">
          Действия ▾
        </button>
      </div>
    </div>
  )
}

type TaskRow = {
  id: string
  title: string
  slug: string
  section: string
  diff: 'Easy' | 'Med' | 'Hard'
  status: 'Active' | 'Draft' | 'Archived'
  tests: number
  used: string
  updated: string
}

const tasks: TaskRow[] = [
  { id: 'tw-sum', title: 'Two Sum', slug: 'two-sum', section: 'Algorithms', diff: 'Easy', status: 'Active', tests: 15, used: '12.4k', updated: '2 ч назад' },
  { id: 'lru', title: 'LRU Cache', slug: 'lru-cache', section: 'Algorithms', diff: 'Med', status: 'Active', tests: 22, used: '8.1k', updated: '5 ч назад' },
  { id: 'med-srt', title: 'Median Sorted', slug: 'median-sorted-arrays', section: 'Algorithms', diff: 'Hard', status: 'Active', tests: 28, used: '3.4k', updated: '1 д назад' },
  { id: 'wb', title: 'Word Break', slug: 'word-break', section: 'DP', diff: 'Med', status: 'Active', tests: 18, used: '4.7k', updated: '2 д назад' },
  { id: 'trie', title: 'Trie', slug: 'trie', section: 'Trees', diff: 'Med', status: 'Draft', tests: 12, used: '0', updated: '3 д назад' },
  { id: 'bfs', title: 'Graph BFS', slug: 'graph-bfs', section: 'Graphs', diff: 'Med', status: 'Active', tests: 16, used: '2.8k', updated: '4 д назад' },
  { id: 'urls', title: 'URL Shortener', slug: 'url-shortener', section: 'System Design', diff: 'Hard', status: 'Active', tests: 10, used: '1.2k', updated: '6 д назад' },
  { id: 'star', title: 'STAR conflict', slug: 'star-conflict', section: 'Behavioral', diff: 'Easy', status: 'Active', tests: 5, used: '5.6k', updated: '7 д назад' },
  { id: 'dcache', title: 'Distributed cache', slug: 'distributed-cache', section: 'System Design', diff: 'Hard', status: 'Active', tests: 14, used: '900', updated: '10 д назад' },
]

const diffColor: Record<TaskRow['diff'], string> = {
  Easy: 'bg-success/15 text-success',
  Med: 'bg-warn/15 text-warn',
  Hard: 'bg-danger/15 text-danger',
}

const statusColor: Record<TaskRow['status'], string> = {
  Active: 'bg-success/15 text-success',
  Draft: 'bg-warn/15 text-warn',
  Archived: 'bg-surface-3 text-text-muted',
}

function TasksTable() {
  return (
    <div className="px-4 pb-4 sm:px-7">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[800px]">
          <thead className="bg-surface-1">
            <tr className="text-left font-mono text-[10px] font-semibold tracking-[0.08em] text-text-muted">
              <th className="w-8 px-3 py-2.5"><input type="checkbox" /></th>
              <th className="px-3 py-2.5">ID</th>
              <th className="px-3 py-2.5">TITLE</th>
              <th className="px-3 py-2.5">SECTION</th>
              <th className="px-3 py-2.5">DIFF</th>
              <th className="px-3 py-2.5">STATUS</th>
              <th className="px-3 py-2.5">TESTS</th>
              <th className="px-3 py-2.5">USED</th>
              <th className="px-3 py-2.5">UPDATED</th>
              <th className="w-8 px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id} className="border-t border-border bg-bg hover:bg-surface-1">
                <td className="px-3 py-3"><input type="checkbox" /></td>
                <td className="px-3 py-3 font-mono text-[12px] text-text-secondary">{t.id}</td>
                <td className="px-3 py-3">
                  <div className="flex flex-col">
                    <span className="text-[13px] font-semibold text-text-primary">{t.title}</span>
                    <span className="font-mono text-[10px] text-text-muted">/{t.slug}</span>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <span className="rounded-full bg-cyan/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan">
                    {t.section}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${diffColor[t.diff]}`}>
                    {t.diff}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${statusColor[t.status]}`}>
                    {t.status}
                  </span>
                </td>
                <td className="px-3 py-3 font-mono text-[12px] text-text-secondary">{t.tests}</td>
                <td className="px-3 py-3 font-mono text-[12px] text-text-secondary">{t.used}</td>
                <td className="px-3 py-3 font-mono text-[11px] text-text-muted">{t.updated}</td>
                <td className="px-3 py-3 text-text-muted">
                  <MoreHorizontal className="h-4 w-4" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Pagination() {
  const pages = ['1', '2', '3', '...', '139']
  return (
    <div className="flex flex-col items-center justify-between gap-2 border-t border-border bg-surface-1 px-4 py-3 sm:flex-row sm:px-7">
      <span className="font-mono text-[11px] text-text-muted">1-9 из 1247</span>
      <div className="flex gap-1">
        {pages.map((p, i) => (
          <button
            key={i}
            className={`grid h-7 w-7 place-items-center rounded-md font-mono text-[11px] ${
              p === '1' ? 'bg-accent text-text-primary' : 'border border-border text-text-secondary hover:bg-surface-2'
            }`}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function AdminPage() {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-text-primary lg:flex-row">
      <Sidebar />
      <main className="flex flex-1 flex-col">
        <TopBar />
        <StatsStrip />
        <FiltersBar />
        <TasksTable />
        <div className="flex-1" />
        <Pagination />
      </main>
    </div>
  )
}
