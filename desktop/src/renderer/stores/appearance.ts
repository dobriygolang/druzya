// Appearance store — expanded chat opacity.
//
// Reads initial value from main on bootstrap, writes back through the
// `appearance:set` IPC channel, and subscribes to `appearance:changed`
// so a change in one window (Settings) propagates live to the expanded
// window (if open) without a reload. Each renderer process has its own
// instance; cross-window sync is by main broadcast only.

import { create } from 'zustand';

import { eventChannels, type AppearancePrefs } from '@shared/ipc';

interface State {
  /** 0..100 slider value. Default 85 — bumped from 100 so first-time
   *  users immediately see the vibrancy blur through the window. */
  expandedOpacity: number;
  loading: boolean;
  /** Pull initial value from main + subscribe to live changes. Returns
   *  the unsubscribe function. */
  bootstrap: () => Promise<() => void>;
  setExpandedOpacity: (value: number) => Promise<void>;
}

export const useAppearanceStore = create<State>((set, get) => ({
  expandedOpacity: 85,
  loading: true,

  bootstrap: async () => {
    try {
      const prefs = await window.druz9.appearance.get();
      set({ expandedOpacity: prefs.expandedOpacity, loading: false });
    } catch {
      set({ loading: false });
    }
    const unsub = window.druz9.on<AppearancePrefs>(
      eventChannels.appearanceChanged,
      (prefs) => set({ expandedOpacity: prefs.expandedOpacity }),
    );
    return unsub;
  },

  setExpandedOpacity: async (value: number) => {
    // Optimistic update — slider feels laggy otherwise. The main-side
    // broadcast that comes back will be a no-op (same value).
    set({ expandedOpacity: value });
    try {
      await window.druz9.appearance.set({ expandedOpacity: value });
    } catch (err) {
      // Rollback on error — revert to whatever the server thinks.
      const prefs = await window.druz9.appearance.get().catch(() => null);
      if (prefs) set({ expandedOpacity: prefs.expandedOpacity });
      // eslint-disable-next-line no-console
      console.error('[appearance] save failed', err);
    }
  },
}));

/**
 * sliderToAlpha — map 0-100 slider to a CSS alpha.
 * 0   → 0.40 (most transparent; still readable text on top)
 * 100 → 1.00 (fully opaque; classic look, no vibrancy visible)
 *
 * Formula chosen so the slider has perceptually linear effect —
 * users report the lower 40% of the range feels "equivalent" if we use
 * a flat 0..1 mapping; compressing to 0.4..1.0 makes every tick visible.
 */
export function sliderToAlpha(slider: number): number {
  const clamped = Math.max(0, Math.min(100, slider));
  return 0.4 + (clamped / 100) * 0.6;
}
