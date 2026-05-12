// theme.ts — dark-only kill switch (CI4 Phase A W3 cleanup, 2026-05-11).
//
// Light theme tokens were never AAA-audited and Hone aesthetic is dark-first
// across all three surfaces (web / Hone / Cue). Per roadmap anti-pattern #16
// — kill switch was chosen over running the full contrast audit (saves ~1
// day work). Public API kept stable so callers don't break; toggle and set
// are no-ops, theme is always 'dark'. Re-introducing light is a 2-line
// revert if we ever change our minds.
import { useCallback, useState } from 'react'

export type ThemeMode = 'dark' | 'light' | 'auto'

function applyDark() {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.remove('light')
  root.classList.add('dark')
  root.dataset.theme = 'dark'
}

if (typeof document !== 'undefined') {
  applyDark()
}

export function useTheme() {
  // State retained для API совместимости (компоненты деструктурируют
  // `theme`); функционально это всегда 'dark'.
  const [theme] = useState<ThemeMode>('dark')

  const set = useCallback((_m: ThemeMode) => {
    // No-op: dark-only kill switch.
  }, [])
  const toggle = useCallback(() => {
    // No-op: dark-only kill switch.
  }, [])

  return { theme, set, toggle }
}

export function getEffectiveTheme(): 'dark' | 'light' {
  return 'dark'
}
