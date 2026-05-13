// StageDrawer — side-panel editor for one stage in the company pipeline.
//
// R7 Phase 1 — click a pipeline box → drawer slides in from the right
// with the per-stage config (kind / strictness profile / optional flag /
// pool-limits for HR-behavioral / language pool for coding). Reuses
// the existing PUT-stages mutation under the hood via
// useUpdateStageMutation в adminCompanyPipeline.
//
// Preview-as-mock button is intentionally deferred to Phase 2 — UI
// shows a disabled hint так чтобы curator знал куда это поедет.
//
// B/W only. Inputs follow existing admin form pattern.

import { useEffect, useState } from 'react'
import { Button } from '../../../components/Button'
import { Drawer } from '../../../components/primitives/Drawer'
import {
  type CompanyStageConfig,
  type StageKind,
  type TaskLanguage,
  mockAdminErrorMessage,
  useStrictnessQuery,
} from '../../../lib/queries/mockAdmin'
import { useUpdateStageMutation } from '../../../lib/queries/adminCompanyPipeline'

const STAGE_KINDS: StageKind[] = [
  'hr',
  'algo',
  'coding',
  'sysdesign',
  'behavioral',
  'ml_coding',
  'ml_system_design',
  'ml_theory',
]
const LANGS: TaskLanguage[] = ['go', 'python', 'sql', 'any']

type Props = {
  companyId: string
  stage: CompanyStageConfig
  allStages: CompanyStageConfig[]
  onClose: () => void
}

export function StageDrawer({ companyId, stage, allStages, onClose }: Props) {
  const update = useUpdateStageMutation()
  const strictness = useStrictnessQuery()
  const [draft, setDraft] = useState<CompanyStageConfig>(stage)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setDraft(stage)
    setErr(null)
  }, [stage])

  const profileOptions = strictness.data ?? []
  const dirty =
    draft.optional !== stage.optional ||
    draft.ai_strictness_profile_id !== stage.ai_strictness_profile_id ||
    draft.stage_kind !== stage.stage_kind ||
    draft.default_question_limit !== stage.default_question_limit ||
    draft.company_question_limit !== stage.company_question_limit ||
    languagesDiffer(draft.language_pool, stage.language_pool)

  const save = async () => {
    setErr(null)
    try {
      await update.mutateAsync({
        companyId,
        current: allStages,
        stageKind: stage.stage_kind,
        patch: draft,
      })
      onClose()
    } catch (e) {
      setErr(mockAdminErrorMessage(e))
    }
  }

  return (
    <Drawer open onClose={onClose} side="right" size="md" ariaLabel={`Этап #${stage.ordinal + 1}`}>
      <header className="flex items-start justify-between border-b border-[var(--hair)] px-5 py-4">
        <div>
          <h2 className="font-display text-base font-bold text-text-primary">
            Этап #{stage.ordinal + 1}
          </h2>
          <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
            {stage.stage_kind}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-[var(--hair-2)] bg-transparent px-2 py-0.5 font-mono text-[11px] text-text-muted hover:text-text-primary transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)]"
        >
          esc
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
              Тип этапа
            </span>
            <select
              value={draft.stage_kind}
              onChange={(e) =>
                setDraft({ ...draft, stage_kind: e.target.value as StageKind })
              }
              className="rounded-md border border-border bg-surface-1 px-2.5 py-1.5 text-[13px] text-text-primary"
            >
              {STAGE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
              Профиль строгости AI
            </span>
            <select
              value={draft.ai_strictness_profile_id ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  ai_strictness_profile_id: e.target.value || null,
                })
              }
              className="rounded-md border border-border bg-surface-1 px-2.5 py-1.5 text-[13px] text-text-primary"
            >
              <option value="">— дефолт —</option>
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
              checked={draft.optional}
              onChange={(e) => setDraft({ ...draft, optional: e.target.checked })}
              style={{ accentColor: 'rgb(var(--ink))' }}
            />
            <span className="font-mono text-[12px] text-text-secondary">
              этап опциональный (кандидат может пропустить)
            </span>
          </label>

          {draft.stage_kind === 'coding' && (
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                Языки в пуле
              </span>
              <div className="flex flex-wrap gap-1.5">
                {LANGS.map((l) => {
                  const on = draft.language_pool.includes(l)
                  return (
                    <button
                      key={l}
                      type="button"
                      onClick={() => {
                        setDraft({
                          ...draft,
                          language_pool: on
                            ? draft.language_pool.filter((x) => x !== l)
                            : [...draft.language_pool, l],
                        })
                      }}
                      aria-pressed={on}
                      className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] transition-[color,background,border-color] duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] ${
                        on
                          ? 'border-text-primary bg-text-primary text-bg'
                          : 'border-border text-text-secondary hover:border-border-strong'
                      }`}
                    >
                      {l}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {(draft.stage_kind === 'hr' || draft.stage_kind === 'behavioral') && (
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                Лимиты вопросов
              </span>
              <div className="grid grid-cols-2 gap-2">
                <PoolLimit
                  label="default"
                  value={draft.default_question_limit ?? null}
                  onChange={(v) => setDraft({ ...draft, default_question_limit: v })}
                />
                <PoolLimit
                  label="company"
                  value={draft.company_question_limit ?? null}
                  onChange={(v) => setDraft({ ...draft, company_question_limit: v })}
                />
              </div>
              <p className="font-mono text-[10px] text-text-muted">
                пусто = все · 0 = пропустить · N = случайных N
              </p>
            </div>
          )}

          {/* Associated tasks / questions live in the existing
              MockTasksPanel + Вопросы tabs — drawer links there
              rather than dupes the listings. */}
          <div className="rounded-md border border-dashed border-[var(--hair-2)] bg-transparent px-3 py-3 font-mono text-[11px] text-text-muted">
            Задачи / вопросы редактируются на табах «Задачи» и «Вопросы».
            Этот drawer управляет stage-level настройками.
          </div>

          <div className="rounded-md border border-dashed border-[var(--hair-2)] bg-transparent px-3 py-3">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
              Preview as mock
            </div>
            <p className="font-mono text-[11px] text-text-muted">
              Доступно в Phase 2. Здесь будет read-only превью того, что увидит
              кандидат на этом этапе.
            </p>
            <Button size="sm" variant="ghost" disabled className="mt-2">
              Preview (soon)
            </Button>
          </div>

          {err && (
            <p
              role="alert"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '8px 12px',
                border: '1px solid rgba(255, 59, 48, 0.4)',
                borderRadius: 'var(--radius-inner)',
                fontSize: 12,
                color: 'var(--red)',
                background: 'transparent',
                margin: 0,
              }}
            >
              <span aria-hidden="true" style={{ display: 'inline-block', width: 1.5, minHeight: 16, background: 'var(--red)', marginTop: 4, flex: '0 0 auto' }} />
              {err}
            </p>
          )}
        </div>
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-[var(--hair)] px-5 py-3">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Отмена
        </Button>
        <Button size="sm" loading={update.isPending} disabled={!dirty} onClick={save}>
          Сохранить
        </Button>
      </footer>
    </Drawer>
  )
}

function languagesDiffer(a: TaskLanguage[], b: TaskLanguage[]): boolean {
  if (a.length !== b.length) return true
  const sa = [...a].sort().join(',')
  const sb = [...b].sort().join(',')
  return sa !== sb
}

function PoolLimit({
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
      <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-text-muted">
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
        className="border-0 border-b border-[var(--hair-2)] bg-transparent rounded-none px-0 py-2 font-mono text-[12px] text-text-primary focus:border-[rgb(var(--ink))] focus:border-b-[1.5px] focus:outline-none transition-[border-color] duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)]"
      />
    </label>
  )
}
