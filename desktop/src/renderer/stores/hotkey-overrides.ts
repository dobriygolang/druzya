// User-overridden hotkey accelerators. Server-provided defaults live in
// DesktopConfig.DefaultHotkeys; whenever a user rebinds, we persist the
// override here. Settings mount merges (defaults + overrides) and sends
// the resulting list to main via hotkeys.update.
//
// localStorage rather than the backend because:
//   1. Keybindings are per-machine — you don't want your laptop's chords
//      to override your desktop's.
//   2. Works offline; no round-trip to save a binding.
//   3. Easy to reset by clearing the key.

import { create } from 'zustand';

import type { HotkeyAction, HotkeyBinding } from '@shared/types';

const STORAGE_KEY = 'druz9.hotkeyOverrides';

interface State {
  /** action → accelerator. Unset means "use the default from DesktopConfig". */
  overrides: Partial<Record<HotkeyAction, string>>;
  set: (action: HotkeyAction, accelerator: string) => void;
  clear: (action: HotkeyAction) => void;
  /** Merge defaults with overrides and return the effective binding list. */
  merge: (defaults: HotkeyBinding[]) => HotkeyBinding[];
}

function load(): Partial<Record<HotkeyAction, string>> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function persist(v: Partial<Record<HotkeyAction, string>>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    /* private mode — ignored */
  }
}

export const useHotkeyOverridesStore = create<State>((set, get) => ({
  overrides: load(),
  set: (action, accelerator) => {
    const next = { ...get().overrides, [action]: accelerator };
    persist(next);
    set({ overrides: next });
  },
  clear: (action) => {
    const next = { ...get().overrides };
    delete next[action];
    persist(next);
    set({ overrides: next });
  },
  merge: (defaults) => {
    const { overrides } = get();
    return defaults.map((b) =>
      overrides[b.action] ? { action: b.action, accelerator: overrides[b.action]! } : b,
    );
  },
}));
