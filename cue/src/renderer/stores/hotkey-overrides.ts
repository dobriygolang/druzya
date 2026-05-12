// User-overridden hotkey accelerators. Server-provided defaults live in
// DesktopConfig.DefaultHotkeys; whenever a user rebinds, we persist the
// override via main IPC (`hotkeys.setOverride`) which writes to
// userData/hotkeys.json. localStorage стал secondary cache для instant
// hydrate'а до того как main ответит — main всё равно source of truth.
//
// Why move off localStorage-only:
//   1. DevTools «Clear storage» затирает renderer state — user теряет
//      rebindings. Main-side JSON выживает.
//   2. main applyBindings() стартует ДО mount'а Settings — раньше main
//      не знал об overrides, fresh запуск всегда регистрировал defaults.
//      Теперь main hydrate'ит overrides → first applyBindings уже
//      применяет их.

import { create } from 'zustand';

import type { HotkeyAction, HotkeyBinding } from '@shared/types';

const STORAGE_KEY = 'druz9.hotkeyOverrides';

interface State {
  /** action → accelerator. Unset means "use the default from DesktopConfig". */
  overrides: Partial<Record<HotkeyAction, string>>;
  set: (action: HotkeyAction, accelerator: string) => void;
  clear: (action: HotkeyAction) => void;
  /** Async hydrate from main process. Called on Settings mount; falls
   *  back to localStorage cache (set on previous run) if main IPC fails. */
  hydrate: () => Promise<void>;
  /** Merge defaults with overrides and return the effective binding list. */
  merge: (defaults: HotkeyBinding[]) => HotkeyBinding[];
}

function loadCache(): Partial<Record<HotkeyAction, string>> {
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

function persistCache(v: Partial<Record<HotkeyAction, string>>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    /* private mode — ignored */
  }
}

export const useHotkeyOverridesStore = create<State>((set, get) => ({
  // Start from localStorage cache so first render shows persisted state
  // even before async hydrate() completes against main IPC.
  overrides: loadCache(),
  set: (action, accelerator) => {
    const next = { ...get().overrides, [action]: accelerator };
    persistCache(next);
    set({ overrides: next });
    // Fire-and-forget to main; main writes userData/hotkeys.json + re-
    // registers globalShortcut so the new chord is live immediately.
    // Errors are non-fatal (cache + renderer state already updated).
    void window.druz9?.hotkeys.setOverride(action, accelerator).catch(() => {});
  },
  clear: (action) => {
    const next = { ...get().overrides };
    delete next[action];
    persistCache(next);
    set({ overrides: next });
    // Empty accelerator = clear override main-side.
    void window.druz9?.hotkeys.setOverride(action, '').catch(() => {});
  },
  hydrate: async () => {
    try {
      const fromMain = await window.druz9?.hotkeys.listOverrides();
      if (fromMain && typeof fromMain === 'object') {
        persistCache(fromMain);
        set({ overrides: fromMain });
      }
    } catch {
      /* network/IPC failure — keep cached overrides */
    }
  },
  merge: (defaults) => {
    const { overrides } = get();
    return defaults.map((b) =>
      overrides[b.action] ? { action: b.action, accelerator: overrides[b.action]! } : b,
    );
  },
}));
