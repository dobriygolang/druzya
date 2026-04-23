// Which AI model the user has picked for their next turn.
//
// The value is a provider-qualified id (e.g. "openai/gpt-4o-mini" or
// "anthropic/claude-sonnet-4-5"). Empty means "use DesktopConfig.defaultModelId"
// — decided at send time inside streaming.ts.
//
// Persisted to localStorage so a user's pick survives app restarts. We
// intentionally do NOT persist to the server — BYOK users especially
// don't want their model choice reflected in a server-side profile.

import { create } from 'zustand';

const STORAGE_KEY = 'druz9.selectedModel';

interface State {
  modelId: string;
  setModel: (id: string) => void;
  clear: () => void;
}

const initial = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) ?? '' : '';

export const useSelectedModelStore = create<State>((set) => ({
  modelId: initial,
  setModel: (id) => {
    set({ modelId: id });
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* private mode — ignore */
    }
  },
  clear: () => {
    set({ modelId: '' });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  },
}));
