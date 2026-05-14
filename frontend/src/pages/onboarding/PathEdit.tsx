// PathEdit — Wave «hybrid path» editor.
//
// Юзер пришёл с /onboarding/path?preset=...; видит группированный список
// тем; toggle'ит чекбоксы какие SKIP'нуть. Save → сохраняем выбор в
// localStorage (V1) → /today.

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'

import { OnboardingLayout } from './_shared/Layout'
import { findPreset } from './pathPresets'

const STATE_KEY = 'onboarding:path:state'

interface SavedState {
  presetId: string
  // node ids которые юзер пометил «знаю / не учить».
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

export default function PathEdit() {
  const { t } = useTranslation('wave14')
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
        <div className="mx-auto px-4 py-16 text-center" style={{ maxWidth: 460 }}>
          <p style={{ color: 'var(--ink-60)', fontSize: 14 }}>{t('onboarding_path.preset_not_found')}</p>
          <Link
            to="/onboarding/path"
            className="focus-ring motion-press"
            style={{
              display: 'inline-flex',
              marginTop: 16,
              padding: '10px 22px',
              background: 'rgb(var(--ink))',
              color: 'rgb(var(--color-bg))',
              border: 0,
              borderRadius: 'var(--radius-inner)',
              fontSize: 14,
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            {t('onboarding_path.pick_other')}
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
      <div className="mx-auto px-4 py-10 sm:py-14" style={{ maxWidth: 760 }}>
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
          <ArrowLeft style={{ width: 12, height: 12 }} /> {t('onboarding_path.to_path_picker')}
        </Link>
        <header style={{ marginTop: 14, marginBottom: 12 }}>
          <div style={captionMono}>{t('onboarding_path.path_label')} {preset.title.toUpperCase()}</div>
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
            {t('onboarding_path.edit_title')}
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
            {t('onboarding_path.edit_hint')}
          </p>
        </header>

        <div
          className="flex-wrap-row"
          style={{ marginBottom: 16, gap: 16, alignItems: 'center', color: 'var(--ink-60)', fontSize: 12 }}
        >
          <span style={captionMono}>
            {t('onboarding_path.learn')}{' '}
            <strong style={{ color: 'rgb(var(--ink))', fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
              {totalLearn}
            </strong>
          </span>
          <span style={captionMono}>
            {t('onboarding_path.skip_topic')}{' '}
            <strong style={{ color: 'rgb(var(--ink))', fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
              {totalSkip}
            </strong>
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {Object.entries(grouped).map(([group, nodes]) => (
            <section key={group}>
              <div style={{ ...captionMono, fontSize: 10, marginBottom: 8 }}>{group}</div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
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
                        className="focus-ring motion-press"
                        aria-pressed={!isSkipped}
                        style={{
                          display: 'flex',
                          width: '100%',
                          alignItems: 'center',
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
                        onMouseEnter={(e) => {
                          if (!isSkipped) e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.22)'
                        }}
                        onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--hair-2)')}
                      >
                        <span
                          aria-hidden="true"
                          style={{
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
                        <span
                          style={{
                            flex: 1,
                            minWidth: 0,
                            fontSize: 13,
                            color: isSkipped ? 'var(--ink-40)' : 'rgb(var(--ink))',
                            textDecoration: isSkipped ? 'line-through' : 'none',
                          }}
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

        <div style={{ marginTop: 32, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={finish}
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
              cursor: 'pointer',
              transition:
                'background-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
            }}
          >
            {t('onboarding_path.save_start')} <ArrowRight style={{ width: 16, height: 16 }} />
          </button>
        </div>
      </div>
    </OnboardingLayout>
  )
}
