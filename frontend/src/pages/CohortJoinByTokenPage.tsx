// CohortJoinByTokenPage — public landing for an invite-token URL.
// Mounted at /c/join/:token. Auto-fires the JoinByToken mutation when
// the user is authed; redirects to /c/{slug} on success or shows the
// error inline (expired / revoked tokens).
//
// Anti-fallback: never silently navigates without a server confirmation;
// shows a "Token expired" empty-state on 410.
import { useEffect } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { AppShellV2 } from '../components/AppShell'
import { EmptyState } from '../components/EmptyState'
import { readAccessToken } from '../lib/apiClient'
import { useJoinByTokenMutation } from '../lib/queries/cohort'

export default function CohortJoinByTokenPage() {
  const { token = '' } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const join = useJoinByTokenMutation()
  const isAuthed = !!readAccessToken()

  useEffect(() => {
    if (!isAuthed || !token || join.isPending || join.isSuccess) return
    join.mutate(token, {
      onSuccess: (resp) => {
        if (resp.slug) navigate(`/c/${encodeURIComponent(resp.slug)}`, { replace: true })
        else navigate('/cohorts', { replace: true })
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, token])

  // Unauthed visitors get bounced to /login with a `next=` so they come
  // back to this page after sign-in and the join fires automatically.
  if (!isAuthed) {
    const next = encodeURIComponent(`/c/join/${token}`)
    return <Navigate to={`/login?next=${next}`} replace />
  }

  return (
    <AppShellV2>
      <div className="flex flex-col gap-4 px-4 py-12 sm:px-8 lg:px-20">
        {join.isPending && (
          <EmptyState
            variant="loading"
            skeletonLayout="single-card"
          />
        )}
        {join.isError && (
          <EmptyState
            variant="error"
            title="Приглашение недействительно"
            body={
              join.error instanceof Error && join.error.message.includes('410')
                ? 'Срок действия токена истёк или он был использован максимальное число раз.'
                : 'Не удалось присоединиться. Попроси создателя когорты выпустить новый токен.'
            }
            cta={{ label: 'К каталогу когорт', onClick: () => navigate('/cohorts') }}
          />
        )}
      </div>
    </AppShellV2>
  )
}
