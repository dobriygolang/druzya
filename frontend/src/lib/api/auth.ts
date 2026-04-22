// Email + password authentication client.
//
// Backed by:
//   POST /api/v1/auth/register   { email, password, username? }
//   POST /api/v1/auth/login      { email, password }
//
// Both return { access_token, expires_in, user } and set an HttpOnly
// refresh cookie on the same path the OAuth flows use. The access token
// is persisted to localStorage so the existing apiClient bearer auth
// keeps working.

import { api, ApiError } from '../apiClient'

const TOKEN_KEY = 'druz9_access_token'

export type AuthCredentials = {
  email: string
  password: string
  username?: string
}

export type AuthUser = {
  id: string
  email: string
  username: string
  role: string
}

export type AuthSuccess = {
  access_token: string
  expires_in: number
  user: AuthUser
}

export type AuthErrorBody = {
  error: { code: string; message: string }
}

/** Persist the access token where apiClient looks for it. */
export function storeAccessToken(token: string): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(TOKEN_KEY, token)
    }
  } catch {
    /* ignore — non-browser env */
  }
}

export async function login(creds: AuthCredentials): Promise<AuthSuccess> {
  const out = await api<AuthSuccess>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: creds.email, password: creds.password }),
  })
  storeAccessToken(out.access_token)
  return out
}

export async function register(creds: AuthCredentials): Promise<AuthSuccess> {
  const body: Record<string, string> = {
    email: creds.email,
    password: creds.password,
  }
  if (creds.username) body.username = creds.username
  const out = await api<AuthSuccess>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  storeAccessToken(out.access_token)
  return out
}

/** Pull a human-readable message out of an ApiError thrown by api(). */
export function describeAuthError(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Network error'
  try {
    const parsed = JSON.parse(err.body) as AuthErrorBody
    if (parsed?.error?.message) return parsed.error.message
  } catch {
    /* not JSON */
  }
  if (err.status === 401) return 'Invalid email or password'
  if (err.status === 409) return 'Email already registered'
  return `Request failed (${err.status})`
}
