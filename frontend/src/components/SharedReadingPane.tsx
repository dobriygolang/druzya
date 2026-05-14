// SharedReadingPane — Reading library tab для тутора.
//
//   - Form для recommend material (title + url + note + button «Отправить»)
//   - Под капотом — `tutor.PushSharedReading` (broadcast assignments + INSERT
//     в tutor_shared_materials для history)
//   - History list ниже формы с прошлыми recommendations.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, ExternalLink, Send } from 'lucide-react'

import { Button } from './Button'
import { ApiError } from '../lib/apiClient'
import {
  useTutorSharedReadingQuery,
  usePushSharedReadingMutation,
} from '../lib/queries/tutor'

export function SharedReadingPane() {
  const { t } = useTranslation('wave14')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [note, setNote] = useState('')
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const push = usePushSharedReadingMutation()
  const historyQ = useTutorSharedReadingQuery(30)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setOkMsg(null)
    const trimmedTitle = title.trim()
    if (!trimmedTitle) return
    try {
      const r = await push.mutateAsync({
        title: trimmedTitle,
        source_url: url.trim() || undefined,
        note: note.trim() || undefined,
      })
      setOkMsg(`${t('shared_reading.sent_to_students_pre')} ${r.pushed_count}${t('shared_reading.errors_count')} ${r.failed_count}.`)
      setTitle('')
      setUrl('')
      setNote('')
    } catch {
      /* surfaced via push.isError */
    }
  }

  const items = historyQ.data?.items ?? []

  return (
    <section className="rounded-lg border border-border bg-surface-1 p-5">
      <header className="mb-3 flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-accent" />
        <h2 className="font-display text-lg font-bold leading-tight">
          Reading library
        </h2>
      </header>
      <p className="mb-4 text-[13px] text-text-secondary">
        {t('shared_reading.one_click_hint')}
      </p>

      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            {t('shared_reading.title_label')}
          </span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('shared_reading.title_placeholder')}
            className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            disabled={push.isPending}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            {t('shared_reading.url_optional')}
          </span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            disabled={push.isPending}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            {t('shared_reading.note_optional')}
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder={t('shared_reading.note_placeholder')}
            className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            disabled={push.isPending}
          />
        </label>
        <div className="flex items-center gap-3">
          <Button
            type="submit"
            size="sm"
            disabled={!title.trim() || push.isPending}
            icon={<Send className="h-3.5 w-3.5" />}
          >
            {push.isPending ? t('shared_reading.sending') : t('shared_reading.send_all')}
          </Button>
          {okMsg && <span className="text-[12px] text-success">{okMsg}</span>}
          {push.isError && (
            <span className="text-[12px] text-warn">
              {push.error instanceof ApiError ? push.error.body : t('shared_reading.send_failed')}
            </span>
          )}
        </div>
      </form>

      <div className="mt-6 border-t border-border pt-4">
        <h3 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
          {t('shared_reading.past_recs')}
        </h3>
        {historyQ.isPending ? (
          <div className="text-[12px] text-text-muted">{t('shared_reading.loading_short')}</div>
        ) : items.length === 0 ? (
          <div className="text-[12px] text-text-muted">
            {t('shared_reading.empty_send_first')}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((m) => (
              <li
                key={m.id}
                className="flex items-start justify-between gap-3 rounded-md bg-surface-2 px-3 py-2 text-[13px]"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-text-primary">
                    {m.source_url && (
                      <a
                        href={m.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent hover:underline"
                        aria-label={t('shared_reading.open_source')}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    <span className="truncate font-medium">{m.title}</span>
                  </div>
                  {m.body_md && (
                    <div className="mt-0.5 truncate text-[11.5px] text-text-secondary">
                      {m.body_md}
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-[11px] tabular-nums text-text-secondary">
                    {m.student_count} {t('shared_reading.students_short')}
                  </div>
                  <div className="font-mono text-[10px] text-text-muted">
                    {formatRel(m.created_at)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function formatRel(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const ms = Date.now() - d.getTime()
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}
