// Persona store — active expert-mode preset.
//
// Refactor (session 2026-04-24): catalogue moved from a hardcoded
// `@shared/personas` module to a server-driven fetch through
// `window.druz9.personas.list()`. The main process caches the /api/v1/
// personas response on boot, so the renderer call returns instantly in
// the common case. Empty list → fall back to a single inlined default
// baseline persona so the picker never shows "nothing".
//
// Active-persona id is persisted to localStorage so the user's last
// pick survives a restart. If the persisted id no longer exists on
// the server (admin deleted that persona), we revert to default.

import { create } from 'zustand';

import { eventChannels, type ActivePersonaChangedEvent, type Persona } from '@shared/ipc';

const STORAGE_KEY = 'druz9.persona.active-id';

// Single zero-persona stub used while the server catalogue is still
// loading or has hard-failed. Never presented as a real choice — it's
// the bare minimum shape so type-consumers (pickActive, compact brand
// mark) don't null-check everywhere. Real personas come from
// GET /api/v1/personas (migration 00052 seeds them on the backend).
// When the fetch fails, the picker surfaces an error state (see
// PickerScreen / PersonaDropdown), it does NOT show this stub as a
// selectable option.
const PlaceholderPersona: Persona = {
  id: 'default',
  label: 'Обычный',
  hint: '',
  icon_emoji: '💬',
  brand_gradient:
    'linear-gradient(135deg, oklch(0.72 0.23 300) 0%, oklch(0.80 0.15 210) 100%)',
  suggested_task: '',
  system_prompt: '',
  sort_order: 0,
};

function pickActive(list: Persona[], persistedId: string | null): Persona {
  if (persistedId) {
    const found = list.find((p) => p.id === persistedId);
    if (found) return found;
  }
  const def = list.find((p) => p.id === 'default');
  if (def) return def;
  if (list.length > 0) return list[0];
  return PlaceholderPersona;
}

function readPersistedId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

interface State {
  active: Persona;
  list: Persona[];
  /** Whether the initial fetch has completed (success or error). */
  loaded: boolean;
  /** Null until first load attempt. When the server endpoint responds
   *  with an error (network / 404 / 401) we keep the last successful
   *  list (may be empty) and surface this message to the UI so the
   *  picker can render a proper error state instead of silently
   *  degrading. `null` when the last fetch succeeded. */
  error: string | null;
  /** Pull catalogue from main + resolve active persona. Idempotent;
   *  safe to call from multiple window mount effects. */
  bootstrap: () => Promise<void>;
  setActive: (id: string) => void;
  reset: () => void;
}

export const usePersonaStore = create<State>((set, get) => ({
  // Zero-state until bootstrap resolves. An empty list is the correct
  // initial shape — the server owns the catalogue, we just show it.
  active: PlaceholderPersona,
  list: [],
  loaded: false,
  error: null,

  bootstrap: async () => {
    // Subscribe unconditionally (even on repeat mounts) so every window
    // tracks cross-process persona picks. The loaded-guard only skips
    // the fetch, not the listener.
    if (!get().loaded) {
      try {
        const fetched = await window.druz9.personas.list();
        const active = pickActive(fetched, readPersistedId());
        set({ list: fetched, active, loaded: true, error: null });
      } catch (err) {
        set({
          loaded: true,
          error: (err as Error)?.message || 'personas fetch failed',
        });
      }
    }
    // Cross-window sync: Picker writes setActive → announces →
    // main rebroadcasts → every window's store updates here. Dedup via
    // current-id equality so our own echo is a no-op.
    window.druz9.on<ActivePersonaChangedEvent>(eventChannels.activePersonaChanged, (ev) => {
      const cur = get().active;
      if (cur.id === ev.personaId) return;
      const next = pickActive(get().list, ev.personaId);
      set({ active: next });
      try {
        localStorage.setItem(STORAGE_KEY, next.id);
      } catch {
        /* storage unavailable — in-memory is enough for this session */
      }
    });
  },

  setActive: (id: string) => {
    const next = pickActive(get().list, id);
    set({ active: next });
    try {
      localStorage.setItem(STORAGE_KEY, next.id);
    } catch {
      /* storage full / disabled — in-memory pick still works for the session */
    }
    // Tell main to rebroadcast so other windows mirror the pick.
    // Fire-and-forget — the echo will hit our listener but the id guard
    // above short-circuits.
    void window.druz9.ui.announcePersonaChanged(next.id);
  },

  reset: () => {
    const def = get().list.find((p) => p.id === 'default') ?? PlaceholderPersona;
    set({ active: def });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  },
}));

/**
 * applyPersonaPrefix — prepends the persona's system-prompt block to
 * the raw user text. Empty prefix ⇒ returns text as-is (default
 * persona path). Same contract as before the server-catalogue
 * refactor — callers at CompactScreen.submitText / capture don't care
 * where the prefix string originated.
 */
export function applyPersonaPrefix(prefix: string, text: string): string {
  const t = text.trim();
  const p = prefix.trim();
  if (!p) return t;
  return `${p}\n\n${t}`;
}
