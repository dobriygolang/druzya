// Textarea — multiline labelled text input primitive. См Input.tsx —
// та же эстетика, ровно одна разница: <textarea> + rows prop.
//
// FormField{multiline: true} остаётся валидным entry-point; этот файл
// существует для нового кода где single-purpose primitive чище.
import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cn } from '../lib/cn'

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {
  label?: string
  hint?: string
  error?: string
  mono?: boolean
  className?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { label, hint, error, mono, className, rows = 3, required, ...rest },
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
        <textarea
          ref={ref}
          rows={rows}
          required={required}
          aria-invalid={hasError || undefined}
          className={cn(
            'resize-none rounded-md border bg-bg/40 px-3 py-2 text-[13px] text-text-primary outline-none transition-colors',
            hasError
              ? 'border-[var(--red)] focus:border-[var(--red)]'
              : 'border-border focus:border-text-primary',
            mono && 'font-mono',
          )}
          {...rest}
        />
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
            <p
              className="text-[11.5px] leading-snug"
              style={{ color: 'var(--red)' }}
            >
              {error}
            </p>
          </div>
        ) : hint ? (
          <p className="text-[11.5px] leading-snug text-text-muted">{hint}</p>
        ) : null}
      </div>
    )
  },
)
