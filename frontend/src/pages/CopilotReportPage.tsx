// CopilotReportPage — public-read view of a single session's analysis.
//
// URL: /copilot/reports/:sessionId. This is the page the desktop's
// Summary modal's "Открыть в браузере" button opens (backend template
// reportURLTemplate = "https://druzya.tech/copilot/reports/%s"). Ships
// its own public route — no auth required, since owning the session id
// is treated as the bearer token here (matches share-by-link UX).
//
// Data shape matches the Phase 3 structured analysis (tldr, key_topics,
// action_items, terminology, decisions, open_questions, usage) plus the
// legacy rubric fields (overall_score, weaknesses, recommendations,
// report_markdown). Missing sections hide — we never render "no data"
// placeholders, because older reports (pre-00053) simply don't have
// the structured fields populated.

import { Link, useParams } from 'react-router-dom'
import {
  CheckCircle2,
  Clock,
  Loader2,
  AlertTriangle,
  Sparkles,
  BookOpen,
  ListChecks,
  Lightbulb,
  Gauge,
  MessageSquare,
} from 'lucide-react'

import { useCopilotReportQuery, type CopilotSessionAnalysis } from '../lib/queries/copilot'

export function CopilotReportPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const { data, isLoading, error } = useCopilotReportQuery(sessionId)

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <MinimalHeader />
      <main className="mx-auto max-w-3xl px-6 pb-24 pt-10">
        {isLoading && <LoadingState />}
        {error && <ErrorStateUI message={(error as Error).message} />}
        {data && data.status === 'failed' && (
          <ErrorStateUI message={data.errorMessage || 'Анализ не был завершён.'} />
        )}
        {data && (data.status === 'pending' || data.status === 'running') && <PendingState />}
        {data && data.status === 'ready' && <ReadyReport a={data} />}
      </main>
    </div>
  )
}

function MinimalHeader() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-border bg-bg/85 px-6 backdrop-blur">
      <Link
        to="/copilot"
        className="flex items-center gap-2 font-display text-[15px] font-semibold"
      >
        <span
          aria-hidden
          className="grid h-6 w-6 place-items-center rounded-md font-display font-extrabold text-white"
          style={{
            background:
              'linear-gradient(135deg, rgb(124,92,255) 0%, rgb(76,139,255) 100%)',
            fontSize: 13,
          }}
        >
          9
        </span>
        Druz9 Copilot
      </Link>
      <span className="text-[12px] text-text-muted">Session report</span>
      <Link
        to="/welcome"
        className="ml-auto rounded-md border border-border bg-surface-1 px-3 py-1.5 text-[12.5px] text-text-secondary hover:bg-surface-2"
      >
        ← к druz9.online
      </Link>
    </header>
  )
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-text-muted">
      <Loader2 className="h-6 w-6 animate-spin" />
      <span className="text-[13px]">Загружаем отчёт…</span>
    </div>
  )
}

function PendingState() {
  return (
    <div className="rounded-2xl border border-border bg-surface-1 p-10 text-center">
      <Clock className="mx-auto mb-3 h-8 w-8 text-text-muted" />
      <h2 className="font-display text-[22px] font-semibold">Анализ обрабатывается</h2>
      <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-text-muted">
        Это занимает 10–30 секунд после окончания сессии. Страница обновится
        автоматически как только отчёт будет готов.
      </p>
    </div>
  )
}

function ErrorStateUI({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-8">
      <div className="mb-2 flex items-center gap-2 text-red-400">
        <AlertTriangle className="h-5 w-5" />
        <span className="font-semibold">Не удалось показать отчёт</span>
      </div>
      <p className="text-[13px] leading-relaxed text-text-muted">{message}</p>
    </div>
  )
}

function ReadyReport({ a }: { a: CopilotSessionAnalysis }) {
  return (
    <div className="flex flex-col gap-8">
      <Header a={a} />
      {a.keyTopics.length > 0 && (
        <Section title="Key topics" icon={<Sparkles size={16} />}>
          <div className="flex flex-wrap gap-2">
            {a.keyTopics.map((t, i) => (
              <span
                key={i}
                className="inline-flex items-center rounded-full border border-border bg-surface-1 px-3 py-1 font-mono text-[11.5px] text-text-secondary"
              >
                {t}
              </span>
            ))}
          </div>
        </Section>
      )}

      {a.actionItems.length > 0 && (
        <Section title="Action items" icon={<ListChecks size={16} />}>
          <ItemList items={a.actionItems} />
        </Section>
      )}

      {a.decisions.length > 0 && (
        <Section title="Decisions" icon={<CheckCircle2 size={16} />}>
          <ItemList items={a.decisions} />
        </Section>
      )}

      {a.terminology.length > 0 && (
        <Section title="Terminology" icon={<BookOpen size={16} />}>
          <div className="flex flex-col gap-3">
            {a.terminology.map((t, i) => (
              <div
                key={i}
                className="rounded-xl border border-border bg-surface-1 p-4"
              >
                <div className="font-mono text-[11.5px] uppercase tracking-wide text-accent">
                  {t.term}
                </div>
                <div className="mt-1 text-[13.5px] leading-relaxed text-text-secondary">
                  {t.definition}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {a.openQuestions.length > 0 && (
        <Section title="Open questions" icon={<Lightbulb size={16} />}>
          <ul className="list-disc space-y-2 pl-6 text-[13.5px] leading-relaxed text-text-secondary">
            {a.openQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </Section>
      )}

      {(a.weaknesses.length > 0 || a.recommendations.length > 0) && (
        <Section title="Rubric notes" icon={<Gauge size={16} />}>
          {a.weaknesses.length > 0 && (
            <SubBlock label="Weaknesses">
              <ul className="list-disc space-y-1.5 pl-6 text-[13px] leading-relaxed text-text-secondary">
                {a.weaknesses.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </SubBlock>
          )}
          {a.recommendations.length > 0 && (
            <SubBlock label="Recommendations">
              <ul className="list-disc space-y-1.5 pl-6 text-[13px] leading-relaxed text-text-secondary">
                {a.recommendations.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </SubBlock>
          )}
          <div className="mt-4 flex flex-col gap-2">
            <ScoreBar label="Overall" value={a.overallScore} />
            {Object.entries(a.sectionScores).map(([k, v]) => (
              <ScoreBar key={k} label={labelize(k)} value={v} />
            ))}
          </div>
        </Section>
      )}

      {a.reportMarkdown && (
        <Section title="Full report" icon={<MessageSquare size={16} />}>
          <pre className="whitespace-pre-wrap rounded-xl border border-border bg-surface-1 p-5 font-sans text-[13px] leading-relaxed text-text-secondary">
            {a.reportMarkdown}
          </pre>
        </Section>
      )}

      {a.usage && <UsageFooter usage={a.usage} />}
    </div>
  )
}

function Header({ a }: { a: CopilotSessionAnalysis }) {
  const title = a.title || 'Session report'
  return (
    <div>
      <h1 className="font-display text-[34px] font-semibold leading-tight tracking-tight">
        {title}
      </h1>
      {a.tldr && (
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-text-secondary">
          {a.tldr}
        </p>
      )}
    </div>
  )
}

function Section({
  title,
  icon,
  children,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
        {icon}
        {title}
      </div>
      {children}
    </section>
  )
}

function SubBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 text-[12px] font-semibold text-text-secondary">{label}</div>
      {children}
    </div>
  )
}

function ItemList({ items }: { items: Array<{ title: string; detail?: string }> }) {
  return (
    <div className="flex flex-col gap-3">
      {items.map((it, i) => (
        <div key={i} className="rounded-xl border border-border bg-surface-1 p-4">
          <div className="text-[14px] font-semibold">{it.title}</div>
          {it.detail && (
            <div className="mt-1.5 text-[13px] leading-relaxed text-text-secondary">
              {it.detail}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 text-[12.5px] text-text-secondary">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            background:
              'linear-gradient(90deg, rgb(124,92,255) 0%, rgb(76,139,255) 100%)',
            boxShadow: '0 0 10px rgba(124,92,255,0.35)',
          }}
        />
      </div>
      <span className="w-10 text-right font-mono text-[11.5px] tabular-nums text-text-muted">
        {pct}
      </span>
    </div>
  )
}

function UsageFooter({
  usage,
}: {
  usage: NonNullable<CopilotSessionAnalysis['usage']>
}) {
  const wall = formatDuration(usage.totalLatencyMs)
  return (
    <footer className="mt-6 border-t border-border pt-6">
      <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
        Usage
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Turns" value={formatNum(usage.turns)} />
        <Stat label="Wall time" value={wall} />
        <Stat label="Tokens in" value={formatNum(usage.tokensIn)} />
        <Stat label="Tokens out" value={formatNum(usage.tokensOut)} />
      </div>
    </footer>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-1 p-3">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-text-muted">
        {label}
      </div>
      <div className="mt-1 font-display text-[22px] font-semibold leading-none tracking-tight tabular-nums">
        {value}
      </div>
    </div>
  )
}

function formatNum(n: number): string {
  return n.toLocaleString('ru-RU')
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '—'
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

function labelize(key: string): string {
  return key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}
