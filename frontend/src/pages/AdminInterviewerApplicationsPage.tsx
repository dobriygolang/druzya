// AdminInterviewerApplicationsPage — moderation queue for the
// «Стать интервьюером» applications. Admin-only — backend gates each
// RPC; the page also redirects non-admins via a 403 from the list call.
//
// Filters: status tab (pending / approved / rejected). Default = pending.
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Check, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AppShellV2 } from '../components/AppShell'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { bcp47 } from '../lib/i18n'
import {
  isInterviewerOrAdmin,
  useAdminInterviewerApplicationsQuery,
  useApproveInterviewerApplication,
  useProfileQuery,
  useRejectInterviewerApplication,
  type InterviewerApplication,
} from '../lib/queries/profile'

type Status = 'pending' | 'approved' | 'rejected'

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(bcp47(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function AdminInterviewerApplicationsPage() {
  const { t } = useTranslation('admin')
  const profile = useProfileQuery()
  const role = profile.data?.role
  const isAdmin = (role ?? '').toUpperCase().includes('ADMIN')
  const isElevated = isInterviewerOrAdmin(role)

  // While profile is loading we render nothing — avoids a brief
  // "Forbidden" flash for legitimate admins.
  if (profile.isLoading) {
    return (
      <AppShellV2>
        <EmptyState variant="loading" skeletonLayout="single-card" />
      </AppShellV2>
    )
  }
  // Non-admin (or unauthenticated) — bounce home. The backend would 403
  // anyway; we save them the trip.
  if (!isAdmin && !isElevated) {
    return <Navigate to="/atlas" replace />
  }
  if (!isAdmin) {
    // Interviewers but not admins still can't moderate.
    return (
      <AppShellV2>
        <div className="px-4 py-8 sm:px-8 lg:px-20">
          <EmptyState
            variant="error"
            title={t('interviewer_apps.admins_only_title')}
            body={t('interviewer_apps.admins_only_body')}
          />
        </div>
      </AppShellV2>
    )
  }

  return <AdminInner />
}

function AdminInner() {
  const { t } = useTranslation('admin')
  const TABS: { key: Status; label: string }[] = [
    { key: 'pending', label: t('interviewer_apps.tab.pending') },
    { key: 'approved', label: t('interviewer_apps.tab.approved') },
    { key: 'rejected', label: t('interviewer_apps.tab.rejected') },
  ]
  const [tab, setTab] = useState<Status>('pending')
  const list = useAdminInterviewerApplicationsQuery(tab)
  const items = list.data ?? []

  return (
    <AppShellV2>
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-2xl lg:text-[32px] font-bold text-text-primary">
            {t('interviewer_apps.title')}
          </h1>
          <p className="text-sm text-text-secondary">
            {t('interviewer_apps.subtitle')}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {TABS.map((tabInfo) => (
            <button
              key={tabInfo.key}
              type="button"
              onClick={() => setTab(tabInfo.key)}
              aria-pressed={tabInfo.key === tab}
              className={`relative rounded-full border px-3.5 py-1.5 text-[13px] tracking-[0.08em] transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] ${
                tabInfo.key === tab
                  ? 'border-text-primary bg-text-primary/15 text-text-primary'
                  : 'border-border bg-surface-2 text-text-secondary hover:border-border-strong hover:text-text-primary'
              }`}
            >
              {tabInfo.key === tab && (
                <span
                  aria-hidden
                  className="absolute -left-px top-1/2 h-3 w-[1.5px] -translate-y-1/2 rounded-full"
                  style={{ background: 'var(--red)' }}
                />
              )}
              {tabInfo.label}
            </button>
          ))}
        </div>

        {list.isLoading && <EmptyState variant="loading" skeletonLayout="card-grid" />}
        {list.isError && (
          <EmptyState
            variant="error"
            title={t('interviewer_apps.load_failed_title')}
            body={t('interviewer_apps.load_failed_body')}
          />
        )}
        {!list.isLoading && !list.isError && items.length === 0 && (
          <EmptyState
            variant="no-data"
            title={t('interviewer_apps.empty_title')}
            body={tab === 'pending' ? t('interviewer_apps.empty_body_pending') : t('interviewer_apps.empty_body_other')}
          />
        )}

        <div className="flex flex-col gap-3">
          {items.map((app) => (
            <ApplicationRow key={app.id} app={app} canModerate={tab === 'pending'} />
          ))}
        </div>
      </div>
    </AppShellV2>
  )
}

function ApplicationRow({ app, canModerate }: { app: InterviewerApplication; canModerate: boolean }) {
  const { t } = useTranslation('admin')
  const approve = useApproveInterviewerApplication()
  const reject = useRejectInterviewerApplication()
  const [note, setNote] = useState('')
  const errMsg =
    approve.isError ? (approve.error instanceof Error ? approve.error.message : t('interviewer_apps.approve_error'))
    : reject.isError ? (reject.error instanceof Error ? reject.error.message : t('interviewer_apps.reject_error'))
    : null

  return (
    <Card className="flex-col items-start gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-base font-bold text-text-primary">
          @{app.user_username || 'unknown'}
        </span>
        {app.user_display_name && (
          <span className="text-sm text-text-secondary">· {app.user_display_name}</span>
        )}
        <span className="ml-auto font-mono text-[11px] text-text-muted">{fmtDate(app.created_at)}</span>
      </div>
      {app.motivation && (
        <p className="text-sm text-text-secondary">{app.motivation}</p>
      )}
      {!app.motivation && (
        <p className="text-sm italic text-text-muted">{t('interviewer_apps.no_motivation')}</p>
      )}
      {app.decision_note && (
        <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-text-secondary">
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
            {t('interviewer_apps.moderator_decision')}
          </span>{' '}
          {app.decision_note}
        </div>
      )}

      {canModerate && (
        <div className="flex w-full flex-col gap-2">
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('interviewer_apps.comment_placeholder')}
            className="w-full resize-none border-0 border-b border-border bg-transparent px-0 py-2 text-sm text-text-primary outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] placeholder:text-text-muted focus:border-text-primary"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => approve.mutate({ id: app.id, note })}
              disabled={approve.isPending || reject.isPending}
            >
              <Check className="mr-1 h-3.5 w-3.5" />
              {approve.isPending ? t('interviewer_apps.approving') : t('interviewer_apps.approve')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => reject.mutate({ id: app.id, note })}
              disabled={approve.isPending || reject.isPending}
            >
              <X className="mr-1 h-3.5 w-3.5" />
              {reject.isPending ? t('interviewer_apps.rejecting') : t('interviewer_apps.reject')}
            </Button>
          </div>
          {errMsg && (
            <div
              className="relative rounded-md border border-border bg-surface-2 px-3 py-2 pl-4 text-sm"
              style={{ color: 'var(--red)' }}
            >
              <span
                aria-hidden
                className="absolute left-0 top-0 h-full w-[1.5px] rounded-l-md"
                style={{ background: 'var(--red)' }}
              />
              {errMsg}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
