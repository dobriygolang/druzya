// Main-side persistent hotkey overrides — лежит в userData/hotkeys.json.
//
// Раньше overrides жили только в renderer localStorage; при wipe'е renderer
// state (DevTools «Clear storage», переустановка) пользователь терял
// rebindings. Также при первом mount'е main-process registry знал только
// DesktopConfig defaults — overrides применялись после mount'а Settings.
//
// Теперь main грузит overrides на startup, sends их в registry.applyBindings
// поверх defaults; renderer тоже читает через hotkeysList() и hydrate'ит
// свой store. setOverride / clearOverride пишут JSON-файл атомарно
// (tmpfile + rename) — на crash'е либо старая, либо новая версия.

import { app } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

import type { HotkeyAction } from '@shared/types';

export type HotkeyOverrides = Partial<Record<HotkeyAction, string>>;

function filePath(): string {
  return join(app.getPath('userData'), 'hotkeys.json');
}

/** Load overrides; missing file → empty map. */
export async function loadHotkeyOverrides(): Promise<HotkeyOverrides> {
  try {
    const raw = await fs.readFile(filePath(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // Validate: keep only string→string entries.
      const out: HotkeyOverrides = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string' && v.length > 0) {
          out[k as HotkeyAction] = v;
        }
      }
      return out;
    }
    return {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // eslint-disable-next-line no-console
      console.warn('[hotkeys] failed to load overrides:', err);
    }
    return {};
  }
}

/** Write the entire overrides map atomically. */
export async function saveHotkeyOverrides(overrides: HotkeyOverrides): Promise<void> {
  const target = filePath();
  const tmp = `${target}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(overrides, null, 2), 'utf8');
    await fs.rename(tmp, target);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[hotkeys] save overrides failed:', err);
    throw err;
  }
}

/** Set / clear a single override and persist. Pass empty accelerator to clear. */
export async function setHotkeyOverride(
  action: HotkeyAction,
  accelerator: string,
): Promise<HotkeyOverrides> {
  const current = await loadHotkeyOverrides();
  const next: HotkeyOverrides = { ...current };
  if (accelerator.trim() === '') {
    delete next[action];
  } else {
    next[action] = accelerator;
  }
  await saveHotkeyOverrides(next);
  return next;
}
