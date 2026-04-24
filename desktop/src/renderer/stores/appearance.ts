// Appearance store — expanded chat opacity.
//
// Reads initial value from main on bootstrap, writes back through the
// `appearance:set` IPC channel, and subscribes to `appearance:changed`
// so a change in one window (Settings) propagates live to the expanded
// window (if open) without a reload. Each renderer process has its own
// instance; cross-window sync is by main broadcast only.

import { create } from 'zustand';

import { eventChannels, type AppearancePrefs } from '@shared/ipc';

/**
 * Write the current slider value to a single :root CSS variable so every
 * window (compact, expanded, settings, history, picker) can read it via
 * `var(--d9-window-alpha)`. One source of truth — when the slider moves
 * in Settings, all open renderers update because each one runs this
 * subscription and re-writes its own :root. No React re-renders needed
 * for the visual change itself.
 */
function writeAlphaVar(slider: number) {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty(
    '--d9-window-alpha',
    String(sliderToAlpha(slider)),
  );
}

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

export const useAppearanceStore = create<State>((set) => ({
  expandedOpacity: 85,
  loading: true,

  bootstrap: async () => {
    try {
      const prefs = await window.druz9.appearance.get();
      set({ expandedOpacity: prefs.expandedOpacity, loading: false });
      writeAlphaVar(prefs.expandedOpacity);
    } catch {
      set({ loading: false });
      writeAlphaVar(85);
    }
    const unsub = window.druz9.on<AppearancePrefs>(
      eventChannels.appearanceChanged,
      (prefs) => {
        set({ expandedOpacity: prefs.expandedOpacity });
        writeAlphaVar(prefs.expandedOpacity);
      },
    );
    return unsub;
  },

  setExpandedOpacity: async (value: number) => {
    // Optimistic update — slider feels laggy otherwise. The main-side
    // broadcast that comes back will be a no-op (same value).
    set({ expandedOpacity: value });
    writeAlphaVar(value);
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
 * 0   → 0.10 (near-fully transparent; vibrancy blur dominates)
 * 100 → 1.00 (fully opaque; classic look, no vibrancy visible)
 *
 * Earlier version capped at 0.40 on the low end to ensure text
 * readability on top. But the chat's message bubbles, code blocks and
 * sidebar cards all paint their own opaque backgrounds, so dropping
 * the root to 0.40 produced only a subtle edge-glow effect — users
 * reported "не работает" at slider=0. Dropping to 0.10 lets the
 * vibrancy blur dominate the empty regions around content while the
 * nested opaque cards keep text readable. If readability problems
 * surface on light desktop backgrounds, bump the floor back up.
 */
export function sliderToAlpha(slider: number): number {
  const clamped = Math.max(0, Math.min(100, slider));
  return 0.1 + (clamped / 100) * 0.9;
}
