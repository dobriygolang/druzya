// ABExperimentsPanel — Admin Phase 2: A/B experiment scaffold (minimal).
//
// List + create modal + status toggle. Variant rollout / metric pipeline /
// stats analytics — Phase 3.
//
// Form: hypothesis textarea + metric_slug + variants editor (2+ rows,
// weights sum 100) + optional starts_at/ends_at.

import { useMemo, useState } from 'react'

import { Button } from '../../../components/Button'
import { Modal } from '../../../components/primitives/Modal'
import { ErrorBox, PanelSkeleton } from '../shared'
import {
  useAdminABExperimentsQuery,
  useCreateABExperimentMutation,
  useSetABExperimentStatusMutation,
  type ABExperiment,
  type ABStatus,
  type ABVariant,
  type CreateABExperimentBody,
} from '../../../lib/queries/abExperiments'

const STATUS_LABEL: Record<ABStatus, string> = {
  draft: 'Draft',
  running: 'Running',
  paused: 'Paused',
  completed: 'Completed',
}

const NEXT_STATUS: Record<ABStatus, { label: string; status: ABStatus }[]> = {
  draft: [{ label: 'Start', status: 'running' }],
  running: [
    { label: 'Pause', status: 'paused' },
    { label: 'Complete', status: 'completed' },
  ],
  paused: [
    { label: 'Resume', status: 'running' },
    { label: 'Complete', status: 'completed' },
  ],
  completed: [],
}

export function ABExperimentsPanel() {
  const query = useAdminABExperimentsQuery()
  const setStatusMut = useSetABExperimentStatusMutation()
  const [showCreate, setShowCreate] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const sorted = useMemo(() => {
    if (!query.data) return []
    return [...query.data]
  }, [query.data])

  if (query.isPending) return <PanelSkeleton rows={6} />
  if (query.error) return <ErrorBox message={(query.error as Error).message || 'Failed to load'} />

  const handleStatus = async (id: string, status: ABStatus) => {
    setErr(null)
    try {
      await setStatusMut.mutateAsync({ id, status })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to update status')
    }
  }

  return (
    <section className="flex flex-col gap-4 px-4 py-5 sm:px-7">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-display text-base font-bold text-text-primary">A/B experiments</h3>
          <p className="font-mono text-[11px] text-text-muted">
            Scaffold для experiment definition. Bucketing + assignment + stats analytics — Phase 3.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          + Новый эксперимент
        </Button>
      </header>

      {err && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
          {err}
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-surface-1 px-4 py-10 text-center">
          <span className="font-mono text-[12px] text-text-muted">Нет экспериментов</span>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            + Новый эксперимент
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full">
            <thead className="bg-surface-1">
              <tr>
                <Th>Slug</Th>
                <Th>Hypothesis</Th>
                <Th>Metric</Th>
                <Th>Variants</Th>
                <Th>Status</Th>
                <Th>{''}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((e) => (
                <tr key={e.id} className="bg-surface-2 hover:bg-surface-1">
                  <Td className="font-mono text-[11px]">{e.slug}</Td>
                  <Td className="max-w-[320px] text-text-secondary" title={e.hypothesis}>
                    <span className="line-clamp-2">{e.hypothesis}</span>
                  </Td>
                  <Td className="font-mono text-[11px] text-text-muted">{e.metric_slug}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {e.variants.map((v) => (
                        <span
                          key={v.name}
                          className="rounded-md border border-border bg-bg px-1.5 py-0.5 font-mono text-[10px] text-text-secondary"
                        >
                          {v.name} · {v.weight}%
                        </span>
                      ))}
                    </div>
                  </Td>
                  <Td>
                    <span
                      className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase ${
                        e.status === 'running'
                          ? 'border border-text-primary text-text-primary'
                          : e.status === 'paused'
                            ? 'border border-border-strong text-text-secondary'
                            : 'border border-border text-text-muted'
                      }`}
                    >
                      {STATUS_LABEL[e.status]}
                    </span>
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1.5">
                      {NEXT_STATUS[e.status].map((n) => (
                        <button
                          key={n.status}
                          type="button"
                          onClick={() => handleStatus(e.id, n.status)}
                          disabled={setStatusMut.isPending}
                          className="rounded-md border border-border px-2 py-1 font-mono text-[10px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-50"
                        >
                          {n.label}
                        </button>
                      ))}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <ABForm onClose={() => setShowCreate(false)} onError={setErr} existing={undefined} />}
    </section>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
      {children}
    </th>
  )
}

function Td({
  children,
  className,
  title,
}: {
  children: React.ReactNode
  className?: string
  title?: string
}) {
  return (
    <td className={`px-3 py-2 text-[12px] text-text-primary ${className ?? ''}`} title={title}>
      {children}
    </td>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Create modal
// ─────────────────────────────────────────────────────────────────────────

interface FormProps {
  existing?: ABExperiment
  onClose: () => void
  onError: (msg: string | null) => void
}

function ABForm({ onClose, onError }: FormProps) {
  const createMut = useCreateABExperimentMutation()
  const [slug, setSlug] = useState('')
  const [hypothesis, setHypothesis] = useState('')
  const [metricSlug, setMetricSlug] = useState('')
  const [variants, setVariants] = useState<ABVariant[]>([
    { name: 'control', weight: 50 },
    { name: 'treatment', weight: 50 },
  ])
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [busy, setBusy] = useState(false)

  const weightSum = variants.reduce((acc, v) => acc + (v.weight || 0), 0)
  const variantsValid =
    variants.length >= 2 && weightSum === 100 && variants.every((v) => v.name.trim().length > 0)
  const canSubmit =
    slug.trim().length >= 2 && hypothesis.trim().length >= 5 && metricSlug.trim().length >= 2 && variantsValid

  const updateVariant = (idx: number, patch: Partial<ABVariant>) => {
    setVariants((vs) => vs.map((v, i) => (i === idx ? { ...v, ...patch } : v)))
  }
  const addVariant = () => setVariants((vs) => [...vs, { name: '', weight: 0 }])
  const removeVariant = (idx: number) => setVariants((vs) => vs.filter((_, i) => i !== idx))

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    onError(null)
    try {
      const body: CreateABExperimentBody = {
        slug: slug.trim(),
        hypothesis: hypothesis.trim(),
        variants,
        metric_slug: metricSlug.trim(),
        status: 'draft',
        starts_at: startsAt ? new Date(startsAt).toISOString() : null,
        ends_at: endsAt ? new Date(endsAt).toISOString() : null,
      }
      await createMut.mutateAsync(body)
      onClose()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to create experiment')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} size="md" title="New A/B experiment">
      <div className="flex flex-col gap-4">
        <Field label="Slug" hint="lowercase-snake, e.g. plan_layout_v2">
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] text-text-primary focus:border-text-primary focus:outline-none"
          />
        </Field>

        <Field label="Hypothesis">
          <textarea
            value={hypothesis}
            onChange={(e) => setHypothesis(e.target.value)}
            rows={3}
            className="w-full resize-y rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary focus:border-text-primary focus:outline-none"
            placeholder="Mock-button в hero увеличит CTR с 4% до 6% за счёт ясности CTA"
          />
        </Field>

        <Field label="Metric slug" hint="e.g. mock_started_rate, daily_brief_clicked">
          <input
            type="text"
            value={metricSlug}
            onChange={(e) => setMetricSlug(e.target.value)}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] text-text-primary focus:border-text-primary focus:outline-none"
          />
        </Field>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
              Variants (weights sum {weightSum}/100)
            </span>
            <button
              type="button"
              onClick={addVariant}
              className="rounded-md border border-border px-2 py-1 font-mono text-[10px] text-text-secondary hover:border-border-strong hover:text-text-primary"
            >
              + variant
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {variants.map((v, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  value={v.name}
                  onChange={(e) => updateVariant(idx, { name: e.target.value })}
                  placeholder={idx === 0 ? 'control' : 'treatment'}
                  className="flex-1 rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-[12px] text-text-primary focus:border-text-primary focus:outline-none"
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={v.weight}
                  onChange={(e) => updateVariant(idx, { weight: Number.parseInt(e.target.value || '0', 10) })}
                  className="w-20 rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-[12px] text-text-primary focus:border-text-primary focus:outline-none"
                />
                <span className="font-mono text-[10px] text-text-muted">%</span>
                {variants.length > 2 && (
                  <button
                    type="button"
                    onClick={() => removeVariant(idx)}
                    className="rounded-md border border-border px-2 py-1 font-mono text-[10px] text-text-muted hover:border-danger hover:text-danger"
                  >
                    −
                  </button>
                )}
              </div>
            ))}
          </div>
          {!variantsValid && (
            <span className="font-mono text-[10px] text-danger">
              Need 2+ named variants, weights must sum to 100
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts at (optional)">
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-[11px] text-text-primary focus:border-text-primary focus:outline-none"
            />
          </Field>
          <Field label="Ends at (optional)">
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-[11px] text-text-primary focus:border-text-primary focus:outline-none"
            />
          </Field>
        </div>

        <footer className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={!canSubmit || busy}>
            Create
          </Button>
        </footer>
      </div>
    </Modal>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">{label}</span>
      {children}
      {hint && <span className="font-mono text-[10px] text-text-muted">{hint}</span>}
    </label>
  )
}
