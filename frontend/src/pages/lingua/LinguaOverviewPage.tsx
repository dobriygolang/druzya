// LinguaOverviewPage — hub overview для /lingua (Reading + Writing +
// Listening + Speaking). Что требует внимания сегодня:
//   - vocab-due count
//   - library count (reading materials)
//   - recent materials list
//   - speaking sparkline (14 sessions)
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { SpeakingSparkline } from '../../components/lingua/SpeakingSparkline'
import { VocabReviewWidget } from '../../components/lingua/VocabReviewWidget'
import { useLinguaOverviewQuery } from '../../lib/queries/lingua'

export default function LinguaOverviewPage() {
  const { t } = useTranslation('lingua')
  const { reading, vocab, speaking } = useLinguaOverviewQuery()
  const dueCount = vocab.data?.length ?? 0
  const libraryCount = reading.data?.length ?? 0
  const speakingCount = speaking.data?.length ?? 0
  const firstError = reading.error ?? vocab.error ?? speaking.error

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8">
        <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          {t('hub_label')}
        </div>
        <h1 className="font-display text-[32px] font-bold leading-tight tracking-tight text-text-primary sm:text-h2">
          {t('overview.title')}
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-text-secondary">
          {t('overview.subtitle')}
        </p>
      </header>

      {firstError && (
        <div role="alert" className="mb-6 flex flex-col gap-1 rounded-md border border-border-strong bg-surface-1 px-4 py-3">
          <div className="text-sm text-text-primary">{t('overview.load_partial_error')}</div>
          <div className="text-xs text-text-muted">{firstError.message}</div>
        </div>
      )}

      <div className="mb-6 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <StatCard label="Vocab due" value={dueCount} hint={t('overview.stat_vocab_due')} to="/lingua/reading" />
        <StatCard label="Library" value={libraryCount} hint={t('overview.stat_library')} to="/lingua/reading" />
        <StatCard label="Speaking" value={speakingCount} hint={t('overview.stat_speaking')} to="/lingua/speaking" />
      </div>

      <section className="mb-8">
        <div className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          {t('overview.vocab_section')}
        </div>
        <VocabReviewWidget />
      </section>

      <section className="mb-8">
        <div className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          {t('overview.recent_materials')}
        </div>
        {libraryCount === 0 ? (
          <div className="rounded-md border border-border bg-surface-1 px-3.5 py-3 text-xs text-text-muted">
            {t('overview.library_empty')}
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {(reading.data ?? []).slice(0, 6).map((m) => (
              <li key={m.id}>
                <Link
                  to="/lingua/reading"
                  className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-transparent px-3 py-2 text-left text-text-primary transition-colors hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">{m.title}</span>
                  <span className="flex-shrink-0 font-mono text-[11px] text-text-muted">
                    {Math.round(m.totalChars / 1000)}k chars
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-8">
        <div className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          {t('overview.speaking_trend')}
        </div>
        <SpeakingSparkline history={speaking.data ?? []} withCaption />
      </section>

      <div className="flex flex-wrap gap-2">
        <QuickAction to="/lingua/reading" label={t('overview.quick.reading')} />
        <QuickAction to="/lingua/writing" label={t('overview.quick.writing')} />
        <QuickAction to="/lingua/listening" label={t('overview.quick.listening')} />
        <QuickAction to="/lingua/speaking" label={t('overview.quick.speaking')} />
      </div>
    </div>
  )
}

function StatCard({ label, value, hint, to }: { label: string; value: number; hint: string; to: string }) {
  return (
    <Link
      to={to}
      className="block min-w-0 rounded-md border border-border bg-transparent p-4 text-left transition-colors hover:bg-surface-2"
    >
      <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-text-muted">{label}</div>
      <div className="mt-1.5 text-3xl font-semibold tabular-nums tracking-tight text-text-primary">{value}</div>
      <div className="mt-0.5 text-[11px] text-text-muted">{hint}</div>
    </Link>
  )
}

function QuickAction({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-transparent px-3.5 py-1.5 text-[13px] text-text-primary transition-colors hover:bg-surface-2"
    >
      {label}
    </Link>
  )
}
