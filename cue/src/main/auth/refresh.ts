// Token-refresh client.
//
// Proactively rotates the access token when it's near expiry, AND retries
// once after a 401 from the backend. Without this loop, every long-lived
// Cue session bricked the moment the JWT TTL elapsed (commonly ~1h after
// login): the user was «logged in» locally — keychain still had a token —
// but every screenshot/chat call returned «HTTP 401 unauthenticated».
//
// Backend contract (see backend/services/auth/ports/server.go):
//   POST /api/v1/auth/refresh
//     header X-Refresh-Token: <stored refresh>
//     body  {}
//   →
//     200  { access_token, expires_in, user }
//          response header X-Refresh-Token: <new rotated refresh>
//     401  refresh expired / revoked → user must log in again
//
// We deliberately serialize concurrent refreshes through a single Promise
// so a burst of requests after expiry triggers ONE refresh, not N.

import type { StoredSession } from './keychain';
import { clearSession, loadSession, saveSession } from './keychain';

export interface RefreshDeps {
  apiBaseURL: string;
}

let inflight: Promise<StoredSession | null> | null = null;

/**
 * Refresh now, regardless of expiry. Coalesces concurrent callers.
 * Resolves with the new session, or null if the refresh token is no
 * longer valid (clearSession was called as a side-effect — caller
 * should redirect to onboarding).
 */
export async function refreshSession(
  deps: RefreshDeps,
  current?: StoredSession,
): Promise<StoredSession | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const session = current ?? (await loadSession());
      if (!session?.refreshToken) return null;
      const url = `${deps.apiBaseURL.replace(/\/+$/, '')}/api/v1/auth/refresh`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Refresh-Token': session.refreshToken,
        },
        body: '{}',
      });
      if (resp.status === 401 || resp.status === 403) {
        // Refresh itself rejected — wipe session, force re-login.
        await clearSession();
        return null;
      }
      if (!resp.ok) {
        // Network / 5xx — keep the existing session; caller may retry on
        // its own. Don't wipe local state on transient backend issues.
        return null;
      }
      const body = (await resp.json()) as {
        access_token?: string;
        accessToken?: string;
        expires_in?: number;
        expiresIn?: number;
      };
      const accessToken = body.access_token ?? body.accessToken ?? '';
      const expiresIn = Number(body.expires_in ?? body.expiresIn ?? 0);
      if (!accessToken || !expiresIn) return null;
      // Rotated refresh comes back in a response header (vanguard
      // transcoder propagates `Set-Cookie`-only state through this header
      // for non-cookie clients — see buildLoginResponse in the backend).
      const rotated = resp.headers.get('X-Refresh-Token') ?? '';
      const next: StoredSession = {
        accessToken,
        refreshToken: rotated || session.refreshToken,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
        profile: session.profile,
      };
      await saveSession(next);
      return next;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Returns a fresh session — refreshes proactively if the access token
 * expires within `safetyWindowMs` (default 30s).
 *
 * Returns null if there's no session at all OR if refresh failed
 * permanently (caller must redirect to onboarding).
 */
export async function getValidSession(
  deps: RefreshDeps,
  safetyWindowMs = 30_000,
): Promise<StoredSession | null> {
  const s = await loadSession();
  if (!s) return null;
  const expiresAt = Date.parse(s.expiresAt);
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() > safetyWindowMs) {
    return s;
  }
  return refreshSession(deps, s);
}
