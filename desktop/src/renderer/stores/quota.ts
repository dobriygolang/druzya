// Quota store — reflects the latest snapshot pushed by the main process.
// Analyze.Done frames carry the updated quota so we do not need to poll.

import { create } from 'zustand';

import type { Quota } from '@shared/types';

interface State {
  quota: Quota | null;
  refresh: () => Promise<void>;
  set: (q: Quota) => void;
}

export const useQuotaStore = create<State>((set) => ({
  quota: null,
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
