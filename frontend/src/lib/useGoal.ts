// useGoal — React hook over lib/goal.ts. Subscribes к store changes так что
// CoachMemoryCard + Hone-like surfaces re-render когда юзер обновляет goal
// через wizard в любом таб'е.
import { useEffect, useState } from 'react'

import { getGoal, subscribeGoal, type UserGoal } from './goal'

export function useGoal(): UserGoal | null {
  const [goal, setGoalState] = useState<UserGoal | null>(() => getGoal())
  useEffect(() => {
    const unsub = subscribeGoal((next) => setGoalState(next))
    return () => {
      unsub()
    }
  }, [])
  return goal
}
