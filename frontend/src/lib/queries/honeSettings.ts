// honeSettings — react-query hooks для активного study-mode (источник
// правды — hone_user_settings). Web читает тот же setting'а что и
// Hone-desktop, чтобы /atlas / mock-result / прочие surface'ы выбирали
// AI-tutor персону по выбранному ученика mode'у.

import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

// Phase 4.1 (2026-05-04): 'ml' убран из enum. ML — специализация
// внутри dev_senior, а не отдельный hardcoded трек. Если на бэке
// пришло 'ml' (старая БД до миграции 00046) — coerce в 'general'.
export type ActiveTrack = 'general' | 'dev' | 'english' | 'go'

type WireSettings = {
  active_track?: string
}

function coerce(t: string | undefined): ActiveTrack {
  switch (t) {
    case 'dev':
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
