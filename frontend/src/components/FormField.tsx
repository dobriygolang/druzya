// FormField — single canonical input pattern (Wave-9 design-review).
//
// Background: SettingsPage had two parallel input shapes — Username with
// a bordered "@"-prefix slot, and Display/Email/City as plain inputs.
// In a 4-column grid this read as "Username is more important / different",
// which it isn't. Claude Design flagged it: every form input must look
// the same shape; only the *prefix* changes.
//
// This component is the convergence point. Use it everywhere we render
// a labelled text input. Multiline + custom prefix supported. Optional
// `hint` slot renders secondary text below the input; `error` renders
// in `--red` ink stripe-style and replaces the hint when present.

import { type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '../lib/cn'

type CommonProps = {
  label: string
  prefix?: string
  mono?: boolean
  /** Secondary description shown below the input. Hidden when `error` is set. */
  hint?: string
  /** Error message shown below the input with a 1.5px red stripe (b/w rule). */
  error?: string
}

type SingleLineProps = CommonProps & {
  multiline?: false
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>

type MultiLineProps = CommonProps & {
  multiline: true
  rows?: number
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>

export type FormFieldProps = SingleLineProps | MultiLineProps

export function FormField(props: FormFieldProps) {
  const { label, prefix, mono, hint, error } = props
  const hasError = !!error
  const inputCls = cn(
    'flex-1 bg-transparent px-3 py-2 text-[13px] text-text-primary outline-none',
    mono && 'font-mono',
  )
  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">
        {label}
      </label>
      {props.multiline ? (
        <textarea
          rows={props.rows ?? 3}
          className={cn(
            'resize-none rounded-md border bg-bg/40 px-3 py-2 text-[13px] text-text-primary outline-none transition-colors',
            hasError
              ? 'border-[var(--red)] focus:border-[var(--red)]'
              : 'border-border focus:border-text-primary',
            mono && 'font-mono',
          )}
          aria-invalid={hasError || undefined}
          {...stripCustom(props)}
        />
      ) : (
        <div
          className={cn(
            'flex items-center rounded-md border bg-bg/40 transition-colors',
            hasError
              ? 'border-[var(--red)] focus-within:border-[var(--red)]'
              : 'border-border focus-within:border-text-primary',
          )}
        >
          {prefix && (
            <span className="border-r border-border px-2.5 py-2 font-mono text-[13px] text-text-muted">
              {prefix}
            </span>
          )}
          <input
            className={inputCls}
            aria-invalid={hasError || undefined}
            {...stripCustom(props)}
          />
        </div>
      )}
      {/* Hint / error slot. Error wins; if neither — слот не рендерится
          (нет лишнего vertical space). Hint в text-muted (12px), error
          в var(--red) с 1.5px stripe — соблюдает b/w rule (red = stripe
          / dot, не bg/fill). */}
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
}

// stripCustom — removes our custom props before spreading onto the
// underlying DOM node so React doesn't warn about unknown attributes.
function stripCustom<
  T extends CommonProps & { multiline?: boolean; rows?: number },
>(p: T) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { label, prefix, mono, hint, error, multiline, rows, ...rest } = p
  return rest
}
