// Persona store — which expert-mode preset is currently active in the
// compact window. Persisted to localStorage so the user's last pick
// survives a restart.
//
// Cross-window sync: unlike selected-model (which broadcasts through
// main), persona lives in compact only today — expanded doesn't show
// the picker. If we later want the badge in expanded, add a broadcast
// mirror in main/ipc/handlers.ts (same pattern as selectedModelChanged).

import { create } from 'zustand';

import { DefaultPersona, findPersona, Personas, type Persona } from '@shared/personas';

const STORAGE_KEY = 'druz9.persona.active-id';

function readPersisted(): Persona {
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    if (!id) return DefaultPersona;
    return findPersona(id);
  } catch {
    return DefaultPersona;
  }
}

interface State {
  active: Persona;
  list: Persona[];
  setActive: (id: string) => void;
  reset: () => void;
}

export const usePersonaStore = create<State>((set) => ({
  active: readPersisted(),
  list: Personas,
  setActive: (id: string) => {
    const next = findPersona(id);
    set({ active: next });
    try {
      localStorage.setItem(STORAGE_KEY, next.id);
    } catch {
      /* storage full / disabled — in-memory pick still works for the session */
    }
  },
  reset: () => {
    set({ active: DefaultPersona });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  },
}));

/**
 * applyPersonaPrefix — prepends the persona's system-prompt block to the
 * raw user text. Empty prefix ⇒ returns text as-is (default persona path).
 *
 * The separator is a blank line + the user's original message, mirroring
 * how LLM chat APIs treat multi-turn content. Models reliably treat the
 * "Инструкция: …" block as an operator-grade instruction.
 */
export function applyPersonaPrefix(prefix: string, text: string): string {
  const t = text.trim();
  const p = prefix.trim();
  if (!p) return t;
  return `${p}\n\n${t}`;
}
