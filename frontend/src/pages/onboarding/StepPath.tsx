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
//
// 2026-05-12: v2 visual language — hairline preset cards, accent icons
// neutralized (was `text-accent`), caption-mono labels 0.08em canonical.

import { useNavigate } from 'react-router-dom'
import { ArrowRight, BookOpen, Sparkles } from 'lucide-react'

import { OnboardingLayout } from './_shared/Layout'
import { PRESETS } from './pathPresets'

const STORAGE_KEY = 'onboarding:path:choice'

const captionMono: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-40)',
}

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
      <div className="mx-auto px-4 py-10 sm:py-14" style={{ maxWidth: 760 }}>
        <header className="text-center" style={{ marginBottom: 32 }}>
          <div style={captionMono}>ВЫБОР ПУТИ</div>
          <h1
            style={{
              margin: '12px 0 0',
              fontSize: 'var(--type-h1-size)',
              lineHeight: 'var(--type-h1-lh)',
              letterSpacing: 'var(--type-h1-ls)',
              fontWeight: 'var(--type-h1-weight)',
              color: 'rgb(var(--ink))',
            }}
          >
            Готовый путь или свой?
          </h1>
          <p
            style={{
              margin: '12px auto 0',
              maxWidth: 540,
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-lh)',
              color: 'var(--ink-60)',
            }}
          >
            У нас есть curated тропки для типовых ролей. Возьми готовый и убери темы, которые уже
            знаешь — или собери свой с нуля.
          </p>
        </header>

        {/* Preset cards */}
        <div
          className="auto-fit-grid"
          style={{ ['--auto-fit-min' as string]: '300px', ['--gap' as string]: '12px' }}
        >
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => pickPreset(p.id)}
              className="focus-ring motion-press"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                padding: '20px',
                borderRadius: 'var(--radius-outer)',
                border: '1px solid var(--hair-2)',
                background: 'transparent',
                textAlign: 'left',
                cursor: 'pointer',
                transition:
                  'background-color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.18)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.borderColor = 'var(--hair-2)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'rgb(var(--ink))' }}>
                <BookOpen style={{ width: 16, height: 16 }} />
                <h2
                  style={{
                    margin: 0,
                    fontSize: 'var(--type-h3-size)',
                    lineHeight: 'var(--type-h3-lh)',
                    letterSpacing: 'var(--type-h3-ls)',
                    fontWeight: 'var(--type-h3-weight)',
                    color: 'rgb(var(--ink))',
                  }}
                >
                  {p.title}
                </h2>
              </div>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--ink-60)' }}>{p.blurb}</p>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={captionMono}>{p.nodes.length} тем</span>
                <ArrowRight style={{ width: 14, height: 14, color: 'var(--ink-40)' }} />
              </div>
            </button>
          ))}
        </div>

        {/* Custom */}
        <div
          style={{
            marginTop: 18,
            padding: '20px',
            borderRadius: 'var(--radius-outer)',
            border: '1px dashed var(--hair-2)',
            background: 'transparent',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: 'rgb(var(--ink))' }}>
            <Sparkles style={{ width: 16, height: 16 }} />
            <h2
              style={{
                margin: 0,
                fontSize: 'var(--type-h3-size)',
                lineHeight: 'var(--type-h3-lh)',
                letterSpacing: 'var(--type-h3-ls)',
                fontWeight: 'var(--type-h3-weight)',
                color: 'rgb(var(--ink))',
              }}
            >
              Свой путь
            </h2>
          </div>
          <p style={{ margin: 0, marginBottom: 14, fontSize: 13, lineHeight: 1.55, color: 'var(--ink-60)' }}>
            Опиши цель в свободной форме («Senior Go в финтех», «ML researcher в LLM-стартап»).
            Мы соберём начальную карту тем, которую ты будешь редактировать дальше.
          </p>
          <button
            type="button"
            onClick={pickCustom}
            className="focus-ring motion-press"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px',
              border: '1px solid var(--hair-2)',
              borderRadius: 'var(--radius-inner)',
              background: 'transparent',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--ink-60)',
              cursor: 'pointer',
              transition:
                'background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'
              e.currentTarget.style.color = 'rgb(var(--ink))'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--ink-60)'
            }}
          >
            Описать цель <ArrowRight style={{ width: 14, height: 14 }} />
          </button>
        </div>
      </div>
    </OnboardingLayout>
  )
}
