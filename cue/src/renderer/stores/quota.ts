// Quota store — reflects the latest snapshot pushed by the main process.
// Analyze.Done frames carry the updated quota so we do not need to poll.

import { create } from 'zustand';

import { eventChannels } from '@shared/ipc';
import type { Quota } from '@shared/types';

interface State {
  quota: Quota | null;
  /** Fetch once + subscribe to live broadcasts. Returns unsubscribe. */
  bootstrap: () => Promise<() => void>;
  refresh: () => Promise<void>;
  set: (q: Quota) => void;
}

export const useQuotaStore = create<State>((set, get) => ({
  quota: null,
  bootstrap: async () => {
    await get().refresh();
    // Subscribe to the main-process broadcast so any window (Compact
    // included) reflects the latest quota without polling. Emitted
    // whenever Analyze.Done lands with a fresh snapshot.
    const unsub = window.druz9.on<Quota>(eventChannels.quotaUpdated, (q) => {
      set({ quota: q });
    });
    return unsub;
  },
  refresh: async () => {
    try {
      const q = (await window.druz9.quota.get()) as Quota;
      set({ quota: q });
    } catch {
      /* ignored — Settings/paywall UI handles nulls gracefully */
    }
  },
  set: (q) => set({ quota: q }),
}));
