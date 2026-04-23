// PairInvitePage — invite-acceptance landing (route /pair/invite/:token).
//
// Flow: extract :token, POST it to a thin REST shim — the editor invite
// endpoint expects the token in the body and returns the resolved roomId.
// On success, redirect to /pair/{roomId}. On 404/410, show 404 EmptyState.
//
// Anti-fallback: never silently navigate to /pair on failure — the user
// asked for a specific room; if we can't resolve it, we say so.

import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { AppShellV2 } from '../../components/AppShell'
import { EmptyState } from '../../components/EmptyState'
import { api, ApiError } from '../../lib/apiClient'

type AcceptResponse = { room_id: string }

export default function PairInvitePage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [error, setError] = useState<'not-found' | 'generic' | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await api<AcceptResponse>(`/editor/invite/accept`, {
          method: 'POST',
          body: JSON.stringify({ token }),
        })
        if (!cancelled && res?.room_id) {
          navigate(`/pair/${res.room_id}`, { replace: true })
        }
      } catch (err) {
        if (cancelled) return
        if (err instanceof ApiError && (err.status === 404 || err.status === 410)) {
          setError('not-found')
        } else {
          setError('generic')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, navigate])

  if (error === 'not-found') {
    return (
      <AppShellV2>
        <EmptyState
          variant="404-not-found"
          title="Приглашение недействительно"
          body="Ссылка истекла или была отозвана."
          cta={{ label: 'К списку комнат', onClick: () => navigate('/pair') }}
        />
      </AppShellV2>
    )
  }
  if (error === 'generic') {
    return (
      <AppShellV2>
        <EmptyState
          variant="error"
          title="Не удалось принять приглашение"
          cta={{ label: 'К списку комнат', onClick: () => navigate('/pair') }}
        />
      </AppShellV2>
    )
  }
  return (
    <AppShellV2>
      <EmptyState variant="loading" />
    </AppShellV2>
  )
}
