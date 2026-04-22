// TODO i18n
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Camera,
  Check,
  CheckCheck,
  FileCode,
  Lightbulb,
  Mic,
  PhoneOff,
  Play,
  Sparkles,
  Triangle,
  Upload,
  Video,
} from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Avatar } from '../components/Avatar'
import { WSStatus } from '../components/ws/WSStatus'
import { useChannel } from '../lib/ws'
import { useMockSessionQuery } from '../lib/queries/mock'

function ErrorChip() {
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      Не удалось загрузить
    </span>
  )
}

type Metric = { label: string; value: number; color?: string }
type AIMessage = { from: 'ai' | 'user'; text: string }

function MatchHeader() {
  return (
    <div className="flex h-[80px] items-center justify-between gap-2 border-b border-border bg-surface-1 px-4 sm:px-8">
      <div className="hidden items-center gap-3 sm:flex">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-success">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          CODING INTERVIEW · LIVE
        </span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <span className="font-display text-[26px] font-extrabold leading-none text-text-primary">
          37:42 <span className="text-text-muted">/ 45:00</span>
        </span>
        <span className="font-mono text-[11px] tracking-[0.08em] text-text-muted">
          ВОПРОС 2 ИЗ 4
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" icon={<Lightbulb className="h-4 w-4" />} size="sm" className="hidden sm:inline-flex">
          Подсказка
        </Button>
        <Button variant="danger" size="sm">
          Завершить
        </Button>
      </div>
    </div>
  )
}

function InterviewerPanel() {
  return (
    <Card className="h-[320px] flex-col gap-3 p-4" interactive={false}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Avatar size="md" gradient="cyan-violet" initials="AI" status="online" />
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-text-primary">AI Interviewer</span>
            <span className="font-mono text-[11px] text-success">● Слушает</span>
          </div>
        </div>
        <Sparkles className="h-4 w-4 text-cyan" />
      </div>
      <div className="flex flex-1 items-center justify-center rounded-lg bg-gradient-to-br from-surface-3 to-surface-2 border border-border-strong">
        <div className="flex flex-col items-center gap-2">
          <Video className="h-10 w-10 text-text-muted" />
          <span className="font-mono text-[11px] text-text-muted">video stream</span>
        </div>
      </div>
    </Card>
  )
}

function QuestionPanel({ title, description }: { title: string; description: string }) {
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-cyan/15 px-2.5 py-1 font-mono text-[11px] font-semibold text-cyan">
        ВОПРОС 2 / 4
      </span>
      <h3 className="font-display text-lg font-bold text-text-primary">
        {title}
      </h3>
      <p className="text-[13px] leading-relaxed text-text-secondary">
        {description}
      </p>
      <div className="rounded-md bg-surface-2 px-3 py-2 font-mono text-[11px] text-text-muted">
        1 ≤ capacity ≤ 1000
      </div>
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-warn/15 px-2.5 py-1 text-[11px] font-semibold text-warn">
        <Lightbulb className="h-3 w-3" /> Hint: используй хешмапу + двусвязный список
      </span>
    </Card>
  )
}

function NotesPanel() {
  const items = [
    { icon: <Check className="h-3.5 w-3.5 text-success" />, text: 'Спросил про edge cases' },
    { icon: <CheckCheck className="h-3.5 w-3.5 text-success" />, text: 'Объяснил выбор структуры' },
    { icon: <Triangle className="h-3.5 w-3.5 text-warn" />, text: 'Не учёл потокобезопасность' },
  ]
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <h3 className="text-sm font-bold text-text-primary">Заметки интервьюера</h3>
      {items.map((it, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="mt-0.5">{it.icon}</span>
          <span className="text-[13px] text-text-secondary">{it.text}</span>
        </div>
      ))}
    </Card>
  )
}

function EditorArea() {
  const code = [
    'package main',
    '',
    'type entry struct {',
    '    key, val int',
    '}',
    '',
    'type LRUCache struct {',
    '    cap   int',
    '    data  map[int]*list.Element',
    '    order *list.List',
    '}',
    '',
    'func (c *LRUCache) Get(key int) int {',
    '    if el, ok := c.data[key]; ok {',
    '        c.order.MoveToFront(el)',
    '        return el.Value.(*entry).val',
    '    }',
    '    return -1',
    '}',
  ]
  return (
    <Card className="flex-1 flex-col p-0 overflow-hidden" interactive={false}>
      <div className="flex h-11 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2.5">
          <FileCode className="h-4 w-4 text-text-secondary" />
          <span className="font-mono text-[13px] text-text-primary">lru.go</span>
          <span className="rounded-full bg-cyan/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan">
            Go
          </span>
        </div>
        <span className="font-mono text-[11px] text-text-muted">UTF-8 · LF</span>
      </div>
      <div className="flex flex-1 overflow-auto bg-surface-1">
        <div className="flex flex-col items-end px-3 py-3 font-mono text-[12px] text-text-muted select-none">
          {code.map((_, i) => (
            <span key={i} className={i === 13 ? 'text-accent-hover font-semibold' : ''}>
              {i + 1}
            </span>
          ))}
        </div>
        <div className="flex flex-1 flex-col py-3 pr-4 font-mono text-[12px] text-text-secondary">
          {code.map((line, i) => (
            <pre
              key={i}
              className={[
                'whitespace-pre',
                i === 13 ? 'bg-accent/15 text-text-primary -mx-2 px-2 rounded' : '',
              ].join(' ')}
            >
              {line || ' '}
            </pre>
          ))}
        </div>
      </div>
      <div className="flex h-14 items-center justify-between border-t border-border px-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" icon={<Play className="h-3.5 w-3.5" />}>
            Run
          </Button>
          <Button variant="primary" size="sm" icon={<Upload className="h-3.5 w-3.5" />}>
            Submit
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[12px] text-success">12/15 tests</span>
          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-black/30">
            <div className="h-full w-[80%] bg-gradient-to-r from-success to-cyan" />
          </div>
        </div>
      </div>
    </Card>
  )
}

function ControlsCard() {
  const btn = (Icon: React.ElementType, danger?: boolean) => (
    <button
      className={[
        'grid h-11 w-11 place-items-center rounded-full border',
        danger ? 'border-danger/40 bg-danger/15 text-danger hover:bg-danger/25' : 'border-border bg-surface-2 text-text-secondary hover:bg-surface-3 hover:text-text-primary',
      ].join(' ')}
    >
      <Icon className="h-4 w-4" />
    </button>
  )
  return (
    <Card className="flex-row items-center justify-around p-4" interactive={false}>
      {btn(Mic)}
      {btn(Camera)}
      {btn(Upload)}
      {btn(PhoneOff, true)}
    </Card>
  )
}

const METRIC_COLORS = ['bg-success', 'bg-cyan', 'bg-accent', 'bg-warn']

function EvaluationCard({ metrics }: { metrics: Metric[] }) {
  return (
    <Card className="flex-col gap-4 border-accent/30 bg-gradient-to-br from-surface-3 to-accent/40 p-5" interactive={false}>
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-bold text-text-primary">AI Оценка</h3>
        <Sparkles className="h-4 w-4 text-cyan" />
      </div>
      <div className="flex flex-col gap-3">
        {metrics.map((m, i) => (
          <div key={m.label} className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-text-secondary">{m.label}</span>
              <span className="font-mono text-[12px] font-semibold text-text-primary">{m.value}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-black/40">
              <div
                className={`h-full transition-all duration-700 ${m.color ?? METRIC_COLORS[i % METRIC_COLORS.length]}`}
                style={{ width: `${m.value}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function QATimeline() {
  const items = [
    { n: 1, label: 'Two Sum Variations', status: 'done', meta: '9.2 ★', color: 'bg-success' },
    { n: 2, label: 'LRU Cache', status: 'active', meta: 'сейчас', color: 'bg-accent' },
    { n: 3, label: 'Word Ladder', status: 'future', meta: '—', color: 'bg-border-strong' },
    { n: 4, label: 'System Design', status: 'future', meta: '—', color: 'bg-border-strong' },
  ]
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <h3 className="text-sm font-bold text-text-primary">Вопросы</h3>
      {items.map((q) => (
        <div key={q.n} className="flex items-center gap-3">
          <span className={`h-2 w-2 rounded-full ${q.color}`} />
          <div className="flex flex-1 flex-col">
            <span className={q.status === 'active' ? 'text-[13px] font-semibold text-text-primary' : 'text-[13px] text-text-secondary'}>
              Q{q.n}. {q.label}
            </span>
          </div>
          <span className="font-mono text-[11px] text-text-muted">{q.meta}</span>
        </div>
      ))}
    </Card>
  )
}

const INITIAL_METRICS: Metric[] = [
  { label: 'Корректность', value: 92, color: 'bg-success' },
  { label: 'Эффективность', value: 78, color: 'bg-cyan' },
  { label: 'Чистота кода', value: 85, color: 'bg-accent' },
  { label: 'Коммуникация', value: 70, color: 'bg-warn' },
]

function TranscriptCard({ messages }: { messages: AIMessage[] }) {
  if (messages.length === 0) return null
  return (
    <Card className="flex-col gap-2 p-4" interactive={false}>
      <h3 className="text-sm font-bold text-text-primary">Транскрипт</h3>
      <div className="flex max-h-[200px] flex-col gap-1.5 overflow-y-auto">
        {messages.slice(-20).map((m, i) => (
          <div key={i} className="text-[12px]">
            <span className={m.from === 'ai' ? 'text-cyan' : 'text-accent-hover'}>
              {m.from === 'ai' ? 'AI:' : 'Я:'}{' '}
            </span>
            <span className="text-text-secondary">{m.text}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

export default function MockSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const channel = sessionId ? `mock/${sessionId}` : ''
  const { lastEvent, data, status } = useChannel<Record<string, unknown>>(channel)
  const { data: session, isError } = useMockSessionQuery(sessionId)
  const qTitle = session?.task?.title ?? 'Реализуй LRU Cache'
  const qDesc = session?.task?.description ?? 'Спроектируй структуру данных, которая поддерживает операции get и put за O(1) и вытесняет наименее недавно использованный элемент при превышении ёмкости.'

  const [metrics, setMetrics] = useState<Metric[]>(INITIAL_METRICS)
  const [transcript, setTranscript] = useState<AIMessage[]>(() =>
    (session?.last_messages ?? []).map((m): AIMessage => ({
      from: m.role === 'user' ? 'user' : 'ai',
      text: m.content,
    })),
  )

  useEffect(() => {
    if (!lastEvent || !data) return
    if (lastEvent === 'ai_evaluation') {
      const m = (data as { metrics?: Metric[] }).metrics
      if (Array.isArray(m)) setMetrics(m)
    } else if (lastEvent === 'ai_message') {
      setTranscript((prev) => [...prev, data as AIMessage])
    }
  }, [lastEvent, data])

  return (
    <AppShellV2>
      <div className="relative">
        <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
          {isError && <ErrorChip />}
          <WSStatus status={status} />
        </div>
        <MatchHeader />
      </div>
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-8 lg:flex-row">
        <div className="flex w-full flex-col gap-4 lg:w-[360px]">
          <QuestionPanel title={qTitle} description={qDesc} />
          <div className="hidden lg:block">
            <InterviewerPanel />
          </div>
          <div className="hidden lg:block">
            <NotesPanel />
          </div>
        </div>
        <div className="flex min-h-[400px] flex-1 flex-col gap-4">
          <EditorArea />
          <TranscriptCard messages={transcript} />
        </div>
        <div className="flex w-full flex-col gap-4 lg:w-[320px]">
          <ControlsCard />
          <EvaluationCard metrics={metrics} />
          <QATimeline />
          <div className="lg:hidden">
            <NotesPanel />
          </div>
        </div>
      </div>
    </AppShellV2>
  )
}
