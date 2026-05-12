// Input — labelled single-line text input primitive, mirroring Card /
// Button styling. Common props: `label`, `hint`, `error`, `required`.
//
// Прелюдия: FormField существует и решает ту же задачу (Wave-9). Input
// добавлен как narrower primitive для случаев когда нужна вариация
// без prefix slot'а и без multiline бранчинга. FormField остаётся
// валидным; Input — для нового кода где не нужен @-префикс.
//
// Использует те же tokens (border, text-primary, var(--red)) что
// FormField, так что визуально страница mixes их без явного отличия.
import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../lib/cn'

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label?: string
  hint?: string
  error?: string
  /** Use a monospace font (e.g. for token / slug inputs). */
  mono?: boolean
  className?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, mono, className, required, ...rest },
  ref,
) {
  const hasError = !!error
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
      <div
        className={cn(
          'flex items-center rounded-md border bg-bg/40 transition-colors',
          hasError
            ? 'border-[var(--red)] focus-within:border-[var(--red)]'
            : 'border-border focus-within:border-text-primary',
        )}
      >
        <input
          ref={ref}
          required={required}
          aria-invalid={hasError || undefined}
          className={cn(
            'flex-1 bg-transparent px-3 py-2 text-[13px] text-text-primary outline-none',
            mono && 'font-mono',
          )}
          {...rest}
        />
      </div>
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
