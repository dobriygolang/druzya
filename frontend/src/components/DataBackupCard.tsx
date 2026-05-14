// Цель: пока persistence backend не shipped, юзер должен иметь way to
// сохранить и restore свой state. Браузер cleanup / device switch не
// должен стирать streak / mini-mock / goal.
//
// Three actions:
//   1. Export — download bundled JSON file (timestamped имя)
//   2. Import — file picker → validate shape → confirm modal → apply
//   3. Reset — double confirm → wipe all druz9.* localStorage keys
//
// Anti-fallback: invalid bundle на import → visible error, не silent ignore.

import { useEffect, useRef, useState } from 'react'
import { Download, Upload, Trash2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  downloadBundle,
  exportAllData,
  importBundle,
  summarizeData,
  validateBundle,
  wipeAllData,
  type BundleValidationError,
  type DataBundle,
  type DataSummary,
  type ImportSummary,
} from '../lib/dataExport'
import { bcp47 } from '../lib/i18n'

type DialogState =
  | { kind: 'idle' }
  | { kind: 'import-confirm'; bundle: DataBundle }
  | { kind: 'import-done'; summary: ImportSummary }
  | { kind: 'import-error'; error: string }
  | { kind: 'reset-confirm' }
  | { kind: 'reset-done' }

function formatValidationError(err: BundleValidationError, t: (k: string, opts?: Record<string, unknown>) => string): string {
  switch (err.code) {
    case 'not_object':
      return t('data_backup.err.not_object')
    case 'missing_version':
      return t('data_backup.err.missing_version')
    case 'version_too_new':
      return t('data_backup.err.version_too_new', { version: err.version, current: err.current })
    case 'activities_not_array':
      return t('data_backup.err.activities_not_array')
    case 'cue_sessions_not_array':
      return t('data_backup.err.cue_sessions_not_array')
    case 'diagnostic_answers_not_object':
      return t('data_backup.err.diagnostic_answers_not_object')
    case 'daily_plan_done_not_object':
      return t('data_backup.err.daily_plan_done_not_object')
  }
}

export function DataBackupCard() {
  const { t } = useTranslation('pages')
  const [summary, setSummary] = useState<DataSummary>(() => summarizeData())
  const [dialog, setDialog] = useState<DialogState>({ kind: 'idle' })
  const fileInput = useRef<HTMLInputElement>(null)

  // Refresh summary on storage event — каждый log activity / goal change
  // обновит counts без manual reload.
  useEffect(() => {
    const onStorage = () => setSummary(summarizeData())
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const onExport = () => {
    const bundle = exportAllData()
    downloadBundle(bundle)
  }

  const onImportPick = () => {
    fileInput.current?.click()
  }

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = '' // reset so picking the same file twice re-fires
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as unknown
      const err = validateBundle(parsed)
      if (err) {
        setDialog({ kind: 'import-error', error: formatValidationError(err, t) })
        return
      }
      setDialog({ kind: 'import-confirm', bundle: parsed as DataBundle })
    } catch (err) {
      const suffix = err instanceof Error ? `: ${err.message}` : ''
      setDialog({ kind: 'import-error', error: t('data_backup.err.bad_json', { detail: suffix }) })
    }
  }

  const onConfirmImport = () => {
    if (dialog.kind !== 'import-confirm') return
    const result = importBundle(dialog.bundle)
    setSummary(summarizeData())
    setDialog({ kind: 'import-done', summary: result })
  }

  const onConfirmReset = () => {
    wipeAllData()
    setSummary(summarizeData())
    setDialog({ kind: 'reset-done' })
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface-1 p-5">
      <header className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          {t('data_backup.eyebrow')}
        </span>
        <h2 className="font-display text-base font-bold leading-tight">
          {t('data_backup.title')}
        </h2>
        <p className="text-[12.5px] leading-relaxed text-text-muted">
          {t('data_backup.subtitle')}
        </p>
      </header>

      <SummaryGrid summary={summary} />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onExport}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[12px] font-semibold text-text-primary transition-colors hover:border-border-strong"
        >
          <Download className="h-3.5 w-3.5" />
          {t('data_backup.btn.export')}
        </button>
        <button
          type="button"
          onClick={onImportPick}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[12px] font-semibold text-text-primary transition-colors hover:border-border-strong"
        >
          <Upload className="h-3.5 w-3.5" />
          {t('data_backup.btn.import')}
        </button>
        <button
          type="button"
          onClick={() => setDialog({ kind: 'reset-confirm' })}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[12px] font-semibold text-text-muted transition-colors hover:border-border-strong hover:text-text-primary"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t('data_backup.btn.reset')}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          onChange={onFileChange}
          className="hidden"
        />
      </div>

      {dialog.kind === 'import-confirm' && (
        <ImportConfirm
          bundle={dialog.bundle}
          onCancel={() => setDialog({ kind: 'idle' })}
          onConfirm={onConfirmImport}
        />
      )}
      {dialog.kind === 'import-done' && (
        <ImportDone
          summary={dialog.summary}
          onClose={() => setDialog({ kind: 'idle' })}
        />
      )}
      {dialog.kind === 'import-error' && (
        <ImportError error={dialog.error} onClose={() => setDialog({ kind: 'idle' })} />
      )}
      {dialog.kind === 'reset-confirm' && (
        <ResetConfirm onCancel={() => setDialog({ kind: 'idle' })} onConfirm={onConfirmReset} />
      )}
      {dialog.kind === 'reset-done' && (
        <ResetDone onClose={() => setDialog({ kind: 'idle' })} />
      )}
    </section>
  )
}

function SummaryGrid({ summary }: { summary: DataSummary }) {
  const { t } = useTranslation('pages')
  const cells: { label: string; value: string }[] = [
    { label: 'goal', value: summary.hasGoal ? '✓' : '—' },
    { label: 'activities', value: String(summary.activitiesCount) },
    { label: 'cue sessions', value: String(summary.cueSessionsCount) },
    { label: 'mini-mock', value: summary.hasMiniMock ? '✓' : '—' },
    { label: 'diagnostic', value: summary.diagnosticDone ? '✓' : '—' },
    { label: 'plan-done', value: t('data_backup.days_count', { count: summary.dailyPlanDoneDays }) },
  ]
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {cells.map((c) => (
        <div key={c.label} className="flex flex-col rounded-md border border-border bg-surface-2 px-2.5 py-2">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-text-muted">
            {c.label}
          </span>
          <span className="font-mono text-[13px] font-semibold tabular-nums text-text-primary">
            {c.value}
          </span>
        </div>
      ))}
      <div className="col-span-3 flex flex-col rounded-md border border-border bg-surface-2 px-2.5 py-2 sm:col-span-6">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-text-muted">
          locker storage
        </span>
        <span className="font-mono text-[12px] text-text-secondary">
          {formatBytes(summary.storageBytes)}
        </span>
      </div>
    </div>
  )
}

function ImportConfirm({
  bundle,
  onCancel,
  onConfirm,
}: {
  bundle: DataBundle
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation('pages')
  const exported = new Date(bundle.exportedAt).toLocaleString(bcp47(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  })
  return (
    <div className="rounded-md border border-border bg-surface-2 p-3">
      <header className="mb-2 flex items-center gap-2">
        <AlertCircle className="h-4 w-4 text-text-primary" />
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
          {t('data_backup.import.header')}
        </span>
      </header>
      <p className="mb-2 text-[12.5px] leading-relaxed text-text-secondary">
        {t('data_backup.import.summary', {
          date: exported,
          goal: bundle.goal ? t('data_backup.import.goal_slot') : '',
          activities: bundle.activities.length,
          cue: bundle.cueSessions.length,
          mock: bundle.miniMockResult ? t('data_backup.import.mock_slot') : '',
          diagnostic: Object.keys(bundle.diagnosticAnswers).length,
          plan: Object.keys(bundle.dailyPlanDone).length,
        })}
      </p>
      <p className="mb-3 text-[12px] italic text-text-muted">
        {t('data_backup.import.replace_warning')}
      </p>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border bg-bg px-3 py-1.5 text-[12px] text-text-secondary hover:text-text-primary"
        >
          {t('data_backup.btn.cancel')}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-md border border-border-strong bg-text-primary/10 px-3 py-1.5 text-[12px] font-semibold text-text-primary hover:bg-text-primary/15"
        >
          {t('data_backup.btn.apply')}
        </button>
      </div>
    </div>
  )
}

function ImportDone({
  summary,
  onClose,
}: {
  summary: ImportSummary
  onClose: () => void
}) {
  const { t } = useTranslation('pages')
  return (
    <div className="rounded-md border border-border bg-surface-2 p-3">
      <header className="mb-2 flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-text-primary" />
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-primary">
          {t('data_backup.import.done_header')}
        </span>
      </header>
      <ul className="mb-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] text-text-secondary">
        <li>goal: {summary.goal ? '✓' : '—'}</li>
        <li>activities: {summary.activities}</li>
        <li>cue: {summary.cueSessions}</li>
        <li>mini-mock: {summary.miniMockResult ? '✓' : '—'}</li>
        <li>diagnostic: {summary.diagnosticAnswers}</li>
        <li>plan-days: {summary.dailyPlanDoneDays}</li>
      </ul>
      <button
        type="button"
        onClick={onClose}
        className="rounded-md border border-border bg-bg px-3 py-1.5 text-[12px] text-text-secondary hover:text-text-primary"
      >
        {t('data_backup.btn.close')}
      </button>
    </div>
  )
}

function ImportError({ error, onClose }: { error: string; onClose: () => void }) {
  const { t } = useTranslation('pages')
  return (
    <div className="relative rounded-md border border-border bg-surface-2 p-3">
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-[1.5px] rounded-l-md"
        style={{ background: '#FF3B30' }}
      />
      <header className="mb-2 flex items-center gap-2">
        <AlertCircle className="h-4 w-4 text-text-primary" />
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-primary">
          {t('data_backup.error_header')}
        </span>
      </header>
      <p className="mb-2 text-[12.5px] text-text-secondary">{error}</p>
      <button
        type="button"
        onClick={onClose}
        className="rounded-md border border-border bg-bg px-3 py-1.5 text-[12px] text-text-secondary hover:text-text-primary"
      >
        {t('data_backup.btn.close')}
      </button>
    </div>
  )
}

function ResetConfirm({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const { t } = useTranslation('pages')
  const [confirmText, setConfirmText] = useState('')
  const ok = confirmText.trim().toLowerCase() === 'wipe'
  return (
    <div className="relative rounded-md border border-border bg-surface-2 p-3">
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-[1.5px] rounded-l-md"
        style={{ background: '#FF3B30' }}
      />
      <header className="mb-2 flex items-center gap-2">
        <AlertCircle className="h-4 w-4 text-text-primary" />
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-primary">
          {t('data_backup.reset.header')}
        </span>
      </header>
      <p className="mb-3 text-[12.5px] leading-relaxed text-text-secondary">
        {t('data_backup.reset.body')}
      </p>
      <p className="mb-2 text-[11px] text-text-muted">
        {t('data_backup.reset.confirm_prompt_pre')}{' '}
        <code className="font-mono text-text-primary">wipe</code>{' '}
        {t('data_backup.reset.confirm_prompt_post')}
      </p>
      <input
        type="text"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder="wipe"
        className="mb-3 w-full rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-[12px] text-text-primary placeholder:text-text-muted focus:border-text-primary focus:outline-none"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border bg-bg px-3 py-1.5 text-[12px] text-text-secondary hover:text-text-primary"
        >
          {t('data_backup.btn.cancel')}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!ok}
          className="rounded-md border border-border-strong bg-text-primary/10 px-3 py-1.5 text-[12px] font-semibold text-text-primary disabled:cursor-not-allowed disabled:opacity-50 hover:bg-text-primary/15"
        >
          {t('data_backup.btn.confirm_reset')}
        </button>
      </div>
    </div>
  )
}

function ResetDone({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('pages')
  return (
    <div className="rounded-md border border-border bg-surface-2 p-3">
      <header className="mb-2 flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-text-primary" />
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-primary">
          {t('data_backup.reset.done_header')}
        </span>
      </header>
      <p className="mb-3 text-[12.5px] text-text-secondary">
        {t('data_backup.reset.done_body')}
      </p>
      <button
        type="button"
        onClick={onClose}
        className="rounded-md border border-border bg-bg px-3 py-1.5 text-[12px] text-text-secondary hover:text-text-primary"
      >
        {t('data_backup.btn.close')}
      </button>
    </div>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}
