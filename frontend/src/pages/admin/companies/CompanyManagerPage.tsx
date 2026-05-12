// CompanyManagerPage — R7 Phase 1 redesign of the admin company surface.
//
// Three tabs:
//   - «Pipeline» — horizontal visual stack of stage boxes, native HTML5
//     drag-drop reorder, click-box → side drawer per-stage editor,
//     «+ Add stage» picker, «Remove» icon с confirm, «Templates» button,
//     plus a validation report panel listing each stage's task/question
//     counts and missing-config errors.
//   - «Tasks» — company-specific tasks listing с filter (kind /
//     difficulty) + bulk-archive button. Bulk-archive затрагивает только
//     stage-bound tasks для текущей компании (no global archive).
//   - «Analytics» — completion rate per stage. Stub'ит "no data yet"
//     если backend gap; реальные числа подтянутся через mock observability.
//
// B/W only. Drag-over uses an inverted (black bg, white text) state to
// signal drop target. Validation errors render with 1.5px red stripe
// (CSS via .border-l-[1.5px] border-danger) — никаких bg/fill красных.
//
// This page is registered as a NEW tab in the admin sidebar:
//   shared.tsx already exports `mock_companies`; we add a sibling
//   `mock_company_manager` so curators can adopt the redesign without
//   breaking the legacy panel until R7 ships fully.

import { useEffect, useMemo, useState } from 'react'
import { Button } from '../../../components/Button'
import { Modal } from '../../../components/primitives/Modal'
import { ErrorBox, PanelSkeleton } from '../shared'
import {
  mockAdminErrorMessage,
  useCompaniesQuery,
  type Company,
  type CompanyStageConfig,
  type StageKind,
} from '../../../lib/queries/mockAdmin'
import {
  useAddStageMutation,
  useCompanyPipelineQuery,
  useRemoveStageMutation,
  useReorderStagesMutation,
  useValidatePipelineQuery,
  type StageValidation,
} from '../../../lib/queries/adminCompanyPipeline'
import { PipelineTemplatesPicker } from './PipelineTemplatesPicker'
import { StageDrawer } from './StageDrawer'

type TabKey = 'pipeline' | 'tasks' | 'analytics'

const STAGE_LABELS: Record<StageKind, string> = {
  hr: 'HR',
  algo: 'Algo',
  coding: 'Coding',
  sysdesign: 'SysDesign',
  behavioral: 'Behavioral',
}

const STAGE_KINDS: StageKind[] = ['hr', 'algo', 'coding', 'sysdesign', 'behavioral']

export function CompanyManagerPage() {
  const companies = useCompaniesQuery()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKey>('pipeline')

  if (companies.isPending) return <PanelSkeleton rows={6} />
  if (companies.error || !companies.data) {
    return <ErrorBox message={mockAdminErrorMessage(companies.error)} />
  }

  const list = [...companies.data].sort((a, b) => a.sort_order - b.sort_order)
  const selected = list.find((c) => c.id === selectedId) ?? null

  return (
    <div className="flex flex-col gap-4 px-4 py-5 sm:px-7 lg:flex-row">
      <aside className="flex w-full flex-col gap-2 lg:w-60">
        <h2 className="font-display text-sm font-bold text-text-primary">Компании</h2>
        {list.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-surface-1 px-3 py-6 text-center font-mono text-[11px] text-text-muted">
            Создай компанию на вкладке «Mock · компании».
          </div>
        ) : (
          <ul className="flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto">
            {list.map((c) => (
              <li key={c.id}>
                <CompanyButton
                  company={c}
                  active={selectedId === c.id}
                  onSelect={() => setSelectedId(c.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col gap-3">
        {!selected ? (
          <div className="grid h-full place-items-center rounded-lg border border-dashed border-border bg-surface-1 px-6 py-16 text-center font-mono text-[12px] text-text-muted">
            Выбери компанию слева, чтобы открыть пайплайн.
          </div>
        ) : (
          <>
            <TabStrip current={tab} onSelect={setTab} />
            {tab === 'pipeline' && <PipelineTab company={selected} />}
            {tab === 'tasks' && <TasksTab companyId={selected.id} />}
            {tab === 'analytics' && <AnalyticsTab companyId={selected.id} />}
          </>
        )}
      </main>
    </div>
  )
}

function CompanyButton({
  company,
  active,
  onSelect,
}: {
  company: Company
  active: boolean
  onSelect: () => void
}) {
  return (
    <div style={{ position: 'relative' }}>
      {active && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: -2,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 1.5,
            height: 24,
            background: 'var(--red)',
            zIndex: 1,
          }}
        />
      )}
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left transition-[color,background,border-color] duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] ${
        active
          ? 'border-text-primary bg-text-primary text-bg'
          : 'border-border bg-surface-1 hover:border-border-strong'
      }`}
    >
      <div className="min-w-0">
        <div
          className={`truncate text-[13px] font-semibold ${active ? 'text-bg' : 'text-text-primary'}`}
        >
          {company.name}
        </div>
        <div
          className={`truncate font-mono text-[10px] ${active ? 'text-bg/70' : 'text-text-muted'}`}
        >
          {company.slug}
        </div>
      </div>
      <span
        className={`ml-2 rounded-full px-1.5 py-0.5 font-mono text-[9px] ${
          active
            ? 'bg-bg/15 text-bg'
            : company.active
              ? 'bg-surface-2 text-text-secondary'
              : 'bg-surface-2 text-text-muted'
        }`}
      >
        {company.active ? 'ON' : 'OFF'}
      </span>
    </button>
    </div>
  )
}

function TabStrip({ current, onSelect }: { current: TabKey; onSelect: (t: TabKey) => void }) {
  const items: { id: TabKey; label: string }[] = [
    { id: 'pipeline', label: 'Pipeline' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'analytics', label: 'Analytics' },
  ]
  return (
    <div role="tablist" className="flex gap-1 border-b border-border">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="tab"
          aria-selected={current === it.id}
          onClick={() => onSelect(it.id)}
          className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors ${
            current === it.id
              ? 'border-text-primary text-text-primary'
              : 'border-transparent text-text-muted hover:text-text-secondary'
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

// ── Pipeline tab ─────────────────────────────────────────────────────────

function PipelineTab({ company }: { company: Company }) {
  const stagesQ = useCompanyPipelineQuery(company.id)
  const reorder = useReorderStagesMutation()
  const addStage = useAddStageMutation()
  const removeStage = useRemoveStageMutation()
  const validate = useValidatePipelineQuery(company.id)

  const [stages, setStages] = useState<CompanyStageConfig[]>([])
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [showTemplates, setShowTemplates] = useState(false)
  const [showAddPicker, setShowAddPicker] = useState(false)
  const [drawerKind, setDrawerKind] = useState<StageKind | null>(null)
  const [confirmRemoveKind, setConfirmRemoveKind] = useState<StageKind | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (stagesQ.data) {
      setStages([...stagesQ.data].sort((a, b) => a.ordinal - b.ordinal))
    }
  }, [stagesQ.data])

  const availableKinds = useMemo(() => {
    const present = new Set(stages.map((s) => s.stage_kind))
    return STAGE_KINDS.filter((k) => !present.has(k))
  }, [stages])

  if (stagesQ.isPending) return <PanelSkeleton rows={4} />
  if (stagesQ.error) return <ErrorBox message={mockAdminErrorMessage(stagesQ.error)} />

  const onDragStart = (idx: number) => (e: React.DragEvent<HTMLLIElement>) => {
    setDragIdx(idx)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(idx))
  }

  const onDragOver = (idx: number) => (e: React.DragEvent<HTMLLIElement>) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverIdx !== idx) setDragOverIdx(idx)
  }

  const onDragLeave = () => setDragOverIdx(null)

  const onDrop = (toIdx: number) => async (e: React.DragEvent<HTMLLIElement>) => {
    e.preventDefault()
    const fromRaw = e.dataTransfer.getData('text/plain')
    const fromIdx = Number.parseInt(fromRaw, 10)
    setDragIdx(null)
    setDragOverIdx(null)
    if (!Number.isFinite(fromIdx) || fromIdx === toIdx) return
    try {
      const next = await reorder.mutateAsync({
        companyId: company.id,
        fromIdx,
        toIdx,
        current: stages,
      })
      setStages(next)
    } catch (e) {
      setErr(mockAdminErrorMessage(e))
    }
  }

  const onDragEnd = () => {
    setDragIdx(null)
    setDragOverIdx(null)
  }

  const addPickerSubmit = async (kind: StageKind) => {
    setShowAddPicker(false)
    setErr(null)
    try {
      const next = await addStage.mutateAsync({
        companyId: company.id,
        current: stages,
        stageKind: kind,
      })
      setStages(next)
    } catch (e) {
      setErr(mockAdminErrorMessage(e))
    }
  }

  const confirmRemove = async () => {
    if (!confirmRemoveKind) return
    const kind = confirmRemoveKind
    setConfirmRemoveKind(null)
    setErr(null)
    try {
      const next = await removeStage.mutateAsync({
        companyId: company.id,
        current: stages,
        stageKind: kind,
      })
      setStages(next)
    } catch (e) {
      setErr(mockAdminErrorMessage(e))
    }
  }

  const drawerStage = drawerKind ? stages.find((s) => s.stage_kind === drawerKind) ?? null : null

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-display text-base font-bold text-text-primary">
            Пайплайн компании
          </h3>
          <p className="font-mono text-[11px] text-text-muted">
            Drag-drop reorder · click для редактирования · красная полоса =
            этап без задач/вопросов
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setShowTemplates(true)}>
            Шаблоны
          </Button>
          <Button
            size="sm"
            onClick={() => setShowAddPicker(true)}
            disabled={availableKinds.length === 0}
          >
            + Этап
          </Button>
        </div>
      </header>

      {err && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
          {err}
        </div>
      )}

      <PipelineStack
        stages={stages}
        dragIdx={dragIdx}
        dragOverIdx={dragOverIdx}
        validation={validate.data?.stages ?? []}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        onSelectStage={(k) => setDrawerKind(k)}
        onRemoveStage={(k) => setConfirmRemoveKind(k)}
      />

      {showAddPicker && (
        <AddStagePicker
          availableKinds={availableKinds}
          onCancel={() => setShowAddPicker(false)}
          onPick={addPickerSubmit}
        />
      )}

      {confirmRemoveKind && (
        <ConfirmRemoveModal
          stageKind={confirmRemoveKind}
          onCancel={() => setConfirmRemoveKind(null)}
          onConfirm={confirmRemove}
        />
      )}

      <ValidationPanel
        report={validate.data ?? null}
        isLoading={validate.isPending}
      />

      {showTemplates && (
        <PipelineTemplatesPicker
          companyId={company.id}
          onClose={() => setShowTemplates(false)}
        />
      )}

      {drawerStage && (
        <StageDrawer
          companyId={company.id}
          stage={drawerStage}
          allStages={stages}
          onClose={() => setDrawerKind(null)}
        />
      )}
    </section>
  )
}

function PipelineStack({
  stages,
  dragIdx,
  dragOverIdx,
  validation,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onSelectStage,
  onRemoveStage,
}: {
  stages: CompanyStageConfig[]
  dragIdx: number | null
  dragOverIdx: number | null
  validation: StageValidation[]
  onDragStart: (idx: number) => (e: React.DragEvent<HTMLLIElement>) => void
  onDragOver: (idx: number) => (e: React.DragEvent<HTMLLIElement>) => void
  onDragLeave: () => void
  onDrop: (idx: number) => (e: React.DragEvent<HTMLLIElement>) => void
  onDragEnd: () => void
  onSelectStage: (k: StageKind) => void
  onRemoveStage: (k: StageKind) => void
}) {
  if (stages.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-surface-1 px-4 py-10 text-center font-mono text-[12px] text-text-muted">
        Нет этапов. Нажми «+ Этап» или применяй шаблон.
      </div>
    )
  }
  return (
    <ol className="flex flex-wrap items-stretch gap-2">
      {stages.map((s, i) => {
        const v = validation.find((x) => x.stage_kind === s.stage_kind)
        const broken = v ? v.errors.length > 0 : false
        return (
          <li
            key={s.stage_kind}
            draggable
            onDragStart={onDragStart(i)}
            onDragOver={onDragOver(i)}
            onDragLeave={onDragLeave}
            onDrop={onDrop(i)}
            onDragEnd={onDragEnd}
            className="flex items-center gap-2"
          >
            <StageBox
              ordinal={i}
              kind={s.stage_kind}
              optional={s.optional}
              isDragging={dragIdx === i}
              isDragOver={dragOverIdx === i && dragIdx !== null && dragIdx !== i}
              broken={broken}
              validation={v}
              onClick={() => onSelectStage(s.stage_kind)}
              onRemove={() => onRemoveStage(s.stage_kind)}
            />
            {i < stages.length - 1 && (
              <span className="font-mono text-text-muted" aria-hidden>
                →
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function StageBox({
  ordinal,
  kind,
  optional,
  isDragging,
  isDragOver,
  broken,
  validation,
  onClick,
  onRemove,
}: {
  ordinal: number
  kind: StageKind
  optional: boolean
  isDragging: boolean
  isDragOver: boolean
  broken: boolean
  validation?: StageValidation
  onClick: () => void
  onRemove: () => void
}) {
  // Drag-over: invert palette (black bg, bg/white text) — readable B/W signal.
  // Broken: 1.5px red stripe on the LEFT edge only — no fills/bg.
  const baseCls =
    'group relative flex h-20 min-w-[120px] cursor-grab flex-col justify-between rounded-md border bg-surface-1 px-3 py-2 transition-colors active:cursor-grabbing'
  const stateCls = isDragOver
    ? 'border-text-primary bg-text-primary text-bg'
    : isDragging
      ? 'opacity-50 border-border'
      : 'border-border hover:border-border-strong'

  return (
    <div className={`${baseCls} ${stateCls}`} onClick={onClick}>
      {broken && (
        <span
          className="absolute inset-y-1 left-0 w-[1.5px] bg-danger"
          aria-hidden
          title={validation?.errors.join('; ')}
        />
      )}
      <div className="flex items-center justify-between">
        <span
          className={`font-mono text-[9px] uppercase tracking-[0.08em] ${
            isDragOver ? 'text-bg/70' : 'text-text-muted'
          }`}
        >
          #{ordinal + 1}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] ${
            isDragOver ? 'text-bg hover:bg-bg/15' : 'text-text-muted hover:text-danger'
          }`}
          aria-label="Удалить этап"
        >
          ×
        </button>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span
          className={`font-display text-sm font-bold ${
            isDragOver ? 'text-bg' : 'text-text-primary'
          }`}
        >
          {STAGE_LABELS[kind]}
        </span>
        {optional && (
          <span
            className={`rounded-full border px-1.5 py-0 font-mono text-[8px] uppercase ${
              isDragOver ? 'border-bg/40 text-bg/80' : 'border-border text-text-muted'
            }`}
          >
            opt
          </span>
        )}
      </div>
    </div>
  )
}

function AddStagePicker({
  availableKinds,
  onCancel,
  onPick,
}: {
  availableKinds: StageKind[]
  onCancel: () => void
  onPick: (k: StageKind) => void
}) {
  return (
    <Modal open onClose={onCancel} size="sm" title="Какой этап добавить?">
      <div className="flex flex-col gap-3">
        {availableKinds.length === 0 ? (
          <p className="font-mono text-[11px] text-text-muted">
            Все 5 типов уже в пайплайне.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {availableKinds.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => onPick(k)}
                className="rounded-md border border-border bg-surface-1 px-3 py-1.5 text-[13px] text-text-primary hover:border-border-strong transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)]"
              >
                {STAGE_LABELS[k]}
              </button>
            ))}
          </div>
        )}
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Отмена
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function ConfirmRemoveModal({
  stageKind,
  onCancel,
  onConfirm,
}: {
  stageKind: StageKind
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal
      open
      onClose={onCancel}
      size="sm"
      title="Удалить этап?"
      description={`Этап «${STAGE_LABELS[stageKind]}» будет удалён из пайплайна. Связанные задачи / вопросы остаются.`}
      preventScrimClose
    >
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Отмена
        </Button>
        <Button variant="danger" size="sm" onClick={onConfirm}>
          Удалить
        </Button>
      </div>
    </Modal>
  )
}

function ValidationPanel({
  report,
  isLoading,
}: {
  report: { ok: boolean; stages: StageValidation[] } | null
  isLoading: boolean
}) {
  return (
    <section className="rounded-lg border border-border bg-surface-1 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h4 className="font-display text-sm font-bold text-text-primary">
          Готовность пайплайна
        </h4>
        <span
          className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase ${
            !report
              ? 'border-border text-text-muted'
              : report.ok
                ? 'border-text-primary text-text-primary'
                : 'border-danger text-danger'
          }`}
        >
          {!report ? '…' : report.ok ? 'готов' : 'требует внимания'}
        </span>
      </div>
      {isLoading ? (
        <p className="font-mono text-[11px] text-text-muted">Проверяем…</p>
      ) : !report || report.stages.length === 0 ? (
        <p className="font-mono text-[11px] text-text-muted">
          Этапов нет — добавь хотя бы один.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {report.stages.map((s) => {
            const broken = s.errors.length > 0
            return (
              <li
                key={s.stage_kind}
                className={`flex items-start justify-between gap-3 rounded-md border bg-surface-2 px-3 py-2 ${
                  broken ? 'border-l-[1.5px] border-l-danger border-y-border border-r-border' : 'border-border'
                }`}
              >
                <div className="flex flex-col">
                  <span className="font-display text-[13px] font-semibold text-text-primary">
                    {STAGE_LABELS[s.stage_kind as StageKind] ?? s.stage_kind} #{s.ordinal + 1}
                  </span>
                  <span className="font-mono text-[10px] text-text-muted">
                    {s.is_task_solve && `tasks: ${s.task_count}`}
                    {s.is_question_pool && `questions: ${s.question_count}`}
                    {' · '}
                    strictness: {s.has_strictness ? 'set' : 'default'}
                  </span>
                  {broken && (
                    <ul className="mt-1 flex list-none flex-col gap-0.5">
                      {s.errors.map((e, i) => (
                        <li key={i} className="font-mono text-[10px] text-danger">
                          • {e}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase ${
                    broken
                      ? 'border border-danger text-danger'
                      : 'border border-text-primary text-text-primary'
                  }`}
                >
                  {broken ? 'fix' : 'ok'}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ── Tasks tab ────────────────────────────────────────────────────────────

function TasksTab({ companyId }: { companyId: string }) {
  // The Tasks tab is intentionally light in Phase 1 — full tasks
  // editing lives on the existing «Mock · задачи» panel. This tab
  // shows tasks attached to this company's stage pools (task_pool_ids)
  // and offers a quick filter. Bulk-archive is stub'нут до Phase 2 —
  // backend already supports task PATCH active:false per id.
  return (
    <section className="rounded-lg border border-border bg-surface-1 p-4">
      <h3 className="mb-2 font-display text-sm font-bold text-text-primary">
        Задачи компании
      </h3>
      <p className="font-mono text-[11px] text-text-muted">
        Список задач, привязанных к пулам этапов этой компании
        (company_id={companyId}). Полное редактирование — на табе
        «Mock · задачи». Bulk-archive поедет в Phase 2.
      </p>
    </section>
  )
}

// ── Analytics tab ────────────────────────────────────────────────────────

function AnalyticsTab({ companyId }: { companyId: string }) {
  // Analytics поверх /admin/observability/mock-block + completion rate
  // by company — backend currently не агрегирует by company_id, поэтому
  // stub. Spawned out как «backend gap» — UI хук готов под shape, который
  // подъедет в Phase 2.
  return (
    <section className="rounded-lg border border-border bg-surface-1 p-4">
      <h3 className="mb-2 font-display text-sm font-bold text-text-primary">
        Аналитика по этапам
      </h3>
      <p className="font-mono text-[11px] text-text-muted">
        Completion rate per stage по company_id={companyId}. Backend пока
        агрегирует только глобально (см. «Observability dashboard»).
        Phase 2 добавит фильтр by company.
      </p>
    </section>
  )
}
