import { CSSProperties, ReactNode } from 'react'

type Props = {
  children: ReactNode
  className?: string
  style?: CSSProperties
  foot?: boolean
}

export function Panel({ children, className = '', style, foot = true }: Props) {
  return (
    <div
      className={`panel ${foot ? 'panel-foot' : ''} ${className}`}
      style={style}
    >
      {children}
    </div>
  )
}
