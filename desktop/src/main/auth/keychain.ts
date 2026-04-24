// Secure token storage via OS keychain. We mirror the frontend's
// post-login shape — access (JWT) + refresh (opaque session UUID) +
// expiresAt for silent-refresh scheduling. The lightweight profile
// (userId, username, avatar) is kept alongside so we can render "hi,
// @you" without decoding the JWT on every read.

// keytar is a CommonJS native addon. electron-vite's ESM bundle wraps
// default/namespace imports in a way that loses the function table.
// createRequire gives us the raw CJS module as the runtime would see
// it — bypasses the bundler interop entirely.
import { createRequire } from 'node:module';
const keytar = createRequire(import.meta.url)('keytar') as typeof import('keytar');

const SERVICE = 'app.druzya.copilot';
const ACCOUNT_ACCESS = 'access-token';
const ACCOUNT_REFRESH = 'refresh-token';
const ACCOUNT_EXPIRES = 'access-expires-at';
const ACCOUNT_PROFILE = 'profile'; // JSON blob — not secret

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  /** ISO-8601 string. We keep a string so IPC transport doesn't mangle it. */
  expiresAt: string;
  profile: SessionProfile;
}

/** Display-only identity info; not used for auth checks. */
export interface SessionProfile {
  userId: string;
  username: string;
  avatarURL: string;
  isNewUser: boolean;
}

export async function saveSession(s: StoredSession): Promise<void> {
  await Promise.all([
    keytar.setPassword(SERVICE, ACCOUNT_ACCESS, s.accessToken),
    keytar.setPassword(SERVICE, ACCOUNT_REFRESH, s.refreshToken),
    keytar.setPassword(SERVICE, ACCOUNT_EXPIRES, s.expiresAt),
    keytar.setPassword(SERVICE, ACCOUNT_PROFILE, JSON.stringify(s.profile)),
  ]);
}

export async function loadSession(): Promise<StoredSession | null> {
  const [accessToken, refreshToken, expiresAt, profileRaw] = await Promise.all([
    keytar.getPassword(SERVICE, ACCOUNT_ACCESS),
    keytar.getPassword(SERVICE, ACCOUNT_REFRESH),
    keytar.getPassword(SERVICE, ACCOUNT_EXPIRES),
    keytar.getPassword(SERVICE, ACCOUNT_PROFILE),
  ]);
  if (!accessToken || !refreshToken || !expiresAt) return null;
  let profile: SessionProfile = { userId: '', username: '', avatarURL: '', isNewUser: false };
  if (profileRaw) {
    try {
      profile = JSON.parse(profileRaw);
    } catch {
      /* corrupt entry — fall back to empty profile */
    }
  }
  return { accessToken, refreshToken, expiresAt, profile };
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    keytar.deletePassword(SERVICE, ACCOUNT_ACCESS),
    keytar.deletePassword(SERVICE, ACCOUNT_REFRESH),
    keytar.deletePassword(SERVICE, ACCOUNT_EXPIRES),
    keytar.deletePassword(SERVICE, ACCOUNT_PROFILE),
  ]);
}
