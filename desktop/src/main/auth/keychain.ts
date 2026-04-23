// Secure token storage via OS keychain. We keep the wrapper tiny so a
// future move to safeStorage (Electron's built-in, uses the same keychain
// under the hood but with library-validation entitlements) is a one-line
// swap.

import keytar from 'keytar';

const SERVICE = 'app.druzya.copilot';
const ACCOUNT_ACCESS = 'access-token';
const ACCOUNT_REFRESH = 'refresh-token';
const ACCOUNT_USER = 'user-id';
const ACCOUNT_EXP = 'expires-at';

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  userId: string;
  expiresAt: string; // ISO-8601
}

export async function saveSession(s: StoredSession): Promise<void> {
  await Promise.all([
    keytar.setPassword(SERVICE, ACCOUNT_ACCESS, s.accessToken),
    keytar.setPassword(SERVICE, ACCOUNT_REFRESH, s.refreshToken),
    keytar.setPassword(SERVICE, ACCOUNT_USER, s.userId),
    keytar.setPassword(SERVICE, ACCOUNT_EXP, s.expiresAt),
  ]);
}

export async function loadSession(): Promise<StoredSession | null> {
  const [accessToken, refreshToken, userId, expiresAt] = await Promise.all([
    keytar.getPassword(SERVICE, ACCOUNT_ACCESS),
    keytar.getPassword(SERVICE, ACCOUNT_REFRESH),
    keytar.getPassword(SERVICE, ACCOUNT_USER),
    keytar.getPassword(SERVICE, ACCOUNT_EXP),
  ]);
  if (!accessToken || !refreshToken || !userId || !expiresAt) {
    return null;
  }
  return { accessToken, refreshToken, userId, expiresAt };
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    keytar.deletePassword(SERVICE, ACCOUNT_ACCESS),
    keytar.deletePassword(SERVICE, ACCOUNT_REFRESH),
    keytar.deletePassword(SERVICE, ACCOUNT_USER),
    keytar.deletePassword(SERVICE, ACCOUNT_EXP),
  ]);
}
