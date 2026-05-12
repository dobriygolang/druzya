// useActivity — React hooks over lib/activity.ts. Subscribe to store changes
// so TodayPage / DailyPlanCard reactively rerender при log/delete.
import { useEffect, useState } from 'react'

import {
  computeStreak,
  getActivitySummary,
  listActivities,
  subscribeActivities,
  type Activity,
  type ActivitySummary,
  type StreakInfo,
} from './activity'

export function useActivities(): Activity[] {
  const [items, setItems] = useState<Activity[]>(() => listActivities())
  useEffect(() => {
    const unsub = subscribeActivities(() => setItems(listActivities()))
    return () => {
      unsub()
    }
  }, [])
  return items
}

export function useActivitySummary(): ActivitySummary {
  const [summary, setSummary] = useState<ActivitySummary>(() => getActivitySummary())
  useEffect(() => {
    const unsub = subscribeActivities(() => setSummary(getActivitySummary()))
    return () => {
      unsub()
    }
  }, [])
  return summary
}

export function useStreak(): StreakInfo {
  const [streak, setStreak] = useState<StreakInfo>(() => computeStreak())
  useEffect(() => {
    const unsub = subscribeActivities(() => setStreak(computeStreak()))
    return () => {
      unsub()
    }
  }, [])
  return streak
}
