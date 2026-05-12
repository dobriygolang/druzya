// Quota store — reflects the latest snapshot pushed by the main process.
// Analyze.Done frames carry the updated quota so we do not need to poll.

import { create } from 'zustand';

import { eventChannels } from '@shared/ipc';
import type { Quota } from '@shared/types';

/**
 * UpgradeContext — payload для unified Pro-upgrade modal (X2 P0).
 * Pre-filled context: «вы тыкнули X, Pro даёт Y». Wiring через
 * showUpgradeModal({...}); UpgradeModal.tsx reads upgradeModalContext.
 *
 * Distinct from existing PaywallModal (server-driven Boosty copy on
 * rate-limit auto-pop) — this one is per-feature trigger pulled from
 * UI gates.
 */
export interface UpgradeContext {
  feature: string;
  /** Human-readable feature name, e.g. "premium personas". */
  label: string;
  /** What Pro unlocks, full-sentence. */
  benefit: string;
  /** Optional per-feature stat. Modal renders only if present. */
  liftStat?: string;
  /** If false, hide BYOK alternative CTA. Defaults to true. */
  byokAvailable?: boolean;
}

interface State {
  quota: Quota | null;
  /** Active upgrade-modal context (X2). null = modal hidden. */
  upgradeModalContext: UpgradeContext | null;
  /** Fetch once + subscribe to live broadcasts. Returns unsubscribe. */
  bootstrap: () => Promise<() => void>;
  refresh: () => Promise<void>;
  set: (q: Quota) => void;
  showUpgradeModal: (ctx: UpgradeContext) => void;
  dismissUpgradeModal: () => void;
}

export const useQuotaStore = create<State>((set, get) => ({
  quota: null,
  upgradeModalContext: null,
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
  showUpgradeModal: (ctx) => set({ upgradeModalContext: ctx }),
  dismissUpgradeModal: () => set({ upgradeModalContext: null }),
}));
