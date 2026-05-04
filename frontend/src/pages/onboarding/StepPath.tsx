// StepPath — Wave «hybrid path»: preset OR custom.
//
// Sergey 2026-05-03: «при выборе трека спрашивает по какому пути хочешь
// пойти (есть готовый атлас) либо пользователь сам себе назначает трек.
// Также было бы круто взять готовый путь и потом редактировать —
// например путь устраивает, но математику знает и не хочет повторять».
//
// Flow:
//   /onboarding/path        — этот компонент: 2 column choose preset/custom
//   /onboarding/path/edit   — pre-fill preset → checkbox toggle тем
//   /onboarding/path/custom — free-form textarea (AI-generated в будущем)
//
// V1 — frontend-only mock: presets hardcoded, выборы сохраняем в
// localStorage. Backend `user_custom_paths` table + AI-generator —
// отдельной волной (Phase 3 в roadmap'е).
//
// После save → /today (новый landing).

import { useNavigate } from 'react-router-dom'
import { ArrowRight, BookOpen, Sparkles } from 'lucide-react'

import { OnboardingLayout } from './_shared/Layout'
import { Button } from '../../components/Button'
import { PRESETS } from './pathPresets'

const STORAGE_KEY = 'onboarding:path:choice'

export default function StepPath() {
  const navigate = useNavigate()

  const pickPreset = (presetId: string) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ kind: 'preset', presetId }))
    } catch {
      /* private mode */
    }
    navigate(`/onboarding/path/edit?preset=${encodeURIComponent(presetId)}`)
  }

  const pickCustom = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ kind: 'custom' }))
    } catch {
      /* ignore */
    }
    navigate('/onboarding/path/custom')
  }

  return (
    <OnboardingLayout step={1}>
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <header className="mb-8 text-center">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted">
            ВЫБОР ПУТИ
          </div>
          <h1 className="mt-2 font-display text-3xl font-bold leading-tight">
            Готовый путь или свой?
          </h1>
          <p className="mt-3 text-[14px] text-text-secondary">
            У нас есть curated тропки для типовых ролей. Возьми готовый и
            убери темы, которые уже знаешь — или собери свой с нуля.
          </p>
        </header>

        {/* Preset cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => pickPreset(p.id)}
              className="group flex flex-col gap-2 rounded-xl border border-border bg-surface-1 p-5 text-left transition-colors hover:border-accent"
            >
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-accent" />
                <h2 className="font-display text-base font-bold">{p.title}</h2>
              </div>
              <p className="text-[13px] leading-relaxed text-text-secondary">{p.blurb}</p>
              <div className="mt-1 flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
                  {p.nodes.length} тем
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-text-muted group-hover:text-accent" />
              </div>
            </button>
          ))}
        </div>

        {/* Custom */}
        <div className="mt-6 rounded-xl border border-dashed border-border bg-surface-1 p-5">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-4 w-4 text-accent" />
            <h2 className="font-display text-base font-bold">Свой путь</h2>
          </div>
          <p className="mb-3 text-[13px] leading-relaxed text-text-secondary">
            Опиши цель в свободной форме («Senior Go в финтех», «ML researcher
            в LLM-стартап»). Мы соберём начальную карту тем, которую ты
            будешь редактировать дальше.
          </p>
          <Button
            variant="ghost"
            size="sm"
            iconRight={<ArrowRight className="h-3.5 w-3.5" />}
            onClick={pickCustom}
          >
            Описать цель
          </Button>
        </div>
      </div>
    </OnboardingLayout>
  )
}
