// LLMChainPanel — админка runtime-конфига LLM chain'а.
//
// Три секции, все меняются в реал-тайме через один PUT /admin/llm/config:
//   1. Chain Order — упорядоченный список провайдеров (↑↓ для reorder,
//      кнопка "✕" удаляет, dropdown добавляет новый).
//   2. Task Map — таблица (task × provider → model_id) с inline-edit'ом.
//   3. Virtual Chains — карточки druz9/turbo|pro|ultra|reasoning, внутри
//      каждой — fallback-цепочка шагов (provider + model), с reorder/add/del.
//
// Все правки накапливаются в local state; "Сохранить" шлёт PUT.
// 409 Conflict → показывает сообщение + автоматически рефетчит свежий
// config (админ повторно применяет свои diff'ы).

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Trash2, Zap } from 'lucide-react'
import { Button } from '../../components/Button'
import { ErrorBox, PanelSkeleton } from './shared'
import {
  useLLMChainConfigQuery,
  useSaveLLMChainConfigMutation,
  KNOWN_PROVIDERS,
  VIRTUAL_IDS,
  KNOWN_TASKS,
  type LLMChainConfig,
  type VirtualCandidate,
} from '../../lib/queries/admin-llm-chain'

export function LLMChainPanel() {
  const q = useLLMChainConfigQuery()
  const save = useSaveLLMChainConfigMutation()

  // Локальный draft: меняется при edit'ах, отправляется на PUT.
  const [draft, setDraft] = useState<LLMChainConfig | null>(null)
  const [conflict, setConflict] = useState(false)

  // Инициализация + сброс при успешном сейве / refetch.
  useEffect(() => {
    if (q.data) setDraft(q.data)
  }, [q.data])

  if (q.isPending) return <PanelSkeleton rows={8} />
  if (q.error || !draft) return <ErrorBox message="Не удалось загрузить LLM chain config." />

  const dirty = JSON.stringify(draft) !== JSON.stringify(q.data)

  async function handleSave() {
    if (!draft) return
    setConflict(false)
    try {
      await save.mutateAsync(draft)
    } catch (e: unknown) {
      const status = (e as { status?: number })?.status
      if (status === 409) {
        setConflict(true)
        await q.refetch()
      }
    }
  }

  function handleReset() {
    if (q.data) setDraft(q.data)
    setConflict(false)
  }

  return (
    <div className="flex flex-col gap-5 px-4 py-5 sm:px-7">
      <header className="flex flex-col gap-2 rounded-lg border border-border bg-surface-1 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 font-display text-sm font-bold text-text-primary">
            <Zap className="h-4 w-4 text-accent" />
            Runtime LLM Chain
          </h2>
          <p className="mt-1 font-mono text-[11px] text-text-muted">
            Версия: {draft.version}. Изменения вступают в силу мгновенно после сохранения
            (force-reload на API). Пустые поля = hardcoded defaults из кода.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={handleReset} disabled={!dirty || save.isPending}>
            Сбросить
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!dirty || save.isPending}>
            {save.isPending ? 'Сохраняю…' : 'Сохранить'}
          </Button>
        </div>
      </header>

      {conflict && (
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          ⚠️ Версия устарела — другой админ менял config параллельно. Подтянул свежие данные,
          применяй правки заново.
        </div>
      )}

      <ChainOrderSection
        order={draft.chain_order}
        onChange={(chain_order) => setDraft({ ...draft, chain_order })}
      />

      <TaskMapSection
        taskMap={draft.task_map}
        onChange={(task_map) => setDraft({ ...draft, task_map })}
      />

      <VirtualChainsSection
        chains={draft.virtual_chains}
        onChange={(virtual_chains) => setDraft({ ...draft, virtual_chains })}
      />
    </div>
  )
}

// ─── Chain Order ──────────────────────────────────────────────────────────

function ChainOrderSection({
  order,
  onChange,
}: {
  order: string[]
  onChange: (next: string[]) => void
}) {
  const unused = KNOWN_PROVIDERS.filter((p) => !order.includes(p))

  function move(from: number, to: number) {
    if (to < 0 || to >= order.length) return
    const next = [...order]
    ;[next[from], next[to]] = [next[to], next[from]]
    onChange(next)
  }
  function remove(idx: number) {
    onChange(order.filter((_, i) => i !== idx))
  }
  function add(p: string) {
    if (!p || order.includes(p)) return
    onChange([...order, p])
  }

  return (
    <section className="rounded-lg border border-border bg-surface-1 p-4">
      <h3 className="font-display text-sm font-bold text-text-primary">1. Chain Order</h3>
      <p className="mt-1 mb-3 font-mono text-[11px] text-text-muted">
        Порядок провайдеров для task-based candidates (пустой = defaults из env LLM_CHAIN_ORDER).
      </p>

      <div className="flex flex-col gap-2">
        {order.length === 0 && (
          <div className="rounded-md border border-dashed border-border bg-surface-2 px-4 py-5 text-center font-mono text-xs text-text-muted">
            Пусто — используется LLM_CHAIN_ORDER из env или дефолт backend'а.
          </div>
        )}
        {order.map((p, i) => (
          <div key={p} className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2">
            <span className="font-mono text-[10px] text-text-muted">{i + 1}.</span>
            <span className="flex-1 font-mono text-sm text-text-primary">{p}</span>
            <button
              onClick={() => move(i, i - 1)}
              disabled={i === 0}
              className="rounded p-1 text-text-muted hover:bg-surface-3 hover:text-text-primary disabled:opacity-30"
              title="Выше"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              onClick={() => move(i, i + 1)}
              disabled={i === order.length - 1}
              className="rounded p-1 text-text-muted hover:bg-surface-3 hover:text-text-primary disabled:opacity-30"
              title="Ниже"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
            <button
              onClick={() => remove(i)}
              className="rounded p-1 text-danger hover:bg-danger/10"
              title="Удалить"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      {unused.length > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <span className="font-mono text-[10px] text-text-muted">Добавить:</span>
          {unused.map((p) => (
            <button
              key={p}
              onClick={() => add(p)}
              className="flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-xs text-text-secondary hover:border-accent hover:text-accent"
            >
              <Plus className="h-3 w-3" /> {p}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

// ─── Task Map ─────────────────────────────────────────────────────────────

function TaskMapSection({
  taskMap,
  onChange,
}: {
  taskMap: Record<string, Record<string, string>>
  onChange: (next: Record<string, Record<string, string>>) => void
}) {
  function setCell(task: string, provider: string, model: string) {
    const next = { ...taskMap }
    const inner = { ...(next[task] ?? {}) }
    if (model === '') {
      delete inner[provider]
    } else {
      inner[provider] = model
    }
    if (Object.keys(inner).length === 0) {
      delete next[task]
    } else {
      next[task] = inner
    }
    onChange(next)
  }

  return (
    <section className="rounded-lg border border-border bg-surface-1 p-4">
      <h3 className="font-display text-sm font-bold text-text-primary">2. Task Map</h3>
      <p className="mt-1 mb-3 font-mono text-[11px] text-text-muted">
        Override per-(task, provider). Пустое поле = fallback на default из кода.
        Пример модели: <code className="rounded bg-surface-2 px-1">llama-3.3-70b-versatile</code>
      </p>

      <div className="overflow-x-auto">
        <table className="w-full font-mono text-xs">
          <thead>
            <tr className="border-b border-border text-left text-text-muted">
              <th className="px-2 py-2">Task</th>
              {KNOWN_PROVIDERS.map((p) => (
                <th key={p} className="px-2 py-2">
                  {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {KNOWN_TASKS.map((task) => (
              <tr key={task} className="border-b border-border/50">
                <td className="px-2 py-1.5 text-text-secondary">{task}</td>
                {KNOWN_PROVIDERS.map((p) => {
                  const val = taskMap[task]?.[p] ?? ''
                  return (
                    <td key={p} className="px-2 py-1">
                      <input
                        value={val}
                        onChange={(e) => setCell(task, p, e.target.value)}
                        placeholder="—"
                        className="w-full rounded border border-border bg-surface-2 px-2 py-1 font-mono text-[11px] text-text-primary placeholder:text-text-muted/50 focus:border-accent focus:outline-none"
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ─── Virtual Chains ───────────────────────────────────────────────────────

function VirtualChainsSection({
  chains,
  onChange,
}: {
  chains: Record<string, VirtualCandidate[]>
  onChange: (next: Record<string, VirtualCandidate[]>) => void
}) {
  function setChain(virt: string, next: VirtualCandidate[]) {
    const out = { ...chains }
    if (next.length === 0) {
      delete out[virt]
    } else {
      out[virt] = next
    }
    onChange(out)
  }

  return (
    <section className="rounded-lg border border-border bg-surface-1 p-4">
      <h3 className="font-display text-sm font-bold text-text-primary">3. Virtual Chains</h3>
      <p className="mt-1 mb-3 font-mono text-[11px] text-text-muted">
        Fallback-цепочки для druz9/turbo|pro|ultra|reasoning. Пустая = defaults из tier.go.
      </p>

      <div className="flex flex-col gap-4">
        {VIRTUAL_IDS.map((v) => (
          <VirtualChainCard
            key={v}
            id={v}
            chain={chains[v] ?? []}
            onChange={(next) => setChain(v, next)}
          />
        ))}
      </div>
    </section>
  )
}

function VirtualChainCard({
  id,
  chain,
  onChange,
}: {
  id: string
  chain: VirtualCandidate[]
  onChange: (next: VirtualCandidate[]) => void
}) {
  function move(from: number, to: number) {
    if (to < 0 || to >= chain.length) return
    const next = [...chain]
    ;[next[from], next[to]] = [next[to], next[from]]
    onChange(next)
  }
  function remove(i: number) {
    onChange(chain.filter((_, idx) => idx !== i))
  }
  function addStep() {
    onChange([...chain, { provider: KNOWN_PROVIDERS[0], model: '' }])
  }
  function updateStep(i: number, patch: Partial<VirtualCandidate>) {
    onChange(chain.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }

  return (
    <div className="rounded-md border border-border bg-surface-2 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-xs font-bold text-text-primary">{id}</span>
        <Button variant="ghost" size="sm" onClick={addStep}>
          <Plus className="h-3 w-3" /> Шаг
        </Button>
      </div>

      {chain.length === 0 ? (
        <div className="rounded border border-dashed border-border bg-surface-1 px-3 py-3 text-center font-mono text-[11px] text-text-muted">
          Override отсутствует — используется цепочка из tier.go.
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {chain.map((step, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 font-mono text-[10px] text-text-muted">{i + 1}.</span>
              <select
                value={step.provider}
                onChange={(e) => updateStep(i, { provider: e.target.value })}
                className="rounded border border-border bg-surface-1 px-2 py-1 font-mono text-[11px] text-text-primary focus:border-accent focus:outline-none"
              >
                {KNOWN_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <input
                value={step.model}
                onChange={(e) => updateStep(i, { model: e.target.value })}
                placeholder="model_id (e.g. llama-3.3-70b-versatile)"
                className="flex-1 rounded border border-border bg-surface-1 px-2 py-1 font-mono text-[11px] text-text-primary placeholder:text-text-muted/50 focus:border-accent focus:outline-none"
              />
              <button
                onClick={() => move(i, i - 1)}
                disabled={i === 0}
                className="rounded p-1 text-text-muted hover:bg-surface-3 hover:text-text-primary disabled:opacity-30"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => move(i, i + 1)}
                disabled={i === chain.length - 1}
                className="rounded p-1 text-text-muted hover:bg-surface-3 hover:text-text-primary disabled:opacity-30"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => remove(i)}
                className="rounded p-1 text-danger hover:bg-danger/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
