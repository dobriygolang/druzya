// Onboarding preview kata — used by step 3 of the onboarding flow.
//
// Backed by GET /api/v1/onboarding/preview-kata (no auth). The endpoint
// returns a fixed "Two Sum" task with starter code + an immutable
// tests_total/tests_passed pair so the marketing UI can demo the kata
// surface without spinning up a real session.

import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

export type PreviewKata = {
  slug: string
  title: string
  tags: string[]
  difficulty: string
  description: string
  starter_code: string
  tests_total: number
  tests_passed: number
}

export function fetchOnboardingPreviewKata(): Promise<PreviewKata> {
  return api<PreviewKata>('/onboarding/preview-kata')
}

export function useOnboardingPreviewKata() {
  return useQuery<PreviewKata>({
    queryKey: ['onboarding', 'preview-kata'],
    queryFn: fetchOnboardingPreviewKata,
    staleTime: 60 * 60_000,
    gcTime: 2 * 60 * 60_000,
    refetchOnWindowFocus: false,
  })
}
