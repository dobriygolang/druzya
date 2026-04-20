import { CSSProperties, ReactNode } from 'react'

type Props = {
  children: ReactNode
  className?: string
  style?: CSSProperties
}

export function InsetGroove({ children, className = '', style }: Props) {
  return (
    <div className={`inset-groove ${className}`} style={style}>
      {children}
    </div>
  )
}
