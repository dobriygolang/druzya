// Flow:
//   1. PeekInvite (public) → render «<Maria> приглашает тебя…»
//   2. If not logged in → «Войти» CTA → /login?next=/invite/{code}
//   3. If logged in + invite active → «Принять» → AcceptInvite mutation
//      → on success redirect to /onboarding/tracks (English-track
//      pre-selected so the student is dropped straight into the
//      tutor-driven flow).
import { useEffect } from 'react'
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

const STATUS_LABEL: Record<TutorInviteStatus, string> = {
  INVITE_STATUS_UNSPECIFIED: 'неизвестно',
  INVITE_STATUS_ACTIVE: 'активен',
  INVITE_STATUS_ACCEPTED: 'уже принят',
  INVITE_STATUS_REVOKED: 'отозван тутром',
  INVITE_STATUS_EXPIRED: 'истёк',
}

export default function InviteAcceptPage() {
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
        <ErrorState message="Код приглашения не указан в ссылке." />
      </Shell>
    )
  }

  if (peekQ.isPending) {
    return (
      <Shell>
        <div className="flex items-center gap-2 text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загружаем приглашение…
        </div>
      </Shell>
    )
  }

  if (peekQ.isError || !peekQ.data) {
    const status = peekQ.error instanceof ApiError ? peekQ.error.status : 0
    const msg =
      status === 404
        ? 'Этого приглашения не существует. Попроси у тутора актуальную ссылку.'
        : 'Не удалось загрузить приглашение. Попробуй обновить страницу.'
    return (
      <Shell>
        <ErrorState message={msg} />
      </Shell>
    )
  }

  const { invite, tutor_display } = peekQ.data
  const tutorName = tutor_display || 'Твой тутор'
  const statusLabel = STATUS_LABEL[invite.status] ?? '—'
  const isActive = invite.status === 'INVITE_STATUS_ACTIVE'
  const isAccepted = invite.status === 'INVITE_STATUS_ACCEPTED'
  const expiresAt = invite.expires_at ? new Date(invite.expires_at).toLocaleDateString() : '—'

  return (
    <Shell>
      <div className="flex flex-col gap-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
          Приглашение от тутра
        </span>
        <h1 className="font-display text-3xl font-bold leading-tight">
          {tutorName} приглашает тебя в&nbsp;druz9.
        </h1>
        <p className="text-sm leading-relaxed text-text-secondary">
          Тутор подключит тебя к своему dashboard'у и сможет видеть твои focus-сессии,
          прогресс по English-Atlas и результаты HR-моков. Заметки и whiteboard остаются
          приватными.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Код" value={invite.code} mono />
        <Stat label="Статус" value={statusLabel} accent={!isActive} />
        <Stat label="Действует до" value={expiresAt} />
        {invite.note && <Stat label="Заметка" value={invite.note} />}
      </div>

      {isAccepted && (
        <Card className="flex-col gap-1 border-border bg-surface-2 p-4" interactive={false}>
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            Уже принято
          </div>
          <p className="text-[13px] leading-relaxed text-text-secondary">
            Это приглашение уже использовано. Если ты — тот, кто его принял, продолжай
            работать в Hone и на druz9.online.
          </p>
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
            Не активно
          </div>
          <p className="text-[13px] leading-relaxed text-text-secondary">
            Приглашение {statusLabel}. Попроси у тутра новую ссылку.
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
                {accept.isPending ? 'Принимаем…' : 'Принять и продолжить'}
              </Button>
              {accept.isError && (
                <span className="text-[12px]" style={{ color: 'var(--red)' }}>
                  {accept.error instanceof ApiError ? accept.error.body : 'Ошибка. Попробуй ещё раз.'}
                </span>
              )}
            </>
          ) : (
            <>
              <Link
                to={`/login?next=${encodeURIComponent(`/invite/${code}`)}`}
                className="inline-flex items-center justify-center rounded-md bg-text-primary px-5 py-2.5 text-sm font-medium tracking-[0.08em] text-bg transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:bg-text-primary/90"
              >
                Войти, чтобы принять
              </Link>
              <span className="text-[12px] text-text-muted">
                После входа сразу вернёшься сюда.
              </span>
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
        Ошибка
      </div>
      <p className="text-[13px] leading-relaxed text-text-secondary">{message}</p>
    </Card>
  )
}
