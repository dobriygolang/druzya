// NotificationTemplatesPanel — Admin Phase 2: notification compose templates.
//
// Per-channel templates (email/tg/push/in_app). Email требует subject;
// остальные каналы — body only. Channel filter в header.

import { useMemo, useState } from 'react'

import { Button } from '../../../components/Button'
import { Modal } from '../../../components/primitives/Modal'
import { ErrorBox, PanelSkeleton } from '../shared'
import {
  useAdminNotificationTemplatesQuery,
  useCreateNotificationTemplateMutation,
  useDeactivateNotificationTemplateMutation,
  useUpdateNotificationTemplateMutation,
  type CreateNotificationTemplateBody,
  type NotificationChannel,
  type NotificationTemplate,
  type UpdateNotificationTemplateBody,
} from '../../../lib/queries/notificationTemplates'

const CHANNEL_OPTIONS: { value: NotificationChannel; label: string }[] = [
  { value: 'email', label: 'Email' },
  { value: 'tg', label: 'Telegram' },
  { value: 'push', label: 'Push' },
  { value: 'in_app', label: 'In-app' },
]

export function NotificationTemplatesPanel() {
  const [channelFilter, setChannelFilter] = useState<NotificationChannel | 'all'>('all')
  const query = useAdminNotificationTemplatesQuery(
    channelFilter === 'all' ? undefined : channelFilter,
  )
  const deactivate = useDeactivateNotificationTemplateMutation()
  const [modal, setModal] = useState<
    { kind: 'create' } | { kind: 'edit'; template: NotificationTemplate } | null
  >(null)
  const [err, setErr] = useState<string | null>(null)

  const sorted = useMemo(() => {
    if (!query.data) return []
    return [...query.data].sort((a, b) => a.channel.localeCompare(b.channel) || a.slug.localeCompare(b.slug))
  }, [query.data])

  if (query.isPending) return <PanelSkeleton rows={6} />
  if (query.error) return <ErrorBox message={(query.error as Error).message || 'Failed to load'} />

  const handleDeactivate = async (id: string) => {
    setErr(null)
    try {
      await deactivate.mutateAsync(id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to deactivate')
    }
  }

  return (
    <section className="flex flex-col gap-4 px-4 py-5 sm:px-7">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-display text-base font-bold text-text-primary">Notification templates</h3>
          <p className="font-mono text-[11px] text-text-muted">
            Compose templates для notify service. Email требует subject + body, остальные каналы — body only.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value as NotificationChannel | 'all')}
            className="rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-[11px] text-text-primary focus:border-text-primary focus:outline-none"
          >
            <option value="all">Все каналы</option>
            {CHANNEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={() => setModal({ kind: 'create' })}>
            + Добавить шаблон
          </Button>
        </div>
      </header>

      {err && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
          {err}
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-surface-1 px-4 py-10 text-center">
          <span className="font-mono text-[12px] text-text-muted">Нет шаблонов</span>
          <Button size="sm" onClick={() => setModal({ kind: 'create' })}>
            + Добавить шаблон
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full">
            <thead className="bg-surface-1">
              <tr>
                <Th>Slug</Th>
                <Th>Channel</Th>
                <Th>Subject</Th>
                <Th>Variables</Th>
                <Th>Active</Th>
                <Th>{''}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((t) => (
                <tr key={t.id} className="bg-surface-2 hover:bg-surface-1">
                  <Td className="font-mono text-[11px]">{t.slug}</Td>
                  <Td>
                    <span className="rounded-full border border-border bg-bg px-2 py-0.5 font-mono text-[10px] uppercase text-text-muted">
                      {t.channel}
                    </span>
                  </Td>
                  <Td className="max-w-[280px] truncate text-text-secondary" title={t.subject_template}>
                    {t.subject_template || <span className="font-mono text-[10px] text-text-muted">—</span>}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {t.variables.length === 0 && (
                        <span className="font-mono text-[10px] text-text-muted">—</span>
                      )}
                      {t.variables.map((v) => (
                        <span key={v} className="rounded-md border border-border bg-bg px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
                          {v}
                        </span>
                      ))}
                    </div>
                  </Td>
                  <Td>
                    <span
                      className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase ${
                        t.is_active
                          ? 'border border-text-primary text-text-primary'
                          : 'border border-border text-text-muted'
                      }`}
                    >
                      {t.is_active ? 'on' : 'off'}
                    </span>
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setModal({ kind: 'edit', template: t })}
                        className="rounded-md border border-border px-2 py-1 font-mono text-[10px] text-text-secondary hover:border-border-strong hover:text-text-primary"
                      >
                        edit
                      </button>
                      {t.is_active && (
                        <button
                          type="button"
                          onClick={() => handleDeactivate(t.id)}
                          disabled={deactivate.isPending}
                          className="rounded-md border border-border px-2 py-1 font-mono text-[10px] text-text-muted hover:border-danger hover:text-danger disabled:opacity-50"
                        >
                          deactivate
                        </button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal?.kind === 'create' && (
        <NotificationForm onClose={() => setModal(null)} onError={setErr} />
      )}
      {modal?.kind === 'edit' && (
        <NotificationForm existing={modal.template} onClose={() => setModal(null)} onError={setErr} />
      )}
    </section>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
      {children}
    </th>
  )
}

function Td({
  children,
  className,
  title,
}: {
  children: React.ReactNode
  className?: string
  title?: string
}) {
  return (
    <td className={`px-3 py-2 text-[12px] text-text-primary ${className ?? ''}`} title={title}>
      {children}
    </td>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Form modal
// ─────────────────────────────────────────────────────────────────────────

interface FormProps {
  existing?: NotificationTemplate
  onClose: () => void
  onError: (msg: string | null) => void
}

function NotificationForm({ existing, onClose, onError }: FormProps) {
  const isEdit = !!existing
  const createMut = useCreateNotificationTemplateMutation()
  const updateMut = useUpdateNotificationTemplateMutation()

  const [slug, setSlug] = useState(existing?.slug ?? '')
  const [channel, setChannel] = useState<NotificationChannel>(existing?.channel ?? 'email')
  const [subject, setSubject] = useState(existing?.subject_template ?? '')
  const [body, setBody] = useState(existing?.body_template ?? '')
  const [varsText, setVarsText] = useState(existing?.variables?.join(', ') ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [isActive, setIsActive] = useState(existing?.is_active ?? true)
  const [busy, setBusy] = useState(false)

  const variables = useMemo(
    () =>
      varsText
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
    [varsText],
  )
  const invalidVar = variables.find((v) => !/^\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}$/.test(v))
  const subjectRequired = channel === 'email'
  const subjectMissing = subjectRequired && subject.trim().length === 0

  const canSubmit =
    (isEdit || slug.trim().length >= 2) &&
    body.trim().length >= 2 &&
    !invalidVar &&
    !subjectMissing

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    onError(null)
    try {
      if (isEdit && existing) {
        const patch: UpdateNotificationTemplateBody = {
          channel,
          subject_template: subject,
          body_template: body,
          variables,
          description,
          is_active: isActive,
        }
        await updateMut.mutateAsync({ id: existing.id, body: patch })
      } else {
        const payload: CreateNotificationTemplateBody = {
          slug: slug.trim(),
          channel,
          subject_template: subject,
          body_template: body,
          variables,
          description,
          is_active: isActive,
        }
        await createMut.mutateAsync(payload)
      }
      onClose()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to save template')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} size="md" title={isEdit ? 'Edit template' : 'New notification template'}>
      <div className="flex flex-col gap-4">
        <Field label="Slug" hint={isEdit ? 'Read-only after creation' : 'lowercase-snake, e.g. streak_at_risk_tg'}>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            disabled={isEdit}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] text-text-primary disabled:opacity-60 focus:border-text-primary focus:outline-none"
            placeholder="user_inactive_4d_email"
          />
        </Field>

        <Field label="Channel">
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as NotificationChannel)}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary focus:border-text-primary focus:outline-none"
          >
            {CHANNEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label={subjectRequired ? 'Subject (required for email)' : 'Subject (optional)'}
          hint={subjectMissing ? 'Email требует subject' : undefined}
        >
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className={`w-full rounded-md border bg-surface-2 px-3 py-2 text-[13px] text-text-primary focus:outline-none ${
              subjectMissing ? 'border-danger focus:border-danger' : 'border-border focus:border-text-primary'
            }`}
            placeholder="{{username}}, давно не виделись"
          />
        </Field>

        <Field label="Body">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            className="w-full resize-y rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary focus:border-text-primary focus:outline-none"
            placeholder="Твоя trajectory просела за {{days}} дней. Открой план: {{link}}"
          />
        </Field>

        <Field
          label="Variables"
          hint={
            invalidVar
              ? `«${invalidVar}» не соответствует {{name}}`
              : 'Comma-separated: {{username}}, {{link}}'
          }
        >
          <input
            type="text"
            value={varsText}
            onChange={(e) => setVarsText(e.target.value)}
            className={`w-full rounded-md border bg-surface-2 px-3 py-2 font-mono text-[11px] text-text-primary focus:outline-none ${
              invalidVar ? 'border-danger focus:border-danger' : 'border-border focus:border-text-primary'
            }`}
          />
        </Field>

        <Field label="Description (admin-internal)">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary focus:border-text-primary focus:outline-none"
          />
        </Field>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 accent-text-primary"
          />
          <span className="text-[13px] text-text-primary">Active</span>
        </label>

        <footer className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={!canSubmit || busy}>
            {isEdit ? 'Save' : 'Create'}
          </Button>
        </footer>
      </div>
    </Modal>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">{label}</span>
      {children}
      {hint && <span className="font-mono text-[10px] text-text-muted">{hint}</span>}
    </label>
  )
}
