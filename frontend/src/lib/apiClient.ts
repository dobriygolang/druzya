// Thin fetch wrapper with bearer auth + 401 handling.
// Backed by either MSW (dev) or a real backend (prod), controlled by VITE_USE_MSW.

const TOKEN_KEY = 'druz9_access_token'

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1'

export function isMockMode(): boolean {
  return (import.meta.env.VITE_USE_MSW as string | undefined) === 'true'
}

function readToken(): string | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(TOKEN_KEY) : null
  } catch {
    return null
  }
}

function clearTokenAndRedirect() {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(TOKEN_KEY)
      // Avoid loop if already on /welcome
      if (!window.location.pathname.startsWith('/welcome')) {
        window.location.href = '/welcome'
      }
    }
  } catch {
    /* noop */
  }
}

export type Fetcher = <T = unknown>(path: string, init?: RequestInit) => Promise<T>

export const api: Fetcher = async (path, init = {}) => {
  const token = readToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers,
  })

  if (res.status === 401) {
    clearTokenAndRedirect()
    throw new ApiError(401, 'unauthorized')
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ApiError(res.status, body)
  }

  if (res.status === 204) return undefined as never
  return res.json()
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`api ${status}: ${body}`)
  }
}
