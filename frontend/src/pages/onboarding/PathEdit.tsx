// PathEdit — Wave «hybrid path» editor.
//
// Sergey 2026-05-03: «было бы круто взять готовый путь и редактировать —
// например путь устраивает, но математику знает и не хочет повторять».
// Юзер пришёл с /onboarding/path?preset=...; видит группированный список
// тем; toggle'ит чекбоксы какие SKIP'нуть. Save → сохраняем выбор в
// localStorage (V1) → /today.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'

import { OnboardingLayout } from './_shared/Layout'
import { Button } from '../../components/Button'
import { findPreset } from './pathPresets'

const STATE_KEY = 'onboarding:path:state'

interface SavedState {
  presetId: string
  // node ids которые юзер пометил «знаю / не учить».
  skip: string[]
}

export default function PathEdit() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const presetId = params.get('preset') ?? ''
  const preset = useMemo(() => findPreset(presetId), [presetId])
  const [skip, setSkip] = useState<Set<string>>(() => {
    try {
      const raw = window.localStorage.getItem(STATE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as SavedState
        if (parsed.presetId === presetId) return new Set(parsed.skip)
      }
    } catch {
      /* ignore */
    }
    return new Set()
  })

  useEffect(() => {
    if (!preset) return
    try {
      window.localStorage.setItem(
        STATE_KEY,
        JSON.stringify({ presetId, skip: [...skip] } satisfies SavedState),
      )
    } catch {
      /* ignore */
    }
  }, [presetId, preset, skip])

  if (!preset) {
    return (
      <OnboardingLayout step={1}>
        <div className="mx-auto max-w-md px-4 py-16 text-center">
          <p className="text-text-secondary">Preset не найден.</p>
          <Link to="/onboarding/path" className="mt-4 inline-block">
            <Button variant="primary">Выбрать другой</Button>
          </Link>
        </div>
      </OnboardingLayout>
    )
  }

  // Group nodes по preset.group для visual structure.
  const grouped = preset.nodes.reduce<Record<string, typeof preset.nodes>>((acc, n) => {
    ;(acc[n.group] ??= []).push(n)
    return acc
  }, {})

  const totalSkip = skip.size
  const totalLearn = preset.nodes.length - totalSkip

  const finish = () => {
    // V1: сохранение уже в localStorage. Backend wire — Phase 3.
    navigate('/today')
  }

  return (
    <OnboardingLayout step={1}>
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <Link
          to="/onboarding/path"
          className="inline-flex items-center gap-1 text-[12px] text-text-muted hover:text-text-primary"
        >
          <ArrowLeft className="h-3 w-3" /> К выбору пути
        </Link>
        <header className="mt-3 mb-2">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted">
            ПУТЬ · {preset.title}
          </div>
          <h1 className="mt-1 font-display text-3xl font-bold leading-tight">
            Что уже знаешь?
          </h1>
          <p className="mt-2 text-[14px] text-text-secondary">
            Сними галочки с тем, которые точно знаешь — мы пропустим их в
            рекомендациях. Можно вернуться и поменять позже.
          </p>
        </header>

        <div className="mb-3 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.16em] text-text-muted">
          <span>Учить: <b className="text-text-primary">{totalLearn}</b></span>
          <span>Пропустить: <b className="text-text-primary">{totalSkip}</b></span>
        </div>

        <div className="flex flex-col gap-5">
          {Object.entries(grouped).map(([group, nodes]) => (
            <section key={group}>
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                {group}
              </div>
              <ul className="flex flex-col gap-1">
                {nodes.map((n) => {
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
                        className={`group flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                          isSkipped
                            ? 'border-border bg-surface-2/50 opacity-60'
                            : 'border-border bg-surface-2 hover:border-accent'
                        }`}
                      >
                        <span
                          className={`grid h-4 w-4 place-items-center rounded border ${
                            isSkipped
                              ? 'border-border bg-transparent'
                              : 'border-accent bg-accent'
                          }`}
                        >
                          {!isSkipped && <Check className="h-3 w-3 text-bg" />}
                        </span>
                        <span
                          className={`flex-1 text-[13px] ${
                            isSkipped ? 'line-through text-text-muted' : 'text-text-primary'
                          }`}
                        >
                          {n.title}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>

        <div className="mt-8 flex justify-end">
          <Button
            variant="primary"
            size="md"
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
