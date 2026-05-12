// Plain-file session storage — trades stronger-at-rest encryption for
// a zero-prompt UX.
//
// History of this file:
//   1. Original: keytar → macOS login Keychain. Every ad-hoc-signed
//      rebuild triggered a password prompt that looked like phishing.
//   2. Tried: Electron `safeStorage`. Turned out safeStorage on macOS
//      is itself Keychain-backed — same prompt, different entry name
//      ("Cue Safe Storage"). Not a real fix.
//   3. Current: plain JSON in userData. No prompts, ever.
//
// Threat model — why this is acceptable:
//   • userData path is under the current macOS user's home, readable
//     only by that user and root. Anyone with read access to it has
//     already compromised your session a dozen other ways.
//   • Tokens are short-lived JWTs; refresh flow re-issues on expiry.
//   • No keychain / secrets manager prompt ever — critical for the
//     "stealth AI assistant" product: first-run UX can't look like a
//     password stealer.
//
// If we later get a stable Developer ID signing identity and want
// at-rest encryption back, swap `fs.readFile`/`fs.writeFile` in here
// for `safeStorage.decryptString`/`encryptString` — the Keychain
// prompt only fires once per signed-identity, so it becomes acceptable.

import { promises as fs } from 'node:fs';
import { join } from 'node:path';

import { app } from 'electron';

function blobPath(): string {
  return join(app.getPath('userData'), 'session.json');
}

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  /** ISO-8601 string. Kept as string so IPC transport doesn't mangle it. */
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
  // Restrictive permissions — macOS / Linux respect the 0600 mode, so
  // other users on the machine can't read the file even if they get
  // list-directory access to userData.
  await fs.writeFile(blobPath(), JSON.stringify(s, null, 0), { mode: 0o600 });
}

export async function loadSession(): Promise<StoredSession | null> {
  try {
    const raw = await fs.readFile(blobPath(), 'utf8');
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.expiresAt) {
      return null;
    }
    return parsed;
  } catch {
    // Missing / malformed → treat as no session. Caller redirects to
    // onboarding.
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await fs.unlink(blobPath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
