// Renders compact state pill для atlas-node based на activity-log fuzzy
// match. Subscribes to activity store так что live updates flow when
// юзер логирует new activity.
//
// Hidden когда state='not_yet' — anti-fallback (нет смысла плюсом
// показывать «нет activity»; node sам по себе уже отображает progress=0).
//
// Compact mode — для inline list rows (sm dot + count).

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { computeCoverage, type CoverageState } from '../lib/atlasCoverage'
import { subscribeActivities } from '../lib/activity'

interface Props {
  nodeKey: string
  nodeTitle: string
  nodeSection: string
  compact?: boolean
}

const STATE_DOT: Record<CoverageState, string> = {
  covered: 'bg-text-primary',
  partial: 'bg-text-secondary',
  struggling: 'bg-text-muted',
  not_yet: '',
}

export function CoverageBadge({ nodeKey, nodeTitle, nodeSection, compact }: Props) {
  const { t } = useTranslation('atlas')
  const STATE_LABEL: Record<CoverageState, string> = {
    covered: t('coverage.label.covered'),
    partial: t('coverage.label.partial'),
    struggling: t('coverage.label.struggling'),
    not_yet: '',
  }
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const unsub = subscribeActivities(() => setTick((t) => t + 1))
    return () => {
      unsub()
    }
  }, [])
  void tick

  const cov = computeCoverage([
    { key: nodeKey, title: nodeTitle, section: nodeSection },
  ]).get(nodeKey)

  if (!cov || cov.state === 'not_yet') return null

  const title = t('coverage.match_title', {
    count: cov.matchCount30d,
    ago: formatAgo(cov.lastMatchAt, t),
  })

  if (compact) {
    return (
      <span
        className="inline-flex items-center gap-1 font-mono text-[10px] text-text-muted"
        title={title}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[cov.state]}`} aria-hidden />
        {cov.matchCount30d}
      </span>
    )
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-text-secondary"
      title={title}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[cov.state]}`} aria-hidden />
      {STATE_LABEL[cov.state]} · {cov.matchCount30d}
    </span>
  )
}

function formatAgo(ms: number | null, t: (k: string, opts?: Record<string, unknown>) => string): string {
  if (!ms) return '—'
  const diff = Date.now() - ms
  const days = Math.floor(diff / (24 * 60 * 60 * 1000))
  if (days <= 0) return t('coverage.ago.today')
  if (days === 1) return t('coverage.ago.yesterday')
  if (days < 7) return t('coverage.ago.days', { n: days })
  return t('coverage.ago.weeks', { n: Math.floor(days / 7) })
}
