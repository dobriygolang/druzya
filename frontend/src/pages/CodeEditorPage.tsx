// TODO i18n
import {
  Edit2,
  Plus,
  Folder,
  FileCode,
  FileText,
  ChevronRight,
  ChevronDown,
  Settings,
  Maximize2,
  Play,
  Bug,
  AlignLeft,
  Sparkles,
  Copy,
  Bookmark,
  Share2,
  MessageSquare,
} from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Avatar } from '../components/Avatar'

function TopBar() {
  return (
    <div className="flex h-auto flex-wrap items-center justify-between gap-3 border-b border-border bg-bg px-4 py-2 sm:px-5 lg:h-14 lg:flex-nowrap lg:py-0">
      <div className="flex items-center gap-4">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-surface-2 border border-border-strong font-display text-sm font-extrabold text-text-primary">
          9
        </span>
        <div className="flex items-center gap-2 font-mono text-[12px] text-text-secondary">
          <span>Playground</span>
          <span className="text-text-muted">/</span>
          <span className="text-text-primary">Untitled-3</span>
          <button className="text-text-muted hover:text-text-secondary">
            <Edit2 className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 font-mono text-[11px] font-semibold text-success">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
          Авто-сохранено
        </span>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex -space-x-2">
          <Avatar size="sm" gradient="violet-cyan" initials="A" />
          <Avatar size="sm" gradient="pink-violet" initials="K" />
          <Avatar size="sm" gradient="success-cyan" initials="N" />
        </div>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[10px] font-semibold text-text-secondary">
          +2
        </span>
        <Button variant="ghost" size="sm">Пригласить</Button>
        <Button variant="primary" size="sm" icon={<Share2 className="h-3.5 w-3.5" />}>Поделиться</Button>
        <Avatar size="md" gradient="pink-violet" initials="Д" />
      </div>
    </div>
  )
}

function FileExplorer() {
  return (
    <div className="flex w-full flex-col border-b border-border bg-surface-1 lg:w-60 lg:border-b-0 lg:border-r">
      <div className="flex h-9 items-center justify-between border-b border-border px-3">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">FILES</span>
        <button className="grid h-5 w-5 place-items-center rounded text-text-muted hover:bg-surface-2 hover:text-text-primary">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-2 text-[12px]">
        <div className="flex items-center gap-1.5 px-1 py-1 text-text-secondary">
          <ChevronDown className="h-3 w-3" />
          <Folder className="h-3.5 w-3.5 text-text-secondary" />
          <span className="font-mono">/playground</span>
        </div>
        <div className="ml-4 flex items-center gap-1.5 rounded bg-text-primary/15 px-2 py-1 text-text-primary">
          <FileCode className="h-3.5 w-3.5 text-text-primary" />
          <span className="font-mono">main.go</span>
        </div>
        <div className="ml-4 flex items-center gap-1.5 px-2 py-1 text-text-secondary hover:bg-surface-2">
          <FileCode className="h-3.5 w-3.5 text-text-muted" />
          <span className="font-mono">utils.go</span>
        </div>
        <div className="ml-4 flex items-center gap-1.5 px-2 py-1 text-text-secondary hover:bg-surface-2">
          <FileText className="h-3.5 w-3.5 text-text-muted" />
          <span className="font-mono">input.txt</span>
        </div>
        <div className="ml-4 flex items-center gap-1.5 px-2 py-1 text-text-secondary hover:bg-surface-2">
          <FileText className="h-3.5 w-3.5 text-text-muted" />
          <span className="font-mono">README.md</span>
        </div>
        <div className="mt-2 flex items-center gap-1.5 px-1 py-1 text-text-secondary">
          <ChevronRight className="h-3 w-3" />
          <Folder className="h-3.5 w-3.5 text-text-muted" />
          <span className="font-mono">drafts</span>
        </div>
        <div className="flex items-center gap-1.5 px-1 py-1 text-text-secondary">
          <ChevronRight className="h-3 w-3" />
          <Folder className="h-3.5 w-3.5 text-text-muted" />
          <span className="font-mono">archive</span>
        </div>
      </div>
      <div className="border-t border-border p-3">
        <span className="mb-2 block font-mono text-[10px] font-semibold tracking-[0.08em] text-text-muted">
          СНИППЕТЫ
        </span>
        <div className="flex flex-col gap-1">
          {['binary-search.go', 'dfs-template.go', 'dp-knapsack.go'].map((s) => (
            <div key={s} className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-2">
              <Bookmark className="h-3 w-3 text-text-secondary" />
              <span className="font-mono">{s}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const CODE = [
  'package main',
  '',
  'import (',
  '\t"bufio"',
  '\t"fmt"',
  '\t"os"',
  '\t"sort"',
  ')',
  '',
  'func solve(nums []int) int {',
  '\tsort.Ints(nums)',
  '\tlow, high := 0, len(nums)-1',
  '\tfor low < high {',
  '\t\tmid := (low + high) / 2',
  '\t\tif nums[mid] < nums[high] {',
  '\t\t\thigh = mid',
  '\t\t} else {',
  '\t\t\tlow = mid + 1',
  '\t\t}',
  '\t}',
  '\treturn nums[low]',
  '}',
]

function Editor() {
  return (
    <div className="flex flex-1 flex-col bg-bg">
      <div className="flex h-10 items-center border-b border-border bg-surface-1">
        <div className="flex items-center gap-2 border-r border-border px-3 py-2">
          <FileCode className="h-3.5 w-3.5 text-text-primary" />
          <span className="font-mono text-[12px] text-text-primary">main.go</span>
        </div>
        <div className="flex items-center gap-2 border-r border-border px-3 py-2 text-text-muted">
          <FileCode className="h-3.5 w-3.5" />
          <span className="font-mono text-[12px]">utils.go</span>
          <span className="h-1.5 w-1.5 rounded-full bg-warn" />
        </div>
        <div className="flex items-center gap-2 border-r border-border px-3 py-2 text-text-muted">
          <FileText className="h-3.5 w-3.5" />
          <span className="font-mono text-[12px]">input.txt</span>
        </div>
        <div className="ml-auto flex items-center gap-3 px-3">
          <span className="rounded-full bg-text-primary/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-text-secondary">
            Go 1.22
          </span>
          <button className="text-text-muted hover:text-text-primary">
            <Settings className="h-4 w-4" />
          </button>
          <button className="text-text-muted hover:text-text-primary">
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex w-14 flex-col items-end border-r border-border bg-surface-1 px-3 py-3 font-mono text-[12px] leading-[20px] text-text-muted">
          {CODE.map((_, i) => (
            <span key={i} className={i === 13 ? 'text-text-primary' : ''}>
              {i + 1}
            </span>
          ))}
        </div>
        <pre className="flex-1 overflow-auto px-4 py-3 font-mono text-[12px] leading-[20px] text-text-secondary">
          {CODE.map((line, i) => (
            <div key={i} className={i === 13 ? 'rounded-sm bg-text-primary/15 px-1 text-text-primary' : ''}>
              {line || '\u00A0'}
            </div>
          ))}
        </pre>
      </div>
      <div className="flex h-12 items-center gap-3 border-t border-border bg-surface-2 px-4">
        <Button variant="primary" size="sm" icon={<Play className="h-3.5 w-3.5" />} className="">
          Run
        </Button>
        <Button variant="ghost" size="sm" icon={<Bug className="h-3.5 w-3.5" />}>Debug</Button>
        <Button variant="ghost" size="sm" icon={<AlignLeft className="h-3.5 w-3.5" />}>Format</Button>
        <span className="ml-4 font-mono text-[11px] text-text-muted">
          Ln 14, Col 32 · Spaces 4 · UTF-8
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="rounded-full bg-success/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-success">
            Compiled
          </span>
          <span className="font-mono text-[11px] text-text-muted">0.4s</span>
        </div>
      </div>
    </div>
  )
}

function Output() {
  return (
    <div className="flex w-full flex-col border-t border-border bg-surface-1 lg:w-[380px] lg:border-l lg:border-t-0">
      <div className="flex h-10 items-center border-b border-border">
        {['OUTPUT', 'INPUT', 'TERMINAL', 'AI CHAT'].map((t, i) => (
          <button
            key={t}
            className={[
              'flex items-center gap-1.5 px-3 py-2 font-mono text-[11px] font-semibold',
              i === 0
                ? 'border-b-2 border-text-primary text-text-primary'
                : 'text-text-muted hover:text-text-secondary',
            ].join(' ')}
          >
            {i === 3 && <Sparkles className="h-3 w-3 text-text-secondary" />}
            {t}
          </button>
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 bg-bg px-4 py-3.5 font-mono text-[12px]">
        <span className="text-text-muted">$ go run main.go</span>
        <span className="italic text-text-muted">5</span>
        <span className="text-text-secondary">1 2 3 4 5</span>
        <span className="my-1 h-px bg-border" />
        <span className="text-success">✓ Compiled in 0.4s</span>
        <span className="text-success">✓ Executed in 12ms</span>
        <span className="h-2" />
        <span className="text-[10px] font-semibold tracking-[0.08em] text-text-muted">OUTPUT:</span>
        <span className="font-display text-[28px] font-extrabold text-text-secondary">9</span>
        <span className="w-fit rounded-full bg-text-primary/10 px-2 py-0.5 text-[10px] text-text-secondary">
          int · ожидаемый результат
        </span>
        <div className="mt-auto flex flex-col gap-2 rounded-lg bg-gradient-to-br from-accent/20 to-pink/20 p-3">
          <div className="flex items-start gap-2">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-text-secondary" />
            <span className="text-[11px] text-text-primary">
              <span className="font-semibold">AI:</span> Можно ускорить через бинарный поиск — O(log n) вместо O(n log n).
            </span>
          </div>
          <button className="self-start text-[11px] font-semibold text-text-primary hover:underline">
            Применить →
          </button>
        </div>
      </div>
    </div>
  )
}

function StatusBar() {
  return (
    <div className="hidden h-7 items-center justify-between border-t border-border bg-surface-2 px-4 font-mono text-[10px] text-text-muted lg:flex">
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1">
          <Bookmark className="h-3 w-3" /> Сохранить как сниппет
        </span>
        <span className="flex items-center gap-1">
          <Share2 className="h-3 w-3" /> Поделиться
        </span>
        <span className="flex items-center gap-1">
          <MessageSquare className="h-3 w-3" /> 3 комментария
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span>playground.druz9.io/abc-7k2-x9p</span>
        <button className="text-text-muted hover:text-text-primary">
          <Copy className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

export default function CodeEditorPage() {
  return (
    <AppShellV2>
      <div className="flex min-h-[calc(100vh-64px)] flex-col lg:h-[calc(100vh-72px)]">
        <TopBar />
        <div className="flex flex-1 flex-col overflow-auto lg:flex-row lg:overflow-hidden">
          <FileExplorer />
          <Editor />
          <Output />
        </div>
        <StatusBar />
      </div>
    </AppShellV2>
  )
}
