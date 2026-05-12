// Global hotkey registry. All bindings live in memory — the authoritative
// defaults come from DesktopConfig.defaultHotkeys, user overrides layer on
// top via setOverride (persisted in userData/hotkeys.json by
// main/settings/hotkeys.ts).
//
// Every registered accelerator fires an IPC event 'event:hotkey-fired'
// with { action } — the renderer decides what that means (screenshot,
// toggle window, etc.). The main process is intentionally dumb about
// business logic.

import { globalShortcut } from 'electron';

import type { HotkeyAction, HotkeyBinding } from '@shared/types';

import {
  loadHotkeyOverrides,
  setHotkeyOverride,
  type HotkeyOverrides,
} from '../settings/hotkeys';

export type HotkeyHandler = (action: HotkeyAction) => void;

let handler: HotkeyHandler = () => {};
let current: HotkeyBinding[] = [];
// In-memory mirror of userData/hotkeys.json — kept in sync via setOverride.
// applyBindings reads this to layer overrides over the passed-in defaults so
// renderer doesn't need to send merged bindings on every settings mount.
let overrides: HotkeyOverrides = {};

export function setHotkeyHandler(h: HotkeyHandler): void {
  handler = h;
}

/**
 * fireAction — programmatically invoke the same pipeline a globalShortcut
 * would trigger. Used by the Tray menu so clicks go through the
 * main-side handler (which does e.g. cursor_freeze_toggle + event
 * broadcast) instead of only broadcasting to renderers.
 *
 * Safe to call before setHotkeyHandler has been registered — the default
 * handler is a no-op.
 */
export function fireAction(action: HotkeyAction): void {
  handler(action);
}

/**
 * Replace all registered bindings. Unregisters whatever was active
 * before, then registers the new set with the persisted override map
 * layered on top. Silently skips accelerators that collide with other
 * apps — the settings UI should let the user know and pick an alternative.
 */
export function applyBindings(bindings: HotkeyBinding[]): HotkeyBinding[] {
  globalShortcut.unregisterAll();
  current = [];
  const failed: HotkeyBinding[] = [];
  for (const b of bindings) {
    const accelerator = overrides[b.action] ?? b.accelerator;
    if (!accelerator) continue;
    const merged: HotkeyBinding = { action: b.action, accelerator };
    const ok = globalShortcut.register(merged.accelerator, () => handler(merged.action));
    if (ok) {
      current.push(merged);
    } else {
      failed.push(merged);
    }
  }
  if (failed.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      '[hotkeys] Failed to register:',
      failed.map((b) => `${b.action}=${b.accelerator}`).join(', '),
      '\n  Common causes:',
      '\n  1. Another app owns the chord (⌘⇧S by default is macOS Screenshot).',
      '\n  2. Accessibility permission not granted (System Settings → Privacy → Accessibility).',
      '\n  3. In dev mode, the parent process (Electron) needs the permission, not Druz9.app.',
    );
  }
  return current;
}

export function listBindings(): HotkeyBinding[] {
  return [...current];
}

/**
 * Hydrate the in-memory override map from disk. Call once on app
 * startup before applyBindings so the first registration picks up
 * persisted user choices.
 */
export async function hydrateOverrides(): Promise<HotkeyOverrides> {
  overrides = await loadHotkeyOverrides();
  return { ...overrides };
}

/**
 * Persist a single override (or clear if accelerator==''), update the
 * in-memory map, and return the new map. Caller re-applies bindings
 * to push the changed accelerator down to globalShortcut.
 */
export async function setOverride(
  action: HotkeyAction,
  accelerator: string,
): Promise<HotkeyOverrides> {
  overrides = await setHotkeyOverride(action, accelerator);
  return { ...overrides };
}

/** Read the in-memory override snapshot. */
export function listOverrides(): HotkeyOverrides {
  return { ...overrides };
}

export function disposeHotkeys(): void {
  globalShortcut.unregisterAll();
  current = [];
}
