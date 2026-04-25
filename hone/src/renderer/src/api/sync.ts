// sync.ts — Phase C-4 replication client.
//
// Two operations:
//   - pullChanges(cursor)  — incremental fetch since cursor (or full
//                            bootstrap if cursor=null).
//   - pushOperations(ops)  — batch upsert/delete (used in C-6 для Yjs).
//
// Cursor хранится в localStorage `hone:sync:cursor`. Это RFC3339Nano
// timestamp от server'а. Frontend никогда сам его не модифицирует —
// только пишет туда то что сервер вернул.
//
// Bootstrap flow (App.tsx → этот модуль):
//   1. Initial pull без cursor — server отдаёт полный snapshot.
//   2. Persist cursor.
//   3. Polling каждые 30s: pull(cursor). Получаем дельты, обновляем
//      локальный cache (см. localCache.ts), пишем new cursor.
//   4. На window-focus / online — внеплановый pull сразу (юзер вернулся
//      из background — хочет видеть актуальное).

import { API_BASE_URL, DEV_BEARER_TOKEN } from './config';
import { useSessionStore } from '../stores/session';

const CURSOR_KEY = 'hone:sync:cursor';

export type SyncTable =
  | 'hone_notes'
  | 'hone_whiteboards'
  | 'hone_focus_sessions'
  | 'hone_plans'
  | 'coach_episodes';

export interface SyncDeleted {
  table: SyncTable;
  rowId: string;
}

export interface PullResponse {
  cursor: string;
  changed: Partial<Record<SyncTable, Array<Record<string, unknown>>>>;
  deleted: SyncDeleted[];
  truncated: boolean;
  fullSnapshot: boolean;
}

export interface PushOperation {
  op: 'upsert' | 'delete';
  table: SyncTable;
  row?: Record<string, unknown>;
  rowId?: string;
}

export interface PushResponse {
  applied: number;
  skipped: number;
  conflicts: Array<{ index: number; reason: string; message: string }>;
}

function authHeaders(): Record<string, string> {
  const token = useSessionStore.getState().accessToken ?? DEV_BEARER_TOKEN;
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (token) h.authorization = `Bearer ${token}`;
  try {
    const did = window.localStorage.getItem('hone:device-id');
    if (did) h['x-device-id'] = did;
  } catch {
    /* private mode */
  }
  return h;
}

export function getStoredCursor(): string | null {
  try {
    return window.localStorage.getItem(CURSOR_KEY);
  } catch {
    return null;
  }
}

export function setStoredCursor(cursor: string): void {
  try {
    window.localStorage.setItem(CURSOR_KEY, cursor);
  } catch {
    /* ignore quota */
  }
}

export function clearStoredCursor(): void {
  try {
    window.localStorage.removeItem(CURSOR_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * pullChanges — fetch deltas since cursor (or full snapshot if cursor=null).
 *
 * If `truncated: true` приходит — клиент обязан повторить pull (новый
 * cursor = response.cursor). Иначе пропустим строки за пределами лимита.
 * Этот retry caller'у проще делать через `pullUntilCaughtUp`.
 */
export async function pullChanges(opts: { cursor?: string | null; tables?: SyncTable[] } = {}): Promise<PullResponse> {
  const body = JSON.stringify({
    cursor: opts.cursor ?? null,
    tables: opts.tables ?? null,
  });
  const resp = await fetch(`${API_BASE_URL}/api/v1/sync/pull`, {
    method: 'POST',
    headers: authHeaders(),
    body,
  });
  if (resp.status === 401) {
    // Может быть device_revoked — transport interceptor для bare-fetch
    // у нас нет, обрабатываем здесь явно.
    const j = await resp.json().catch(() => null);
    if (j?.error?.code === 'device_revoked') {
      // Trigger session clear — это вернёт юзера на LoginScreen.
      void useSessionStore.getState().clear();
    }
    throw new Error(`pull: 401 ${j?.error?.code ?? ''}`);
  }
  if (!resp.ok) {
    throw new Error(`pull: ${resp.status}`);
  }
  return (await resp.json()) as PullResponse;
}

/**
 * pullUntilCaughtUp — repeatedly pulls until truncated=false. Returns the
 * aggregated changes + final cursor. Defensive cap of 20 iterations
 * (10k rows in 500-page chunks) — если упёрлись, что-то очень не так
 * со временем на сервере, бросаем.
 */
export async function pullUntilCaughtUp(initialCursor?: string | null): Promise<PullResponse> {
  let cursor = initialCursor ?? null;
  let total: PullResponse | null = null;
  for (let i = 0; i < 20; i++) {
    const page = await pullChanges({ cursor });
    if (!total) {
      total = page;
    } else {
      // Merge: концатенация changed[]; deleted concat; cursor = last.
      for (const [k, v] of Object.entries(page.changed)) {
        const key = k as SyncTable;
        const existing = total.changed[key] ?? [];
        total.changed[key] = [...existing, ...(v ?? [])];
      }
      total.deleted = [...total.deleted, ...page.deleted];
      total.cursor = page.cursor;
      total.truncated = page.truncated;
    }
    if (!page.truncated) return total;
    cursor = page.cursor;
  }
  throw new Error('pullUntilCaughtUp: 20 iterations exceeded — server cursor not advancing');
}

export async function pushOperations(operations: PushOperation[]): Promise<PushResponse> {
  const resp = await fetch(`${API_BASE_URL}/api/v1/sync/push`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ operations }),
  });
  if (!resp.ok) throw new Error(`push: ${resp.status}`);
  return (await resp.json()) as PushResponse;
}
