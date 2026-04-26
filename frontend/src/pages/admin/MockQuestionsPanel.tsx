// MockQuestionsPanel — default + company-overlay HR/behavioral questions.
// Phase A.2 of ADR-002.
//
// Single-column panel with two sections:
//   1. Default questions (universal pool, grouped by stage_kind).
//   2. Company-specific overlays (pick a company → see/manage its overlay).
// Both sections share the same question editor (body, expected answer,
// reference criteria, sort_order) via inline expand.

import { useMemo, useState } from 'react'
import { Button } from '../../components/Button'
import { FormField } from '../../components/FormField'
import { ErrorBox, PanelSkeleton } from './shared'
import { ReferenceCriteriaEditor } from './ReferenceCriteriaEditor'
import {
  mockAdminErrorMessage,
  useCompaniesQuery,
  useCompanyQuestionsQuery,
  useCreateCompanyQuestionMutation,
  useCreateDefaultQuestionMutation,
  useDefaultQuestionsQuery,
  useDeleteCompanyQuestionMutation,
  useDeleteDefaultQuestionMutation,
  useUpdateCompanyQuestionMutation,
  useUpdateDefaultQuestionMutation,
  type CompanyQuestion,
  type DefaultQuestion,
  type ReferenceCriteria,
  type StageKind,
} from '../../lib/queries/mockAdmin'

const STAGE_KINDS: StageKind[] = ['hr', 'algo', 'coding', 'sysdesign', 'behavioral']

export function MockQuestionsPanel() {
  return (
    <div className="flex flex-col gap-6 px-4 py-5 sm:px-7">
      <DefaultQuestionsSection />
      <CompanyQuestionsSection />
    </div>
  )
}

// ── default questions ────────────────────────────────────────────────────

function DefaultQuestionsSection() {
  const [stageFilter, setStageFilter] = useState<StageKind | undefined>(undefined)
  const list = useDefaultQuestionsQuery(stageFilter)
  const create = useCreateDefaultQuestionMutation()
  const [newStage, setNewStage] = useState<StageKind>('hr')
  const [newBody, setNewBody] = useState('')
  const [newExpected, setNewExpected] = useState('')
  const [err, setErr] = useState<string | null>(null)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    if (!newBody.trim()) return
    try {
      await create.mutateAsync({
        stage_kind: newStage,
        body: newBody.trim(),
        expected_answer_md: newExpected.trim() || undefined,
      })
      setNewBody('')
      setNewExpected('')
    } catch (e) {
      setErr(mockAdminErrorMessage(e))
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<StageKind, DefaultQuestion[]>()
    for (const q of list.data ?? []) {
      const arr = map.get(q.stage_kind) ?? []
      arr.push(q)
      map.set(q.stage_kind, arr)
    }
    for (const arr of map.values()) arr.sort((a, b) => a.sort_order - b.sort_order)
    return map
  }, [list.data])

  return (
    <section className="rounded-lg border border-border bg-surface-1 p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-sm font-bold text-text-primary">
            Дефолтные вопросы
          </h2>
          <p className="mt-1 font-mono text-[11px] text-text-muted">
            Универсальный пул для HR / behavioral. Подмешиваются ко всем компаниям.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterChip
            on={stageFilter === undefined}
            onClick={() => setStageFilter(undefined)}
          >
            all
          </FilterChip>
          {STAGE_KINDS.map((s) => (
            <FilterChip
              key={s}
              on={stageFilter === s}
              onClick={() => setStageFilter(s)}
            >
              {s}
            </FilterChip>
          ))}
        </div>
      </header>

      {list.isPending ? (
        <PanelSkeleton rows={3} />
      ) : list.error ? (
        <ErrorBox message={mockAdminErrorMessage(list.error)} />
      ) : grouped.size === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-surface-2 px-3 py-4 text-center font-mono text-[11px] text-text-muted">
          Пока нет вопросов.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {STAGE_KINDS.filter((s) => grouped.has(s)).map((s) => (
            <div key={s} className="flex flex-col gap-1.5">
              <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">
                {s}
              </div>
              <ul className="flex flex-col gap-1.5">
                {(grouped.get(s) ?? []).map((q) => (
                  <DefaultQuestionRow key={q.id} q={q} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <form
        onSubmit={add}
        className="mt-4 flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3"
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">
          + добавить дефолтный вопрос
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="flex flex-col gap-1 sm:w-44">
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-muted">stage</span>
            <select
              value={newStage}
              onChange={(e) => setNewStage(e.target.value as StageKind)}
              className="rounded-md border border-border bg-bg/40 px-2 py-1.5 text-[13px] text-text-primary"
            >
              {STAGE_KINDS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <div className="flex-1">
            <FormField label="body — текст вопроса" value={newBody} onChange={(e) => setNewBody(e.currentTarget.value)} />
          </div>
        </div>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-muted">
            expected_answer_md — образец ответа (для AI-судьи)
          </span>
          <textarea
            value={newExpected}
            onChange={(e) => setNewExpected(e.target.value)}
            rows={3}
            placeholder="Краткий «как правильно» — судья сравнивает с ним. Можно оставить пустым."
            className="rounded-md border border-border bg-bg/40 px-2 py-1.5 font-mono text-[12px] text-text-primary"
          />
        </label>
        {err && <div className="text-[12px] text-danger">{err}</div>}
        <div className="flex justify-end">
          <Button type="submit" size="sm" loading={create.isPending}>Добавить</Button>
        </div>
      </form>
    </section>
  )
}

function DefaultQuestionRow({ q }: { q: DefaultQuestion }) {
  const update = useUpdateDefaultQuestionMutation()
  const del = useDeleteDefaultQuestionMutation()
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState(q.body)
  const [expected, setExpected] = useState(q.expected_answer_md ?? '')
  const [criteria, setCriteria] = useState<ReferenceCriteria>(q.reference_criteria ?? {})
  const [sort, setSort] = useState(String(q.sort_order))
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setErr(null)
    try {
      await update.mutateAsync({
        id: q.id,
        body: {
          body: body.trim(),
          expected_answer_md: expected,
          reference_criteria: criteria,
          sort_order: Number(sort) || 0,
        },
      })
      setOpen(false)
    } catch (e) {
      setErr(mockAdminErrorMessage(e))
    }
  }

  return (
    <li
      className="rounded-md border border-border bg-surface-2 p-3"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) setOpen(false)
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 text-[12px] text-text-primary">{q.body}</div>
        <div className="flex items-center gap-1">
          <span className="font-mono text-[9px] text-text-muted">#{q.sort_order}</span>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="rounded border border-border px-2 py-0.5 font-mono text-[10px] text-text-secondary"
          >
            {open ? '−' : 'edit'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm('Удалить?')) del.mutate(q.id)
            }}
            className="rounded border border-danger/40 px-2 py-0.5 font-mono text-[10px] text-danger"
          >
            ✕
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-3 flex flex-col gap-2">
          <FormField label="body" value={body} onChange={(e) => setBody(e.currentTarget.value)} />
          <FormField
            label="expected_answer_md"
            multiline
            rows={4}
            mono
            value={expected}
            onChange={(e) => setExpected(e.currentTarget.value)}
          />
          <ReferenceCriteriaEditor value={criteria} onChange={setCriteria} />
          <FormField
            label="sort_order"
            type="number"
            value={sort}
            onChange={(e) => setSort(e.currentTarget.value)}
          />
          {err && <div className="text-[12px] text-danger">{err}</div>}
          <div className="flex justify-end">
            <Button size="sm" onClick={save} loading={update.isPending}>Сохранить</Button>
          </div>
        </div>
      )}
    </li>
  )
}

// ── company-specific overlay ─────────────────────────────────────────────

function CompanyQuestionsSection() {
  const companies = useCompaniesQuery()
  const [companyId, setCompanyId] = useState<string>('')
  const [stageFilter, setStageFilter] = useState<StageKind | undefined>(undefined)
  const list = useCompanyQuestionsQuery(companyId || null, stageFilter)
  const create = useCreateCompanyQuestionMutation()
  const [newStage, setNewStage] = useState<StageKind>('hr')
  const [newBody, setNewBody] = useState('')
  const [newExpected, setNewExpected] = useState('')
  const [err, setErr] = useState<string | null>(null)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    if (!newBody.trim() || !companyId) return
    try {
      await create.mutateAsync({
        companyId,
        body: {
          stage_kind: newStage,
          body: newBody.trim(),
          expected_answer_md: newExpected.trim() || undefined,
        },
      })
      setNewBody('')
      setNewExpected('')
    } catch (e) {
      setErr(mockAdminErrorMessage(e))
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface-1 p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-sm font-bold text-text-primary">
            Company-overlay вопросы
          </h2>
          <p className="mt-1 font-mono text-[11px] text-text-muted">
            Накладываются поверх дефолтов для конкретной компании.
          </p>
        </div>
        <label className="flex items-center gap-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-muted">company</span>
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="rounded-md border border-border bg-bg/40 px-2 py-1.5 text-[13px] text-text-primary"
          >
            <option value="">— выбери —</option>
            {(companies.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      </header>

      {!companyId ? (
        <div className="rounded-md border border-dashed border-border bg-surface-2 px-3 py-5 text-center font-mono text-[11px] text-text-muted">
          Выбери компанию выше — увидишь её overlay вопросы.
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            <FilterChip on={stageFilter === undefined} onClick={() => setStageFilter(undefined)}>all</FilterChip>
            {STAGE_KINDS.map((s) => (
              <FilterChip key={s} on={stageFilter === s} onClick={() => setStageFilter(s)}>{s}</FilterChip>
            ))}
          </div>
          {list.isPending ? (
            <PanelSkeleton rows={3} />
          ) : list.error ? (
            <ErrorBox message={mockAdminErrorMessage(list.error)} />
          ) : (list.data ?? []).length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-surface-2 px-3 py-4 text-center font-mono text-[11px] text-text-muted">
              Нет company-specific вопросов.
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {(list.data ?? [])
                .slice()
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((q) => (
                  <CompanyQuestionRow key={q.id} q={q} />
                ))}
            </ul>
          )}

          <form
            onSubmit={add}
            className="mt-4 flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">
              + добавить company-specific вопрос
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="flex flex-col gap-1 sm:w-44">
                <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-muted">stage</span>
                <select
                  value={newStage}
                  onChange={(e) => setNewStage(e.target.value as StageKind)}
                  className="rounded-md border border-border bg-bg/40 px-2 py-1.5 text-[13px] text-text-primary"
                >
                  {STAGE_KINDS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <div className="flex-1">
                <FormField label="body — текст вопроса" value={newBody} onChange={(e) => setNewBody(e.currentTarget.value)} />
              </div>
            </div>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-muted">
                expected_answer_md — образец ответа (для AI-судьи)
              </span>
              <textarea
                value={newExpected}
                onChange={(e) => setNewExpected(e.target.value)}
                rows={3}
                placeholder="Краткий «как правильно» — судья сравнивает с ним. Можно оставить пустым."
                className="rounded-md border border-border bg-bg/40 px-2 py-1.5 font-mono text-[12px] text-text-primary"
              />
            </label>
            {err && <div className="text-[12px] text-danger">{err}</div>}
            <div className="flex justify-end">
              <Button type="submit" size="sm" loading={create.isPending}>Добавить</Button>
            </div>
          </form>
        </>
      )}
    </section>
  )
}

function CompanyQuestionRow({ q }: { q: CompanyQuestion }) {
  const update = useUpdateCompanyQuestionMutation()
  const del = useDeleteCompanyQuestionMutation()
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState(q.body)
  const [expected, setExpected] = useState(q.expected_answer_md ?? '')
  const [criteria, setCriteria] = useState<ReferenceCriteria>(q.reference_criteria ?? {})
  const [sort, setSort] = useState(String(q.sort_order))
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setErr(null)
    try {
      await update.mutateAsync({
        id: q.id,
        body: {
          body: body.trim(),
          expected_answer_md: expected,
          reference_criteria: criteria,
          sort_order: Number(sort) || 0,
        },
      })
      setOpen(false)
    } catch (e) {
      setErr(mockAdminErrorMessage(e))
    }
  }

  return (
    <li
      className="rounded-md border border-border bg-surface-2 p-3"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) setOpen(false)
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[12px] text-text-primary">{q.body}</div>
          <div className="mt-0.5 font-mono text-[9px] text-text-muted">
            {q.stage_kind} · sort={q.sort_order}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="rounded border border-border px-2 py-0.5 font-mono text-[10px] text-text-secondary"
          >
            {open ? '−' : 'edit'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm('Удалить?')) del.mutate(q.id)
            }}
            className="rounded border border-danger/40 px-2 py-0.5 font-mono text-[10px] text-danger"
          >
            ✕
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-3 flex flex-col gap-2">
          <FormField label="body" value={body} onChange={(e) => setBody(e.currentTarget.value)} />
          <FormField
            label="expected_answer_md"
            multiline
            rows={4}
            mono
            value={expected}
            onChange={(e) => setExpected(e.currentTarget.value)}
          />
          <ReferenceCriteriaEditor value={criteria} onChange={setCriteria} />
          <FormField
            label="sort_order"
            type="number"
            value={sort}
            onChange={(e) => setSort(e.currentTarget.value)}
          />
          {err && <div className="text-[12px] text-danger">{err}</div>}
          <div className="flex justify-end">
            <Button size="sm" onClick={save} loading={update.isPending}>Сохранить</Button>
          </div>
        </div>
      )}
    </li>
  )
}

function FilterChip({
  on,
  onClick,
  children,
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${
        on
          ? 'border-text-primary bg-text-primary/10 text-text-primary'
          : 'border-border text-text-secondary'
      }`}
    >
      {children}
    </button>
  )
}
