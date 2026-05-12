// useReadiness — reactive hook over computeReadiness() (F3). Recomputes
// когда goal обновляется (subscribeGoal) или activity log меняется
// (subscribeActivities). Diagnostic answers тоже учитываются — но они
// меняются редко (только после F9 quiz), так что storage event тригерит
// recompute из subscribeActivities (cross-tab) при следующем activity event.
//
// Возвращает Readiness | null когда goal не выбран — anti-fallback,
// readiness без goal не имеет смысла.

import { useEffect, useState } from 'react'

import { subscribeActivities } from './activity'
import { subscribeGoal } from './goal'
import { computeReadiness, type Readiness } from './readiness'
import { useGoal } from './useGoal'

export function useReadiness(): Readiness | null {
  const goal = useGoal()
  const [readiness, setReadiness] = useState<Readiness | null>(() =>
    goal ? computeReadiness(goal) : null,
  )

  useEffect(() => {
    if (!goal) {
      setReadiness(null)
      return
    }
    // Initial sync — useState init может отставать от useGoal первого render'а.
    setReadiness(computeReadiness(goal))

    const unsubActivity = subscribeActivities(() => {
      setReadiness(computeReadiness(goal))
    })
    const unsubGoal = subscribeGoal((next) => {
      setReadiness(next ? computeReadiness(next) : null)
    })
    return () => {
      unsubActivity()
      unsubGoal()
    }
  }, [goal])

  return readiness
}
