// TODO i18n
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Editor from '@monaco-editor/react'
import {
  Check,
  FileCode,
  Loader2,
  Play,
  Send,
  Upload,
  X,
} from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Avatar } from '../components/Avatar'
import { WSStatus } from '../components/ws/WSStatus'
import { useChannel } from '../lib/ws'
import {
  useArenaMatchQuery,
  useSubmitCodeMutation,
  type ArenaLanguageKey,
} from '../lib/queries/arena'
import type { ReactNode } from 'react'

function ErrorChip() {
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      Не удалось загрузить
    </span>
  )
}

function PlayerCard({
  side,
  nick,
  tier,
  gradient,
  typing,
}: {
  side: 'left' | 'right'
  nick: string
  tier: string
  gradient: 'violet-cyan' | 'pink-violet'
  typing?: boolean
}) {
  return (
    <div
      className={[
        'flex items-center gap-4',
        side === 'right' ? 'flex-row-reverse text-right' : '',
      ].join(' ')}
    >
      <Avatar size="lg" gradient={gradient} initials={nick.charAt(1).toUpperCase()} status="online" />
      <div className="flex flex-col gap-0.5">
        <span className="font-display text-lg font-bold text-text-primary">{nick}</span>
        <span className="font-mono text-[11px] text-text-muted">{tier}</span>
        {typing && (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-success">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
            typing...
          </span>
        )}
      </div>
    </div>
  )
}

function MatchHeader({ opponentTyping, opponentRunStatus }: { opponentTyping: boolean; opponentRunStatus: string | null }) {
  return (
    <div className="flex flex-col gap-4 border-b border-border bg-surface-1 px-4 py-4 sm:px-6 lg:h-[120px] lg:flex-row lg:items-center lg:justify-between lg:px-10 lg:py-0">
      <PlayerCard side="left" nick="@you" tier="Diamond III · 2 840 LP" gradient="violet-cyan" />
      <div className="flex flex-col items-center gap-2">
        <span className="font-display text-3xl font-extrabold leading-none text-text-primary lg:text-[40px]">
          12:43
        </span>
        <span className="font-mono text-[11px] font-semibold tracking-[0.12em] text-text-muted">
          RANKED · BO3 · ROUND 1
        </span>
        <div className="flex gap-1.5">
          <span className="h-2 w-6 rounded-full bg-accent" />
          <span className="h-2 w-6 rounded-full bg-border" />
          <span className="h-2 w-6 rounded-full bg-border" />
        </div>
        {opponentRunStatus && (
          <span className="rounded-full bg-cyan/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan">
            opponent: {opponentRunStatus}
          </span>
        )}
      </div>
      <PlayerCard
        side="right"
        nick="@kirill_dev"
        tier="Diamond II · 2 980 LP"
        gradient="pink-violet"
        typing={opponentTyping}
      />
    </div>
  )
}

function TaskPanel({ title, description, difficulty, section }: { title: string; description: string; difficulty: string; section: string }) {
  return (
    <div className="flex w-full flex-col gap-4 border-b border-border bg-surface-2 p-4 sm:p-6 lg:w-[340px] lg:border-b-0 lg:border-r lg:overflow-y-auto">
      <div className="flex flex-wrap gap-1.5">
        <span className="rounded-full bg-warn/15 px-2.5 py-1 font-mono text-[11px] font-semibold text-warn">
          {difficulty}
        </span>
        <span className="rounded-full bg-cyan/15 px-2.5 py-1 font-mono text-[11px] font-semibold text-cyan">
          {section}
        </span>
      </div>
      <h2 className="font-display text-lg font-bold text-text-primary break-words">
        {title}
      </h2>
      <p className="text-[13px] leading-relaxed text-text-secondary break-words">
        {description}
      </p>
    </div>
  )
}

const STARTER_GO = `package main

import "fmt"

func solve() {
\tfmt.Println("hello")
}

func main() {
\tsolve()
}
`

// MONACO_LANG maps our ArenaLanguageKey onto the Monaco language id.
const MONACO_LANG: Record<ArenaLanguageKey, string> = {
  go: 'go',
  python: 'python',
  javascript: 'javascript',
  typescript: 'typescript',
  sql: 'sql',
}

type CodeEditorProps = {
  language: ArenaLanguageKey
  code: string
  onChange: (next: string) => void
  onRun: () => void
  onSubmit: () => void
  isSubmitting: boolean
  resultLabel: string | null
}

function CodeEditor({
  language,
  code,
  onChange,
  onRun,
  onSubmit,
  isSubmitting,
  resultLabel,
}: CodeEditorProps) {
  return (
    <div className="flex min-w-0 flex-1 flex-col bg-surface-1">
      <div className="flex h-11 items-center gap-3 border-b border-border bg-bg px-4">
        <div className="flex items-center gap-2 rounded-t-md border-b-2 border-accent px-2 py-2">
          <FileCode className="h-3.5 w-3.5 text-accent-hover" />
          <span className="font-mono text-[12px] text-text-primary">
            solution.{language === 'javascript' ? 'js' : language === 'typescript' ? 'ts' : language === 'python' ? 'py' : language}
          </span>
        </div>
        <span className="rounded-full bg-cyan/15 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-cyan">
          {language}
        </span>
        {resultLabel && (
          <span className="ml-auto rounded-full bg-success/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-success">
            {resultLabel}
          </span>
        )}
      </div>
      <div className="flex flex-1 overflow-hidden">
        <Editor
          language={MONACO_LANG[language]}
          value={code}
          onChange={(v) => onChange(v ?? '')}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            lineHeight: 20,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
          }}
        />
      </div>
      <div className="flex items-center gap-4 border-t border-border bg-bg px-5 py-3">
        <Button
          variant="ghost"
          size="sm"
          icon={<Play className="h-3.5 w-3.5" />}
          onClick={onRun}
          disabled={isSubmitting}
        >
          Run
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon={
            isSubmitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )
          }
          className="shadow-glow"
          onClick={onSubmit}
          disabled={isSubmitting}
        >
          Submit
        </Button>
      </div>
    </div>
  )
}

type TestRow = { status: 'ok' | 'loading' | 'fail'; name: string; time: string }

const TESTS: TestRow[] = [
  { status: 'ok', name: 'empty string', time: '0.4ms' },
  { status: 'ok', name: 'single char', time: '0.6ms' },
  { status: 'ok', name: 'all unique', time: '1.2ms' },
  { status: 'loading', name: 'long ascii', time: '...' },
  { status: 'fail', name: 'unicode edge case', time: '8.1ms' },
]

function TestIcon({ status }: { status: TestRow['status'] }): ReactNode {
  if (status === 'ok')
    return (
      <span className="grid h-5 w-5 place-items-center rounded-full bg-success/20">
        <Check className="h-3 w-3 text-success" />
      </span>
    )
  if (status === 'loading')
    return (
      <span className="grid h-5 w-5 place-items-center rounded-full bg-cyan/20">
        <Loader2 className="h-3 w-3 animate-spin text-cyan" />
      </span>
    )
  return (
    <span className="grid h-5 w-5 place-items-center rounded-full bg-danger/20">
      <X className="h-3 w-3 text-danger" />
    </span>
  )
}

function TestList({ opponentTests }: { opponentTests: string }) {
  return (
    <Card className="flex-col gap-2 p-4" interactive={false}>
      <div className="flex items-center justify-between pb-1">
        <h3 className="font-display text-sm font-bold text-text-primary">Тесты</h3>
        <span className="font-mono text-[11px] text-cyan">opponent: {opponentTests}</span>
      </div>
      {TESTS.map((t, i) => (
        <div key={i} className="flex items-center gap-3 rounded-md px-1 py-1.5">
          <TestIcon status={t.status} />
          <span className="flex-1 font-mono text-[12px] text-text-secondary">{t.name}</span>
          <span className="font-mono text-[11px] text-text-muted">{t.time}</span>
        </div>
      ))}
    </Card>
  )
}

function ChatCard() {
  return (
    <Card className="flex-1 flex-col gap-3 p-4" interactive={false}>
      <div className="flex items-center justify-between pb-1">
        <h3 className="font-display text-sm font-bold text-text-primary">Чат матча</h3>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto" />
      <div className="flex items-center gap-2 rounded-md border border-border bg-bg px-3 py-2">
        <input
          className="flex-1 bg-transparent font-sans text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none"
          placeholder="Сообщение..."
        />
        <button className="grid h-6 w-6 place-items-center rounded text-text-muted hover:text-text-primary">
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </Card>
  )
}

// inferLanguage maps the match section to a default editor language. SQL
// matches obviously use SQL; everything else defaults to Go for now (the
// backend accepts a per-submission language switch via SubmitCode).
function inferLanguage(section: string | undefined): ArenaLanguageKey {
  if (section === 'sql') return 'sql'
  return 'go'
}

export default function ArenaMatchPage() {
  const { matchId } = useParams<{ matchId: string }>()
  const navigate = useNavigate()
  const channel = matchId ? `arena/${matchId}` : ''
  const { lastEvent, data, status, send } = useChannel<Record<string, unknown>>(channel)
  const { data: match, isError, isLoading } = useArenaMatchQuery(matchId)
  const submit = useSubmitCodeMutation()

  const taskTitle = match?.task?.title ?? '…'
  const taskDesc = match?.task?.description ?? ''
  const taskDifficulty = match?.task?.difficulty ?? 'Medium'
  const taskSection = match?.task?.section ?? 'algorithms'

  const language: ArenaLanguageKey = useMemo(
    () => inferLanguage(match?.section),
    [match?.section],
  )

  const [code, setCode] = useState<string>(STARTER_GO)
  // When the match loads with a starter snippet for the chosen language,
  // adopt it once. We deliberately don't overwrite user edits afterwards.
  const adoptedStarter = useRef(false)
  useEffect(() => {
    if (adoptedStarter.current) return
    const starter = match?.task?.starter_code?.[language]
    if (starter) {
      setCode(starter)
      adoptedStarter.current = true
    }
  }, [match, language])

  const [opponentTyping, setOpponentTyping] = useState(false)
  const [opponentRunStatus, setOpponentRunStatus] = useState<string | null>(null)
  const [opponentTests, setOpponentTests] = useState('—')
  const [resultLabel, setResultLabel] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!lastEvent || !data) return
    if (lastEvent === 'opponent_typing') {
      setOpponentTyping(Boolean((data as { active?: boolean }).active))
    } else if (lastEvent === 'opponent_run') {
      const tests = (data as { tests?: string }).tests ?? '—'
      setOpponentRunStatus(`запустил Run · ${tests}`)
      setOpponentTests(tests)
      window.setTimeout(() => setOpponentRunStatus(null), 4000)
    } else if (lastEvent === 'match_result' && matchId) {
      navigate(`/match/${matchId}/end`)
    } else if (lastEvent === 'submission_result') {
      const r = data as { passed?: boolean; tests_passed?: number; tests_total?: number }
      setResultLabel(
        r.passed
          ? `passed ${r.tests_passed ?? '?'}/${r.tests_total ?? '?'}`
          : `failed ${r.tests_passed ?? 0}/${r.tests_total ?? '?'}`,
      )
    }
  }, [lastEvent, data, matchId, navigate])

  // Debounced WS notification of code-edit progress. We only ever send
  // size + line-count, never the actual code (bible §11 leakage).
  const debounceRef = useRef<number | null>(null)
  const handleCodeChange = useCallback(
    (next: string) => {
      setCode(next)
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
      debounceRef.current = window.setTimeout(() => {
        send('code_update', {
          bytes: next.length,
          lines: next.split('\n').length,
        })
      }, 300)
    },
    [send],
  )

  const handleSubmit = useCallback(() => {
    if (!matchId) return
    setSubmitError(null)
    setResultLabel(null)
    submit.mutate(
      { matchId, code, language },
      {
        onSuccess: (r) => {
          setResultLabel(
            r.passed
              ? `passed ${r.tests_passed}/${r.tests_total}`
              : `failed ${r.tests_passed}/${r.tests_total}`,
          )
          if (r.passed) {
            // Match is now finished server-side; navigate when we receive
            // the WS match_result envelope. Fallback: kick to end after 2s.
            window.setTimeout(() => navigate(`/match/${matchId}/end`), 2_000)
          }
        },
        onError: (e: unknown) => {
          setSubmitError((e as Error).message ?? 'submit failed')
        },
      },
    )
  }, [matchId, code, language, submit, navigate])

  const handleRun = useCallback(() => {
    // For MVP "Run" exercises the same backend submit endpoint — Judge0
    // already runs every test. UI distinguishes by NOT navigating away.
    if (!matchId) return
    setResultLabel('running…')
    submit.mutate(
      { matchId, code, language },
      {
        onSuccess: (r) =>
          setResultLabel(
            r.passed
              ? `run ok ${r.tests_passed}/${r.tests_total}`
              : `run ${r.tests_passed}/${r.tests_total}`,
          ),
        onError: (e: unknown) => setResultLabel(`error: ${(e as Error).message}`),
      },
    )
  }, [matchId, code, language, submit])

  return (
    <AppShellV2>
      <div className="relative flex min-h-[calc(100vh-64px)] flex-col lg:h-[calc(100vh-72px)]">
        <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
          {isError && <ErrorChip />}
          <WSStatus status={status} />
        </div>
        <MatchHeader opponentTyping={opponentTyping} opponentRunStatus={opponentRunStatus} />
        <div className="flex flex-1 flex-col overflow-auto lg:flex-row lg:overflow-hidden">
          <TaskPanel
            title={isLoading ? 'Загружаем задачу…' : taskTitle}
            description={taskDesc}
            difficulty={taskDifficulty}
            section={taskSection}
          />
          <CodeEditor
            language={language}
            code={code}
            onChange={handleCodeChange}
            onRun={handleRun}
            onSubmit={handleSubmit}
            isSubmitting={submit.isPending}
            resultLabel={submitError ? `err: ${submitError}` : resultLabel}
          />
          <div className="flex w-full flex-col gap-4 border-t border-border bg-bg p-4 lg:w-[300px] lg:border-l lg:border-t-0">
            <TestList opponentTests={opponentTests} />
            <ChatCard />
          </div>
        </div>
      </div>
    </AppShellV2>
  )
}
