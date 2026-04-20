import { CSSProperties } from 'react'

type Tone = 'blood' | 'mana' | 'gold'

type Props = {
  value: number
  max: number
  label?: string
  tone?: Tone
  size?: number
}

export function Orb({ value, max, label, tone = 'blood', size = 120 }: Props) {
  const pct = Math.min(100, Math.max(0, (value / Math.max(1, max)) * 100))
  const bgStyle: CSSProperties =
    tone === 'mana'
      ? { background: 'radial-gradient(circle at 35% 30%, #1a1a5a, #060a1a 70%)' }
      : tone === 'gold'
        ? { background: 'radial-gradient(circle at 35% 30%, #3a2d14, #0a0804 70%)' }
        : {}
  const fillStyle: CSSProperties =
    tone === 'mana'
      ? {
          background:
            'linear-gradient(180deg, rgba(100,100,255,0.8), rgba(40,40,160,0.95))',
        }
      : tone === 'gold'
        ? {
            background:
              'linear-gradient(180deg, rgba(232,200,122,0.85), rgba(200,169,110,0.95))',
          }
        : {}
  return (
    <div className="orb" style={{ width: size, height: size, ...bgStyle }}>
      <div className="orb-fill" style={{ height: `${pct}%`, ...fillStyle }} />
      <div className="orb-label">
        <div style={{ fontSize: Math.round(size * 0.15), fontWeight: 700 }}>
          {value}
        </div>
        {label ? (
          <div
            style={{
              fontSize: Math.round(size * 0.075),
              color: 'var(--text-mid)',
              letterSpacing: '0.15em',
            }}
          >
            {label}
          </div>
        ) : (
          <div
            style={{
              fontSize: Math.round(size * 0.075),
              color: 'var(--text-mid)',
              letterSpacing: '0.15em',
            }}
          >
            / {max}
          </div>
        )}
      </div>
    </div>
  )
}
