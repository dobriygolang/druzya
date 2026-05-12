// Appearance prefs — opacity of the expanded chat + last-resize bounds.
//
// Why a separate file from Keychain / masquerade / hotkeys: those all
// persist OS-integrated state (secure secrets, icon swap, global
// shortcuts). Appearance is purely cosmetic and user-local — a single
// JSON in userData is enough and keeps the code diff tiny.
//
// File lives at app.getPath('userData') + '/appearance.json'. Missing
// file = return defaults. Corrupted file (parse error) = log warn,
// return defaults, overwrite on next write. No migrations needed at
// this version count.

import { app } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export interface AppearancePrefs {
  /**
   * Opacity of the expanded chat's background layer.
   * 0   = fully transparent (full vibrancy blur shows through)
   * 100 = fully opaque (classic look, no blur visible)
   * Mapped in CSS: alpha = 1 - (opacity * 0.006) so slider 0 maps to
   * 0.4 alpha (still readable) and slider 100 maps to 1.0 alpha.
   */
  expandedOpacity: number;
  /**
   * Last user-set bounds of the expanded window. Restored on next
   * open. Null when user has never resized/moved (= fresh install).
   */
  expandedBounds: { x: number; y: number; width: number; height: number } | null;
  /**
   * Last user-set bounds of the compact window (the always-on-top
   * floating bar). Width/height are ignored — compact is not
   * resizable — but we keep them in the same shape to reuse the
   * same setBounds helper. Null = first run, use the top-right
   * default anchored position.
   *
   * This is the "follows your eyes" feature: the user drags compact
   * to wherever they're looking (IDE left panel, Zoom window middle,
   * etc.) and it stays there across app restarts / window re-opens.
   */
  compactBounds: { x: number; y: number; width: number; height: number } | null;
}

export const DefaultAppearance: AppearancePrefs = {
  expandedOpacity: 85,
  expandedBounds: null,
  compactBounds: null,
};

function filePath(): string {
  return join(app.getPath('userData'), 'appearance.json');
}

export async function loadAppearance(): Promise<AppearancePrefs> {
  try {
    const raw = await fs.readFile(filePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppearancePrefs>;
    return { ...DefaultAppearance, ...parsed };
  } catch (err) {
    // ENOENT on first run is normal — just return defaults.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // eslint-disable-next-line no-console
      console.warn('[appearance] failed to load, using defaults:', err);
    }
    return { ...DefaultAppearance };
  }
}

export async function saveAppearance(prefs: Partial<AppearancePrefs>): Promise<AppearancePrefs> {
  const current = await loadAppearance();
  const merged: AppearancePrefs = { ...current, ...prefs };
  try {
    await fs.writeFile(filePath(), JSON.stringify(merged, null, 2), 'utf8');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[appearance] save failed:', err);
    throw err;
  }
  return merged;
}
