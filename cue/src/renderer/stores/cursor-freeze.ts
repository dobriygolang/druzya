// Mirror of the main-process cursor-freeze state. Compact / Tray / any
// indicator subscribes here rather than polling main. Main pushes the
// current state on startup and on every toggle.

import { create } from 'zustand';

import { eventChannels, type CursorFreezeState } from '@shared/ipc';

interface State {
  state: CursorFreezeState;
  refresh: () => Promise<void>;
  bootstrap: () => () => void;
}

export const useCursorFreezeStore = create<State>((set) => ({
  state: 'thawed',
  refresh: async () => {
    try {
      const s = await window.druz9.cursor.state();
      set({ state: s });
    } catch {
      /* unavailable — UI shows the hint */
    }
  },
  bootstrap: () => {
    void (async () => {
      const s = await window.druz9.cursor.state().catch(() => 'unavailable' as CursorFreezeState);
      set({ state: s });
    })();
    return window.druz9.on<CursorFreezeState>(eventChannels.cursorFreezeChanged, (next) => {
      set({ state: next });
    });
  },
}));
