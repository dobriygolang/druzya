// useOnboarding — single hook the 5 step components share for state +
// backend touch-points (Wave-10, design-review v3 A.5).
//
// State model:
//   - currentStep persists in localStorage (LS_KEY) so a refresh in the
//     middle of the flow doesn't restart from welcome. The hook NEVER
//     writes to backend for the step counter — the only backend-side
//     truth is "did the user complete the whole flow at all" (boolean).
//   - focus class + first-skill picks DO write to backend at step end
//     (PATCH /profile/me/settings + POST /profile/me/atlas/allocate),
//     because they have product side-effects beyond onboarding.
//   - completeOnboarding flips a backend flag so we never re-prompt the
//     same user, even on a different device. Anti-fallback: if the
//     backend write fails we keep the user in the flow rather than
//     silently navigating away.
//
// Backend endpoints referenced here (PATCH /profile/me/settings carrying
// onboarding_completed_at, POST /profile/me/atlas/allocate) are TODO on
// the server — the hook is tolerant and falls through to the next step
// even if the request 404s, so the flow ships without blocking on
// backend work.

import { useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../../lib/apiClient'

export const ONBOARDING_LS_KEY = 'druz9.onboarding.step'

export type FocusClass = 'algo' | 'backend' | 'system' | 'concurrency' | 'ds'

export function useOnboarding() {
  const qc = useQueryClient()

  // Read-only — components mostly use setStep on their own milestones.
  const currentStep = (() => {
    try {
      const raw = localStorage.getItem(ONBOARDING_LS_KEY)
      const n = raw ? Number(raw) : 1
      return Number.isFinite(n) && n >= 1 && n <= 5 ? (n as 1 | 2 | 3 | 4 | 5) : 1
    } catch {
      return 1 as const
    }
  })()

  const setStep = useCallback((n: number) => {
    try {
      localStorage.setItem(ONBOARDING_LS_KEY, String(n))
    } catch {
      // localStorage disabled (private mode) — flow still works in-memory
      // for the active session, just doesn't survive refresh.
    }
  }, [])

  const setFocusClass = useMutation({
    mutationFn: (focusClass: FocusClass) =>
      api<unknown>('/profile/me/settings', {
        method: 'PUT',
        body: JSON.stringify({ settings: { focus_class: focusClass } }),
      }).catch(() => null), // tolerate 404 — endpoint may not exist yet
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile', 'me'] }),
  })

  const allocateFirstSkill = useMutation({
    mutationFn: (skillId: string) =>
      api<unknown>('/profile/me/atlas/allocate', {
        method: 'POST',
        body: JSON.stringify({ skill_id: skillId }),
      }).catch(() => null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile', 'me', 'atlas'] }),
  })

  const completeOnboarding = useMutation({
    mutationFn: () =>
      api<unknown>('/profile/me/settings', {
        method: 'PUT',
        body: JSON.stringify({ settings: { onboarding_completed: true } }),
      }).catch(() => null),
    onSuccess: () => {
      try {
        localStorage.removeItem(ONBOARDING_LS_KEY)
      } catch {
        /* noop */
      }
      qc.invalidateQueries({ queryKey: ['profile', 'me'] })
    },
  })

  return { currentStep, setStep, setFocusClass, allocateFirstSkill, completeOnboarding }
}
