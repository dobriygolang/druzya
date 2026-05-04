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

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { OnboardingLayout } from './_shared/Layout'
import { api, ApiError } from '../../lib/apiClient'
import { cn } from '../../lib/cn'

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
      <div className="text-center mb-7">
        <div className="font-mono text-[11px] uppercase tracking-wider text-text-muted mb-2">
          шаг 0 · треки
        </div>
        <h2 className="font-display text-2xl font-bold mb-1.5">Кто ты и над чем хочешь расти?</h2>
        <p className="text-[13px] text-text-secondary">
          Выбери один трек или несколько — мы покажем разный Atlas, разные mock-сессии и разные подсказки.
          Любой выбор можно поменять в Settings.
        </p>
      </div>

      <div className="stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        {CARDS.map((c) => {
          const selected = state.picked.has(c.wire)
          const isPrimary = state.primary === c.wire
          return (
            <div
              key={c.wire}
              className={cn(
                'rounded-xl border p-4 transition-colors',
                selected ? 'border-text-primary bg-text-primary/5' : 'border-border hover:border-border-strong',
              )}
            >
              <button
                type="button"
                onClick={() => setState((s) => reduceClick(s, c.wire))}
                aria-pressed={selected}
                className="text-left w-full"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="font-display text-[15px] font-bold">{c.title}</div>
                  {selected && (
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-text-primary text-[10px] font-bold text-bg">
                      ✓
                    </span>
                  )}
                </div>
                <div className="text-[12px] text-text-secondary leading-relaxed mb-3">{c.blurb}</div>
              </button>

              {selected && c.needsSeniority && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {(['junior', 'middle', 'senior', 'lead'] as const).map((s) => {
                    const active = state.seniority.get(c.wire) === s
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setState((prev) => {
                          const next = new Map(prev.seniority)
                          next.set(c.wire, s)
                          return { ...prev, seniority: next }
                        })}
                        className={cn(
                          'rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors',
                          active
                            ? 'border-text-primary bg-text-primary text-bg'
                            : 'border-border text-text-secondary hover:border-border-strong',
                        )}
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
                  className={cn(
                    'mt-3 w-full text-center rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors',
                    isPrimary
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border text-text-muted hover:border-border-strong',
                  )}
                  aria-pressed={isPrimary}
                >
                  {isPrimary ? '★ primary' : 'сделать primary'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-[12px] text-accent">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <div className="text-[12px] text-text-secondary">
          {state.picked.size === 0
            ? 'выбери хотя бы один трек'
            : `выбрано: ${state.picked.size} · primary: ${state.primary ?? '—'}`}
        </div>
        <button
          type="button"
          onClick={handleContinue}
          disabled={!canContinue || submitting}
          className="rounded-md bg-text-primary hover:bg-text-primary/90 text-bg font-medium text-sm px-5 py-2.5 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {submitting ? 'сохраняем…' : 'Далее →'}
        </button>
      </div>
    </OnboardingLayout>
  )
}
