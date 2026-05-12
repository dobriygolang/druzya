// ProGate — wrapper, который рендерит children только если у юзера есть
// Pro features (paid OR BYOK). Free → fallback с upgrade prompt'ом.
//
// Usage:
//   <ProGate feature="mock_pipeline">
//     <MockPipelineUI />
//   </ProGate>
//
// B/W design: 1.5px полоса слева (red accent dot only, не fill) для
// Free-prompt blocка; Pro/BYOK badge — font-mono uppercase, без gradient.
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Button } from './Button'
import { Card } from './Card'
import { analytics, ANALYTICS_EVENTS } from '../lib/analytics'
import { hasProAccess, useTierQuery } from '../lib/queries/tier'

// FeatureKey — список фич, чтобы текст в upgrade-prompt был контекстным.
// Расширяем по мере добавления paywall-точек.
export type FeatureKey =
  | 'mock_pipeline'
  | 'deep_analytics'
  | 'premium_cue'
  | 'gcal_sync'
  | 'goal_analytics'
  | 'generic'

type FeatureCopy = { title: string; body: string }

// FEATURE_COPY — короткие prompt'ы. Free-юзер видит конкретику «что
// он получит», не абстрактное «upgrade now».
const FEATURE_COPY: Record<FeatureKey, FeatureCopy> = {
  mock_pipeline: {
    title: 'Полный AI-mock pipeline — Pro',
    body: 'Mini-mock доступен бесплатно. Полный multi-stage pipeline с AI-feedback и radar score — нужен Pro или свой LLM-ключ (BYOK).',
  },
  deep_analytics: {
    title: 'Deep readiness analytics — Pro',
    body: 'Базовый activity log бесплатен. Прогноз готовности к интервью + drift detection — Pro или BYOK.',
  },
  premium_cue: {
    title: 'Premium Cue — Pro',
    body: 'Cue basic (20 LLM calls/day) бесплатен. Безлимит + лучшая модель — Pro или BYOK.',
  },
  gcal_sync: {
    title: 'Google Calendar sync — Pro',
    body: 'Двунаправленная синхронизация Hone-плана с Google Calendar — Pro или BYOK.',
  },
  goal_analytics: {
    title: 'Advanced goal analytics — Pro',
    body: 'Per-skill радар, weekly trends, target-date estimator — Pro или BYOK.',
  },
  generic: {
    title: 'Pro feature',
    body: 'Эта фича доступна на Pro или с подключённым своим LLM-ключом (BYOK, бесплатно).',
  },
}

export interface ProGateProps {
  feature?: FeatureKey
  /** Что показать вместо upgrade-prompt'а. По умолчанию — InlinePrompt. */
  fallback?: React.ReactNode
  children: React.ReactNode
}

// ProGate — проверяет tier и решает, что рендерить. Loading-state — null
// (не пинаем фронт пустым flash; consumer всё равно показывает свой
// скелетон выше по дереву).
export function ProGate({ feature = 'generic', fallback, children }: ProGateProps) {
  const tier = useTierQuery()
  if (tier.isLoading) return null
  if (hasProAccess(tier.data)) return <>{children}</>
  return <>{fallback ?? <InlinePrompt feature={feature} />}</>
}

// InlinePrompt — компактный upgrade-блок. B/W: левая полоса 1.5px белого,
// .indicator-dot — единственный 6px красный кружок (брендовая точка,
// не gradient/fill). См memory/feedback_color_rule.md.
function InlinePrompt({ feature }: { feature: FeatureKey }) {
  const copy = FEATURE_COPY[feature]
  // Phase J / X3 — fire upgrade_modal_shown once per mount. `feature`
  // bucket is categorical (whitelisted in FeatureKey union) → safe to
  // send без sanitization concerns.
  useEffect(() => {
    analytics.track(ANALYTICS_EVENTS.upgrade_modal_shown, { feature })
  }, [feature])
  return (
    <Card className="flex-col gap-4 border-l-[1.5px] border-l-text-primary p-6">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-1.5 inline-block h-1.5 w-1.5 rounded-full bg-danger"
        />
        <div className="flex min-w-0 flex-col gap-1">
          <h4 className="font-display text-[15px] font-bold text-text-primary">
            {copy.title}
          </h4>
          <p className="text-[13px] text-text-secondary">{copy.body}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          to="/settings/billing"
          onClick={() => analytics.track(ANALYTICS_EVENTS.upgrade_modal_clicked, { feature })}
        >
          <Button variant="primary" size="md">
            Открыть billing
          </Button>
        </Link>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted self-center">
          Pro 990₽/mo · BYOK free
        </span>
      </div>
    </Card>
  )
}

// TierBadge — единый бейдж для current-tier indicator (Settings, header).
// B/W: font-mono uppercase, surface-2 bg, 1.5px stripe слева для BYOK.
export function TierBadge() {
  const tier = useTierQuery()
  if (tier.isLoading || !tier.data) {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
        loading…
      </span>
    )
  }
  const { tier: tierKind, source } = tier.data
  const label = source === 'byok' ? 'PRO · BYOK' : source.toUpperCase()
  const isPro = source === 'pro' || source === 'byok'
  return (
    <span
      className={[
        'font-mono text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md',
        source === 'byok' ? 'border-l-[1.5px] border-l-text-primary' : '',
        isPro ? 'bg-text-primary/15 text-text-primary' : 'bg-surface-2 text-text-secondary',
      ].join(' ')}
      title={`tier=${tierKind} source=${source}`}
    >
      {label}
    </span>
  )
}
