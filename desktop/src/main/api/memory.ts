// Desktop-side wrapper for compact Cue memory sync.
// Sends derived conversation memory only; raw screenshots/audio stay local.

import { getValidSession } from '../auth/refresh';
import type { RuntimeConfig } from '../config/bootstrap';
import type { ConversationMemory } from '@shared/types';

export interface MemoryClient {
  sync: (conversationId: string, memory: ConversationMemory) => Promise<void>;
}

export function createMemoryClient(cfg: RuntimeConfig): MemoryClient {
  const url = (p: string) => `${cfg.apiBaseURL.replace(/\/+$/, '')}${p}`;

  const authHeaders = async (): Promise<Record<string, string>> => {
    const s = await getValidSession({ apiBaseURL: cfg.apiBaseURL });
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (s) h.Authorization = `Bearer ${s.accessToken}`;
    return h;
  };

  return {
    sync: async (conversationId, memory) => {
      const resp = await fetch(
        url(`/api/v1/copilot/memory/${encodeURIComponent(conversationId)}`),
        {
          method: 'PUT',
          headers: await authHeaders(),
          body: JSON.stringify(memory),
        },
      );
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`PUT /copilot/memory/${conversationId}: ${resp.status} ${text.slice(0, 200)}`);
      }
    },
  };
}
