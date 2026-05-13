// useTrackFilter — composable hook that bridges URL params,
// localStorage and the user's PrimaryGoal-derived default into a single
// Set<TrackKey>. Surfaces (Atlas list / canvas, Mock picker, Codex,
// Insights) call this once and pipe `selected` + `setSelected` into
// <TrackFilterChips>.
//
// Precedence:
//   1. URL `?tracks=go,ml` — explicit shareable override (no LS write
//      until user clicks a chip, so opening a shared link doesn't
//      clobber the recipient's prefs).
//   2. localStorage `druz9.track-filter:<key>` — last-used per-surface.
//   3. PrimaryGoal-derived default (GOAL_KIND_ML_OFFER → ml, etc.) when
//      `defaultFromPrimaryGoal: true` and the user has set a goal.
//   4. Empty Set («All») fallback.
//
// URL write strategy: when the user toggles a chip, we BOTH persist
// to LS and update `?tracks=…`. This keeps shareable links live AND
// keeps the URL in sync if you copy it mid-session.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  parseTracksFromUrl,
  primaryGoalToTrackKey,
  readTrackFilterFromStorage,
  serializeTracksForUrl,
  writeTrackFilterToStorage,
  type TrackKey,
} from './trackFilter'
import { useActivePrimaryGoalQuery } from './queries/primaryGoal'

export interface UseTrackFilterOptions {
  /**
   * localStorage key (without the prefix). Required for cross-session
   * persistence; omit for ephemeral filters.
   */
  persistKey?: string
  /**
   * When true, и нет ни URL ни LS state, pre-select track derived from
   * the user's active PrimaryGoal. Useful для Atlas where «show me my
   * track only» is the more useful default than «overwhelming everything».
   */
  defaultFromPrimaryGoal?: boolean
  /**
   * URL query-param name. Defaults to `tracks`. Set to `null` to skip
   * URL sync entirely (purely local filter).
   */
  urlParam?: string | null
}

export function useTrackFilter(opts: UseTrackFilterOptions = {}) {
  const { persistKey, defaultFromPrimaryGoal = false, urlParam = 'tracks' } = opts

  const [searchParams, setSearchParams] = useSearchParams()
  const primaryGoalQ = useActivePrimaryGoalQuery()
  const primaryGoal = primaryGoalQ.data ?? null

  // Track whether we've hydrated initial state yet — initial render
  // can't read URL+LS+goal в один pass (goal query may still be pending).
  // We hydrate URL/LS synchronously, then patch in the goal-derived
  // default if BOTH URL and LS are empty AND the user has a goal.
  const initialFromUrl = urlParam ? parseTracksFromUrl(searchParams.get(urlParam)) : null
  const initialFromLs = persistKey ? readTrackFilterFromStorage(persistKey) : null
  const initial = initialFromUrl ?? initialFromLs ?? new Set<TrackKey>()

  const [selected, setSelectedState] = useState<Set<TrackKey>>(initial)
  const hydratedGoalRef = useRef<boolean>(false)

  // Apply PrimaryGoal-derived default once, ONLY when:
  //   - URL had nothing
  //   - LS had nothing
  //   - User has an active goal that maps to a track
  // We use a ref guard so re-renders / goal refetches don't replay it
  // (the user может уже toggle'нуть chip к этому моменту).
  useEffect(() => {
    if (hydratedGoalRef.current) return
    if (!defaultFromPrimaryGoal) return
    if (primaryGoalQ.isLoading) return
    if (initialFromUrl !== null) {
      hydratedGoalRef.current = true
      return
    }
    if (initialFromLs !== null && initialFromLs.size > 0) {
      hydratedGoalRef.current = true
      return
    }
    const goalTrack = primaryGoalToTrackKey(primaryGoal?.kind)
    if (goalTrack) {
      hydratedGoalRef.current = true
      setSelectedState(new Set([goalTrack]))
    } else {
      hydratedGoalRef.current = true
    }
    // We intentionally depend on the *resolved* state, not the dynamic
    // searchParams — initialFromUrl is a stable read on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryGoalQ.isLoading, primaryGoal?.kind, defaultFromPrimaryGoal])

  // setSelected is the public mutator. It updates state, writes LS, and
  // syncs the URL param. We keep URL behind `replace: true` so the
  // browser history doesn't fill with filter toggles.
  const setSelected = useCallback(
    (next: Set<TrackKey>) => {
      setSelectedState(next)
      if (persistKey) writeTrackFilterToStorage(persistKey, next)
      if (urlParam) {
        // Snapshot current params to avoid clobbering other state
        // (e.g. /atlas?v=2&tracks=go).
        const params = new URLSearchParams(window.location.search)
        if (next.size === 0) {
          params.delete(urlParam)
        } else {
          params.set(urlParam, serializeTracksForUrl(next))
        }
        setSearchParams(params, { replace: true })
      }
    },
    [persistKey, urlParam, setSearchParams],
  )

  // Re-sync from URL if the param changes externally (back/forward nav,
  // shareable link load, programmatic navigate()). Only fires when the
  // serialized form actually drifts so we don't loop с our own writes.
  const lastSyncedUrlRef = useRef<string | null>(null)
  useEffect(() => {
    if (!urlParam) return
    const fromUrl = searchParams.get(urlParam)
    if (fromUrl === lastSyncedUrlRef.current) return
    lastSyncedUrlRef.current = fromUrl
    const parsed = parseTracksFromUrl(fromUrl)
    if (parsed === null) {
      // Param removed — but don't clear if it was just our LS-loaded
      // state не показанное в URL изначально.
      return
    }
    setSelectedState(parsed)
  }, [searchParams, urlParam])

  // Stable identity for consumers that pass `selected` to memo deps.
  const selectedMemo = useMemo(() => selected, [selected])

  return {
    selected: selectedMemo,
    setSelected,
    /** True when goal-derived default is still being resolved. */
    isHydrating: defaultFromPrimaryGoal && primaryGoalQ.isLoading && !hydratedGoalRef.current,
  }
}
