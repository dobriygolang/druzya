// AITutorChatPage — `/tutor/ai/{slug}` chat-интерфейс.
//
// Flow:
//   1. Resolve persona by slug → ListPersonas + find. Если нет — adopt
//      на фоне (нужен auth, fall back в /login).
//   2. Load my threads → find thread с persona.id.
//   3. Render history → polling? Нет, react-query refetch on send.
//   4. Send → optimistic append + invalidate history.
//
// Минималистично: текстовый log + textarea + Submit. Sticky header с
// именем персоны + recall-summary («что AI помнит»). Assistant сообщения
// рендерятся через лёгкий inline markdown-парсер (bold/italic/inline
// code / fenced code / lists / links) — heavy dep (marked /
// react-markdown) добавил бы ~80kb gzipped на одну страницу. User
// сообщения остаются plain text как и раньше.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader2, Send, ArrowLeft } from 'lucide-react'

import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { DataLoader } from '../components/DataLoader'
import { ApiError, readAccessToken } from '../lib/apiClient'
import {
  useAITutorHistoryQuery,
  useAITutorPersonasQuery,
  useAdoptAITutorMutation,
  useMyAITutorThreadsQuery,
  useSendAITutorMessageMutation,
  type AITutorEpisode,
  type AITutorPersona,
  type AITutorThread,
} from '../lib/queries/aiTutor'
import { useMemoryStatsQuery, type MemoryStats } from '../lib/queries/intelligence'
import { useGoal } from '../lib/useGoal'
import { formatGoal, type UserGoal } from '../lib/goal'
import { GoalWizardModal } from '../components/GoalWizardModal'
import { useLatestCueSession } from '../lib/useCueSessions'
import type { CueSession } from '../lib/cueSessions'
import { useReadiness } from '../lib/useReadiness'
import { useStreak } from '../lib/useActivity'
import type { Readiness } from '../lib/readiness'
import type { StreakInfo } from '../lib/activity'

export default function AITutorChatPage() {
  const { slug = '' } = useParams<{ slug: string }>()
  const navigate = useNavigate()

  const personasQ = useAITutorPersonasQuery()
  const threadsQ = useMyAITutorThreadsQuery()
  const adopt = useAdoptAITutorMutation()

  const persona: AITutorPersona | undefined = useMemo(
    () => (personasQ.data?.items ?? []).find((p) => p.slug === slug),
    [personasQ.data, slug],
  )

  const thread: AITutorThread | undefined = useMemo(() => {
    if (!persona) return undefined
    return (threadsQ.data?.items ?? []).find((t) => t.persona_id === persona.id)
  }, [threadsQ.data, persona])

  // Auto-adopt: если персона есть, но thread'а нет (юзер пришёл по
  // прямой ссылке без adopt), и юзер залогинен — адоптируем.
  const [adoptTried, setAdoptTried] = useState(false)
  useEffect(() => {
    if (!persona || thread || adoptTried) return
    if (!readAccessToken()) {
      navigate(`/login?next=${encodeURIComponent(`/tutor/ai/${slug}`)}`)
      return
    }
    setAdoptTried(true)
    void adopt.mutateAsync(slug).catch(() => {
      /* mutation error surfaces ниже */
    })
  }, [persona, thread, adoptTried, slug, navigate, adopt])

  if (personasQ.isPending || (persona && !thread && (threadsQ.isPending || adopt.isPending))) {
    return (
      <AppShellV2>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
        </div>
      </AppShellV2>
    )
  }
  if (!persona) {
    return (
      <AppShellV2>
        <div className="mx-auto max-w-3xl px-4 py-10">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              style={{
                display: 'inline-block',
                width: 1.5,
                minHeight: 18,
                background: 'var(--red)',
                marginTop: 4,
                flex: '0 0 auto',
              }}
            />
            <p className="text-[14px]" style={{ color: 'var(--red)' }}>Персона не найдена.</p>
          </div>
          <Button variant="ghost" onClick={() => navigate('/atlas')}>
            ← Atlas
          </Button>
        </div>
      </AppShellV2>
    )
  }
  if (!thread) {
    return (
      <AppShellV2>
        <div className="mx-auto max-w-3xl px-4 py-10">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              style={{
                display: 'inline-block',
                width: 1.5,
                minHeight: 18,
                background: 'var(--red)',
                marginTop: 4,
                flex: '0 0 auto',
              }}
            />
            <p className="text-[14px]" style={{ color: 'var(--red)' }}>
              {adopt.error instanceof ApiError ? adopt.error.body : 'Не удалось открыть чат.'}
            </p>
          </div>
        </div>
      </AppShellV2>
    )
  }

  return <ChatBody persona={persona} thread={thread} />
}

function ChatBody({
  persona,
  thread,
}: {
  persona: AITutorPersona
  thread: AITutorThread
}) {
  const navigate = useNavigate()
  const historyQ = useAITutorHistoryQuery(thread.id, 60)
  const send = useSendAITutorMessageMutation(thread.id)
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  const episodes = useMemo(
    () =>
      (historyQ.data?.episodes ?? []).filter(
        (e) => e.role === 'user' || e.role === 'assistant' || e.role === 'system',
      ),
    [historyQ.data],
  )

  // Auto-scroll-bottom on new episodes.
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [episodes.length])

  const onSend = async (e: React.FormEvent) => {
    e.preventDefault()
    const content = draft.trim()
    if (!content || send.isPending) return
    setDraft('')
    try {
      await send.mutateAsync({ content })
    } catch {
      // Mutation state surfaces error inline.
      setDraft(content) // restore так юзер не теряет текст
    }
  }

  const summary = (historyQ.data?.thread.summary_md ?? '').trim()
  const memoryStatsQ = useMemoryStatsQuery()
  const goal = useGoal()
  const latestCue = useLatestCueSession()
  const readiness = useReadiness()
  const streak = useStreak()
  const [goalWizardOpen, setGoalWizardOpen] = useState(false)

  return (
    <AppShellV2>
      <div className="mx-auto flex h-[calc(100vh-72px)] w-full max-w-3xl flex-col gap-3 px-4 py-6">
        <header className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <button
              type="button"
              onClick={() => navigate('/atlas')}
              className="flex items-center gap-1 self-start font-mono text-[11px] tracking-[0.08em] text-text-muted transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:text-text-primary"
            >
              <ArrowLeft className="h-3 w-3" /> Atlas
            </button>
            <h1 className="font-display text-xl font-semibold">{persona.display_name}</h1>
            <div className="flex items-center gap-2 font-mono text-[11px] text-text-muted">
              <span>AI · 24/7 · {persona.scope_track_kind}</span>
              <CoachKnowsBadge memoryStats={memoryStatsQ.data} loading={memoryStatsQ.isPending} />
            </div>
          </div>
          <div className="text-right font-mono text-[11px] text-text-muted">
            {thread.daily_msg_count}/30 · сегодня
          </div>
        </header>

        <ErrorBoundary section="Coach memory">
          <CoachMemoryCard
            summary={summary}
            stats={memoryStatsQ.data}
            loading={memoryStatsQ.isPending}
            goal={goal}
            latestCue={latestCue}
            readiness={readiness}
            streak={streak}
            onEditGoal={() => setGoalWizardOpen(true)}
          />
        </ErrorBoundary>

        {goalWizardOpen && (
          <GoalWizardModal initial={goal} onClose={() => setGoalWizardOpen(false)} />
        )}

        <ErrorBoundary section="Chat history">
          <div
            ref={logRef}
            className="flex flex-1 flex-col gap-3 overflow-y-auto rounded-md border border-border bg-surface-1 p-4"
          >
            <DataLoader
              state={historyQ}
              section="История"
              skeleton={
                <div className="flex flex-col gap-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div
                      key={i}
                      className={
                        i % 2 === 0
                          ? 'self-end h-10 w-3/5 animate-pulse rounded-md bg-surface-2'
                          : 'self-start h-10 w-2/3 animate-pulse rounded-md bg-surface-2'
                      }
                    />
                  ))}
                </div>
              }
              empty={() => false}
            >
              {() => (
                <>
                  {episodes.map((ep) => (
                    <ChatBubble key={ep.id} ep={ep} />
                  ))}
                </>
              )}
            </DataLoader>
            {send.isPending && (
              <p className="self-start font-mono text-[11px] text-text-muted">…coach думает</p>
            )}
          </div>
        </ErrorBoundary>

        <form onSubmit={onSend} className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void onSend(e as unknown as React.FormEvent)
              }
            }}
            placeholder="Напиши сообщение… (⌘/Ctrl+Enter — отправить)"
            rows={3}
            maxLength={4000}
            className="flex-1 resize-none border-b border-[var(--hair-2)] bg-transparent px-1 py-2 text-sm text-[rgb(var(--ink))] outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)] placeholder:text-text-muted focus:border-[rgb(var(--ink))]"
          />
          <Button type="submit" disabled={!draft.trim() || send.isPending}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
        {send.isError && (
          <div className="flex items-start gap-2">
            <span
              aria-hidden="true"
              style={{
                display: 'inline-block',
                width: 1.5,
                minHeight: 14,
                background: 'var(--red)',
                marginTop: 3,
                flex: '0 0 auto',
              }}
            />
            <p className="text-[12px]" style={{ color: 'var(--red)' }}>
              {send.error instanceof ApiError ? send.error.body : 'Не получилось отправить.'}
            </p>
          </div>
        )}
      </div>
    </AppShellV2>
  )
}

//   1..9            → «coach · знает N событий»
//   10+             → «coach · знает N событий за 30 дн» (более развёрнуто)
//
// Без N === 0 fallback к статичному «coach» — anti-fallback: не симулируем
// несуществующую память пустыми цифрами.
function CoachKnowsBadge({
  memoryStats,
  loading,
}: {
  memoryStats: MemoryStats | undefined
  loading: boolean
}) {
  if (loading || !memoryStats) {
    return <span className="text-text-muted">· coach</span>
  }
  if (memoryStats.total30d === 0) {
    return <span className="text-text-muted">· coach · learning…</span>
  }
  const detail = memoryStats.total30d >= 10 ? ' за 30 дн' : ''
  return (
    <span className="text-text-secondary">
      · coach помнит {memoryStats.total30d} событий{detail}
    </span>
  )
}

// Sticky card с пятью уровнями памяти:
//   1. Active goal — из useGoal() (F2 localStorage MVP). Goal CTA → wizard.
//   2. **Readiness + streak** — F3 computed % + F5 streak в одной строке.
//      Hidden когда goal не выбран (readiness не имеет смысла без цели).
//   3. **Latest Cue session** — F10 stub (cue выявила weak: sysdesign 2h
//      назад) → AI имеет cross-product context.
//   4. summary_md — rolling working-memory от thread compaction.
//   5. Fallback «coach is still learning…» когда ни goal ни Cue ни summary.
//
// Anti-fallback: card всё равно рендерится с Goal/Cue CTAs если пусто.
function CoachMemoryCard({
  summary,
  stats,
  loading,
  goal,
  latestCue,
  readiness,
  streak,
  onEditGoal,
}: {
  summary: string
  stats: MemoryStats | undefined
  loading: boolean
  goal: UserGoal | null
  latestCue: CueSession | null
  readiness: Readiness | null
  streak: StreakInfo
  onEditGoal: () => void
}) {
  const hasSummary = summary.length > 0
  const hasMemory = (stats?.total30d ?? 0) > 0
  const hasGoal = goal !== null
  const hasCue = latestCue !== null

  // Card всегда рендерится — Goal CTA даёт юзеру entrypoint даже когда
  // backend ничего не вернул. Это и есть F2 главный value: видимая цель
  // юзера в каждом chat-сessions, AI всегда «знает» куда идём.
  return (
    <Card className="flex-col gap-2 p-3" interactive={false}>
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          Что AI помнит
        </p>
        {stats && hasMemory && (
          <p className="font-mono text-[10px] text-text-muted">
            {stats.total30d} событий · 30 дн
          </p>
        )}
      </div>

      {/* Goal slice — F2 MVP. Sergey 2026-05-12: visible цель = trust signal. */}
      <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-text-muted">
            Цель
          </span>
          {hasGoal ? (
            <span className="truncate text-[13px] text-text-primary">{formatGoal(goal)}</span>
          ) : (
            <span className="text-[12px] italic text-text-muted">Не выбрана — AI плывёт без курса</span>
          )}
        </div>
        <button
          type="button"
          onClick={onEditGoal}
          className="shrink-0 rounded-md border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:border-border-strong hover:text-text-primary"
        >
          {hasGoal ? 'Изменить' : 'Поставить'}
        </button>
      </div>

      {/* F3 Readiness + F5 streak slice — visible signal что AI учитывает
          траекторию. Hidden когда goal не выбран (readiness не имеет смысла).
          Streak показывается отдельно даже без 3-дневного threshold —
          здесь полный signal, не chip. */}
      {hasGoal && readiness && (
        <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-text-muted">
              Готовность · F3
            </span>
            <span className="text-[13px] text-text-primary">
              <b className="font-mono tabular-nums">{readiness.readinessPct}%</b>
              {readiness.daysToTarget !== null && (
                <span className="text-text-secondary">
                  {' · '}
                  {readiness.daysToTarget === 0
                    ? 'дедлайн сегодня'
                    : `${readiness.daysToTarget} ${pluralDaysToTarget(readiness.daysToTarget)} до цели`}
                </span>
              )}
            </span>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-0.5">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-text-muted">
              Streak
            </span>
            <span className="font-mono text-[12px] tabular-nums text-text-primary">
              {streak.days === 0
                ? '—'
                : `${streak.days}${streak.includesToday ? '' : '*'}`}
              {streak.longestDays > streak.days && (
                <span className="ml-1 text-text-muted">
                  · max {streak.longestDays}
                </span>
              )}
            </span>
          </div>
        </div>
      )}

      {/* F10 Cue session slice — cross-product moat. Если ingestion stub
          имеет recent session, surface'им её здесь так что AI явно «знает»
          interview context. Hidden когда Cue журнал пуст (anti-fallback). */}
      {hasCue && latestCue && (
        <div className="flex flex-col gap-0.5 border-b border-border pb-2">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-text-muted">
            Cue · {formatCueAgo(latestCue.completedAt)}
          </span>
          <span className="truncate text-[12.5px] text-text-secondary">
            {latestCue.company}
            {latestCue.persona && ` · ${latestCue.persona}`}
            {latestCue.stages.length > 0 && ` · ${latestCue.stages.length} ${pluralStages(latestCue.stages.length)}`}
          </span>
          {latestCue.aiSummary && (
            <span className="text-[11px] italic text-text-muted line-clamp-2">{latestCue.aiSummary}</span>
          )}
        </div>
      )}

      {hasSummary ? (
        <p className="whitespace-pre-line text-[12px] text-text-secondary">{summary}</p>
      ) : (
        <p className="text-[12px] italic text-text-muted">
          {loading
            ? 'Загружаем что AI помнит…'
            : hasMemory
              ? 'События зарегистрированы; разговор ещё не вынес ключевых фактов наружу. Спроси / расскажи о своих целях — AI начнёт строить контекст.'
              : 'Coach только знакомится с тобой. Поделись целью / уровнем / больной точкой — AI будет помнить от сессии к сессии.'}
        </p>
      )}
    </Card>
  )
}

// Helpers для CoachMemoryCard Cue slice. Local utilities keep formatting
// concise (formatAgo similar to ActivityFeed но с less granularity).
function formatCueAgo(ms: number): string {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins} мин назад`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}ч назад`
  const days = Math.floor(hrs / 24)
  if (days <= 6) return `${days}д назад`
  return new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

function pluralStages(n: number): string {
  if (n === 1) return 'стадия'
  if (n >= 2 && n <= 4) return 'стадии'
  return 'стадий'
}

function pluralDaysToTarget(n: number): string {
  if (n === 1) return 'день'
  if (n >= 2 && n <= 4) return 'дня'
  return 'дней'
}

function ChatBubble({ ep }: { ep: AITutorEpisode }) {
  const isUser = ep.role === 'user'
  const isSystem = ep.role === 'system'
  return (
    <div className={isUser ? 'self-end max-w-[80%]' : 'self-start max-w-[80%]'}>
      {isSystem ? (
        <p className="rounded-md border border-dashed border-border px-3 py-2 font-mono text-[11px] tracking-[0.08em] text-text-muted">
          {ep.content}
        </p>
      ) : (
        <div
          className={
            isUser
              ? 'rounded-md bg-[rgb(var(--ink))] px-3 py-2 text-sm text-bg'
              : 'rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary'
          }
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{ep.content}</p>
          ) : (
            <AssistantMarkdown content={ep.content} />
          )}
          {!isUser && ep.model_used && (
            <p className="mt-1 font-mono text-[10px] tracking-[0.08em] text-text-muted">{ep.model_used}</p>
          )}
        </div>
      )}
    </div>
  )
}

// AssistantMarkdown — мини-парсер для assistant сообщений.
//
// Поддерживает: fenced ```code``` блоки, inline `code`, **bold**, *italic*,
// [текст](url), unordered (`- `, `* `) и ordered (`1. `) lists, blank
// lines = новый параграф. Newline внутри параграфа → <br/>.
//
// Намеренно НЕ полноценный md-parser: heavy deps (marked / react-markdown)
// добавили бы ~80kb gzipped. Edge-cases типа nested lists / tables /
// blockquotes игнорируем — LLM в нашем production-prompt'е возвращает
// плоский md, не markdown spec.
function AssistantMarkdown({ content }: { content: string }) {
  const blocks = useMemo(() => splitBlocks(content), [content])
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {blocks.map((b, i) => {
        if (b.type === 'code') {
          return (
            <pre
              key={i}
              className="max-w-full overflow-x-auto rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] leading-relaxed"
            >
              <code>{b.code}</code>
            </pre>
          )
        }
        if (b.type === 'ul') {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {b.items.map((it, j) => (
                <li key={j}>{renderInline(it)}</li>
              ))}
            </ul>
          )
        }
        if (b.type === 'ol') {
          return (
            <ol key={i} className="list-decimal space-y-1 pl-5">
              {b.items.map((it, j) => (
                <li key={j}>{renderInline(it)}</li>
              ))}
            </ol>
          )
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {renderInline(b.text)}
          </p>
        )
      })}
    </div>
  )
}

type MdBlock =
  | { type: 'p'; text: string }
  | { type: 'code'; code: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }

// splitBlocks — линия за линией: ``` открывает/закрывает fenced code,
// `- `/`* ` и `1. ` копят список, всё остальное — параграф (пустая
// строка = разделитель).
function splitBlocks(src: string): MdBlock[] {
  const lines = src.split('\n')
  const out: MdBlock[] = []
  let i = 0
  let para: string[] = []
  let ul: string[] = []
  let ol: string[] = []
  const flushPara = () => {
    if (para.length) {
      out.push({ type: 'p', text: para.join('\n') })
      para = []
    }
  }
  const flushUl = () => {
    if (ul.length) {
      out.push({ type: 'ul', items: ul })
      ul = []
    }
  }
  const flushOl = () => {
    if (ol.length) {
      out.push({ type: 'ol', items: ol })
      ol = []
    }
  }
  const flushAll = () => {
    flushPara()
    flushUl()
    flushOl()
  }
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (line.trimStart().startsWith('```')) {
      flushAll()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !(lines[i] ?? '').trimStart().startsWith('```')) {
        codeLines.push(lines[i] ?? '')
        i++
      }
      // skip closing ``` (or EOF)
      i++
      out.push({ type: 'code', code: codeLines.join('\n') })
      continue
    }
    const ulMatch = /^\s*[-*]\s+(.*)$/.exec(line)
    const olMatch = /^\s*\d+\.\s+(.*)$/.exec(line)
    if (ulMatch) {
      flushPara()
      flushOl()
      ul.push(ulMatch[1] ?? '')
      i++
      continue
    }
    if (olMatch) {
      flushPara()
      flushUl()
      ol.push(olMatch[1] ?? '')
      i++
      continue
    }
    if (line.trim() === '') {
      flushAll()
      i++
      continue
    }
    flushUl()
    flushOl()
    para.push(line)
    i++
  }
  flushAll()
  return out
}

// renderInline — token-level прохождение по строке. Распознаём:
//   `code` → <code>; **bold** → <strong>; *italic* → <em>;
//   [txt](url) → <a target="_blank">.
// Greedy left-to-right, без regex-replace на whole-string (даёт правильное
// nesting bold/italic/code).
function renderInline(text: string): React.ReactNode {
  const out: React.ReactNode[] = []
  let i = 0
  let buf = ''
  const flushBuf = () => {
    if (buf) {
      out.push(buf)
      buf = ''
    }
  }
  while (i < text.length) {
    const ch = text[i]
    // inline code `..`
    if (ch === '`') {
      const close = text.indexOf('`', i + 1)
      if (close > i) {
        flushBuf()
        out.push(
          <code
            key={out.length}
            className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px]"
          >
            {text.slice(i + 1, close)}
          </code>,
        )
        i = close + 1
        continue
      }
    }
    // bold **..**
    if (ch === '*' && text[i + 1] === '*') {
      const close = text.indexOf('**', i + 2)
      if (close > i + 1) {
        flushBuf()
        out.push(
          <strong key={out.length} className="font-semibold">
            {text.slice(i + 2, close)}
          </strong>,
        )
        i = close + 2
        continue
      }
    }
    // italic *..*  (single-star, не должно начинаться с **).
    if (ch === '*' && text[i + 1] !== '*') {
      const close = text.indexOf('*', i + 1)
      if (close > i && text[close - 1] !== '*') {
        flushBuf()
        out.push(
          <em key={out.length} className="italic">
            {text.slice(i + 1, close)}
          </em>,
        )
        i = close + 1
        continue
      }
    }
    // link [text](url)
    if (ch === '[') {
      const closeBracket = text.indexOf(']', i + 1)
      if (closeBracket > i && text[closeBracket + 1] === '(') {
        const closeParen = text.indexOf(')', closeBracket + 2)
        if (closeParen > closeBracket + 1) {
          const label = text.slice(i + 1, closeBracket)
          const href = text.slice(closeBracket + 2, closeParen)
          // safe-href: блокируем javascript: схемы.
          const safe = /^(https?:|mailto:|\/)/.test(href) ? href : '#'
          flushBuf()
          out.push(
            <a
              key={out.length}
              href={safe}
              target="_blank"
              rel="noreferrer noopener"
              className="text-text-primary underline decoration-text-muted underline-offset-2 hover:decoration-text-primary"
            >
              {label}
            </a>,
          )
          i = closeParen + 1
          continue
        }
      }
    }
    buf += ch
    i++
  }
  flushBuf()
  return out
}
