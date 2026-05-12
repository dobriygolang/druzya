// Onboarding Step 0 — multi-track selection (Wave-0 of feature plan, see
// docs/feature/tracks.md). Lives BEFORE the existing Wave-10 5-step flow:
//   /onboarding/tracks → /onboarding/welcome → ... → /onboarding/done.
//
// Why a separate step (and not inline into Step2Class):
//   - focus_class is a within-track specialization (algo/backend/system/...)
//     while track is the higher-level persona (dev/dev_senior/sysanalyst/
//     english/...). They are orthogonal.
//   - Multi-select needs different UX from focus_class single-select.
//   - Adding tracks doesn't disturb the existing 5-step flow's i18n /
//     state contract — both can evolve independently.
//
// Persistence: PUT /api/v1/profile/me/tracks (SetUserTracks RPC). On
// failure, the form stays mounted with an error message; we never
// silently advance.
//
// 2026-05-12: v2 visual language — hairline track cards, selection = white
// border + red signal stripe, hairline seniority chips, primary = red signal
// dot, error banner = red stripe.

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { OnboardingLayout } from './_shared/Layout'
import { api, ApiError } from '../../lib/apiClient'

// Wire-side enum values mirror druz9.v1.Track (proto3 JSON encoding uses
// the prefixed UPPER_SNAKE name, not the lowercase DB value).
type WireTrack =
  | 'TRACK_DEV'
  | 'TRACK_DEV_SENIOR'
  | 'TRACK_SYSANALYST'
  | 'TRACK_PRODUCT_ANALYST'
  | 'TRACK_QA'
  | 'TRACK_ENGLISH'

type Seniority = '' | 'junior' | 'middle' | 'senior' | 'lead'

type Card = {
  wire: WireTrack
  title: string
  blurb: string
  needsSeniority: boolean
}

const CARDS: Card[] = [
  { wire: 'TRACK_DEV', title: 'Разработчик', blurb: 'Алгоритмы, бэкенд, базовый mock. Junior / Middle.', needsSeniority: true },
  { wire: 'TRACK_DEV_SENIOR', title: 'Senior dev', blurb: 'System Design, Tech Lead / EM, code-review.', needsSeniority: true },
  { wire: 'TRACK_SYSANALYST', title: 'Системный аналитик', blurb: 'BPMN, use-cases, SQL, requirements gathering.', needsSeniority: true },
  { wire: 'TRACK_PRODUCT_ANALYST', title: 'Product analyst', blurb: 'Метрики, A/B, SQL, dashboards.', needsSeniority: true },
  { wire: 'TRACK_QA', title: 'QA / тестировщик', blurb: 'Тест-дизайн, API-тестирование, автотесты.', needsSeniority: true },
  { wire: 'TRACK_ENGLISH', title: 'English', blurb: 'Дисциплина-слой между тобой и твоим тутром.', needsSeniority: false },
]

type PickState = {
  picked: Set<WireTrack>
  seniority: Map<WireTrack, Seniority>
  primary: WireTrack | null
}

function reduceClick(s: PickState, wire: WireTrack): PickState {
  const picked = new Set(s.picked)
  const seniority = new Map(s.seniority)
  let primary = s.primary
  if (picked.has(wire)) {
    picked.delete(wire)
    seniority.delete(wire)
    if (primary === wire) {
      // Promote the most-recently-picked remaining track. Set iteration
      // preserves insertion order — последний элемент = самый свежий
      // pick (раньше брали первый = oldest, что противоречило comment'у
      // и удивляло юзера).
      const arr = [...picked]
      primary = arr.length > 0 ? (arr[arr.length - 1] ?? null) : null
    }
  } else {
    picked.add(wire)
    if (wire !== 'TRACK_ENGLISH') {
      seniority.set(wire, 'middle')
    }
    if (primary === null) {
      primary = wire
    }
  }
  return { picked, seniority, primary }
}

const captionMono: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-40)',
}

export default function Step0Tracks() {
  const nav = useNavigate()
  const [state, setState] = useState<PickState>(() => ({
    picked: new Set(),
    seniority: new Map(),
    primary: null,
  }))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const items = useMemo(() => {
    return Array.from(state.picked).map((wire) => ({
      track: wire,
      seniority: wire === 'TRACK_ENGLISH' ? '' : state.seniority.get(wire) ?? 'middle',
      primary: state.primary === wire,
    }))
  }, [state])

  const canContinue = state.picked.size > 0 && state.primary !== null

  const handleContinue = async () => {
    if (!canContinue || submitting) return
    setError(null)
    setSubmitting(true)
    try {
      await api<unknown>('/profile/me/tracks', {
        method: 'PUT',
        body: JSON.stringify({ items }),
      })
      nav('/onboarding/welcome')
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        // apiClient redirects on 401 already; just stop spinner.
        return
      }
      setError(e instanceof Error ? e.message : 'Не удалось сохранить выбор')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <OnboardingLayout step={1} total={5}>
      <div className="text-center" style={{ marginBottom: 28 }}>
        <div style={{ ...captionMono, marginBottom: 10 }}>шаг 0 · треки</div>
        <h2
          style={{
            margin: 0,
            marginBottom: 8,
            fontSize: 'var(--type-h2-size)',
            lineHeight: 'var(--type-h2-lh)',
            letterSpacing: 'var(--type-h2-ls)',
            fontWeight: 'var(--type-h2-weight)',
            color: 'rgb(var(--ink))',
          }}
        >
          Кто ты и над чем хочешь расти?
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-60)', lineHeight: 1.55, maxWidth: '60ch', marginInline: 'auto' }}>
          Выбери один трек или несколько — мы покажем разный Atlas, разные mock-сессии и разные подсказки.
          Любой выбор можно поменять в Settings.
        </p>
      </div>

      <div
        className="auto-fit-grid"
        style={{ ['--auto-fit-min' as string]: '240px', ['--gap' as string]: '10px', marginBottom: 24 }}
      >
        {CARDS.map((c) => {
          const selected = state.picked.has(c.wire)
          const isPrimary = state.primary === c.wire
          return (
            <div
              key={c.wire}
              style={{
                position: 'relative',
                padding: '16px 18px',
                background: selected ? 'rgba(255, 255, 255, 0.04)' : 'transparent',
                border: selected ? '1.5px solid rgb(var(--ink))' : '1px solid var(--hair-2)',
                borderRadius: 'var(--radius-outer)',
                transition:
                  'background-color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard)',
              }}
            >
              {selected && (
                <span
                  aria-hidden="true"
                  style={{ position: 'absolute', top: 16, right: 16, width: 24, height: 1.5, background: 'var(--red)' }}
                />
              )}
              <button
                type="button"
                onClick={() => setState((s) => reduceClick(s, c.wire))}
                aria-pressed={selected}
                className="focus-ring"
                style={{
                  textAlign: 'left',
                  width: '100%',
                  background: 'transparent',
                  border: 0,
                  padding: 0,
                  cursor: 'pointer',
                  color: 'rgb(var(--ink))',
                }}
              >
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    letterSpacing: '-0.005em',
                    marginBottom: 6,
                    color: 'rgb(var(--ink))',
                  }}
                >
                  {c.title}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-60)', lineHeight: 1.55, marginBottom: 12 }}>{c.blurb}</div>
              </button>

              {selected && c.needsSeniority && (
                <div className="flex-wrap-row" style={{ gap: 6, marginTop: 8 }}>
                  {(['junior', 'middle', 'senior', 'lead'] as const).map((s) => {
                    const active = state.seniority.get(c.wire) === s
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() =>
                          setState((prev) => {
                            const next = new Map(prev.seniority)
                            next.set(c.wire, s)
                            return { ...prev, seniority: next }
                          })
                        }
                        className="focus-ring motion-press"
                        style={{
                          padding: '4px 10px',
                          border: active ? '1px solid rgb(var(--ink))' : '1px solid var(--hair-2)',
                          background: active ? 'rgb(var(--ink))' : 'transparent',
                          color: active ? 'rgb(var(--color-bg))' : 'var(--ink-60)',
                          borderRadius: 999,
                          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                          fontSize: 10,
                          fontWeight: 600,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          cursor: 'pointer',
                          transition:
                            'background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
                        }}
                      >
                        {s}
                      </button>
                    )
                  })}
                </div>
              )}

              {selected && state.picked.size > 1 && (
                <button
                  type="button"
                  onClick={() => setState((prev) => ({ ...prev, primary: c.wire }))}
                  aria-pressed={isPrimary}
                  className="focus-ring motion-press"
                  style={{
                    marginTop: 12,
                    width: '100%',
                    padding: '6px 10px',
                    background: 'transparent',
                    border: '1px solid var(--hair-2)',
                    color: isPrimary ? 'rgb(var(--ink))' : 'var(--ink-40)',
                    borderRadius: 'var(--radius-inner)',
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    transition:
                      'color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
                  }}
                >
                  {isPrimary && (
                    <span
                      aria-hidden="true"
                      style={{ display: 'inline-block', width: 5, height: 5, borderRadius: 999, background: 'var(--red)' }}
                    />
                  )}
                  {isPrimary ? 'primary' : 'сделать primary'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {error && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            padding: '10px 14px',
            border: '1px solid rgba(255, 59, 48, 0.4)',
            borderRadius: 'var(--radius-inner)',
            fontSize: 13,
            color: 'var(--red)',
            background: 'transparent',
            marginBottom: 16,
          }}
        >
          <span style={{ display: 'inline-block', width: 1.5, minHeight: 16, background: 'var(--red)', marginTop: 4, flex: '0 0 auto' }} />
          {error}
        </div>
      )}

      <div className="flex-wrap-row" style={{ alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--ink-60)' }}>
          {state.picked.size === 0
            ? 'выбери хотя бы один трек'
            : (
              <>
                выбрано: <strong style={{ color: 'rgb(var(--ink))', fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontWeight: 600 }}>{state.picked.size}</strong>
                {' · primary: '}
                <strong style={{ color: 'rgb(var(--ink))', fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontWeight: 600 }}>{state.primary ?? '—'}</strong>
              </>
            )}
        </div>
        <button
          type="button"
          onClick={handleContinue}
          disabled={!canContinue || submitting}
          className="focus-ring motion-press"
          style={{
            padding: '10px 22px',
            background: 'rgb(var(--ink))',
            color: 'rgb(var(--color-bg))',
            border: 0,
            borderRadius: 'var(--radius-inner)',
            fontSize: 14,
            fontWeight: 500,
            cursor: !canContinue || submitting ? 'not-allowed' : 'pointer',
            opacity: !canContinue || submitting ? 0.5 : 1,
            transition:
              'background-color var(--motion-dur-small) var(--motion-ease-standard), opacity var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
          }}
        >
          {submitting ? 'сохраняем…' : 'Далее →'}
        </button>
      </div>
    </OnboardingLayout>
  )
}
