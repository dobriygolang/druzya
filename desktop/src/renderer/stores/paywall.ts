// Paywall store — one-shot flag controlling whether the modal is
// visible in the current window. Two open paths:
//   1. conversation.ts observes 'rate_limited' stream errors and calls
//      open({ reason: '...' }).
//   2. Settings → Upgrade button calls open({ reason: '…' }).
//
// We keep the reason text in the store so the header adapts to context
// ("Лимит исчерпан" vs generic "Расширь возможности").

import { create } from 'zustand';

interface State {
  open: boolean;
  reason?: string;
  show: (opts?: { reason?: string }) => void;
  hide: () => void;
}

export const usePaywallStore = create<State>((set) => ({
  open: false,
  reason: undefined,
  show: (opts) => set({ open: true, reason: opts?.reason }),
  hide: () => set({ open: false, reason: undefined }),
}));
