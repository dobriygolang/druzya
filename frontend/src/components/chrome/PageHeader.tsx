import { ReactNode } from 'react'

type Props = {
  title: string
  subtitle?: string
  right?: ReactNode
}

// Bilingual page header — "Святилище · SANCTUM" style (bible §3).
export function PageHeader({ title, subtitle, right }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        marginBottom: 20,
        paddingBottom: 12,
        borderBottom: '1px solid var(--gold-faint)',
      }}
    >
      <div>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 26,
            color: 'var(--gold-bright)',
            letterSpacing: '0.12em',
            lineHeight: 1,
          }}
        >
          {title}
          {subtitle && (
            <span
              style={{
                color: 'var(--gold-dim)',
                fontSize: 14,
                marginLeft: 12,
                letterSpacing: '0.25em',
              }}
            >
              · {subtitle}
            </span>
          )}
        </h1>
      </div>
      {right && <div>{right}</div>}
    </div>
  )
}
