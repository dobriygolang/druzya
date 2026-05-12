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

import { eventChannels, type SelectedModelChangedEvent } from '@shared/ipc';

const STORAGE_KEY = 'druz9.selectedModel';

interface State {
  modelId: string;
  setModel: (id: string) => void;
  clear: () => void;
  /** Mount once per window — subscribes to cross-window model-change
   *  broadcasts so a pick in one renderer reflects everywhere. */
  bootstrap: () => () => void;
}

const initial = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) ?? '' : '';

function writeLocal(id: string): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode — ignore */
  }
}

export const useSelectedModelStore = create<State>((set, get) => ({
  modelId: initial,
  setModel: (id) => {
    if (get().modelId === id) return;
    set({ modelId: id });
    writeLocal(id);
    // Fire-and-forget: let main rebroadcast to other windows. The echo
    // will hit our own listener too — bootstrap dedupes via the
    // equality guard above.
    void window.druz9.ui.announceModelChanged(id);
  },
  clear: () => {
    if (!get().modelId) return;
    set({ modelId: '' });
    writeLocal('');
    void window.druz9.ui.announceModelChanged('');
  },
  bootstrap: () =>
    window.druz9.on<SelectedModelChangedEvent>(eventChannels.selectedModelChanged, (ev) => {
      if (get().modelId === ev.modelId) return;
      set({ modelId: ev.modelId });
      writeLocal(ev.modelId);
    }),
}));
