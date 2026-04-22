import { useEffect, useState, useCallback } from 'react'

export type ThemeMode = 'dark' | 'light' | 'auto'
const STORAGE_KEY = 'druz9_theme'

function readStored(): ThemeMode {
  if (typeof window === 'undefined') return 'dark'
  const v = window.localStorage.getItem(STORAGE_KEY)
  if (v === 'dark' || v === 'light' || v === 'auto') return v
  return 'dark'
}

function resolveEffective(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'auto') {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
    }
    return 'dark'
  }
  return mode
}

function applyTheme(mode: ThemeMode) {
  if (typeof document === 'undefined') return
  const effective = resolveEffective(mode)
  const root = document.documentElement
  root.classList.remove('dark', 'light')
  root.classList.add(effective)
  root.dataset.theme = effective
}

// Apply ASAP at module load to avoid initial flash
if (typeof document !== 'undefined') {
  applyTheme(readStored())
}

type Listener = (m: ThemeMode) => void
const listeners = new Set<Listener>()
let current: ThemeMode = readStored()

function setMode(mode: ThemeMode) {
  current = mode
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, mode)
  }
  applyTheme(mode)
  listeners.forEach((l) => l(mode))
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(current)

  useEffect(() => {
    const l: Listener = (m) => setThemeState(m)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])

  // Listen for system color scheme changes when in auto
  useEffect(() => {
    if (theme !== 'auto') return
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia('(prefers-color-scheme: light)')
    const handler = () => applyTheme('auto')
    mql.addEventListener?.('change', handler)
    return () => mql.removeEventListener?.('change', handler)
  }, [theme])

  const set = useCallback((m: ThemeMode) => setMode(m), [])
  const toggle = useCallback(() => {
    const effective = resolveEffective(current)
    setMode(effective === 'dark' ? 'light' : 'dark')
  }, [])

  return { theme, set, toggle }
}

export function getEffectiveTheme(): 'dark' | 'light' {
  return resolveEffective(current)
}
