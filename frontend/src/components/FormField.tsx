// FormField — single canonical input pattern (Wave-9 design-review).
//
// Background: SettingsPage had two parallel input shapes — Username with
// a bordered "@"-prefix slot, and Display/Email/City as plain inputs.
// In a 4-column grid this read as "Username is more important / different",
// which it isn't. Claude Design flagged it: every form input must look
// the same shape; only the *prefix* changes.
//
// This component is the convergence point. Use it everywhere we render
// a labelled text input. Multiline + custom prefix supported.

import { type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '../lib/cn'

type CommonProps = {
  label: string
  prefix?: string
  mono?: boolean
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
  const { label, prefix, mono } = props
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
            'resize-none rounded-md border border-border bg-bg/40 px-3 py-2 text-[13px] text-text-primary outline-none focus:border-text-primary transition-colors',
            mono && 'font-mono',
          )}
          {...stripCustom(props)}
        />
      ) : (
        <div className="flex items-center rounded-md border border-border bg-bg/40 focus-within:border-text-primary transition-colors">
          {prefix && (
            <span className="border-r border-border px-2.5 py-2 font-mono text-[13px] text-text-muted">
              {prefix}
            </span>
          )}
          <input className={inputCls} {...stripCustom(props)} />
        </div>
      )}
    </div>
  )
}

// stripCustom — removes our custom props before spreading onto the
// underlying DOM node so React doesn't warn about unknown attributes.
function stripCustom<T extends CommonProps & { multiline?: boolean; rows?: number }>(p: T) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { label, prefix, mono, multiline, rows, ...rest } = p
  return rest
}
