// TutorRoleToggle — Stream D (2026-05-12). Self-toggle for the tutor
// role, surfaced on /profile. Identity.md states tutor mode is a role
// toggle (not a separate app, not paywalled), so this is the entire
// onboarding flow: flip ON → AppShell shows the Tutor nav item +
// /tutor sub-surfaces unlock.
//
// Wire shape: backend reads/writes `users.tutor_mode_enabled` via
// /profile/me/settings (PUT) and /profile/me (GET). Until `make
// generate` regenerates the proto, the wire field lives on the
// Settings PUT body but is consumed only by the new column write
// path on the server.
import { useState } from 'react'

import { Button } from './Button'
import { ApiError } from '../lib/apiClient'
import {
  useProfileQuery,
  useUpdateSettingsMutation,
} from '../lib/queries/profile'

export function TutorRoleToggle() {
  const profile = useProfileQuery()
  const update = useUpdateSettingsMutation()
  // Optimistic local state — the server round-trip + cache invalidate
  // can take a moment, and the toggle should feel instant.
  const [localOptimistic, setLocalOptimistic] = useState<boolean | null>(null)
  const enabled =
    localOptimistic ?? Boolean(profile.data?.tutor_mode_enabled ?? false)

  const onToggle = () => {
    const next = !enabled
    setLocalOptimistic(next)
    update.mutate(
      { tutor_mode_enabled: next },
      {
        onError: () => {
          // Roll back local state on failure so the UI doesn't lie.
          setLocalOptimistic(null)
        },
        onSettled: () => {
          // Drop the optimistic override once the cache has refetched.
          setLocalOptimistic(null)
        },
      },
    )
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface-1 p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-base font-bold leading-tight">
            Режим тутора
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">
            Включает дашборд тутора с подопечными, ассайнментами, сессиями
            и reading paths. Не требует подтверждения. Бесплатно.
          </p>
        </div>
        <span
          aria-label={enabled ? 'tutor mode on' : 'tutor mode off'}
          className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
            enabled
              ? 'border-text-primary bg-surface-2 text-text-primary'
              : 'border-border bg-surface-2 text-text-muted'
          }`}
        >
          {enabled ? 'on' : 'off'}
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant={enabled ? 'ghost' : 'primary'}
          size="sm"
          onClick={onToggle}
          disabled={update.isPending}
        >
          {update.isPending
            ? 'Сохраняем…'
            : enabled
              ? 'Выключить режим тутора'
              : 'Стать тутором'}
        </Button>
        {update.isError && (
          <span className="text-[12px] text-warn">
            {update.error instanceof ApiError
              ? update.error.body
              : 'Не получилось сохранить'}
          </span>
        )}
        {enabled && (
          <a
            href="/tutor"
            className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary hover:text-text-primary"
          >
            открыть дашборд →
          </a>
        )}
      </div>
    </section>
  )
}
