// MockCompaniesPanel — companies CRUD + per-company stage config.
// Phase A.2 of ADR-002.
//
// 2-column: list of companies on the left, selected company detail on
// the right. Detail has a top form (name/desc/logo/sort/active) and a
// CompanyStagesEditor below — drag-replacement via simple ↑/↓ arrows
// (no @dnd-kit dep). The stages PUT replaces the whole array.

import { useEffect, useMemo, useState } from 'react'
import { Button } from '../../components/Button'
import { FormField } from '../../components/FormField'
import { ErrorBox, PanelSkeleton } from './shared'
import {
  mockAdminErrorMessage,
  useCompaniesQuery,
  useCompanyStagesQuery,
  useCreateCompanyMutation,
  usePutCompanyStagesMutation,
  useStrictnessQuery,
  useToggleCompanyActiveMutation,
  useUpdateCompanyMutation,
  type Company,
  type CompanyStageConfig,
  type StageKind,
  type TaskLanguage,
} from '../../lib/queries/mockAdmin'

const STAGE_KINDS: StageKind[] = ['hr', 'algo', 'coding', 'sysdesign', 'behavioral']
const LANGS: TaskLanguage[] = ['go', 'python', 'sql', 'any']

export function MockCompaniesPanel() {
  const list = useCompaniesQuery()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  if (list.isPending) return <PanelSkeleton rows={6} />
  if (list.error || !list.data) return <ErrorBox message={mockAdminErrorMessage(list.error)} />

  const companies = [...list.data].sort((a, b) => a.sort_order - b.sort_order)
  const selected = companies.find((c) => c.id === selectedId) ?? null

  return (
    <div className="flex flex-col gap-4 px-4 py-5 sm:px-7 lg:flex-row">
      <aside className="flex w-full flex-col gap-3 lg:w-72">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm font-bold text-text-primary">Компании</h2>
          <Button size="sm" onClick={() => setCreating(true)}>
            + Add
          </Button>
        </div>
        {companies.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-surface-1 px-3 py-6 text-center font-mono text-[11px] text-text-muted">
            Пока нет companies — создай первую.
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {companies.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left transition-colors ${
                    selectedId === c.id
                      ? 'border-text-primary bg-surface-2'
                      : 'border-border bg-surface-1 hover:border-border-strong'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-text-primary">
                      {c.name}
                    </div>
                    <div className="truncate font-mono text-[10px] text-text-muted">{c.slug}</div>
                  </div>
                  <span
                    className={`ml-2 rounded-full px-1.5 py-0.5 font-mono text-[9px] ${
                      c.active ? 'bg-success/20 text-success' : 'bg-surface-3 text-text-muted'
                    }`}
                  >
                    {c.active ? 'ON' : 'OFF'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <main className="flex-1">
        {creating ? (
          <CreateCompanyForm onClose={() => setCreating(false)} />
        ) : selected ? (
          <CompanyDetail company={selected} />
        ) : (
          <div className="grid h-full place-items-center rounded-lg border border-dashed border-border bg-surface-1 px-6 py-16 text-center font-mono text-[12px] text-text-muted">
            Выбери компанию слева или создай новую.
          </div>
        )}
      </main>
    </div>
  )
}

function CreateCompanyForm({ onClose }: { onClose: () => void }) {
  const create = useCreateCompanyMutation()
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [sortOrder, setSortOrder] = useState('0')
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    try {
      await create.mutateAsync({
        slug: slug.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
        logo_url: logoUrl.trim() || undefined,
        sort_order: Number(sortOrder) || 0,
      })
      onClose()
    } catch (e) {
      setErr(mockAdminErrorMessage(e))
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface-1 p-4"
    >
      <h3 className="font-display text-sm font-bold text-text-primary">Новая компания</h3>
      <FormField label="slug" value={slug} onChange={(e) => setSlug(e.currentTarget.value)} required />
      <FormField label="name" value={name} onChange={(e) => setName(e.currentTarget.value)} required />
      <FormField
        label="description"
        multiline
        value={description}
        onChange={(e) => setDescription(e.currentTarget.value)}
      />
      <FormField label="logo_url" value={logoUrl} onChange={(e) => setLogoUrl(e.currentTarget.value)} />
      <FormField
        label="sort_order"
        type="number"
        value={sortOrder}
        onChange={(e) => setSortOrder(e.currentTarget.value)}
      />
      {err && <div className="text-[12px] text-danger">{err}</div>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Отмена
        </Button>
        <Button type="submit" size="sm" loading={create.isPending}>
          Создать
        </Button>
      </div>
    </form>
  )
}

function CompanyDetail({ company }: { company: Company }) {
  const update = useUpdateCompanyMutation()
  const toggleActive = useToggleCompanyActiveMutation()
  const [name, setName] = useState(company.name)
  const [description, setDescription] = useState(company.description ?? '')
  const [logoUrl, setLogoUrl] = useState(company.logo_url ?? '')
  const [sortOrder, setSortOrder] = useState(String(company.sort_order))
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setName(company.name)
    setDescription(company.description ?? '')
    setLogoUrl(company.logo_url ?? '')
    setSortOrder(String(company.sort_order))
    setErr(null)
  }, [company.id, company.name, company.description, company.logo_url, company.sort_order])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    try {
      await update.mutateAsync({
        id: company.id,
        body: {
          name: name.trim(),
          description: description.trim(),
          logo_url: logoUrl.trim(),
          sort_order: Number(sortOrder) || 0,
        },
      })
    } catch (e) {
      setErr(mockAdminErrorMessage(e))
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <form
        onSubmit={submit}
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface-1 p-4"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-sm font-bold text-text-primary">{company.slug}</h3>
          <button
            type="button"
            onClick={() =>
              toggleActive.mutate({ id: company.id, active: !company.active })
            }
            className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] ${
              company.active ? 'bg-success/20 text-success' : 'bg-surface-3 text-text-muted'
            }`}
          >
            {company.active ? 'active' : 'inactive'}
          </button>
        </div>
        <FormField label="name" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <FormField
          label="description"
          multiline
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />
        <FormField label="logo_url" value={logoUrl} onChange={(e) => setLogoUrl(e.currentTarget.value)} />
        <FormField
          label="sort_order"
          type="number"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.currentTarget.value)}
        />
        {err && <div className="text-[12px] text-danger">{err}</div>}
        <div className="flex justify-end">
          <Button type="submit" size="sm" loading={update.isPending}>
            Сохранить
          </Button>
        </div>
      </form>

      <CompanyStagesEditor companyId={company.id} />
    </div>
  )
}

function CompanyStagesEditor({ companyId }: { companyId: string }) {
  const stagesQ = useCompanyStagesQuery(companyId)
  const strictness = useStrictnessQuery()
  const put = usePutCompanyStagesMutation()
  const [draft, setDraft] = useState<CompanyStageConfig[]>([])
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (stagesQ.data) setDraft(sortStages(stagesQ.data))
  }, [stagesQ.data, companyId])

  const profileOptions = useMemo(
    () => strictness.data ?? [],
    [strictness.data],
  )

  function setStage(idx: number, patch: Partial<CompanyStageConfig>) {
    setDraft((d) => d.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }
  function move(idx: number, dir: -1 | 1) {
    setDraft((d) => {
      const next = [...d]
      const j = idx + dir
      if (j < 0 || j >= next.length) return next
      ;[next[idx], next[j]] = [next[j], next[idx]]
      return next.map((s, i) => ({ ...s, ordinal: i }))
    })
  }
  function remove(idx: number) {
    setDraft((d) => d.filter((_, i) => i !== idx).map((s, i) => ({ ...s, ordinal: i })))
  }
  function add() {
    setDraft((d) => [
      ...d,
      {
        stage_kind: 'hr',
        ordinal: d.length,
        optional: false,
        language_pool: [],
        task_pool_ids: [],
        ai_strictness_profile_id: null,
      },
    ])
  }
  async function save() {
    setErr(null)
    try {
      await put.mutateAsync({
        companyId,
        stages: draft.map((s, i) => ({ ...s, ordinal: i })),
      })
    } catch (e) {
      setErr(mockAdminErrorMessage(e))
    }
  }

  if (stagesQ.isPending) return <PanelSkeleton rows={3} />
  if (stagesQ.error) return <ErrorBox message={mockAdminErrorMessage(stagesQ.error)} />

  return (
    <section className="rounded-lg border border-border bg-surface-1 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-sm font-bold text-text-primary">Этапы интервью</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={add}>
            + Этап
          </Button>
          <Button size="sm" onClick={save} loading={put.isPending}>
            Сохранить пайплайн
          </Button>
        </div>
      </div>

      {draft.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-surface-2 px-3 py-5 text-center font-mono text-[11px] text-text-muted">
          Нет этапов. Добавь первый.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {draft.map((s, i) => (
            <li
              key={i}
              className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3 sm:flex-row sm:items-start"
            >
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-text-secondary disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === draft.length - 1}
                  className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-text-secondary disabled:opacity-30"
                >
                  ↓
                </button>
                <span className="ml-1 font-mono text-[10px] text-text-muted">#{i}</span>
              </div>

              <div className="grid flex-1 gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-muted">
                    stage
                  </span>
                  <select
                    value={s.stage_kind}
                    onChange={(e) =>
                      setStage(i, { stage_kind: e.target.value as StageKind })
                    }
                    className="rounded-md border border-border bg-bg/40 px-2 py-1.5 text-[12px] text-text-primary"
                  >
                    {STAGE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-muted">
                    strictness
                  </span>
                  <select
                    value={s.ai_strictness_profile_id ?? ''}
                    onChange={(e) =>
                      setStage(i, {
                        ai_strictness_profile_id: e.target.value || null,
                      })
                    }
                    className="rounded-md border border-border bg-bg/40 px-2 py-1.5 text-[12px] text-text-primary"
                  >
                    <option value="">— default —</option>
                    {profileOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={s.optional}
                    onChange={(e) => setStage(i, { optional: e.target.checked })}
                  />
                  <span className="font-mono text-[11px] text-text-secondary">optional</span>
                </label>

                {s.stage_kind === 'coding' && (
                  <div className="flex flex-col gap-1 sm:col-span-2">
                    <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-muted">
                      language_pool
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {LANGS.map((l) => {
                        const on = s.language_pool.includes(l)
                        return (
                          <button
                            key={l}
                            type="button"
                            onClick={() => {
                              setStage(i, {
                                language_pool: on
                                  ? s.language_pool.filter((x) => x !== l)
                                  : [...s.language_pool, l],
                              })
                            }}
                            className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] ${
                              on
                                ? 'border-text-primary bg-text-primary/10 text-text-primary'
                                : 'border-border text-text-secondary'
                            }`}
                          >
                            {l}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {(s.stage_kind === 'hr' || s.stage_kind === 'behavioral') && (
                  <div className="flex flex-col gap-2 sm:col-span-2">
                    <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-muted">
                      Question sampling
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <PoolLimitInput
                        label="default pool"
                        value={s.default_question_limit ?? null}
                        onChange={(v) => setStage(i, { default_question_limit: v })}
                      />
                      <PoolLimitInput
                        label="company pool"
                        value={s.company_question_limit ?? null}
                        onChange={(v) => setStage(i, { company_question_limit: v })}
                      />
                    </div>
                    <p className="font-mono text-[10px] text-text-muted">
                      пусто = взять все · 0 = пропустить · N = случайных N
                    </p>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => remove(i)}
                className="self-start rounded border border-danger/40 px-2 py-0.5 font-mono text-[10px] text-danger hover:bg-danger/10"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {err && <div className="mt-3 text-[12px] text-danger">{err}</div>}
    </section>
  )
}

function sortStages(s: CompanyStageConfig[]): CompanyStageConfig[] {
  return [...s].sort((a, b) => a.ordinal - b.ordinal)
}

// PoolLimitInput — number-or-null input. Empty string serialises to
// `null` (= "take all"); explicit 0 keeps the source disabled.
function PoolLimitInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-muted">
        {label}
      </span>
      <input
        type="number"
        min={0}
        max={50}
        placeholder="all"
        value={value ?? ''}
        onChange={(e) => {
          const raw = e.target.value
          if (raw === '') return onChange(null)
          const n = Number(raw)
          if (!Number.isFinite(n)) return
          onChange(Math.max(0, Math.min(50, Math.round(n))))
        }}
        className="rounded-md border border-border bg-bg/40 px-2 py-1.5 font-mono text-[12px] text-text-primary"
      />
    </label>
  )
}
