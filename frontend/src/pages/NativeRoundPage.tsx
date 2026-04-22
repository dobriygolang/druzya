// TODO i18n
import { useParams } from 'react-router-dom'
import {
  Bot,
  Check,
  FileCode,
  Lightbulb,
  Play,
  Send,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Avatar } from '../components/Avatar'
import { useNativeScoreQuery } from '../lib/queries/native'

function ErrorChip() {
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      Не удалось загрузить
    </span>
  )
}

function MatchHeader({ aiUsed, aiMax }: { aiUsed: number; aiMax: number }) {
  return (
    <div className="flex flex-col gap-3 border-b border-border bg-surface-1 px-4 py-3 sm:px-6 lg:h-[80px] lg:flex-row lg:items-center lg:justify-between lg:px-8 lg:py-0">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-warn/15 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-warn">
          <Sparkles className="h-3 w-3" />
          AI-ALLOWED · РАЗРЕШЁН
        </span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <span className="font-display text-[26px] font-extrabold leading-none text-text-primary">
          22:14 <span className="text-text-muted">/ 60:00</span>
        </span>
        <span className="font-mono text-[11px] tracking-[0.08em] text-text-muted">
          NATIVE ROUND
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-warn/15 px-2.5 py-1 font-mono text-[11px] font-semibold text-warn">
          AI запросов: {aiUsed} / {aiMax}
        </span>
        <Button variant="ghost" icon={<Lightbulb className="h-4 w-4" />} size="sm">
          Подсказка
        </Button>
        <Button variant="danger" size="sm">
          Завершить
        </Button>
      </div>
    </div>
  )
}

function QuestionPanel() {
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <h3 className="font-display text-[18px] font-bold leading-tight text-text-primary">
        Design Twitter Timeline System
      </h3>
      <p className="text-[13px] leading-relaxed text-text-secondary">
        Спроектируй систему генерации home timeline для 100M активных пользователей.
        Опиши fan-out, кэширование и стратегию репликации.
      </p>
      <div className="flex flex-wrap gap-1.5">
        <span className="rounded-full bg-danger/15 px-2.5 py-1 font-mono text-[11px] font-semibold text-danger">
          Senior
        </span>
        <span className="rounded-full bg-cyan/15 px-2.5 py-1 font-mono text-[11px] font-semibold text-cyan">
          System Design
        </span>
      </div>
    </Card>
  )
}

function AllowedToolsCard() {
  const allowed = ['GPT-4o Free', 'Claude Sonnet Free', 'Поиск по docs', 'Stack Overflow']
  const forbidden = ['ChatGPT с web', 'Copilot in IDE']
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <h3 className="text-sm font-bold text-text-primary">Разрешённые AI-инструменты</h3>
      {allowed.map((t) => (
        <div key={t} className="flex items-center gap-2">
          <Check className="h-4 w-4 text-success" />
          <span className="text-[13px] text-text-secondary">{t}</span>
        </div>
      ))}
      <div className="my-1 border-t border-border" />
      <h4 className="font-mono text-[11px] font-semibold tracking-[0.08em] text-danger">
        ЗАПРЕЩЕНО:
      </h4>
      {forbidden.map((t) => (
        <div key={t} className="flex items-center gap-2">
          <X className="h-4 w-4 text-danger" />
          <span className="text-[13px] text-text-secondary">{t}</span>
        </div>
      ))}
    </Card>
  )
}

function UsageStatsCard({ aiUsed, aiMax, aiFraction, humanFraction }: { aiUsed: number; aiMax: number; aiFraction: number; humanFraction: number }) {
  const rows = [
    { label: 'Промпты', value: `${aiUsed} / ${aiMax}` },
    { label: 'AI fraction', value: `${Math.round(aiFraction * 100)}%` },
    { label: 'Своя доля', value: `${Math.round(humanFraction * 100)}%` },
  ]
  return (
    <Card className="flex-col gap-3 border-warn/30 bg-gradient-to-br from-surface-3 to-warn/30 p-5" interactive={false}>
      <h3 className="font-display text-base font-bold text-text-primary">AI Usage</h3>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between">
          <span className="text-[13px] text-text-secondary">{r.label}</span>
          <span className="font-mono text-[13px] font-semibold text-text-primary">{r.value}</span>
        </div>
      ))}
    </Card>
  )
}

function EditorArea() {
  const code = [
    '// Twitter timeline — fan-out write',
    'type Tweet struct { ID, AuthorID int64; Body string }',
    '',
    'func PostTweet(t Tweet) error {',
    '    if err := db.Insert(t); err != nil {',
    // AI suggested block 5-12
    '        return err',
    '    }',
    '    followers := graph.GetFollowers(t.AuthorID)',
    '    for _, f := range followers {',
    '        timelineCache.LPush(',
    '            keyFor(f), t.ID)',
    '    }',
    '    return nil',
    '}',
    '',
    'func GetTimeline(uid int64) []Tweet { ... }',
  ]
  return (
    <Card className="flex-1 flex-col p-0 overflow-hidden" interactive={false}>
      <div className="flex h-11 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2.5">
          <FileCode className="h-4 w-4 text-text-secondary" />
          <span className="font-mono text-[13px] text-text-primary">timeline.go</span>
          <span className="rounded-full bg-cyan/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan">
            Go
          </span>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-accent/20 px-2.5 py-1 font-mono text-[11px] font-semibold text-accent-hover">
          <Sparkles className="h-3 w-3" /> AI предложил блок 5-12
        </span>
      </div>
      <div className="flex flex-1 overflow-auto bg-surface-1">
        <div className="flex flex-col items-end px-3 py-3 font-mono text-[12px] text-text-muted select-none">
          {code.map((_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </div>
        <div className="flex flex-1 flex-col py-3 pr-4 font-mono text-[12px] text-text-secondary">
          {code.map((line, i) => {
            const ai = i >= 4 && i <= 11
            return (
              <pre
                key={i}
                className={[
                  'whitespace-pre',
                  ai ? 'bg-accent/10 -mx-2 px-2 border-l-2 border-accent' : '',
                ].join(' ')}
              >
                {line || ' '}
              </pre>
            )
          })}
        </div>
      </div>
      <div className="flex h-14 items-center justify-between border-t border-border px-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" icon={<Sparkles className="h-3.5 w-3.5" />}>
            Ask AI
          </Button>
          <Button variant="ghost" size="sm" icon={<Play className="h-3.5 w-3.5" />}>
            Run
          </Button>
          <Button variant="primary" size="sm" icon={<Upload className="h-3.5 w-3.5" />}>
            Submit
          </Button>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-warn/15 px-2.5 py-1 font-mono text-[11px] font-semibold text-warn">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warn" />
          Логирование вкл
        </span>
      </div>
    </Card>
  )
}

function ChatPanel() {
  const messages: Array<{ role: 'user' | 'ai'; text: string; code?: string }> = [
    { role: 'user', text: 'Как реализовать LRU? O(1)' },
    {
      role: 'ai',
      text: 'Двусвязный список + хеш-таблица. На Get переноси узел в head, на Put вытесняй tail.',
      code: 'type LRU struct {\n  m map[int]*Node\n  head, tail *Node\n}',
    },
    { role: 'user', text: 'А как fan-out для 100M юзеров?' },
    {
      role: 'ai',
      text: 'Гибрид: write-fan-out для обычных, pull-on-read для celebrity (>1M фолловеров).',
    },
  ]
  return (
    <Card className="flex-col gap-0 p-0 overflow-hidden" interactive={false}>
      <div className="flex items-center justify-between border-b border-border p-4">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-cyan" />
          <span className="text-sm font-bold text-text-primary">Chat с GPT-4o</span>
        </div>
        <span className="rounded-full bg-warn/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-warn">
          3/10
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-auto p-4">
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80%] rounded-lg bg-accent px-3 py-2 text-[13px] text-text-primary">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={i} className="flex gap-2">
              <Avatar size="sm" gradient="cyan-violet" initials="AI" />
              <div className="flex max-w-[80%] flex-col gap-2 rounded-lg bg-surface-3 px-3 py-2">
                <span className="text-[13px] text-text-secondary">{m.text}</span>
                {m.code && (
                  <pre className="rounded bg-black/40 p-2 font-mono text-[11px] text-cyan whitespace-pre-wrap">
                    {m.code}
                  </pre>
                )}
              </div>
            </div>
          ),
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-border p-3">
        <input
          placeholder="Спроси AI…"
          className="flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
        />
        <button className="grid h-9 w-9 place-items-center rounded-md bg-accent text-text-primary shadow-glow hover:bg-accent-hover">
          <Send className="h-4 w-4" />
        </button>
      </div>
    </Card>
  )
}

export default function NativeRoundPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const { data: score, isError } = useNativeScoreQuery(sessionId)
  const aiUsed = 3
  const aiMax = 10
  const aiFraction = score?.ai_fraction ?? 0.42
  const humanFraction = score?.human_fraction ?? 0.58
  return (
    <AppShellV2>
      <MatchHeader aiUsed={aiUsed} aiMax={aiMax} />
      {isError && (
        <div className="flex justify-end px-4 py-2">
          <ErrorChip />
        </div>
      )}
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:px-8">
        <div className="flex w-full flex-col gap-4 lg:w-[320px]">
          <QuestionPanel />
          <AllowedToolsCard />
          <UsageStatsCard aiUsed={aiUsed} aiMax={aiMax} aiFraction={aiFraction} humanFraction={humanFraction} />
        </div>
        <div className="flex min-h-[400px] flex-1 flex-col">
          <EditorArea />
        </div>
        <div className="flex w-full lg:w-[360px]">
          <ChatPanel />
        </div>
      </div>
    </AppShellV2>
  )
}
