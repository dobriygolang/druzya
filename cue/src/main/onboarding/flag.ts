// First-run gating. We persist a single empty marker file at
// userData/onboarding-completed.flag once the user lands on the
// CompleteScreen. The Boot path in main/index.ts reads this synchronously
// (cheap stat) and decides whether to open the onboarding window or
// the compact window straight away.
//
// Why file existence not JSON content: zero parse cost on cold boot,
// no schema drift, easy to wipe for debug (Settings → "Re-run onboarding"
// just deletes the file).
//
// Why not the keychain: nothing sensitive here. The keychain has
// platform-specific quirks (TouchID prompts on macOS Tahoe before
// keytar 2.x); a plain file in userData is the boring correct call.

import { existsSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { app } from 'electron';

const FLAG_BASENAME = 'onboarding-completed.flag';

function flagPath(): string {
  return join(app.getPath('userData'), FLAG_BASENAME);
}

/** Sync probe — used by the boot path so we don't await before showing
 *  the first window. */
export function isOnboardingCompleted(): boolean {
  try {
    return existsSync(flagPath());
  } catch {
    // Filesystem error → treat as not-completed; better to over-show
    // onboarding than to drop a first-time user straight into compact
    // with no permission context.
    return false;
  }
}

export async function markOnboardingCompleted(): Promise<void> {
  const path = flagPath();
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, new Date().toISOString(), 'utf-8');
  } catch (err) {
    // Best-effort — if we can't write the flag the worst case is the
    // user sees onboarding again on next boot. Log + move on.
    // eslint-disable-next-line no-console
    console.warn('[onboarding] failed to write completion flag:', err);
  }
}

/** Clear the flag so the next boot re-shows onboarding. Surfaced via
 *  Settings → Permissions → "Re-run welcome flow". */
export async function clearOnboardingCompleted(): Promise<void> {
  try {
    await unlink(flagPath());
  } catch {
    // Already absent → fine.
  }
}
