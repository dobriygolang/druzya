import { CSSProperties, ReactNode } from 'react'

type Props = {
  children?: ReactNode
  style?: CSSProperties
}

export function Divider({ children, style }: Props) {
  return (
    <div className="divider" style={style}>
      <span className="star">✦</span>
      <span>{children}</span>
      <span className="star">✦</span>
    </div>
  )
}
