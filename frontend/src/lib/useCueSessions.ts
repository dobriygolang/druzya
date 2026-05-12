// useCueSessions — React hooks over lib/cueSessions.ts (F10 stub). Subscribe
// to store changes so CoachMemoryCard reactively rerenders when юзер
// «logs» Cue session (manual entry или later via real Cue ingestion).
import { useEffect, useState } from 'react'

import {
  getLatestCueSession,
  getCueSessionsSummary,
  listCueSessions,
  subscribeCueSessions,
  type CueSession,
  type CueSessionsSummary,
} from './cueSessions'

export function useCueSessions(): CueSession[] {
  const [items, setItems] = useState<CueSession[]>(() => listCueSessions())
  useEffect(() => {
    const unsub = subscribeCueSessions(() => setItems(listCueSessions()))
    return () => {
      unsub()
    }
  }, [])
  return items
}

export function useLatestCueSession(): CueSession | null {
  const [latest, setLatest] = useState<CueSession | null>(() => getLatestCueSession())
  useEffect(() => {
    const unsub = subscribeCueSessions(() => setLatest(getLatestCueSession()))
    return () => {
      unsub()
    }
  }, [])
  return latest
}

export function useCueSessionsSummary(): CueSessionsSummary {
  const [summary, setSummary] = useState<CueSessionsSummary>(() => getCueSessionsSummary())
  useEffect(() => {
    const unsub = subscribeCueSessions(() => setSummary(getCueSessionsSummary()))
    return () => {
      unsub()
    }
  }, [])
  return summary
}
