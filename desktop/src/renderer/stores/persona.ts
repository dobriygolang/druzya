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

import type { Persona } from '@shared/ipc';

const STORAGE_KEY = 'druz9.persona.active-id';

// Inline default-baseline persona. Used as the absolute fallback when
// the server catalogue is empty (fresh install before migration 00051
// has been applied to the environment, or network failure). The
// server's seeded "default" row has the same id + empty prefix, so
// once the fetch succeeds this gets transparently replaced.
const InlineDefaultPersona: Persona = {
  id: 'default',
  label: 'Обычный',
  hint: 'Без специализации — универсальный режим',
  icon_emoji: '💬',
  brand_gradient:
    'linear-gradient(135deg, var(--d-accent) 0%, var(--d-accent-2) 100%)',
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
  return InlineDefaultPersona;
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
  /** Pull catalogue from main + resolve active persona. Idempotent;
   *  safe to call from multiple window mount effects. */
  bootstrap: () => Promise<void>;
  setActive: (id: string) => void;
  reset: () => void;
}

export const usePersonaStore = create<State>((set, get) => ({
  active: InlineDefaultPersona,
  list: [InlineDefaultPersona],
  loaded: false,

  bootstrap: async () => {
    if (get().loaded) return;
    try {
      const fetched = await window.druz9.personas.list();
      const list = fetched.length > 0 ? fetched : [InlineDefaultPersona];
      const active = pickActive(list, readPersistedId());
      set({ list, active, loaded: true });
    } catch {
      // Keep inline default; mark loaded so re-mounts don't re-fire.
      set({ loaded: true });
    }
  },

  setActive: (id: string) => {
    const next = pickActive(get().list, id);
    set({ active: next });
    try {
      localStorage.setItem(STORAGE_KEY, next.id);
    } catch {
      /* storage full / disabled — in-memory pick still works for the session */
    }
  },

  reset: () => {
    const def = get().list.find((p) => p.id === 'default') ?? InlineDefaultPersona;
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
