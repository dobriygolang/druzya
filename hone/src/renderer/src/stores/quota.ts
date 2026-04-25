// Quota store — central source-of-truth для tier + usage в Hone.
//
// Бэкенд: GET /api/v1/subscription/quota → JSON со shape:
//   { tier: 'free'|'seeker'|'ascended', policy: {synced_notes, ...}, usage: {...} }
//
// Refresh strategy:
//   - На app start (init)
//   - После любого create/delete для resource'а который трогает quota
//     (создал note → refresh, удалил → refresh) — caller дёргает `refresh()`
//   - При 402 ResourceExhausted от backend'а — refresh + show upgrade prompt
//
// Tier — single canonical name из Seeker / Ascended / Free.
import { create } from 'zustand';

import { API_BASE_URL, DEV_BEARER_TOKEN } from '../api/config';
import { useSessionStore } from './session';

export type Tier = 'free' | 'seeker' | 'ascended';

export interface QuotaPolicy {
  synced_notes: number;
  active_shared_boards: number;
  active_shared_rooms: number;
  shared_ttl_seconds: number;
  ai_monthly: number;
}

export interface QuotaUsage {
  synced_notes: number;
  active_shared_boards: number;
  active_shared_rooms: number;
  ai_this_month: number;
}

interface QuotaState {
  tier: Tier;
  policy: QuotaPolicy;
  usage: QuotaUsage;
  loaded: boolean;
  /** Last upgrade-prompt error message to show в modal'ке. null = hidden. */
  upgradePromptMessage: string | null;
  refresh: () => Promise<void>;
  showUpgradePrompt: (msg: string) => void;
  dismissUpgradePrompt: () => void;
}

const DEFAULT_POLICY: QuotaPolicy = {
  synced_notes: 10,
  active_shared_boards: 1,
  active_shared_rooms: 1,
  shared_ttl_seconds: 24 * 3600,
  ai_monthly: -1, // Unlimited на Free
};

const DEFAULT_USAGE: QuotaUsage = {
  synced_notes: 0,
  active_shared_boards: 0,
  active_shared_rooms: 0,
  ai_this_month: 0,
};

export const useQuotaStore = create<QuotaState>((set) => ({
  tier: 'free',
  policy: DEFAULT_POLICY,
  usage: DEFAULT_USAGE,
  loaded: false,
  upgradePromptMessage: null,
  refresh: async () => {
    try {
      const token = useSessionStore.getState().accessToken ?? DEV_BEARER_TOKEN;
      if (!token) {
        // Не залогинен — оставляем defaults.
        return;
      }
      const resp = await fetch(`${API_BASE_URL}/api/v1/subscription/quota`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        // Backend пока без subscription module / dynamic_config row missing —
        // оставляем defaults. Не блокируем юзера.
        set({ loaded: true });
        return;
      }
      const j = (await resp.json()) as {
        tier?: string;
        policy?: Partial<QuotaPolicy>;
        usage?: Partial<QuotaUsage>;
      };
      set({
        tier: normalizeTier(j.tier),
        policy: { ...DEFAULT_POLICY, ...(j.policy ?? {}) },
        usage: { ...DEFAULT_USAGE, ...(j.usage ?? {}) },
        loaded: true,
      });
    } catch {
      // Network blip — keep defaults; повторная попытка на следующем refresh().
      set({ loaded: true });
    }
  },
  showUpgradePrompt: (msg: string) => set({ upgradePromptMessage: msg }),
  dismissUpgradePrompt: () => set({ upgradePromptMessage: null }),
}));

function normalizeTier(t: unknown): Tier {
  if (t === 'seeker' || t === 'ascended') return t;
  return 'free';
}

// Helper: forms human-readable upgrade message based on what was hit.
export function quotaExceededMessage(resource: 'note' | 'board' | 'room'): string {
  switch (resource) {
    case 'note':
      return "You've reached your free-tier limit on synced notes (10). Upgrade to Seeker for 100, or Ascended for unlimited cross-device sync.";
    case 'board':
      return "Free tier allows 1 shared board with a 24-hour share window. Upgrade to Seeker for 5 always-on shared boards, or Ascended for unlimited.";
    case 'room':
      return "Free tier allows 1 shared code-room with a 24-hour share window. Upgrade to Seeker for 5 always-on rooms.";
  }
}

// Helper: detect 402-style quota error from a fetch response.
// Connect-RPC 402 mapping: ResourceExhausted (gRPC code 8) → HTTP 429
// in connect-go's mapping table; standalone REST handlers возвращают
// 402 Payment Required directly.
export function isQuotaExceeded(resp: Response): boolean {
  return resp.status === 402 || resp.status === 429;
}
