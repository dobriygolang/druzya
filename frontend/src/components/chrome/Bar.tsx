import { CSSProperties } from 'react'

type Tone = 'gold' | 'blood' | 'ember' | 'mana'
type Props = {
  value: number
  max?: number
  tone?: Tone
  tall?: boolean
  className?: string
  style?: CSSProperties
}

export function Bar({
  value,
  max = 100,
  tone = 'gold',
  tall,
  className = '',
  style,
}: Props) {
  const pct = Math.min(100, Math.max(0, (value / Math.max(1, max)) * 100))
  const fillClass =
    tone === 'blood'
      ? 'bar-fill-blood'
      : tone === 'ember'
        ? 'bar-fill-ember'
        : tone === 'mana'
          ? 'bar-fill-mana'
          : 'bar-fill'
  return (
    <div className={`bar ${tall ? 'bar-tall' : ''} ${className}`} style={style}>
      <div className={fillClass} style={{ width: `${pct}%` }} />
    </div>
  )
}
