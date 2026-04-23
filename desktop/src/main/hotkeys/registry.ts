// Global hotkey registry. All bindings live in memory — the authoritative
// defaults come from DesktopConfig.defaultHotkeys, user overrides layer on
// top once the settings screen can persist them (future work).
//
// Every registered accelerator fires an IPC event 'event:hotkey-fired'
// with { action } — the renderer decides what that means (screenshot,
// toggle window, etc.). The main process is intentionally dumb about
// business logic.

import { globalShortcut } from 'electron';

import type { HotkeyAction, HotkeyBinding } from '@shared/types';

export type HotkeyHandler = (action: HotkeyAction) => void;

let handler: HotkeyHandler = () => {};
let current: HotkeyBinding[] = [];

export function setHotkeyHandler(h: HotkeyHandler): void {
  handler = h;
}

/**
 * Replace all registered bindings. Unregisters whatever was active
 * before, then registers the new set. Silently skips accelerators that
 * collide with other apps — the settings UI should let the user know
 * and pick an alternative.
 */
export function applyBindings(bindings: HotkeyBinding[]): HotkeyBinding[] {
  globalShortcut.unregisterAll();
  current = [];
  for (const b of bindings) {
    if (!b.accelerator) continue;
    const ok = globalShortcut.register(b.accelerator, () => handler(b.action));
    if (ok) current.push(b);
  }
  return current;
}

export function listBindings(): HotkeyBinding[] {
  return [...current];
}

export function disposeHotkeys(): void {
  globalShortcut.unregisterAll();
  current = [];
}
