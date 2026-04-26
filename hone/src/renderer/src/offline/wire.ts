// wire.ts — connects outbox executors к реальным API clients.
//
// Вынесено в отдельный файл чтобы outbox.ts не импортировал api/* (избежать
// circular dep'ов при tree-shake'е). Здесь имеем full доступ к api/editor,
// api/whiteboard и т.д.
//
// Использование: вызывается ОДИН раз из App.tsx bootstrap'а ДО
// `installOutboxAutoDrain()`. Order matters — executors должны быть
// зарегистрированы прежде чем drain попытается их использовать.
import { registerExecutor } from './outbox';
import { setEditorRoomVisibility } from '../api/editor';
import { setRoomVisibility as setWhiteboardRoomVisibility } from '../api/whiteboard';
import { API_BASE_URL, DEV_BEARER_TOKEN } from '../api/config';
import { useSessionStore } from '../stores/session';

interface CreateEditorRoomPayload {
  // Client-generated UUID. Backend должен accept'ить с idempotency-key,
  // т.е. POST с тем же id → no-op возвращающий existing row. Сейчас
  // backend этого не делает — TODO в backend'е добавить idempotency.
  // Без этого re-drain после flaky network может создать дубликаты.
  clientId: string;
  type: string;
  language: number;
}

interface SetVisibilityPayload {
  roomId: string;
  visibility: 'private' | 'shared';
}

interface DeleteRoomPayload {
  roomId: string;
}

function authHeaders(): Record<string, string> {
  const token = useSessionStore.getState().accessToken ?? DEV_BEARER_TOKEN;
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

/**
 * Маркируем error как nonRetryable когда сервер вернул 4xx (кроме 408/429).
 * 5xx + network — retryable.
 */
function rpcError(message: string, status: number): Error {
  const nonRetryable = status >= 400 && status < 500 && status !== 408 && status !== 429;
  return Object.assign(new Error(`${message} (HTTP ${status})`), {
    cause: { nonRetryable },
  });
}

export function wireOutboxExecutors(): void {
  // ── editor.create_room ────────────────────────────────────────────────
  registerExecutor('editor.create_room', async (payload) => {
    const p = payload as CreateEditorRoomPayload;
    const resp = await fetch(`${API_BASE_URL}/api/v1/editor/room`, {
      method: 'POST',
      headers: { ...authHeaders(), 'idempotency-key': p.clientId },
      body: JSON.stringify({ type: p.type, language: p.language }),
    });
    if (!resp.ok) throw rpcError('editor.create_room', resp.status);
    // Парсим server-assigned ID из response (нужен post-drain hook'у для
    // y-indexeddb migration: hone:editor:<clientId> → hone:editor:<serverId>).
    try {
      const j = (await resp.json()) as { id?: string };
      return { serverId: j.id };
    } catch {
      return {};
    }
  });

  // ── editor.set_visibility ─────────────────────────────────────────────
  registerExecutor('editor.set_visibility', async (payload) => {
    const p = payload as SetVisibilityPayload;
    try {
      await setEditorRoomVisibility(p.roomId, p.visibility);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // setEditorRoomVisibility throws на non-2xx — extract HTTP code из msg
      // ("set visibility: 403"). Грубовато но достаточно для retry-классификации.
      const m = /(\d{3})/.exec(msg);
      const status = m ? parseInt(m[1]!, 10) : 0;
      throw rpcError('editor.set_visibility', status);
    }
  });

  // ── editor.delete_room ────────────────────────────────────────────────
  registerExecutor('editor.delete_room', async (payload) => {
    const p = payload as DeleteRoomPayload;
    const resp = await fetch(
      `${API_BASE_URL}/api/v1/editor/room/${encodeURIComponent(p.roomId)}`,
      { method: 'DELETE', headers: authHeaders() },
    );
    if (!resp.ok && resp.status !== 404) {
      // 404 = already deleted, treat as success.
      throw rpcError('editor.delete_room', resp.status);
    }
  });

  // ── whiteboard.create_room ────────────────────────────────────────────
  registerExecutor('whiteboard.create_room', async (payload) => {
    const p = payload as CreateEditorRoomPayload;
    const resp = await fetch(`${API_BASE_URL}/api/v1/whiteboard/room`, {
      method: 'POST',
      headers: { ...authHeaders(), 'idempotency-key': p.clientId },
      body: '{}',
    });
    if (!resp.ok) throw rpcError('whiteboard.create_room', resp.status);
    try {
      const j = (await resp.json()) as { id?: string };
      return { serverId: j.id };
    } catch {
      return {};
    }
  });

  // ── whiteboard.set_visibility ─────────────────────────────────────────
  registerExecutor('whiteboard.set_visibility', async (payload) => {
    const p = payload as SetVisibilityPayload;
    try {
      await setWhiteboardRoomVisibility(p.roomId, p.visibility);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const m = /(\d{3})/.exec(msg);
      const status = m ? parseInt(m[1]!, 10) : 0;
      throw rpcError('whiteboard.set_visibility', status);
    }
  });

  // ── whiteboard.delete_room ────────────────────────────────────────────
  registerExecutor('whiteboard.delete_room', async (payload) => {
    const p = payload as DeleteRoomPayload;
    const resp = await fetch(
      `${API_BASE_URL}/api/v1/whiteboard/room/${encodeURIComponent(p.roomId)}`,
      { method: 'DELETE', headers: authHeaders() },
    );
    if (!resp.ok && resp.status !== 404) {
      throw rpcError('whiteboard.delete_room', resp.status);
    }
  });
}
