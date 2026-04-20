import { ReactNode } from 'react'

type Props = {
  children: ReactNode
  /** Deprecated: was used as a small-caps English subhead, but it duplicated
      the Russian title for ru-locale users (e.g. "Гильдия · GUILD"). The
      i18n key already yields the right language. Prop is kept so old call
      sites compile; render is suppressed. */
  subtitle?: string
  right?: ReactNode
}

export function PanelHead({ children, right }: Props) {
  return (
    <div className="panel-head">
      <span className="ornament">✦</span>
      <span>{children}</span>
      {right && <div style={{ marginLeft: 'auto' }}>{right}</div>}
    </div>
  )
}
