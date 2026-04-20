import { ReactNode } from 'react'

type Variant = 'gold' | 'dim' | 'normal' | 'hard' | 'boss' | 'blood' | 'ember'

type Props = {
  children: ReactNode
  variant?: Variant
}

export function Badge({ children, variant = 'gold' }: Props) {
  return <span className={`badge badge-${variant}`}>{children}</span>
}
