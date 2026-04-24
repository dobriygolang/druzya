// queries/sanctum.ts — composite-aliases для главной страницы.
//
// SanctumPage сам по себе агрегирует несколько bounded-контекстов
// (daily kata + streak, season pass, rating, profile, arena history,
// cohort). Чтобы импортный блок страницы не был километровым и для
// будущего реюза «дашборд для виджета X» — собираем удобные алиасы
// здесь.
//
// Хуки НЕ дублируем — реэкспорт оригиналов из их доменных файлов.

export { useDailyKataQuery, useStreakQuery } from './daily'
export { useSeasonQuery } from './season'
export { useRatingMeQuery, useLeaderboardQuery } from './rating'
export { useProfileQuery } from './profile'
export { useArenaHistoryQuery } from './matches'
export { useMyCohortQuery, useCohortWarQuery } from './cohort'

// useSanctumGreeting — крошечный синтетический селектор. Пара
// {displayName, streak} — то, что использует HeaderRow на главной.
// Вынесено в отдельный hook, чтобы тест мог проверять greeting-логику
// без рендера всей страницы.
import { useProfileQuery } from './profile'
import { useStreakQuery } from './daily'

export type SanctumGreeting = {
  displayName: string
  streak: number
  profileLoading: boolean
  streakLoading: boolean
}

export function useSanctumGreeting(): SanctumGreeting {
  const { data: profile, isLoading: profileLoading } = useProfileQuery()
  const { data: streak, isLoading: streakLoading } = useStreakQuery()
  return {
    displayName: profile?.display_name ?? '—',
    streak: streak?.current ?? 0,
    profileLoading,
    streakLoading,
  }
}
