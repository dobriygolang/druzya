// QuotasPanel — admin UI для редактирования subscription quota policies.
//
// Каждый из трёх tier'ов (Free, Seeker, Ascended) — отдельная карточка с
// числовыми инпутами. Backend хранит value как JSON в dynamic_config под
// ключами `quota_policy.<tier>`. -1 = unlimited (UI показывает «∞»).
//
// Save — per-tier (не глобальный): меняешь Free → нажимаешь Save → PUT
// /admin/config/quota_policy.free. Subscription module горячо подтягивает
// новые значения через PolicyResolver TTL-cache (5 min).
import { useEffect, useState } from 'react'
import {
  useQuotaPoliciesQuery,
  useUpdateQuotaPolicyMutation,
  QUOTA_DEFAULTS,
  type Tier,
  type QuotaPolicy,
} from '../../lib/queries/adminQuotas'
import { PanelSkeleton, ErrorBox } from './shared'

const TIER_ORDER: Tier[] = ['free', 'seeker', 'ascended']
const TIER_LABEL: Record<Tier, string> = {
  free: 'Free',
  seeker: 'Seeker',
  ascended: 'Ascended',
}

const FIELD_LABELS: Array<{ key: keyof QuotaPolicy; label: string; hint: string; allowUnlimited: boolean }> = [
  { key: 'synced_notes', label: 'Synced notes', hint: 'Cloud-synced notes (free-tier creates locally only).', allowUnlimited: true },
  { key: 'active_shared_boards', label: 'Active shared boards', hint: 'Concurrent multiplayer whiteboards owned.', allowUnlimited: true },
  { key: 'active_shared_rooms', label: 'Active shared code-rooms', hint: 'Concurrent multiplayer code-rooms owned.', allowUnlimited: true },
  { key: 'shared_ttl_seconds', label: 'Share TTL (seconds)', hint: 'Auto-private after this idle window. 0 = no auto-downgrade.', allowUnlimited: false },
  { key: 'ai_monthly', label: 'AI calls / month', hint: 'Free unlimited via free-LLMs; tighter on paid tiers.', allowUnlimited: true },
]

export function QuotasPanel() {
  const q = useQuotaPoliciesQuery()
  if (q.isPending) return <PanelSkeleton rows={6} />
  if (q.isError) return <ErrorBox message={(q.error as Error).message} />
  if (!q.data) return null
  return (
    <div className="flex flex-col gap-4 px-4 py-5 sm:px-7">
      <p className="text-sm text-text-secondary">
        Тарифные квоты. <code className="font-mono text-xs">-1</code> или пусто = unlimited.
        Изменения применяются на бэкенде через ~5 минут (TTL-кэш PolicyResolver).
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {TIER_ORDER.map((tier) => (
          <TierCard key={tier} tier={tier} initial={q.data![tier]} />
        ))}
      </div>
    </div>
  )
}

function TierCard({ tier, initial }: { tier: Tier; initial: QuotaPolicy }) {
  const [draft, setDraft] = useState<QuotaPolicy>(initial)
  useEffect(() => setDraft(initial), [initial])
  const mutate = useUpdateQuotaPolicyMutation()

  const dirty = (Object.keys(initial) as Array<keyof QuotaPolicy>).some((k) => draft[k] !== initial[k])

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-1 p-4">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <h3 className="font-display text-base font-bold text-text-primary">{TIER_LABEL[tier]}</h3>
        <span className="font-mono text-[10px] tracking-[0.16em] text-text-muted uppercase">
          quota_policy.{tier}
        </span>
      </div>
      {FIELD_LABELS.map((f) => (
        <NumberField
          key={f.key}
          label={f.label}
          hint={f.hint}
          allowUnlimited={f.allowUnlimited}
          value={draft[f.key]}
          onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
        />
      ))}
      <div className="flex items-center justify-between gap-2 pt-2">
        <button
          type="button"
          onClick={() => setDraft(QUOTA_DEFAULTS[tier])}
          className="rounded-md px-3 py-1.5 text-[12px] text-text-secondary hover:bg-surface-2"
        >
          Reset to defaults
        </button>
        <button
          type="button"
          disabled={!dirty || mutate.isPending}
          onClick={() => mutate.mutate({ tier, policy: draft })}
          className="rounded-md bg-text-primary px-3 py-1.5 text-[12px] font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-40"
        >
          {mutate.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
      {mutate.isError && (
        <div className="mt-1 rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger">
          {(mutate.error as Error).message}
        </div>
      )}
    </div>
  )
}

function NumberField({
  label,
  hint,
  value,
  onChange,
  allowUnlimited,
}: {
  label: string
  hint: string
  value: number
  onChange: (v: number) => void
  allowUnlimited: boolean
}) {
  const [text, setText] = useState(formatVal(value))
  useEffect(() => setText(formatVal(value)), [value])
  return (
    <label className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-text-primary">{label}</span>
        {allowUnlimited && value < 0 && (
          <span className="font-mono text-[10px] text-text-muted">∞</span>
        )}
      </div>
      <input
        type="text"
        inputMode="numeric"
        value={text}
        onChange={(e) => {
          const t = e.target.value
          setText(t)
          if (t === '' || t === '-') {
            onChange(allowUnlimited ? -1 : 0)
            return
          }
          const n = Number.parseInt(t, 10)
          if (!Number.isNaN(n)) onChange(n)
        }}
        className="rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-[13px] text-text-primary outline-none focus:border-text-primary"
      />
      <span className="text-[11px] text-text-muted">{hint}</span>
    </label>
  )
}

function formatVal(v: number): string {
  return String(v)
}
