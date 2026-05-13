// PathCustom — Wave «hybrid path» — custom-mode entry.
//
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

const captionMono: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-40)',
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
      <div className="mx-auto px-4 py-10 sm:py-14" style={{ maxWidth: 640 }}>
        <Link
          to="/onboarding/path"
          className="focus-ring"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            color: 'var(--ink-60)',
            textDecoration: 'none',
            padding: '4px 8px',
            borderRadius: 6,
            transition: 'color var(--motion-dur-small) var(--motion-ease-standard)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'rgb(var(--ink))')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-60)')}
        >
          <ArrowLeft style={{ width: 12, height: 12 }} /> К выбору пути
        </Link>
        <header style={{ marginTop: 14, marginBottom: 24 }}>
          <div style={captionMono}>СВОЙ ПУТЬ</div>
          <h1
            style={{
              margin: '8px 0 0',
              fontSize: 'var(--type-h1-size)',
              lineHeight: 'var(--type-h1-lh)',
              letterSpacing: 'var(--type-h1-ls)',
              fontWeight: 'var(--type-h1-weight)',
              color: 'rgb(var(--ink))',
            }}
          >
            Опиши цель
          </h1>
          <p
            style={{
              margin: '12px 0 0',
              maxWidth: 540,
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-lh)',
              color: 'var(--ink-60)',
            }}
          >
            Чем точнее цель — тем релевантнее карта тем. Примеры: «Senior Go-разработчик
            в Booking», «ML researcher в LLM-стартап», «Senior backend в Yandex Search».
          </p>
        </header>

        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={4}
          placeholder="Senior Go-разработчик в финтех с фокусом на realtime-сервисы…"
          className="focus-ring"
          aria-label="Цель"
          style={{
            width: '100%',
            padding: '12px 0',
            background: 'transparent',
            border: 0,
            borderBottom: '1px solid var(--hair-2)',
            color: 'rgb(var(--ink))',
            fontSize: 14,
            outline: 'none',
            resize: 'vertical',
            fontFamily: 'inherit',
            transition: 'border-color var(--motion-dur-small) var(--motion-ease-decelerate)',
          }}
          onFocus={(e) => (e.currentTarget.style.borderBottomColor = 'rgb(var(--ink))')}
          onBlur={(e) => (e.currentTarget.style.borderBottomColor = 'var(--hair-2)')}
        />

        <div className="flex-wrap-row" style={{ marginTop: 14, alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={goal.trim().length < 5 || gen.isPending}
            className="focus-ring motion-press"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              background: 'rgb(var(--ink))',
              color: 'rgb(var(--color-bg))',
              border: 0,
              borderRadius: 'var(--radius-inner)',
              fontSize: 13,
              fontWeight: 500,
              cursor: goal.trim().length < 5 || gen.isPending ? 'not-allowed' : 'pointer',
              opacity: goal.trim().length < 5 || gen.isPending ? 0.5 : 1,
              transition:
                'background-color var(--motion-dur-small) var(--motion-ease-standard), opacity var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
            }}
          >
            {gen.isPending ? <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> : <Sparkles style={{ width: 14, height: 14 }} />}
            {nodes.length > 0 ? 'Перегенерировать' : 'Сгенерировать карту тем'}
          </button>
          <span style={captionMono}>8–15 тем · ~3–8 секунд</span>
        </div>

        {error && (
          <div
            role="alert"
            style={{
              marginTop: 14,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              padding: '10px 14px',
              border: '1px dashed var(--hair-2)',
              borderRadius: 'var(--radius-inner)',
              fontSize: 12,
              color: 'var(--ink-60)',
              background: 'transparent',
            }}
          >
            <span aria-hidden="true" style={{ display: 'inline-block', width: 24, height: 1.5, background: 'var(--red)', marginTop: 6, flex: '0 0 auto' }} />
            <span>{error}</span>
          </div>
        )}

        {/* Generated nodes — group view + checkboxes */}
        {nodes.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div
              className="flex-wrap-row"
              style={{ marginBottom: 14, gap: 16, alignItems: 'center', color: 'var(--ink-60)' }}
            >
              <span style={captionMono}>
                Учить:{' '}
                <strong style={{ color: 'rgb(var(--ink))', fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
                  {totalLearn}
                </strong>
              </span>
              <span style={captionMono}>
                Пропустить:{' '}
                <strong style={{ color: 'rgb(var(--ink))', fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
                  {skip.size}
                </strong>
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {Object.entries(grouped).map(([group, gNodes]) => (
                <section key={group}>
                  <div style={{ ...captionMono, fontSize: 10, marginBottom: 8 }}>{group}</div>
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
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
                            className="focus-ring motion-press"
                            aria-pressed={!isSkipped}
                            style={{
                              display: 'flex',
                              width: '100%',
                              alignItems: 'flex-start',
                              gap: 12,
                              padding: '10px 14px',
                              border: '1px solid var(--hair-2)',
                              background: 'transparent',
                              borderRadius: 'var(--radius-inner)',
                              textAlign: 'left',
                              cursor: 'pointer',
                              opacity: isSkipped ? 0.5 : 1,
                              transition:
                                'background-color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), opacity var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
                            }}
                          >
                            <span
                              aria-hidden="true"
                              style={{
                                marginTop: 2,
                                display: 'grid',
                                placeItems: 'center',
                                width: 16,
                                height: 16,
                                border: isSkipped ? '1px solid var(--hair-2)' : 0,
                                borderRadius: 4,
                                background: isSkipped ? 'transparent' : 'rgb(var(--ink))',
                                color: 'rgb(var(--color-bg))',
                                flex: '0 0 auto',
                              }}
                            >
                              {!isSkipped && <Check style={{ width: 12, height: 12 }} />}
                            </span>
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <span
                                style={{
                                  display: 'block',
                                  fontSize: 13,
                                  color: isSkipped ? 'var(--ink-40)' : 'rgb(var(--ink))',
                                  textDecoration: isSkipped ? 'line-through' : 'none',
                                }}
                              >
                                {n.title}
                              </span>
                              {n.hint && (
                                <span style={{ marginTop: 2, display: 'block', fontSize: 11, color: 'var(--ink-40)', lineHeight: 1.5 }}>
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

        <div style={{ marginTop: 32, display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => navigate('/onboarding/path')}
            className="focus-ring motion-press"
            style={{
              padding: '10px 18px',
              background: 'transparent',
              color: 'var(--ink-60)',
              border: '1px solid var(--hair-2)',
              borderRadius: 'var(--radius-inner)',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
              transition:
                'background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
            }}
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={finish}
            disabled={goal.trim().length < 5}
            className="focus-ring motion-press"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 22px',
              background: 'rgb(var(--ink))',
              color: 'rgb(var(--color-bg))',
              border: 0,
              borderRadius: 'var(--radius-inner)',
              fontSize: 14,
              fontWeight: 500,
              cursor: goal.trim().length < 5 ? 'not-allowed' : 'pointer',
              opacity: goal.trim().length < 5 ? 0.5 : 1,
              transition:
                'background-color var(--motion-dur-small) var(--motion-ease-standard), opacity var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
            }}
          >
            Сохранить и начать <ArrowRight style={{ width: 16, height: 16 }} />
          </button>
        </div>
      </div>
    </OnboardingLayout>
  )
}
