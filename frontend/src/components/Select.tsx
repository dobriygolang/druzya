// Select — labelled <select> primitive mirroring Input / Textarea.
//
// B/W: используем native <select> для accessibility + cross-browser,
// поверх него border/bg/colour-vars как у Input. Caret icon — встроенный
// SVG в правом краю (через background-image), чтобы chrome / safari
// рендерили одинаково.
import { forwardRef, type SelectHTMLAttributes } from 'react'
import { cn } from '../lib/cn'

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> {
  label?: string
  hint?: string
  error?: string
  /** Список опций. Если undefined — рендерим children (legacy mode). */
  options?: ReadonlyArray<{ value: string; label: string }>
  className?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, options, className, required, children, ...rest },
  ref,
) {
  const hasError = !!error
  // inline SVG caret через data-uri чтобы избежать дополнительного asset'а.
  // Цвет — text-muted (#888 как rgb приближение var(--text-muted)).
  const caret =
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E\")"
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">
          {label}
          {required && (
            <span aria-hidden="true" className="ml-1" style={{ color: 'var(--red)' }}>
              *
            </span>
          )}
        </label>
      )}
      <select
        ref={ref}
        required={required}
        aria-invalid={hasError || undefined}
        className={cn(
          'appearance-none rounded-md border bg-bg/40 px-3 py-2 pr-9 text-[13px] text-text-primary outline-none transition-colors',
          hasError
            ? 'border-[var(--red)] focus:border-[var(--red)]'
            : 'border-border focus:border-text-primary',
        )}
        style={{
          backgroundImage: caret,
          backgroundPosition: 'right 10px center',
          backgroundRepeat: 'no-repeat',
        }}
        {...rest}
      >
        {options
          ? options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))
          : children}
      </select>
      {hasError ? (
        <div className="flex items-start gap-2">
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: 1.5,
              minHeight: 12,
              background: 'var(--red)',
              marginTop: 3,
              flex: '0 0 auto',
            }}
          />
          <p className="text-[11.5px] leading-snug" style={{ color: 'var(--red)' }}>
            {error}
          </p>
        </div>
      ) : hint ? (
        <p className="text-[11.5px] leading-snug text-text-muted">{hint}</p>
      ) : null}
    </div>
  )
})
