// Flow:
//   1. PeekInvite (public) → render «<Maria> приглашает тебя…»
//   2. If not logged in → «Войти» CTA → /login?next=/invite/{code}
//   3. If logged in + invite active → «Принять» → AcceptInvite mutation
//      → on success redirect to /onboarding/tracks (English-track
//      pre-selected so the student is dropped straight into the
//      tutor-driven flow).
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { readAccessToken, ApiError } from '../lib/apiClient'
import {
  usePeekInviteQuery,
  useAcceptInviteMutation,
  type TutorInviteStatus,
} from '../lib/queries/tutor'

// Mapping TutorInviteStatus → i18n key suffix; resolved at render via t().
const STATUS_KEY: Record<TutorInviteStatus, string> = {
  INVITE_STATUS_UNSPECIFIED: 'unspecified',
  INVITE_STATUS_ACTIVE: 'active',
  INVITE_STATUS_ACCEPTED: 'accepted',
  INVITE_STATUS_REVOKED: 'revoked',
  INVITE_STATUS_EXPIRED: 'expired',
}

export default function InviteAcceptPage() {
  const { t } = useTranslation('invite')
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const peekQ = usePeekInviteQuery(code)
  const accept = useAcceptInviteMutation()
  const isLoggedIn = Boolean(readAccessToken())

  // After successful accept → drop into onboarding with English track
  // pre-suggested. The tracks page reads /tutor relationships on
  // mount and seeds the picker accordingly (Phase 2 wiring).
  useEffect(() => {
    if (accept.isSuccess) {
      navigate('/onboarding/tracks?source=invite', { replace: true })
    }
  }, [accept.isSuccess, navigate])

  if (!code) {
    return (
      <Shell>
        <ErrorState message={t('err.no_code')} />
      </Shell>
    )
  }

  if (peekQ.isPending) {
    return (
      <Shell>
        <div className="flex items-center gap-2 text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('err.loading')}
        </div>
      </Shell>
    )
  }

  if (peekQ.isError || !peekQ.data) {
    const status = peekQ.error instanceof ApiError ? peekQ.error.status : 0
    const msg = status === 404 ? t('err.not_found') : t('err.load_failed')
    return (
      <Shell>
        <ErrorState message={msg} />
      </Shell>
    )
  }

  const { invite, tutor_display } = peekQ.data
  const tutorName = tutor_display || t('default_tutor')
  const statusLabel = t(`status.${STATUS_KEY[invite.status] ?? 'unspecified'}`)
  const isActive = invite.status === 'INVITE_STATUS_ACTIVE'
  const isAccepted = invite.status === 'INVITE_STATUS_ACCEPTED'
  const expiresAt = invite.expires_at ? new Date(invite.expires_at).toLocaleDateString() : '—'

  return (
    <Shell>
      <div className="flex flex-col gap-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
          {t('eyebrow')}
        </span>
        <h1 className="font-display text-3xl font-bold leading-tight">
          {t('headline', { tutor: tutorName })}
        </h1>
        <p className="text-sm leading-relaxed text-text-secondary">{t('body')}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat label={t('stat.code')} value={invite.code} mono />
        <Stat label={t('stat.status')} value={statusLabel} accent={!isActive} />
        <Stat label={t('stat.until')} value={expiresAt} />
        {invite.note && <Stat label={t('stat.note')} value={invite.note} />}
      </div>

      {isAccepted && (
        <Card className="flex-col gap-1 border-border bg-surface-2 p-4" interactive={false}>
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            {t('accepted_title')}
          </div>
          <p className="text-[13px] leading-relaxed text-text-secondary">{t('accepted_body')}</p>
        </Card>
      )}

      {!isActive && !isAccepted && (
        <Card
          className="relative flex-col gap-1 border-border bg-surface-2 p-4"
          interactive={false}
        >
          <span
            aria-hidden
            className="absolute left-0 top-0 h-full w-[1.5px]"
            style={{ background: 'var(--red)' }}
          />
          <div
            className="font-mono text-[10px] uppercase tracking-[0.08em]"
            style={{ color: 'var(--red)' }}
          >
            {t('inactive_title')}
          </div>
          <p className="text-[13px] leading-relaxed text-text-secondary">
            {t('inactive_body', { status: statusLabel })}
          </p>
        </Card>
      )}

      {isActive && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {isLoggedIn ? (
            <>
              <Button
                onClick={() => accept.mutate(code)}
                disabled={accept.isPending}
              >
                {accept.isPending ? t('cta.accept_pending') : t('cta.accept')}
              </Button>
              {accept.isError && (
                <span className="text-[12px]" style={{ color: 'var(--red)' }}>
                  {accept.error instanceof ApiError ? accept.error.body : t('err.default_accept')}
                </span>
              )}
            </>
          ) : (
            <>
              <Link
                to={`/login?next=${encodeURIComponent(`/invite/${code}`)}`}
                className="inline-flex items-center justify-center rounded-md bg-text-primary px-5 py-2.5 text-sm font-medium tracking-[0.08em] text-bg transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:bg-text-primary/90"
              >
                {t('cta.login')}
              </Link>
              <span className="text-[12px] text-text-muted">{t('cta.login_hint')}</span>
            </>
          )}
        </div>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-12 sm:px-8 sm:py-16">
        <Link
          to="/welcome"
          className="font-mono text-[12px] tracking-[0.08em] text-text-muted transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:text-text-primary"
        >
          ← druz9
        </Link>
        {children}
      </div>
    </div>
  )
}

function Stat({ label, value, mono = false, accent = false }: { label: string; value: string; mono?: boolean; accent?: boolean }) {
  // Accent = red signal stripe (statuses != active). Card stays ink-ramp; only the
  // signal channel is colour.
  return (
    <div className="relative rounded-lg border border-border bg-surface-2 px-3 py-2.5">
      {accent && (
        <span
          aria-hidden
          className="absolute left-0 top-0 h-full w-[1.5px] rounded-l-lg"
          style={{ background: 'var(--red)' }}
        />
      )}
      <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">{label}</div>
      <div
        className={`mt-0.5 text-sm ${mono ? 'font-mono tabular-nums' : ''} text-text-primary`}
        style={accent ? { color: 'var(--red)' } : undefined}
      >
        {value}
      </div>
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  const { t } = useTranslation('invite')
  return (
    <Card className="relative flex-col gap-2 p-5" interactive={false}>
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-[1.5px]"
        style={{ background: 'var(--red)' }}
      />
      <div
        className="font-mono text-[10px] uppercase tracking-[0.08em]"
        style={{ color: 'var(--red)' }}
      >
        {t('err.title')}
      </div>
      <p className="text-[13px] leading-relaxed text-text-secondary">{message}</p>
    </Card>
  )
}
