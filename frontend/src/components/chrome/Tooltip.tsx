import { ReactNode } from 'react'

type Props = {
  title: ReactNode
  children: ReactNode
}

export function Tooltip({ title, children }: Props) {
  return (
    <div className="tooltip">
      <div className="tooltip-head">{title}</div>
      <div className="tooltip-body">{children}</div>
    </div>
  )
}
