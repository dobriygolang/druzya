// CueSessionsSection — F10 list view + manual log button. Renders на TodayPage
// под ActivityFeed. Empty state когда журнал пуст; иначе показывает 3
// recent sessions с stages + ratings + opens detail/delete inline.

import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../lib/i18n'

import { CueLogModal } from './CueLogModal'
import { useCueSessions } from '../lib/useCueSessions'
import { deleteCueSession, type CueSession, type CueSessionStage } from '../lib/cueSessions'

const STAGE_LABEL: Record<CueSessionStage, string> = {
  hr: 'HR',
  algo: 'Algo',
  coding: 'Coding',
  sysdesign: 'SysDesign',
  behavioral: 'Behavioral',
  other: 'Other',
}

const LIMIT_DEFAULT = 3

export function CueSessionsSection() {
  const { t } = useTranslation('wave14')
  const sessions = useCueSessions()
  const [logOpen, setLogOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const visible = showAll ? sessions : sessions.slice(0, LIMIT_DEFAULT)

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface-1 p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            Cue sessions
          </span>
          <h2 className="font-display text-base font-bold leading-tight">
            {sessions.length === 0
              ? t('cue_sessions.empty_journal')
              : `${sessions.length} ${pluralSessions(sessions.length)}`}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setLogOpen(true)}
          className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[12px] font-semibold text-text-primary transition-colors hover:border-border-strong"
        >
          <Plus className="h-3.5 w-3.5" />
          Cue
        </button>
      </header>

      {sessions.length === 0 ? (
        <p className="text-[12.5px] italic text-text-muted">
          {t('cue_sessions.log_helps_coach')}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {visible.map((s) => (
            <SessionRow key={s.id} session={s} />
          ))}
        </ul>
      )}

      {sessions.length > LIMIT_DEFAULT && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="self-start font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary underline-offset-2 hover:text-text-primary hover:underline"
        >
          {showAll ? `${t('cue_sessions.collapse_shown')} ${sessions.length}` : `${t('cue_sessions.show_all')} ${sessions.length} →`}
        </button>
      )}

      {logOpen && <CueLogModal onClose={() => setLogOpen(false)} />}
    </section>
  )
}

function SessionRow({ session }: { session: CueSession }) {
  const { t } = useTranslation('wave14')
  const lowRatingStages = session.stages.filter(
    (s) => s.selfRating !== undefined && s.selfRating <= 2,
  )

  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <div className="flex flex-1 flex-col gap-0.5 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="truncate text-[13px] font-semibold text-text-primary">
            {session.company}
          </span>
          {session.persona && (
            <span className="font-mono text-[10px] text-text-muted">· {session.persona}</span>
          )}
          {lowRatingStages.length > 0 && (
            <span
              className="rounded-sm border border-border px-1 py-px font-mono text-[9px] uppercase tracking-[0.1em]"
              style={{ color: '#FF3B30', borderColor: 'rgba(255,59,48,0.4)' }}
              title={t('cue_sessions.low_rating_warning')}
            >
              weak {lowRatingStages.length}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-text-muted">
          {session.stages.map((stage, i) => (
            <span key={i} className="inline-flex items-center gap-0.5">
              {STAGE_LABEL[stage.stage]}
              {stage.selfRating !== undefined && (
                <span
                  className={
                    stage.selfRating <= 2
                      ? 'text-[#FF3B30]'
                      : stage.selfRating >= 4
                        ? 'text-text-primary'
                        : 'text-text-muted'
                  }
                >
                  {' '}
                  {stage.selfRating}/5
                </span>
              )}
              {i < session.stages.length - 1 && <span>·</span>}
            </span>
          ))}
          <span>·</span>
          <span>{formatAgo(session.completedAt)}</span>
        </div>
        {session.aiSummary && (
          <p className="mt-0.5 text-[11.5px] italic text-text-muted line-clamp-2">
            {session.aiSummary}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => deleteCueSession(session.id)}
        aria-label={t('cue_sessions.delete_entry')}
        title={t('cue_sessions.delete')}
        className="shrink-0 rounded-md p-1 text-text-muted opacity-50 transition-opacity hover:bg-surface-2 hover:text-text-primary hover:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  )
}

function pluralSessions(n: number): string {
  if (n === 1) return i18n.t('cue_sessions.session', { ns: 'wave14' })
  if (n >= 2 && n <= 4) return i18n.t('cue_sessions.sessions_few', { ns: 'wave14' })
  return i18n.t('cue_sessions.sessions_many', { ns: 'wave14' })
}

function formatAgo(ms: number): string {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins} ${i18n.t('cue_sessions.min', { ns: 'wave14' })}`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}${i18n.t('cue_sessions.h', { ns: 'wave14' })}`
  const days = Math.floor(hrs / 24)
  if (days <= 6) return `${days}${i18n.t('cue_sessions.d', { ns: 'wave14' })}`
  return new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}
