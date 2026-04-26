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
  useCompanyQuestionsQuery,
  useCompanyStagesQuery,
  useCreateCompanyMutation,
  useCreateCompanyQuestionMutation,
  useDefaultQuestionsQuery,
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
      <CandidatePreview companyId={company.id} />
      <CompanyQuestionsInline companyId={company.id} />
    </div>
  )
}

// CompanyQuestionsInline — embeds the company-specific question pool
// management RIGHT under the stages editor, so admin doesn't have to
// switch to "Mock · вопросы" tab + filter by company.
function CompanyQuestionsInline({ companyId }: { companyId: string }) {
  const list = useCompanyQuestionsQuery(companyId)
  const create = useCreateCompanyQuestionMutation()
  const [stageFilter, setStageFilter] = useState<StageKind | 'all'>('all')
  const [draftStage, setDraftStage] = useState<StageKind>('hr')
  const [draftBody, setDraftBody] = useState('')
  const [draftExpected, setDraftExpected] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const allQuestions = list.data ?? []
  const filtered =
    stageFilter === 'all'
      ? allQuestions
      : allQuestions.filter((q) => q.stage_kind === stageFilter)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (!draftBody.trim()) return
    try {
      await create.mutateAsync({
        companyId,
        body: {
          stage_kind: draftStage,
          body: draftBody.trim(),
          expected_answer_md: draftExpected.trim() || undefined,
        },
      })
      setDraftBody('')
      setDraftExpected('')
    } catch (e) {
      setErr(mockAdminErrorMessage(e))
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface-1 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="font-display text-sm font-bold text-text-primary">
            Вопросы компании
          </h3>
          <p className="font-mono text-[10px] text-text-muted">
            HR / behavioral пулы — пайплайн берёт из них N случайных по limits выше.
          </p>
        </div>
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value as StageKind | 'all')}
          className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[11px] text-text-primary"
        >
          <option value="all">все этапы ({allQuestions.length})</option>
          {STAGE_KINDS.map((s) => {
            const n = allQuestions.filter((q) => q.stage_kind === s).length
            return (
              <option key={s} value={s}>
                {s} ({n})
              </option>
            )
          })}
        </select>
      </div>

      {list.isPending ? (
        <p className="font-mono text-[11px] text-text-muted">Загрузка…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-surface-2 px-3 py-4 text-center font-mono text-[11px] text-text-muted">
          Нет вопросов в выбранном этапе. Добавь первый ниже.
        </div>
      ) : (
        <ul className="mb-3 flex flex-col gap-1.5">
          {filtered.map((q) => (
            <li
              key={q.id}
              className="flex items-start justify-between gap-3 rounded-md border border-border bg-surface-2 p-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-bg/40 px-1.5 py-0.5 font-mono text-[9px] uppercase text-text-muted">
                    {q.stage_kind}
                  </span>
                  {'active' in q && (q as { active?: boolean }).active === false && (
                    <span className="rounded-full bg-warn/15 px-1.5 py-0.5 font-mono text-[9px] uppercase text-warn">
                      hidden
                    </span>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-[12px] text-text-primary">{q.body}</p>
                {q.expected_answer_md && (
                  <p className="mt-1 line-clamp-1 font-mono text-[10px] text-text-muted">
                    expected: {q.expected_answer_md}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={submit}
        className="flex flex-col gap-2 rounded-md border border-text-primary/30 bg-text-primary/[0.03] p-3"
      >
        <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
          + добавить вопрос для этой компании
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={draftStage}
            onChange={(e) => setDraftStage(e.target.value as StageKind)}
            className="rounded-md border border-border bg-bg/40 px-2 py-1.5 text-[12px] text-text-primary sm:w-32"
          >
            {STAGE_KINDS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            placeholder="Текст вопроса"
            className="flex-1 rounded-md border border-border bg-bg/40 px-2 py-1.5 text-[12px] text-text-primary"
          />
        </div>
        <textarea
          value={draftExpected}
          onChange={(e) => setDraftExpected(e.target.value)}
          rows={2}
          placeholder="Образец ответа (для AI-судьи) — можно оставить пустым"
          className="rounded-md border border-border bg-bg/40 px-2 py-1.5 font-mono text-[11px] text-text-primary"
        />
        {err && <div className="text-[12px] text-danger">{err}</div>}
        <div className="flex justify-end">
          <Button type="submit" size="sm" loading={create.isPending}>
            Добавить
          </Button>
        </div>
      </form>
    </section>
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
                {(s.stage_kind === 'algo' ||
                  s.stage_kind === 'coding' ||
                  s.stage_kind === 'sysdesign') && (
                  <span
                    className={`ml-1 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase ${
                      s.task_pool_ids.length === 0
                        ? 'border-warn/50 bg-warn/10 text-warn'
                        : 'border-border bg-surface-2 text-text-muted'
                    }`}
                    title={
                      s.task_pool_ids.length === 0
                        ? 'Пул пуст — picker возьмёт случайную задачу из ВСЕХ активных mock_tasks для этого этапа.'
                        : `${s.task_pool_ids.length} задач в пуле — picker выберет одну случайную.`
                    }
                  >
                    {s.task_pool_ids.length === 0 ? 'pool: any' : `${s.task_pool_ids.length} tasks`}
                  </span>
                )}
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

// CandidatePreview — read-only "what the candidate will see" view for
// the currently-selected company. Aggregates stages config + question
// pool counts so the admin sees the actual flow without spawning a
// pipeline. Closes the «у каждой компании 0 задач» confusion: this
// shows e.g. "5 default HR + 3 random of 47 company questions".
function CandidatePreview({ companyId }: { companyId: string }) {
  const stagesQ = useCompanyStagesQuery(companyId)
  const companyQs = useCompanyQuestionsQuery(companyId)
  const defaultQs = useDefaultQuestionsQuery() // all stages, single fetch
  if (stagesQ.isPending) return null
  if (stagesQ.error) return null
  const stages = [...(stagesQ.data ?? [])].sort((a, b) => a.ordinal - b.ordinal)
  if (stages.length === 0) return null

  const stageLabel: Record<StageKind, string> = {
    hr: 'HR / screening',
    algo: 'Algorithms',
    coding: 'Coding',
    sysdesign: 'System design',
    behavioral: 'Behavioral',
  }

  return (
    <section className="rounded-lg border border-text-primary/30 bg-text-primary/[0.03] p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="font-display text-sm font-bold text-text-primary">
          Что увидит кандидат
        </h3>
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
          live preview · по текущей конфигурации
        </span>
      </div>
      <ol className="flex flex-col gap-2">
        {stages.map((s, i) => {
          const desc = describeStage(s, defaultQs.data ?? [], companyQs.data ?? [])
          return (
            <li
              key={s.stage_kind}
              className="flex items-start gap-3 rounded-md border border-border bg-surface-2 p-3"
            >
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-text-primary/10 font-display text-xs font-bold text-text-primary">
                {i + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-sm font-bold text-text-primary">
                    {stageLabel[s.stage_kind]}
                  </span>
                  {s.optional && (
                    <span className="rounded-full border border-border bg-bg/40 px-1.5 font-mono text-[9px] uppercase tracking-wider text-text-muted">
                      optional
                    </span>
                  )}
                </div>
                <span className="font-mono text-[11px] text-text-secondary">{desc}</span>
              </div>
            </li>
          )
        })}
      </ol>
      <p className="mt-3 font-mono text-[10px] text-text-muted">
        Считается из текущих лимитов на этапах + активных вопросов в пуле. Меняй конфиг выше — превью пересчитается.
      </p>
    </section>
  )
}

// describeStage builds one human-readable line for the candidate
// preview. Branches on stage_kind because HR/behavioral pull from
// question pools while algo/coding/sysdesign pull from task pools.
function describeStage(
  s: CompanyStageConfig,
  defaults: { stage_kind: StageKind; active?: boolean }[],
  companyQs: { stage_kind: StageKind; active?: boolean }[],
): string {
  if (s.stage_kind === 'hr' || s.stage_kind === 'behavioral') {
    // `active` is optional in the local type — undefined means "treat
    // as active" (server is source of truth and excludes inactive
    // before sending). Counts here are upper bounds for the preview.
    const defaultActive = defaults.filter(
      (q) => q.stage_kind === s.stage_kind && q.active !== false,
    ).length
    const companyActive = companyQs.filter(
      (q) => q.stage_kind === s.stage_kind && q.active !== false,
    ).length
    const dPart = describePoolDraw(defaultActive, s.default_question_limit ?? null, 'default')
    const cPart = describePoolDraw(companyActive, s.company_question_limit ?? null, 'company')
    const parts = [dPart, cPart].filter(Boolean)
    if (parts.length === 0) return 'нет вопросов в пулах — этап будет пуст'
    return parts.join(' + ')
  }
  // task_solve stages: picker takes 1 random task per stage.
  if (s.task_pool_ids.length === 0) {
    return '1 случайная задача из ВСЕХ активных mock_tasks этого этапа (pool пуст)'
  }
  return `1 случайная задача из ${s.task_pool_ids.length} в пуле компании`
}

function describePoolDraw(active: number, limit: number | null, label: string): string {
  if (active === 0) return ''
  if (limit === null) return `все ${active} ${label}-вопросов`
  if (limit === 0) return ''
  if (limit >= active) return `все ${active} ${label}-вопросов`
  return `${limit} случайных из ${active} ${label}-вопросов`
}
