// whats-new.ts — shows a one-time "What's new" toast on the first boot
// after an app version change.
//
// We persist the last-seen version in userData/last-seen-version.txt.
// On each boot we compare it to app.getVersion():
//   - Same version → nothing shown.
//   - Different (or file missing) → show info toast, write new version.
//
// The toast is intentionally short (≤3 lines) because ToastScreen clips
// at -webkit-line-clamp:3. For a full changelog the user can open ⌘K.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';

import { showToast, type WindowOptions } from './windows/window-manager';

const FILE = 'last-seen-version.txt';

// Bullet summary of the latest batch of changes shown in the toast.
// Keep it ≤ 120 chars so it fits in 3 lines at 12.5px.
const WHATS_NEW_MSG =
  '✨ Новое в Cue: ⌘K-палитра, Boosty-планы, голосовой тогл, обновлённый Persona/Model picker.';

export async function maybeShowWhatsNew(windowOptions: WindowOptions): Promise<void> {
  const current = app.getVersion();
  const versionFile = join(app.getPath('userData'), FILE);

  let stored: string | null = null;
  try {
    stored = (await readFile(versionFile, 'utf8')).trim();
  } catch {
    // File missing → first ever boot, treat as "new".
  }

  if (stored === current) return; // already seen this version

  // Write new version first so a crash during toast doesn't re-show forever.
  await writeFile(versionFile, current, 'utf8').catch(() => {
    /* best-effort */
  });

  // Small delay so compact window is fully visible before toast pops.
  await new Promise<void>((resolve) => setTimeout(resolve, 1500));
  showToast({ msg: WHATS_NEW_MSG, kind: 'info', ttlMs: 6000 }, windowOptions);
}
