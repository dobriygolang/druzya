// honeSettings — react-query hooks для активного study-mode (источник
// правды — hone_user_settings). Web читает тот же setting'а что и
// Hone-desktop, чтобы /atlas / mock-result / прочие surface'ы выбирали
// AI-tutor персону по выбранному ученика mode'у.

import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

// M1 (2026-05-12): 'ml' восстановлен как first-class active track.
// identity.md обещает «3 equal tracks: Go senior · ML engineering ·
// English» — реальность теперь матчит. ML атлас-узлы по-прежнему
// tag'нуты под track_kind='dev_senior' (ml-coach persona scoped to
// dev_senior); active_track='ml' — UI-фильтр Hone + persona handoff
// (TodayPage / AtlasDrawer / MockResultPage / Reading → ml-coach).
// Backend mig 00110 восстановил CHECK constraint.
export type ActiveTrack = 'general' | 'dev' | 'ml' | 'english' | 'go'

type WireSettings = {
  active_track?: string
}

function coerce(t: string | undefined): ActiveTrack {
  switch (t) {
    case 'dev':
    case 'ml':
    case 'english':
    case 'go':
      return t
    default:
      return 'general'
  }
}

/** Активный study-mode пользователя. На неавторизованном — 'general'. */
export function useActiveStudyModeQuery() {
  return useQuery({
    queryKey: ['hone', 'settings'] as const,
    queryFn: async () => {
      const r = await api<WireSettings>('/hone/settings')
      return { activeTrack: coerce(r.active_track) }
    },
    staleTime: 60_000,
  })
}
