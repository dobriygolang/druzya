// Backend persistence через PUT /profile/me/settings {onboarding_completed:
// true} уже сделано (useOnboarding.completeOnboarding). Здесь добавляем
// localStorage mirror чтобы:
//   1. Root redirect не ждал /profile fetch для решения «отправить юзера на
//      /onboarding или /today»
//   2. Cross-tab sync: complete в одном tab'е → второй tab тоже идёт на
//      /today после storage event
//
// Pattern: read-through. localStorage = fast path, backend = source of
// truth. При несоответствии (юзер cleared localStorage но backend знает что
// done) — backend response переписывает localStorage через
// markOnboardingCompleted().

const KEY = 'druz9.onboarding.completed.v1'

export function isOnboardingCompleted(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function markOnboardingCompleted(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY, '1')
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: '1' }))
  } catch {
    /* private mode / quota — silent */
  }
}

export function clearOnboardingFlag(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(KEY)
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: null }))
  } catch {
    /* ignore */
  }
}

/**
 * Subscribe to flag changes via storage event. Multi-tab safe.
 */
export function subscribeOnboardingFlag(cb: (completed: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (e: StorageEvent) => {
    if (e.key !== KEY) return
    cb(e.newValue === '1')
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}
