// PathCustom — Wave «hybrid path» — custom-mode entry.
//
// Sergey 2026-05-03: «либо пользователь сам себе назначает трек».
// Юзер пишет цель в свободной форме («Senior Go в финтех») → нажимает
// «Сгенерировать карту тем» → backend GenerateCustomPath (llmchain
// TaskCustomPathGenerate) возвращает 8-15 nodes, сгруппированных по
// темам. Дальше юзер toggle'ит чекбоксы (как в PathEdit) — какие темы
// учить, какие skip. Save → сохраняем в localStorage → /today.
//
// Backend nil-safe: если LLMChain не сконфигурён, RPC отвечает
// Unimplemented — UI показывает inline-сообщение и оставляет
// «coming soon» fallback (юзер может всё равно сохранить goal).

import { useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, Sparkles, Loader2 } from 'lucide-react'

import { OnboardingLayout } from './_shared/Layout'
import { Button } from '../../components/Button'
import {
  useGenerateCustomPathMutation,
  type CustomPathNode,
} from '../../lib/queries/tracks'

const GOAL_KEY = 'onboarding:path:custom'
const STATE_KEY = 'onboarding:path:state'

interface SavedCustomState {
  kind: 'custom'
  goal: string
  nodes: CustomPathNode[]
  skip: string[]
}

export default function PathCustom() {
  const navigate = useNavigate()
  const [goal, setGoal] = useState<string>(() => {
    try {
      return window.localStorage.getItem(GOAL_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [nodes, setNodes] = useState<CustomPathNode[]>([])
  const [skip, setSkip] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const gen = useGenerateCustomPathMutation()

  const grouped = useMemo(() => {
    return nodes.reduce<Record<string, CustomPathNode[]>>((acc, n) => {
      ;(acc[n.group || 'misc'] ??= []).push(n)
      return acc
    }, {})
  }, [nodes])

  const handleGenerate = async () => {
    setError(null)
    const trimmed = goal.trim()
    if (trimmed.length < 5) return
    try {
      window.localStorage.setItem(GOAL_KEY, trimmed)
    } catch {
      /* ignore */
    }
    try {
      const res = await gen.mutateAsync(trimmed)
      const list = res.nodes ?? []
      if (list.length === 0) {
        setError('Пустой ответ от модели — попробуй переформулировать цель.')
        return
      }
      setNodes(list)
      setSkip(new Set())
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Unimplemented (no LLM) — мягкий fallback.
      if (/unimplemented/i.test(msg)) {
        setError('AI-генерация пока недоступна (LLM не сконфигурён). Цель сохранена.')
      } else {
        setError(msg)
      }
    }
  }

  const finish = () => {
    const trimmed = goal.trim()
    try {
      window.localStorage.setItem(GOAL_KEY, trimmed)
      if (nodes.length > 0) {
        const state: SavedCustomState = {
          kind: 'custom',
          goal: trimmed,
          nodes,
          skip: [...skip],
        }
        window.localStorage.setItem(STATE_KEY, JSON.stringify(state))
      }
    } catch {
      /* ignore */
    }
    navigate('/today')
  }

  const totalLearn = nodes.length - skip.size

  return (
    <OnboardingLayout step={1}>
      <div className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
        <Link
          to="/onboarding/path"
          className="inline-flex items-center gap-1 text-[12px] text-text-muted hover:text-text-primary"
        >
          <ArrowLeft className="h-3 w-3" /> К выбору пути
        </Link>
        <header className="mt-3 mb-6">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted">
            СВОЙ ПУТЬ
          </div>
          <h1 className="mt-1 font-display text-3xl font-bold leading-tight">
            Опиши цель
          </h1>
          <p className="mt-2 text-[14px] text-text-secondary">
            Чем точнее цель — тем релевантнее карта тем. Примеры:
            «Senior Go-разработчик в Booking», «ML researcher в LLM-стартап»,
            «Senior backend в Yandex Search».
          </p>
        </header>

        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={4}
          placeholder="Senior Go-разработчик в финтех с фокусом на realtime-сервисы…"
          className="w-full rounded-lg border border-border bg-surface-2 px-4 py-3 text-[14px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
        />

        <div className="mt-3 flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={goal.trim().length < 5 || gen.isPending}
            icon={
              gen.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )
            }
            onClick={handleGenerate}
          >
            {nodes.length > 0 ? 'Перегенерировать' : 'Сгенерировать карту тем'}
          </Button>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
            8–15 тем · ~3–8 секунд
          </span>
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-dashed border-warn bg-surface-1 p-3 text-[12px] text-text-secondary">
            {error}
          </div>
        )}

        {/* Generated nodes — group view + checkboxes */}
        {nodes.length > 0 && (
          <div className="mt-6">
            <div className="mb-3 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.16em] text-text-muted">
              <span>
                Учить: <b className="text-text-primary">{totalLearn}</b>
              </span>
              <span>
                Пропустить: <b className="text-text-primary">{skip.size}</b>
              </span>
            </div>
            <div className="flex flex-col gap-5">
              {Object.entries(grouped).map(([group, gNodes]) => (
                <section key={group}>
                  <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                    {group}
                  </div>
                  <ul className="flex flex-col gap-1">
                    {gNodes.map((n) => {
                      const isSkipped = skip.has(n.id)
                      return (
                        <li key={n.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setSkip((s) => {
                                const next = new Set(s)
                                if (next.has(n.id)) next.delete(n.id)
                                else next.add(n.id)
                                return next
                              })
                            }}
                            className={`group flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                              isSkipped
                                ? 'border-border bg-surface-2/50 opacity-60'
                                : 'border-border bg-surface-2 hover:border-accent'
                            }`}
                          >
                            <span
                              className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border ${
                                isSkipped
                                  ? 'border-border bg-transparent'
                                  : 'border-accent bg-accent'
                              }`}
                            >
                              {!isSkipped && (
                                <Check className="h-3 w-3 text-bg" />
                              )}
                            </span>
                            <span className="flex-1">
                              <span
                                className={`block text-[13px] ${
                                  isSkipped
                                    ? 'line-through text-text-muted'
                                    : 'text-text-primary'
                                }`}
                              >
                                {n.title}
                              </span>
                              {n.hint && (
                                <span className="mt-0.5 block text-[11px] text-text-muted">
                                  {n.hint}
                                </span>
                              )}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8 flex justify-end gap-2">
          <Button
            variant="ghost"
            size="md"
            onClick={() => navigate('/onboarding/path')}
          >
            Отмена
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={goal.trim().length < 5}
            iconRight={<ArrowRight className="h-4 w-4" />}
            onClick={finish}
          >
            Сохранить и начать
          </Button>
        </div>
      </div>
    </OnboardingLayout>
  )
}
