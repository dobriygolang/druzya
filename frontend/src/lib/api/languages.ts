// Supported languages used by the onboarding language picker (step 2).
//
// Backed by GET /api/v1/languages (no auth). Player counts are stable
// pseudo-random integers derived server-side from the slug, so the same
// language renders the same number across reloads without any server
// state.

import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

export type Language = {
  slug: string
  name: string
  symbol: string
  color: string
  text_color?: string
  players_active: number
  kata_count: number
}

type LanguagesResponse = {
  items: Language[]
}

export function fetchLanguages(): Promise<LanguagesResponse> {
  return api<LanguagesResponse>('/languages')
}

export function useLanguages() {
  return useQuery<LanguagesResponse>({
    queryKey: ['languages'],
    queryFn: fetchLanguages,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  })
}
