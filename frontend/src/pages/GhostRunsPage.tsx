// TODO i18n
import { Plus, Settings, Play, Send } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Avatar } from '../components/Avatar'

type Ghost = {
  name: string
  sub: string
  gradient: 'violet-cyan' | 'cyan-violet' | 'gold' | 'pink-violet' | 'pink-red'
  on: boolean
  dim?: boolean
}

const ghosts: Ghost[] = [
  { name: 'Твой прошлый run', sub: '5 дней назад · 4:21', gradient: 'violet-cyan', on: true },
  { name: '@alexey', sub: '#1 global · 1:47', gradient: 'cyan-violet', on: true },
  { name: 'AI Reference', sub: 'optimal · 1:32', gradient: 'gold', on: true },
  { name: '@kirill_dev', sub: 'друг · 3:08', gradient: 'pink-violet', on: true },
  { name: 'Median Senior', sub: 'mid-bench · 6:00', gradient: 'pink-red', on: false, dim: true },
]

const code = [
  'package main',
  '',
  'import "fmt"',
  '',
  'func twoSum(nums []int, target int) []int {',
  '    seen := map[int]int{}',
  '    for i, n := range nums {',
  '        if j, ok := seen[target-n]; ok {',
  '            return []int{j, i}',
  '        }',
  '        seen[n] = i',
  '    }',
  '    return nil',
  '}',
  'func main() { fmt.Println(twoSum([]int{2,7,11,15}, 9)) }',
]

function Header() {
  return (
    <div className="flex flex-col gap-3 border-b border-border bg-surface-1 px-4 py-3 sm:px-6 lg:h-16 lg:flex-row lg:items-center lg:justify-between lg:py-0">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">
          GHOST RUNS · ПРАКТИКА
        </span>
        <span className="text-text-muted">·</span>
        <span className="font-display text-base font-bold text-text-primary">
          Two Sum · vs Ghosts
        </span>
      </div>
      <span className="rounded-full bg-accent/15 px-3 py-1 font-mono text-xs font-semibold text-accent-hover">
        👻 4 ghosts active
      </span>
      <Button variant="ghost" size="sm" icon={<Settings className="h-3.5 w-3.5" />}>
        Настроить ghosts
      </Button>
    </div>
  )
}

function GhostRow({ g }: { g: Ghost }) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-[10px] border border-border bg-surface-2 p-3 ${
        g.dim ? 'opacity-50' : ''
      }`}
    >
      <Avatar size="sm" gradient={g.gradient} initials={g.name[1]?.toUpperCase()} />
      <div className="flex flex-1 flex-col">
        <span className="text-[12px] font-semibold text-text-primary">{g.name}</span>
        <span className="font-mono text-[10px] text-text-muted">{g.sub}</span>
      </div>
      <div
        className={`relative h-4 w-7 rounded-full ${
          g.on ? 'bg-accent' : 'bg-surface-3'
        }`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
            g.on ? 'left-3.5' : 'left-0.5'
          }`}
        />
      </div>
    </div>
  )
}

function LeftPanel() {
  return (
    <div className="flex w-full flex-col gap-3 border-b border-border bg-surface-1 p-4 lg:w-[280px] lg:border-b-0 lg:border-r">
      <h3 className="font-display text-sm font-bold text-text-primary">Активные ghosts</h3>
      {ghosts.map((g) => (
        <GhostRow key={g.name} g={g} />
      ))}
      <div className="flex-1" />
      <button className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong px-3 py-2 text-xs text-text-muted hover:bg-surface-2">
        <Plus className="h-3.5 w-3.5" /> Добавить ghost
      </button>
      <div className="rounded-lg border border-border bg-surface-2 p-3">
        <p className="text-[11px] text-text-secondary">
          👻 Ghost не блокирует — Прозрачные курсоры идут параллельно
        </p>
      </div>
    </div>
  )
}

function CenterEditor() {
  const inlineGhosts: Record<number, { label: string; color: string }> = {
    3: { label: '@alexey is here', color: 'text-cyan bg-cyan/15' },
    5: { label: '▮ ты', color: 'text-accent-hover bg-accent/15' },
    7: { label: 'AI ref typed here · 8s ago', color: 'text-warn bg-warn/15' },
    9: { label: '@kirill ↑ 12s back', color: 'text-pink bg-pink/15' },
    11: { label: 'you (5 days ago)', color: 'text-text-secondary bg-white/5' },
  }
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex h-10 items-center justify-between border-b border-border bg-surface-1 px-4">
        <span className="rounded-md bg-surface-2 px-3 py-1 font-mono text-[12px] text-text-primary">
          solution.go
        </span>
        <span className="font-mono text-[11px] text-accent-hover">1:24 elapsed</span>
      </div>
      <div className="flex flex-1 overflow-auto">
        <div className="flex w-12 flex-col border-r border-border bg-surface-2 py-3 text-right">
          {code.map((_, i) => (
            <span
              key={i}
              className={`px-3 font-mono text-[11px] ${
                i === 5 ? 'bg-accent/15 text-accent-hover' : 'text-text-muted'
              }`}
            >
              {i + 1}
            </span>
          ))}
        </div>
        <div className="flex flex-1 flex-col py-3">
          {code.map((line, i) => (
            <div key={i} className="flex flex-col">
              <code className="whitespace-pre px-4 font-mono text-[12px] text-text-secondary">
                {line || ' '}
              </code>
              {inlineGhosts[i] && (
                <span
                  className={`ml-4 mb-1 inline-flex w-fit items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] ${inlineGhosts[i].color}`}
                >
                  {inlineGhosts[i].label}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="flex h-14 items-center gap-3 border-t border-border bg-surface-1 px-4">
        <Button variant="ghost" size="sm" icon={<Play className="h-3.5 w-3.5" />}>
          Run
        </Button>
        <Button variant="primary" size="sm" icon={<Send className="h-3.5 w-3.5" />}>
          Submit
        </Button>
        <span className="font-mono text-xs text-text-muted">12/15 tests</span>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full w-[80%] rounded-full bg-success" />
        </div>
      </div>
    </div>
  )
}

type Standing = {
  rank: number
  name: string
  sub: string
  time: string
  gradient: Ghost['gradient']
  done?: boolean
  active?: boolean
  past?: boolean
}

const standings: Standing[] = [
  { rank: 1, name: 'AI Reference', sub: 'optimal solution', time: '1:32 ✓ DONE', gradient: 'gold', done: true },
  { rank: 2, name: '@alexey', sub: '#1 global', time: '1:47', gradient: 'cyan-violet' },
  { rank: 3, name: '@kirill_dev', sub: 'друг', time: '3:08', gradient: 'pink-violet' },
  { rank: 4, name: '@you', sub: 'IN PROGRESS', time: '1:24', gradient: 'violet-cyan', active: true },
  { rank: 5, name: 'your past', sub: '5d ago', time: '4:21', gradient: 'violet-cyan', past: true },
  { rank: 6, name: '@nastya', sub: 'друг', time: '5:14', gradient: 'pink-red' },
]

function RightLeaderboard() {
  return (
    <div className="flex w-full flex-col gap-3.5 border-t border-border bg-surface-2 p-5 lg:w-[320px] lg:border-l lg:border-t-0">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-bold text-text-primary">Race · Live Standings</h3>
        <span className="h-2 w-2 animate-pulse rounded-full bg-danger" />
      </div>
      {standings.map((s) => (
        <div
          key={s.rank}
          className={`flex items-center gap-3 rounded-[10px] bg-surface-1 p-3 ${
            s.active ? 'border border-accent' : 'border border-border'
          } ${s.past ? 'opacity-60' : ''}`}
        >
          <span className="grid h-7 w-7 place-items-center rounded-full bg-surface-3 font-display text-[13px] font-bold text-text-primary">
            #{s.rank}
          </span>
          <Avatar size="sm" gradient={s.gradient} initials={s.name[1]?.toUpperCase()} />
          <div className="flex flex-1 flex-col">
            <span className="text-[12px] font-semibold text-text-primary">{s.name}</span>
            <span className="font-mono text-[10px] text-text-muted">{s.sub}</span>
          </div>
          <span className={`font-mono text-[11px] ${s.done ? 'text-warn' : 'text-text-secondary'}`}>
            {s.time}
          </span>
          {s.active && (
            <span className="rounded-full bg-accent/20 px-1.5 py-0.5 font-mono text-[9px] text-accent-hover">
              ты
            </span>
          )}
        </div>
      ))}
      <div className="rounded-lg border border-border bg-surface-1 p-3 text-center">
        <p className="text-[11px] text-text-secondary">🎯 Цель: побить твоё прошлое</p>
      </div>
    </div>
  )
}

export default function GhostRunsPage() {
  return (
    <AppShellV2>
      <Header />
      <div className="flex flex-col lg:h-[calc(100vh-72px-64px)] lg:flex-row">
        <LeftPanel />
        <CenterEditor />
        <RightLeaderboard />
      </div>
    </AppShellV2>
  )
}
