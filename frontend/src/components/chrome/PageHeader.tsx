import { ReactNode } from 'react'

type Props = {
  title: string
  /** Optional secondary line, displayed BELOW the title in a smaller mute
      font. Use this for genuine context — interview date, slot id, mode —
      NOT for an English mirror of the Russian title (that's just noise). */
  subtitle?: string
  right?: ReactNode
}

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
        gap: 16,
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
        </h1>
        {subtitle && (
          <div
            style={{
              marginTop: 6,
              color: 'var(--text-mid)',
              fontSize: 11,
              letterSpacing: '0.18em',
              fontFamily: 'var(--font-display)',
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
      {right && <div>{right}</div>}
    </div>
  )
}
