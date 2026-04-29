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
import { AlertCircle, ChevronDown, ChevronUp, Eye, Plus, Trash2, Zap } from 'lucide-react'
import { Button } from '../../components/Button'
import { ErrorBox, PanelSkeleton } from './shared'
import {
  useLLMChainConfigQuery,
  useSaveLLMChainConfigMutation,
  KNOWN_PROVIDERS,
  VIRTUAL_IDS,
  KNOWN_TASKS,
  PROVIDER_MODELS,
  VIRTUAL_MIN_TIER,
  tierCovers,
  resolveModelTier,
  testLLMModel,
  type LLMChainConfig,
  type VirtualCandidate,
  type ModelTier,
  type KnownProvider,
} from '../../lib/queries/admin-llm-chain'
import {
  useLLMKeysQuery,
  useUpdateLLMKeysMutation,
  maskKey,
  type ProviderKeysMap,
} from '../../lib/queries/adminLLMKeys'

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
            <Zap className="h-4 w-4 text-text-primary" />
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

      <TestModelSection />

      <LLMKeysSection />

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
        defaults={draft.virtual_chains_defaults ?? {}}
        onChange={(virtual_chains) => setDraft({ ...draft, virtual_chains })}
        registeredProviders={draft.registered_providers ?? []}
      />
    </div>
  )
}

// ─── Datalist helper — одна на провайдера, id нужен чтобы <input list="..."> её нашёл ─

function ProviderModelDatalist({ provider }: { provider: string }) {
  const list = PROVIDER_MODELS[provider as KnownProvider]
  if (!list) return null
  return (
    <datalist id={`models-${provider}`}>
      {list.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
          {m.hint ? ` · ${m.hint}` : ''}
          {m.tier !== 'free' ? ` · ${m.tier}` : ''}
        </option>
      ))}
    </datalist>
  )
}

// ─── Test Model — sanity-probe конкретной пары provider+model ───────────
//
// Шлёт короткий prompt в выбранный driver и показывает ответ + latency.
// Не записывает в config — просто проверка «доходит ли запрос до модели».
// Полезно после смены ключа в env / проверки нового провайдера.

function TestModelSection() {
  const [provider, setProvider] = useState<KnownProvider>(KNOWN_PROVIDERS[0])
  const [model, setModel] = useState<string>(PROVIDER_MODELS[KNOWN_PROVIDERS[0]]?.[0]?.id ?? '')
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{
    ok: boolean
    output?: string
    error?: string
    latencyMs?: number
    actualProvider?: string
    actualModel?: string
  } | null>(null)

  // При смене провайдера выставляем первую модель из catalogue'а как
  // sane default — иначе input остаётся пустым и юзер недоумевает.
  function onProviderChange(next: KnownProvider) {
    setProvider(next)
    const first = PROVIDER_MODELS[next]?.[0]?.id ?? ''
    setModel(first)
    setResult(null)
  }

  async function handleRun() {
    if (!provider || !model) return
    setBusy(true)
    setResult(null)
    try {
      const r = await testLLMModel({ provider, model, prompt: prompt.trim() })
      setResult({
        ok: r.ok,
        output: r.output,
        error: r.errorMessage,
        latencyMs: r.latencyMs,
        actualProvider: r.actualProvider,
        actualModel: r.actualModel,
      })
    } catch (e: unknown) {
      setResult({ ok: false, error: (e as Error)?.message ?? 'Request failed' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface-1 p-4">
      <h3 className="font-display text-sm font-bold text-text-primary">Test model</h3>
      <p className="mt-1 mb-3 font-mono text-[11px] text-text-muted">
        Проверить что выбранный provider+model отвечает. Шлёт короткий prompt
        с MaxTokens=64.
      </p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[140px_1fr_auto]">
        <select
          value={provider}
          onChange={(e) => onProviderChange(e.target.value as KnownProvider)}
          disabled={busy}
          className="rounded border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs text-text-primary focus:border-text-primary focus:outline-none disabled:opacity-60"
        >
          {KNOWN_PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="model id"
          list={`models-${provider}`}
          disabled={busy}
          className="rounded border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs text-text-primary placeholder:text-text-muted/50 focus:border-text-primary focus:outline-none disabled:opacity-60"
        />
        <ProviderModelDatalist provider={provider} />

        <Button
          size="sm"
          onClick={handleRun}
          disabled={busy || !model.trim()}
        >
          {busy ? 'Проверяю…' : 'Run'}
        </Button>
      </div>

      <input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder='Prompt (опционально, default: "Reply with exactly: ok")'
        disabled={busy}
        className="mt-2 w-full rounded border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs text-text-primary placeholder:text-text-muted/50 focus:border-text-primary focus:outline-none disabled:opacity-60"
      />

      {result && (
        <div
          className={`mt-3 rounded border px-3 py-2 font-mono text-[11px] ${
            result.ok
              ? 'border-success/40 bg-success/5 text-text-primary'
              : 'border-danger/40 bg-danger/5 text-text-primary'
          }`}
        >
          <div className="mb-1 flex items-center justify-between text-text-muted">
            <span>
              {result.ok ? '✓ ok' : '✕ failed'}
              {result.actualProvider && result.actualModel && (
                <span className="ml-2">
                  · {result.actualProvider}/{result.actualModel}
                </span>
              )}
            </span>
            {typeof result.latencyMs === 'number' && (
              <span>{result.latencyMs}ms</span>
            )}
          </div>
          {result.ok ? (
            <pre className="whitespace-pre-wrap break-words text-text-secondary">
              {result.output || '(empty response)'}
            </pre>
          ) : (
            <pre className="whitespace-pre-wrap break-words text-danger">
              {result.error || 'unknown error'}
            </pre>
          )}
        </div>
      )}
    </section>
  )
}

// ─── LLM Provider Keys (admin-managed multi-key) ────────────────────────
//
// Хранение: dynamic_config[llm_provider_keys] = {provider: ["key1","key2"]}.
// Backend на boot'е объединяет с env-CSV (env-keys + db-keys → один
// MultiKeyDriver per provider). Hot-swap не поддержан — после save
// требуется restart монолита, тогда новые ключи вступят в силу.
// Quota от нескольких аккаунтов одного провайдера складывается;
// MultiKeyDriver round-robin'ит и временно исключает rate-limited
// ключи на 1 час.

function LLMKeysSection() {
  const q = useLLMKeysQuery()
  const save = useUpdateLLMKeysMutation()
  const [draft, setDraft] = useState<ProviderKeysMap | null>(null)
  const [revealAll, setRevealAll] = useState(false)
  const [savedOnce, setSavedOnce] = useState(false)

  useEffect(() => {
    if (q.data) setDraft(structuredClone(q.data))
  }, [q.data])

  if (q.isPending)
    return (
      <section className="rounded-lg border border-border bg-surface-1 p-4">
        <p className="font-mono text-[11px] text-text-muted">Загружаю API-ключи…</p>
      </section>
    )
  if (!draft) return null

  const dirty = JSON.stringify(draft) !== JSON.stringify(q.data)

  function setKeysFor(provider: KnownProvider, keys: string[]) {
    setDraft((prev) => (prev ? { ...prev, [provider]: keys } : prev))
  }

  async function handleSave() {
    if (!draft) return
    try {
      await save.mutateAsync(draft)
      setSavedOnce(true)
    } catch {
      /* error visible через save.error */
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface-1 p-4">
      <header className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-sm font-bold text-text-primary">API keys (multi-key)</h3>
          <p className="mt-1 font-mono text-[11px] text-text-muted">
            Несколько ключей на провайдер → quota суммируется. Round-robin внутри
            MultiKeyDriver; rate-limited ключ автоматически исключается на 1 час.
          </p>
          <p className="mt-1 font-mono text-[11px] text-text-muted">
            ⚠️ Изменения вступают в силу <strong>после рестарта монолита</strong>.
            Env-ключи (`GROQ_API_KEY=k1,k2`) добавляются к этим в одну ротацию.
          </p>
        </div>
        <div className="flex flex-shrink-0 gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setRevealAll((v) => !v)}
            disabled={save.isPending}
          >
            {revealAll ? 'Hide' : 'Reveal'}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!dirty || save.isPending}>
            {save.isPending ? 'Сохраняю…' : 'Сохранить'}
          </Button>
        </div>
      </header>

      {save.isError && (
        <div className="mb-3 rounded border border-danger/40 bg-danger/5 px-3 py-2 font-mono text-[11px] text-danger">
          Не удалось сохранить: {(save.error as Error).message}
        </div>
      )}

      {savedOnce && !dirty && !save.isError && (
        <div className="mb-3 rounded border border-warn/40 bg-warn/5 px-3 py-2 font-mono text-[11px] text-warn">
          ✓ Сохранено в DB. Перезапусти монолит — новые ключи будут активны после рестарта.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {KNOWN_PROVIDERS.map((p) => (
          <ProviderKeysEditor
            key={p}
            provider={p}
            keys={draft[p] ?? []}
            reveal={revealAll}
            onChange={(next) => setKeysFor(p, next)}
          />
        ))}
      </div>
    </section>
  )
}

function ProviderKeysEditor({
  provider,
  keys,
  reveal,
  onChange,
}: {
  provider: KnownProvider
  keys: string[]
  reveal: boolean
  onChange: (next: string[]) => void
}) {
  return (
    <div className="rounded border border-border bg-surface-2 p-3">
      <header className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-text-primary">
          {provider}
        </span>
        {keys.length > 0 && (
          <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
            ×{keys.length}
          </span>
        )}
      </header>
      <div className="flex flex-col gap-1.5">
        {keys.map((k, i) => (
          <div key={i} className="flex items-center gap-1">
            <input
              type={reveal ? 'text' : 'password'}
              value={k}
              onChange={(e) => {
                const next = keys.slice()
                next[i] = e.target.value
                onChange(next)
              }}
              placeholder="API key"
              className="flex-1 rounded border border-border bg-surface-1 px-2 py-1 font-mono text-[11px] text-text-primary placeholder:text-text-muted/50 focus:border-text-primary focus:outline-none"
            />
            {!reveal && k && (
              <span
                className="font-mono text-[10px] text-text-muted"
                title={maskKey(k)}
              >
                {maskKey(k)}
              </span>
            )}
            <button
              type="button"
              onClick={() => onChange(keys.filter((_, j) => j !== i))}
              className="rounded p-1 text-text-muted hover:bg-surface-3 hover:text-danger"
              title="Удалить"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...keys, ''])}
          className="flex items-center gap-1 self-start rounded border border-border bg-surface-1 px-2 py-1 font-mono text-[10px] text-text-muted hover:border-text-muted hover:text-text-primary"
        >
          <Plus className="h-3 w-3" /> Добавить ключ
        </button>
      </div>
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
              className="flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-xs text-text-secondary hover:border-text-primary hover:text-text-primary"
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
                        list={`models-${p}`}
                        className="w-full rounded border border-border bg-surface-2 px-2 py-1 font-mono text-[11px] text-text-primary placeholder:text-text-muted/50 focus:border-text-primary focus:outline-none"
                      />
                      <ProviderModelDatalist provider={p} />
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
  defaults,
  onChange,
  registeredProviders,
}: {
  chains: Record<string, VirtualCandidate[]>
  defaults: Record<string, VirtualCandidate[]>
  onChange: (next: Record<string, VirtualCandidate[]>) => void
  registeredProviders: string[]
}) {
  // Tier-симулятор для live preview. free по умолчанию — админ
  // переключает чтобы увидеть что видит юзер каждого уровня.
  const [previewTier, setPreviewTier] = useState<ModelTier>('free')

  function setChain(virt: string, next: VirtualCandidate[]) {
    const out = { ...chains }
    if (next.length === 0) {
      delete out[virt]
    } else {
      out[virt] = next
    }
    onChange(out)
  }

  const regSet = new Set(registeredProviders)

  return (
    <section className="rounded-lg border border-border bg-surface-1 p-4">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-display text-sm font-bold text-text-primary">3. Virtual Chains</h3>
          <p className="mt-1 font-mono text-[11px] text-text-muted">
            Fallback-цепочки для druz9/turbo|pro|ultra|reasoning. Пустая = defaults из tier.go.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Eye className="h-3.5 w-3.5 text-text-muted" />
          <span className="font-mono text-[10px] text-text-muted">Preview для:</span>
          {(['free', 'pro', 'max'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setPreviewTier(t)}
              className={`rounded-md px-2 py-1 font-mono text-[11px] ${
                previewTier === t
                  ? 'bg-text-primary/20 text-text-primary'
                  : 'bg-surface-2 text-text-muted hover:bg-surface-3'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {VIRTUAL_IDS.map((v) => (
          <VirtualChainCard
            key={v}
            id={v}
            chain={chains[v] ?? []}
            defaultChain={defaults[v] ?? []}
            onChange={(next) => setChain(v, next)}
            previewTier={previewTier}
            registeredProviders={regSet}
          />
        ))}
      </div>
    </section>
  )
}

function VirtualChainCard({
  id,
  chain,
  defaultChain,
  onChange,
  previewTier,
  registeredProviders,
}: {
  id: string
  chain: VirtualCandidate[]
  defaultChain: VirtualCandidate[]
  onChange: (next: VirtualCandidate[]) => void
  previewTier: ModelTier
  registeredProviders: Set<string>
}) {
  const [testingIdx, setTestingIdx] = useState<number | null>(null)
  const [testResults, setTestResults] = useState<Record<number, string>>({})

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
  async function testStep(i: number, step: VirtualCandidate) {
    if (!step.provider || !step.model || testingIdx !== null) return
    setTestingIdx(i)
    try {
      const res = await testLLMModel({
        provider: step.provider,
        model: step.model,
        prompt: 'Reply with exactly: ok',
      })
      setTestResults((prev) => ({
        ...prev,
        [i]: res.ok ? `ok · ${res.latencyMs ?? 0}ms` : `fail · ${res.errorMessage ?? 'unknown'}`,
      }))
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'request failed'
      setTestResults((prev) => ({ ...prev, [i]: `fail · ${msg}` }))
    } finally {
      setTestingIdx(null)
    }
  }

  // Live preview: фильтруем chain как это сделает backend'овский
  // candidates() — tier-gate + registered-драйвер-check. Показываем
  // отрезанные шаги приглушёнными, активные — ярко.
  const virtReq = VIRTUAL_MIN_TIER[id as keyof typeof VIRTUAL_MIN_TIER] ?? 'free'
  const tierOK = tierCovers(previewTier, virtReq)
  const effectiveChain = chain.map((step) => {
    const tierBlocked = !tierCovers(previewTier, resolveModelTier(step.provider, step.model))
    const providerMissing = !registeredProviders.has(step.provider)
    return { ...step, tierBlocked, providerMissing }
  })
  const firstReachable = effectiveChain.findIndex((s) => !s.tierBlocked && !s.providerMissing)

  return (
    <div className="rounded-md border border-border bg-surface-2 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold text-text-primary">{id}</span>
          <span className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] ${
            virtReq === 'free'
              ? 'bg-surface-3 text-text-muted'
            : virtReq === 'pro'
                ? 'bg-text-primary/10 text-text-secondary'
                : 'bg-text-primary/15 text-text-primary'
          }`}>
            min: {virtReq}
          </span>
          {!tierOK && (
            <span className="flex items-center gap-1 rounded-full bg-danger/15 px-1.5 py-0.5 font-mono text-[9px] text-danger">
              <AlertCircle className="h-2.5 w-2.5" /> не для {previewTier}
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={addStep}>
          <Plus className="h-3 w-3" /> Шаг
        </Button>
      </div>

      {chain.length === 0 ? (
        // Override пуст — раскрываем defaults из tier.go (read-only) и
        // даём кнопку "Скопировать в override" чтобы юзер мог отредактировать
        // как обычное значение. Раньше тут было сообщение «Override
        // отсутствует — используется цепочка из tier.go» без возможности
        // править.
        <div className="flex flex-col gap-2 rounded border border-dashed border-border bg-surface-1 px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
              Defaults из tier.go (read-only)
            </span>
            {defaultChain.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onChange(defaultChain.map((s) => ({ ...s })))}
              >
                Скопировать в override
              </Button>
            )}
          </div>
          {defaultChain.length === 0 ? (
            <div className="text-center font-mono text-[11px] text-text-muted">
              Defaults пусты — добавь шаг через «+ Шаг» сверху.
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {defaultChain.map((step, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded border border-border/50 bg-surface-2/40 px-2 py-1 font-mono text-[11px] text-text-muted"
                >
                  <span className="w-5">{i + 1}.</span>
                  <span className="text-text-secondary">{step.provider}</span>
                  <span className="text-text-muted/60">·</span>
                  <span className="flex-1 truncate">{step.model}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {effectiveChain.map((step, i) => {
            const dimmed = step.tierBlocked || step.providerMissing
            const isFirstReachable = i === firstReachable && tierOK
            return (
              <div
                key={i}
                className={`flex items-center gap-2 rounded border px-1.5 py-1 ${
                  isFirstReachable
                    ? 'border-success/40 bg-success/5'
                    : dimmed
                      ? 'border-border bg-surface-1 opacity-50'
                      : 'border-border bg-surface-1'
                }`}
              >
                <span className="w-5 font-mono text-[10px] text-text-muted">{i + 1}.</span>
                {isFirstReachable && (
                  <span className="rounded-full bg-success/20 px-1.5 py-0.5 font-mono text-[9px] text-success">
                    active
                  </span>
                )}
                <select
                  value={step.provider}
                  onChange={(e) => updateStep(i, { provider: e.target.value })}
                  className="rounded border border-border bg-surface-2 px-2 py-1 font-mono text-[11px] text-text-primary focus:border-text-primary focus:outline-none"
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
                  placeholder="model_id"
                  list={`models-${step.provider}`}
                  className="flex-1 rounded border border-border bg-surface-2 px-2 py-1 font-mono text-[11px] text-text-primary placeholder:text-text-muted/50 focus:border-text-primary focus:outline-none"
                />
                <button
                  onClick={() => void testStep(i, step)}
                  disabled={!step.provider || !step.model || testingIdx !== null}
                  className="rounded border border-border bg-surface-2 px-2 py-1 font-mono text-[10px] text-text-secondary hover:border-text-primary hover:text-text-primary disabled:opacity-40"
                  title="Отправить тестовый запрос"
                >
                  {testingIdx === i ? 'test…' : 'test'}
                </button>
                {testResults[i] && (
                  <span className={`max-w-40 truncate rounded-full px-1.5 py-0.5 font-mono text-[9px] ${
                    testResults[i].startsWith('ok')
                      ? 'bg-success/15 text-success'
                      : 'bg-danger/15 text-danger'
                  }`}>
                    {testResults[i]}
                  </span>
                )}
                <ProviderModelDatalist provider={step.provider} />
                {step.providerMissing && (
                  <span
                    className="rounded-full bg-warn/15 px-1.5 py-0.5 font-mono text-[9px] text-warn"
                    title="API-ключ провайдера не настроен на backend'е"
                  >
                    key?
                  </span>
                )}
                {step.tierBlocked && (
                  <span
                    className="rounded-full bg-danger/15 px-1.5 py-0.5 font-mono text-[9px] text-danger"
                    title="Модель требует tier выше чем preview"
                  >
                    tier
                  </span>
                )}
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
            )
          })}
        </div>
      )}
    </div>
  )
}
