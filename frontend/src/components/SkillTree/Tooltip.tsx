import { useTranslation } from 'react-i18next'
import type { AtlasNode } from '../../lib/queries/profile'

type Props = {
  node: AtlasNode
  x: number // client px
  y: number // client px
  accent: string
}

// Native HTML tooltip — positioned at mouse coords, above the SVG.
export function Tooltip({ node, x, y, accent }: Props) {
  const { t } = useTranslation()
  const kindLabel =
    node.kind === 'keystone'
      ? 'KEYSTONE'
      : node.kind === 'ascendant'
        ? 'ASCENDANT'
        : 'NORMAL'
  return (
    <div
      className="tooltip"
      style={{
        position: 'fixed',
        left: Math.min(x + 18, window.innerWidth - 320),
        top: Math.min(y + 14, window.innerHeight - 180),
        pointerEvents: 'none',
        zIndex: 40,
        minWidth: 240,
        maxWidth: 300,
      }}
    >
      <div className="tooltip-head">{node.title}</div>
      <div className="tooltip-body">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 8,
            fontFamily: 'var(--font-code)',
            fontSize: 10,
            letterSpacing: '0.2em',
            color: 'var(--text-mid)',
            textTransform: 'uppercase',
          }}
        >
          <span style={{ color: accent }}>
            {t(`sections.${node.section}`, node.section)}
          </span>
          <span style={{ color: 'var(--gold-dim)' }}>{kindLabel}</span>
        </div>

        {node.description && (
          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              color: 'var(--text-bright)',
              lineHeight: 1.5,
            }}
          >
            {node.description}
          </div>
        )}

        <div
          style={{
            marginTop: 10,
            display: 'flex',
            justifyContent: 'space-between',
            fontFamily: 'var(--font-code)',
            fontSize: 10,
            color: 'var(--ember-lit)',
            letterSpacing: '0.1em',
          }}
        >
          <span style={{ color: 'var(--text-mid)' }}>XP</span>
          <span>{node.progress}%</span>
        </div>
        <div className="bar" style={{ marginTop: 4, height: 6 }}>
          <div
            className="bar-fill-ember"
            style={{ width: `${Math.max(0, Math.min(100, node.progress))}%` }}
          />
        </div>

        <div
          style={{
            marginTop: 10,
            paddingTop: 8,
            borderTop: '1px solid var(--metal-dark)',
            fontFamily: 'var(--font-code)',
            fontSize: 10,
            letterSpacing: '0.15em',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span
            style={{
              color: node.unlocked ? 'var(--ember-lit)' : 'var(--text-dim)',
            }}
          >
            {node.unlocked ? t('atlas.unlocked') : t('atlas.locked')}
          </span>
          {node.decaying && (
            <span style={{ color: 'var(--blood-lit)' }}>
              ◈ {t('atlas.decaying')}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
