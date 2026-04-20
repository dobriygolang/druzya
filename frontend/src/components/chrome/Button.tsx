import { ButtonHTMLAttributes, ReactNode } from 'react'

type Tone = 'default' | 'primary' | 'blood' | 'ghost'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: Tone
  size?: 'sm' | 'md'
  cut?: boolean
  children: ReactNode
}

export function Button({
  tone = 'default',
  size = 'md',
  cut,
  children,
  className = '',
  ...rest
}: Props) {
  const toneClass =
    tone === 'primary'
      ? 'btn-primary'
      : tone === 'blood'
        ? 'btn-blood'
        : tone === 'ghost'
          ? 'btn-ghost'
          : ''
  return (
    <button
      className={`btn ${toneClass} ${size === 'sm' ? 'btn-sm' : ''} ${
        cut ? 'btn-cut' : ''
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
