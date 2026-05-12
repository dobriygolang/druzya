// CopilotPlansPanel — admin UI для редактирования copilot subscription
// тарифов. Backend хранит весь document как JSON value в dynamic_config
// под ключом 'copilot_plans' (services/copilot/infra/config.go).
//
// Структура карточки совпадает с CopilotPlanConfig (Go struct):
//   - id          : free | pro | max (read-only, фиксирован)
//   - display_name: строка (видна в /pricing UI)
//   - price_label : "Бесплатно" / "499 ₽/мес" / ...
//   - tagline     : короткий слоган
//   - bullets[]   : буллеты для pricing-страницы
//   - cta_label   : текст CTA-кнопки
//   - subscribe_url: ссылка на оплату (Boosty/etc)
//   - requests_cap: лимит copilot-запросов /день; -1 = unlimited
//   - models_allowed[]: whitelist virtual chains; пустой = no restriction
//
// Save шлёт ВЕСЬ document одним PUT — backend хранит его как один JSON
// value. PolicyResolver TTL-cache на бэкенде ~5 мин; UI пишет, на проде
// эффект через 5 минут максимум.
import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '../../components/Button'
import { ErrorBox, PanelSkeleton } from './shared'
import {
  useCopilotPlansQuery,
  useUpdateCopilotPlansMutation,
  COPILOT_PLAN_DEFAULTS,
  type CopilotPlanConfig,
  type CopilotPlansConfig,
  type PlanTier,
} from '../../lib/queries/adminCopilotPlans'

const TIER_ORDER: PlanTier[] = ['free', 'pro', 'max']

// Известные virtual-chain IDs для подсказки в models_allowed.
const KNOWN_VIRTUAL_CHAINS = ['druz9/turbo', 'druz9/pro', 'druz9/ultra', 'druz9/reasoning']

export function CopilotPlansPanel() {
  const q = useCopilotPlansQuery()
  const save = useUpdateCopilotPlansMutation()

  const [draft, setDraft] = useState<CopilotPlansConfig | null>(null)

  useEffect(() => {
    if (q.data) setDraft(structuredClone(q.data))
  }, [q.data])

  if (q.isPending) return <PanelSkeleton rows={6} />
  if (q.isError) return <ErrorBox message={(q.error as Error).message} />
  if (!draft) return null

  const dirty = JSON.stringify(draft) !== JSON.stringify(q.data)

  function updatePlan(tier: PlanTier, next: CopilotPlanConfig) {
    setDraft((prev) => {
      if (!prev) return prev
      return { ...prev, plans: { ...prev.plans, [tier]: next } }
    })
  }

  async function handleSave() {
    if (!draft) return
    try {
      await save.mutateAsync(draft)
    } catch {
      /* mutation surfaces error in save.error */
    }
  }

  function handleReset() {
    if (q.data) setDraft(structuredClone(q.data))
  }

  function handleResetDefaults() {
    if (!confirm('Сбросить ВСЕ тарифы на хардкод-дефолты? Текущие правки потеряются.')) return
    setDraft(structuredClone(COPILOT_PLAN_DEFAULTS))
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-5 sm:px-7">
      <header className="flex flex-col gap-2 rounded-lg border border-border bg-surface-1 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-sm font-bold text-text-primary">Copilot · тарифные планы</h2>
          <p className="mt-1 font-mono text-[11px] text-text-muted">
            Редактируется здесь, читается через PlanForTier(dynamic_config[copilot_plans]).
            Эффект на бэке ≤5 мин (PolicyResolver cache).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={handleResetDefaults} disabled={save.isPending}>
            Дефолты
          </Button>
          <Button size="sm" variant="ghost" onClick={handleReset} disabled={!dirty || save.isPending}>
            Сбросить правки
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!dirty || save.isPending}>
            {save.isPending ? 'Сохраняю…' : 'Сохранить'}
          </Button>
        </div>
      </header>

      {save.isError && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          Не удалось сохранить: {(save.error as Error).message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {TIER_ORDER.map((tier) => (
          <PlanCard
            key={tier}
            tier={tier}
            plan={draft.plans[tier] ?? COPILOT_PLAN_DEFAULTS.plans[tier]}
            onChange={(p) => updatePlan(tier, p)}
          />
        ))}
      </div>

      {/* Doc model id (default) — отдельным блоком, потому что это
          property не плана а корневая. */}
      <section className="rounded-lg border border-border bg-surface-1 p-4">
        <h3 className="mb-3 font-display text-sm font-bold text-text-primary">Default model</h3>
        <p className="mb-2 font-mono text-[11px] text-text-muted">
          Если pinned-model в conversation отсутствует или недоступна tier'у —
          fallback на эту virtual-chain.
        </p>
        <input
          value={draft.default_model_id}
          onChange={(e) =>
            setDraft((prev) => (prev ? { ...prev, default_model_id: e.target.value } : prev))
          }
          list="known-virtual-chains"
          placeholder="druz9/turbo"
          className="w-full max-w-md border-0 border-b border-[var(--hair-2)] bg-transparent rounded-none px-0 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted/50 focus:border-[rgb(var(--ink))] focus:border-b-[1.5px] focus:outline-none transition-[border-color] duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)]"
        />
        <datalist id="known-virtual-chains">
          {KNOWN_VIRTUAL_CHAINS.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      </section>
    </div>
  )
}

// ── PlanCard ──────────────────────────────────────────────────────────

function PlanCard({
  tier,
  plan,
  onChange,
}: {
  tier: PlanTier
  plan: CopilotPlanConfig
  onChange: (next: CopilotPlanConfig) => void
}) {
  function set<K extends keyof CopilotPlanConfig>(key: K, value: CopilotPlanConfig[K]) {
    onChange({ ...plan, [key]: value })
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface-1 p-4">
      <header className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">{tier}</span>
        {plan.requests_cap === -1 && (
          <span className="rounded bg-success/15 px-2 py-0.5 font-mono text-[10px] text-success">∞</span>
        )}
      </header>

      <Field label="Display name">
        <input
          value={plan.display_name}
          onChange={(e) => set('display_name', e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field label="Price label">
        <input
          value={plan.price_label}
          onChange={(e) => set('price_label', e.target.value)}
          placeholder="Бесплатно / 499 ₽/мес"
          className={inputClass}
        />
      </Field>

      <Field label="Tagline">
        <input
          value={plan.tagline}
          onChange={(e) => set('tagline', e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field label="Bullets">
        <StringListEditor
          values={plan.bullets}
          onChange={(bullets) => set('bullets', bullets)}
          placeholder="Например: 200 запросов в день"
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="CTA label">
          <input
            value={plan.cta_label}
            onChange={(e) => set('cta_label', e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Requests/day">
          <input
            type="number"
            value={plan.requests_cap}
            onChange={(e) => set('requests_cap', parseInt(e.target.value || '0', 10))}
            placeholder="-1 = ∞"
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Subscribe URL">
        <input
          value={plan.subscribe_url}
          onChange={(e) => set('subscribe_url', e.target.value)}
          placeholder="https://boosty.to/..."
          className={inputClass}
        />
      </Field>

      <Field label="Models allowed (virtual chains)">
        <StringListEditor
          values={plan.models_allowed}
          onChange={(models_allowed) => set('models_allowed', models_allowed)}
          placeholder="druz9/turbo"
          datalistId="known-virtual-chains"
          hint={plan.models_allowed.length === 0 ? 'Пусто = без ограничений' : undefined}
        />
      </Field>
    </section>
  )
}

// ── small helpers ─────────────────────────────────────────────────────

const inputClass =
  'w-full border-0 border-b border-[var(--hair-2)] bg-transparent rounded-none px-0 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted/50 focus:border-[rgb(var(--ink))] focus:border-b-[1.5px] focus:outline-none transition-[border-color] duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)]'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">{label}</span>
      {children}
    </label>
  )
}

function StringListEditor({
  values,
  onChange,
  placeholder,
  datalistId,
  hint,
}: {
  values: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  datalistId?: string
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      {values.map((v, i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            value={v}
            onChange={(e) => {
              const next = values.slice()
              next[i] = e.target.value
              onChange(next)
            }}
            placeholder={placeholder}
            list={datalistId}
            className={inputClass}
          />
          <button
            type="button"
            onClick={() => onChange(values.filter((_, j) => j !== i))}
            className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-danger"
            title="Удалить"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...values, ''])}
        className="flex items-center gap-1 self-start rounded border border-border bg-surface-2 px-2 py-1 font-mono text-[10px] text-text-muted hover:border-text-muted hover:text-text-primary"
      >
        <Plus className="h-3 w-3" /> Добавить
      </button>
      {hint && <span className="font-mono text-[10px] text-text-muted">{hint}</span>}
    </div>
  )
}
