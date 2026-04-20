import { ReactNode } from 'react'

type Props = {
  children: ReactNode
  subtitle?: string
  right?: ReactNode
}

export function PanelHead({ children, subtitle, right }: Props) {
  return (
    <div className="panel-head">
      <span className="ornament">✦</span>
      <span>{children}</span>
      {subtitle && (
        <>
          <span className="ornament">·</span>
          <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
            {subtitle}
          </span>
        </>
      )}
      {right && <div style={{ marginLeft: 'auto' }}>{right}</div>}
    </div>
  )
}
