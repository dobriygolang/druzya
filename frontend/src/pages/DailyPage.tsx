import { useEffect, useState } from 'react'
import Editor from '@monaco-editor/react'
import { CheckCircle2, Flame, Loader2, Play, Send, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { cn } from '../lib/cn'
import { ApiError } from '../lib/apiClient'
import {
  useDailyKataQuery,
  useDailyKataBySlugQuery,
  useDailyRunMutation,
  useDailySubmitMutation,
  useStreakQuery,
  type DailyKata,
  type DailyRunResponse,
  type DailySubmitResponse,
} from '../lib/queries/daily'

function Hero({ kata, isError }: { kata: DailyKata | undefined; isError: boolean }) {
  const { t } = useTranslation('daily')
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
        </div>
      </div>
      <div className="flex w-full flex-row items-center justify-between gap-2 lg:w-auto lg:flex-col lg:items-end">
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-white/80">{t('passed_today')}</span>
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

// Only "description" is backed by real backend data today. "Examples",
// "Discussion" and "Hints" were deleted because the backend TaskPublic has
// no examples / discussion thread / hints fields — rendering them would be
// hardcoded fake content (anti-fallback policy).
type DescTab = 'description'
const DESC_TABS: DescTab[] = ['description']

function DescriptionCard({ kata }: { kata: DailyKata | undefined }) {
  const { t } = useTranslation('daily')
  const [tab, setTab] = useState<DescTab>('description')
  const description = kata?.task?.description ?? ''
  const timeLimit = kata?.task?.time_limit_sec
  const memoryLimit = kata?.task?.memory_limit_mb
  return (
    <Card className="w-full flex-col gap-0 p-0 lg:w-[380px]" interactive={false}>
      <div className="flex min-w-0 flex-wrap items-center gap-1 overflow-x-auto border-b border-border px-2">
        {DESC_TABS.map((tk) => {
          const active = tab === tk
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
              {t(`tabs.${tk}`)}
            </button>
          )
        })}
      </div>
      <div className="flex flex-col gap-4 p-5">
        {tab === 'description' && (
          <>
            {description ? (
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-text-secondary">
                {description}
              </p>
            ) : (
              <p className="text-[13px] italic leading-relaxed text-text-muted">
                {t('no_kata_today')}
              </p>
            )}
            {(timeLimit || memoryLimit) && (
              <div className="flex flex-col gap-2">
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted">
                  {t('constraints')}
                </span>
                <ul className="flex flex-col gap-1 pl-4 text-[12px] text-text-secondary">
                  {timeLimit ? <li className="list-disc">{t('time_limit', { sec: timeLimit })}</li> : null}
                  {memoryLimit ? <li className="list-disc">{t('memory_limit', { mb: memoryLimit })}</li> : null}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  )
}

type RunState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'run-result'; result: DailyRunResponse }
  | { kind: 'submitting' }
  | { kind: 'submit-result'; result: DailySubmitResponse }
  | { kind: 'error'; message: string }

function Editor3({ kataID, initialCode }: { kataID: string; initialCode: string }) {
  const { t } = useTranslation('daily')
  const [code, setCode] = useState<string>(initialCode)
  // When the kata switches (id transitions from pending → real), reset the
  // editor buffer to the new starter snippet.
  useEffect(() => {
    setCode(initialCode)
  }, [initialCode])
  const [state, setState] = useState<RunState>({ kind: 'idle' })
  const runMu = useDailyRunMutation()
  const submitMu = useDailySubmitMutation()

  const disabled = kataID === 'pending-kata'

  const onRun = () => {
    if (disabled) return
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
    if (disabled) return
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
            disabled={isBusy || disabled}
          >
            {t('run')}
          </Button>
          <Button
            variant="primary"
            icon={state.kind === 'submitting' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            size="sm"
            className="shadow-glow"
            onClick={onSubmit}
            disabled={isBusy || disabled}
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
  const passed = state.kind === 'run-result' ? state.result.passed : state.result.passed
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
  const history = streak?.history?.slice(-14) ?? []
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

// SlugNotFoundView renders when /daily/kata/:slug resolves to a 404 from the
// backend. Anti-fallback policy: we never silently fall back to today's kata —
// the user gets a clear "не существует" message and a back-link.
function SlugNotFoundView({ slug }: { slug: string }) {
  return (
    <AppShellV2>
      <div className="flex flex-col items-center justify-center gap-4 px-6 py-24 text-center">
        <h1 className="font-display text-3xl font-extrabold text-text-primary">
          Ката с таким slug не существует
        </h1>
        <p className="font-mono text-[13px] text-text-muted">slug: {slug}</p>
        <Link
          to="/daily"
          className="mt-2 rounded-md bg-accent px-4 py-2 font-mono text-[12px] font-semibold text-bg hover:opacity-90"
        >
          ← Вернуться к сегодняшней ка́те
        </Link>
      </div>
    </AppShellV2>
  )
}

export default function DailyPage() {
  const params = useParams<{ slug?: string }>()
  const slug = params.slug
  // Run exactly one of the two queries (the slug query is `enabled` only when
  // slug is set; the today-kata query is always enabled — its result is just
  // ignored on the slug branch).
  const todayQ = useDailyKataQuery()
  const slugQ = useDailyKataBySlugQuery(slug)

  // Slug branch: surface 404 explicitly, never fall back.
  if (slug) {
    if (slugQ.isError) {
      const status = slugQ.error instanceof ApiError ? slugQ.error.status : 0
      if (status === 404) {
        return <SlugNotFoundView slug={slug} />
      }
    }
    const slugKata: DailyKata | undefined = slugQ.data
      ? {
          // Stitch the wire shape into the same DailyKata view-model the rest
          // of the page reads. There's no per-user state for slug deep-links,
          // so submission flags default to false / today's date.
          date: new Date().toISOString().slice(0, 10),
          task: slugQ.data.task,
          is_cursed: false,
          is_weekly_boss: false,
          already_submitted: false,
        }
      : undefined
    const kataID = slugKata?.task?.id ?? 'pending-kata'
    const starter = slugKata?.task?.starter_code?.go ?? ''
    return (
      <AppShellV2>
        <Hero kata={slugKata} isError={slugQ.isError} />
        <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:flex-row lg:px-10 lg:py-8" style={{ minHeight: 'calc(100vh - 72px - 200px)' }}>
          <DescriptionCard kata={slugKata} />
          <Editor3 kataID={kataID} initialCode={starter} />
          <div className="flex w-full flex-col gap-4 lg:w-[240px]">
            <StreakCard />
          </div>
        </div>
      </AppShellV2>
    )
  }

  // Default branch: today's kata.
  const kata = todayQ.data
  const isError = todayQ.isError
  const kataID = kata?.task?.id ?? 'pending-kata'
  const starter = kata?.task?.starter_code?.go ?? ''
  return (
    <AppShellV2>
      <Hero kata={kata} isError={isError} />
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:flex-row lg:px-10 lg:py-8" style={{ minHeight: 'calc(100vh - 72px - 200px)' }}>
        <DescriptionCard kata={kata} />
        <Editor3 kataID={kataID} initialCode={starter} />
        <div className="flex w-full flex-col gap-4 lg:w-[240px]">
          <StreakCard />
        </div>
      </div>
    </AppShellV2>
  )
}
