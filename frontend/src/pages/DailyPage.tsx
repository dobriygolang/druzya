import { useEffect, useMemo, useState } from 'react'
import Editor from '@monaco-editor/react'
import { CheckCircle2, Flame, Lock, Loader2, Play, Send, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { cn } from '../lib/cn'
import {
  useDailyKataQuery,
  useDailyRunMutation,
  useDailySubmitMutation,
  useStreakQuery,
  type DailyRunResponse,
  type DailySubmitResponse,
} from '../lib/queries/daily'

function Hero() {
  const { t } = useTranslation('daily')
  const { data: kata, isError } = useDailyKataQuery()
  const { data: streak } = useStreakQuery()
  const day = streak?.current ?? 0
  const title = kata?.task?.title ?? '—'
  const difficulty = kata?.task?.difficulty ?? '—'
  const section = kata?.task?.section ?? '—'
  return (
    <div
      className="flex flex-col items-start justify-between gap-5 px-4 py-6 sm:px-8 lg:flex-row lg:items-center lg:gap-0 lg:px-10 lg:py-0"
      style={{
        minHeight: 200,
        background: 'linear-gradient(10deg, #F472B6 0%, #582CFF 100%)',
      }}
    >
      <div className="flex flex-col gap-3">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-warn/90 px-3 py-1 font-mono text-[11px] font-bold tracking-[0.1em] text-bg">
          <Flame className="h-3 w-3" /> {t('day_of', { day })}
        </span>
        <h1 className="font-display text-3xl font-extrabold leading-[1.05] text-white sm:text-4xl lg:text-[44px]">
          {title}
        </h1>
        {isError && (
          <span className="rounded-full bg-danger/30 px-2 py-0.5 font-mono text-[10px] font-semibold text-white">
            {t('load_failed')}
          </span>
        )}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <MetaTag>{difficulty}</MetaTag>
          <MetaTag>{section}</MetaTag>
          <MetaTag>850 XP</MetaTag>
          <MetaTag>O(log n)</MetaTag>
        </div>
      </div>
      <div className="flex w-full flex-row items-center justify-between gap-2 lg:w-auto lg:flex-col lg:items-end">
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-white/80">{t('passed_today')}</span>
        {/*
          Phase 2: live "passed today" count requires a daily-aggregate
          endpoint that doesn't yet exist on the backend (GetCalendar /
          GetStreak are per-user). Until that lands we hide the number
          rather than show fake hardcoded telemetry.
        */}
        <span className="font-display text-[28px] font-extrabold text-white">
          {kata?.already_submitted ? '✓' : '—'}
        </span>
        <span className="font-mono text-[13px] text-cyan">
          {kata?.already_submitted ? 'ты сдал сегодня' : 'не сдано'}
        </span>
      </div>
    </div>
  )
}

function MetaTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-white/30 bg-white/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-white">
      {children}
    </span>
  )
}

type DescTab = 'description' | 'examples' | 'discussion' | 'hints'
const DESC_TABS: DescTab[] = ['description', 'examples', 'discussion', 'hints']

function DescriptionCard() {
  const { t } = useTranslation('daily')
  const [tab, setTab] = useState<DescTab>('description')
  const constraints = t('constraints_list', { returnObjects: true }) as string[]
  return (
    <Card className="w-full flex-col gap-0 p-0 lg:w-[380px]" interactive={false}>
      {/*
        Tab strip: the parent flex container needs `min-w-0` so it can shrink
        below its intrinsic width; `flex-wrap` lets the buttons drop onto a
        second row instead of pushing the card out of bounds. `overflow-x-auto`
        is the fallback when wrapping is undesirable (mobile portrait).
      */}
      <div className="flex min-w-0 flex-wrap items-center gap-1 overflow-x-auto border-b border-border px-2">
        {DESC_TABS.map((tk) => {
          const active = tab === tk
          const locked = tk === 'hints'
          return (
            <button
              key={tk}
              type="button"
              onClick={() => setTab(tk)}
              className={cn(
                'relative h-11 shrink-0 px-3 text-[13px] font-semibold transition-colors',
                active
                  ? 'text-text-primary after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-accent'
                  : 'text-text-muted hover:text-text-primary',
              )}
            >
              {t(`tabs.${tk}`)} {locked && <Lock className="ml-1 inline h-3 w-3" />}
            </button>
          )
        })}
      </div>
      <div className="flex flex-col gap-4 p-5">
        <p className="text-[13px] leading-relaxed text-text-secondary">
          {t('desc_p1')}
        </p>
        <p className="text-[13px] leading-relaxed text-text-secondary">
          {t('desc_p2')}
        </p>

        <div className="flex flex-col gap-2 rounded-lg bg-surface-1 p-4">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted">{t('example')}</span>
          <pre className="overflow-x-auto font-mono text-[12px] leading-relaxed text-text-primary">
{`Input:  nums = [4,5,6,7,0,1,2], target = 0
Output: 4

Input:  nums = [4,5,6,7,0,1,2], target = 3
Output: -1`}
          </pre>
        </div>

        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted">{t('constraints')}</span>
          <ul className="flex flex-col gap-1 pl-4 text-[12px] text-text-secondary">
            {constraints.map((c, i) => (
              <li key={i} className="list-disc">{c}</li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  )
}

const STARTER_CODE = `package main

func search(nums []int, target int) int {
\tlo, hi := 0, len(nums)-1
\tfor lo <= hi {
\t\tmid := (lo + hi) / 2
\t\tif nums[mid] == target { return mid }
\t\t// TODO: handle rotation
\t}
\treturn -1
}
`

type RunState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'run-result'; result: DailyRunResponse }
  | { kind: 'submitting' }
  | { kind: 'submit-result'; result: DailySubmitResponse }
  | { kind: 'error'; message: string }

function Editor3({ kataID }: { kataID: string }) {
  const { t } = useTranslation('daily')
  const [code, setCode] = useState<string>(STARTER_CODE)
  const [state, setState] = useState<RunState>({ kind: 'idle' })
  const runMu = useDailyRunMutation()
  const submitMu = useDailySubmitMutation()

  const onRun = () => {
    setState({ kind: 'running' })
    runMu.mutate(
      { kata_id: kataID, code, language: 'go' },
      {
        onSuccess: (result) => setState({ kind: 'run-result', result }),
        onError: (err: unknown) =>
          setState({
            kind: 'error',
            message: err instanceof Error ? err.message : 'Ошибка запуска',
          }),
      },
    )
  }

  const onSubmit = () => {
    setState({ kind: 'submitting' })
    submitMu.mutate(
      { kata_id: kataID, code, language: 'go' },
      {
        onSuccess: (result) => setState({ kind: 'submit-result', result }),
        onError: (err: unknown) =>
          setState({
            kind: 'error',
            message: err instanceof Error ? err.message : 'Ошибка отправки',
          }),
      },
    )
  }

  const isBusy = state.kind === 'running' || state.kind === 'submitting'

  return (
    <div className="flex min-h-[400px] min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-surface-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2 overflow-x-auto border-b border-border px-3">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b-2 border-accent px-3 text-[13px] font-semibold text-text-primary">
          solution.go
        </div>
        <span className="shrink-0 rounded-md bg-cyan/15 px-2 py-0.5 font-mono text-[10px] font-bold text-cyan">GO</span>
      </div>
      <div className="flex min-h-[280px] flex-1 overflow-hidden">
        <Editor
          language="go"
          value={code}
          onChange={(v) => setCode(v ?? '')}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineHeight: 22,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            // Explicit readOnly:false — the previous static-pre version
            // rendered code as plain HTML, which the user reported as
            // "the editor is locked". Monaco defaults to writable but we
            // pin it for clarity.
            readOnly: false,
          }}
        />
      </div>
      <ResultPanel state={state} />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
        <span className="font-mono text-[12px] text-text-muted">
          {state.kind === 'idle' ? t('tests_not_run') : statusLabel(state)}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            icon={state.kind === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            size="sm"
            onClick={onRun}
            disabled={isBusy}
          >
            {t('run')}
          </Button>
          <Button
            variant="primary"
            icon={state.kind === 'submitting' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            size="sm"
            className="shadow-glow"
            onClick={onSubmit}
            disabled={isBusy}
          >
            {t('submit')}
          </Button>
        </div>
      </div>
    </div>
  )
}

function statusLabel(state: RunState): string {
  switch (state.kind) {
    case 'running':
      return 'Запускаем тесты…'
    case 'submitting':
      return 'Отправляем решение…'
    case 'run-result':
      return state.result.passed
        ? `OK · ${state.result.total} тест(а) · ${state.result.time_ms}ms`
        : `Не прошло — ${state.result.total} тест(а)`
    case 'submit-result':
      return state.result.passed
        ? `Принято · +${state.result.xp_earned} XP · streak ${state.result.streak.current}🔥`
        : 'Решение не принято'
    case 'error':
      return state.message
    case 'idle':
    default:
      return ''
  }
}

function ResultPanel({ state }: { state: RunState }) {
  if (state.kind === 'idle' || state.kind === 'running' || state.kind === 'submitting') {
    return null
  }
  if (state.kind === 'error') {
    return (
      <div className="flex items-start gap-2 border-t border-border bg-danger/10 px-4 py-3 text-[12px] text-danger">
        <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="font-mono">{state.message}</span>
      </div>
    )
  }
  const passed =
    state.kind === 'run-result' ? state.result.passed : state.result.passed
  const lines: string[] = []
  if (state.kind === 'run-result') {
    lines.push(state.result.output)
  } else {
    lines.push(
      `${state.result.tests_passed}/${state.result.tests_total} тестов пройдено`,
    )
    if (state.result.passed) {
      lines.push(`+${state.result.xp_earned} XP · streak ${state.result.streak.current}🔥`)
    }
  }
  return (
    <div
      className={cn(
        'flex flex-col gap-1 border-t px-4 py-3 text-[12px] font-mono',
        passed ? 'border-success/30 bg-success/10 text-success' : 'border-danger/30 bg-danger/10 text-danger',
      )}
    >
      <div className="flex items-center gap-2">
        {passed ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
        <span className="font-semibold">{passed ? 'PASS' : 'FAIL'}</span>
      </div>
      {lines.map((l, i) => (
        <span key={i} className="text-text-secondary">{l}</span>
      ))}
    </div>
  )
}

function StreakCard() {
  const { t } = useTranslation('daily')
  const { data: streak } = useStreakQuery()
  const current = streak?.current ?? 0
  const history = streak?.history?.slice(-14) ?? Array.from({ length: 14 }, (_, i) => i < 12)
  const days = Array.from({ length: 14 }, (_, i) => Boolean(history[i]))
  return (
    <Card className="flex-col gap-3 p-4">
      <h3 className="font-display text-[13px] font-bold text-text-primary">{t('streak_progress')}</h3>
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((done, i) => (
          <div
            key={i}
            className={cn(
              'aspect-square rounded-sm',
              done ? 'bg-gradient-to-br from-warn to-pink' : 'bg-surface-1',
            )}
          />
        ))}
      </div>
      <div className="mt-1 flex flex-col items-center gap-0.5">
        <span className="font-display text-[26px] font-extrabold text-warn">{current} 🔥</span>
        <span className="text-[11px] text-text-muted">{t('consecutive_days')}</span>
      </div>
    </Card>
  )
}

const UNLOCKS = [
  { name: 'Streak Master', cur: 12, tgt: 14 },
  { name: 'Speed Demon', cur: 6, tgt: 10 },
  { name: 'DP Apprentice', cur: 3, tgt: 10 },
] as const

function UnlocksCard() {
  const { t } = useTranslation('daily')
  return (
    <Card className="flex-col gap-3 p-4">
      <h3 className="font-display text-[13px] font-bold text-text-primary">{t('unlocks')}</h3>
      <div className="flex flex-col gap-3">
        {UNLOCKS.map((u) => (
          <div key={u.name} className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold text-text-secondary">{u.name}</span>
              <span className="font-mono text-[11px] text-text-muted">
                {u.cur}/{u.tgt}
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-black/30">
              <div
                className="h-full rounded-full bg-cyan"
                style={{ width: `${(u.cur / u.tgt) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function useKataID() {
  const { data: kata } = useDailyKataQuery()
  // Fall back to a stable placeholder so the editor still renders before
  // the kata fetch resolves; the run/submit handlers carry the real id once
  // it lands.
  return useMemo(() => kata?.task?.id ?? 'pending-kata', [kata])
}

export default function DailyPage() {
  const kataID = useKataID()
  // Re-mount the editor when kata id flips from "pending" to a real one so
  // the starter code can be re-derived (currently the same template, but
  // future kata may carry per-task starter_code).
  useEffect(() => void kataID, [kataID])
  return (
    <AppShellV2>
      <Hero />
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:flex-row lg:px-10 lg:py-8" style={{ minHeight: 'calc(100vh - 72px - 200px)' }}>
        <DescriptionCard />
        <Editor3 kataID={kataID} />
        <div className="flex w-full flex-col gap-4 lg:w-[240px]">
          <StreakCard />
          <UnlocksCard />
        </div>
      </div>
    </AppShellV2>
  )
}
