// Desktop-side wrapper for GET /api/v1/personas. Mirrors sessions.ts
// (same auth-header pattern, same JSON parsing). Fetched once on app
// boot + cached in main; renderer reads from main via IPC so the
// 6-window multi-renderer setup doesn't each re-fetch.
//
// Falls back to an empty list on network error. Compact's persona
// picker handles empty-list by rendering just the default baseline
// (persona with id='default' — always seeded in migration 00051).

import type { RuntimeConfig } from '../config/bootstrap';
import { loadSession } from '../auth/keychain';

export interface PersonaDTO {
  id: string;
  label: string;
  hint: string;
  icon_emoji: string;
  brand_gradient: string;
  suggested_task?: string;
  system_prompt: string;
  sort_order: number;
}

export interface PersonasClient {
  list: () => Promise<PersonaDTO[]>;
}

export function createPersonasClient(cfg: RuntimeConfig): PersonasClient {
  const url = `${cfg.apiBaseURL.replace(/\/+$/, '')}/api/v1/personas`;

  return {
    list: async () => {
      const session = await loadSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session) headers.Authorization = `Bearer ${session.accessToken}`;
      const resp = await fetch(url, { method: 'GET', headers });
      if (!resp.ok) {
        // Log but don't throw — picker falls back to default-only.
        // This mirrors the DesktopConfig error-swallow pattern: the
        // app should never break because personas are unreachable.
        // eslint-disable-next-line no-console
        console.warn('[personas] GET failed', resp.status, await resp.text().catch(() => ''));
        return [];
      }
      const parsed = (await resp.json()) as { items?: PersonaDTO[] };
      return parsed.items ?? [];
    },
  };
}
