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
import { endFocusSession } from '../api/hone';
import { saveFocusReflection } from '../api/intelligence';
import { API_BASE_URL, DEV_BEARER_TOKEN } from '../api/config';
import { useSessionStore } from '../stores/session';
import { emitConflict } from '../components/ConflictModal';

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

/**
 * Defensive 409 surfacing — если backend для outbox-эндпоинта когда-нибудь
 * начнёт возвращать version_mismatch (e.g. при reflection.submit поверх
 * stale-row'а), мы покажем ConflictModal вместо silent dead-letter в
 * outbox'е. Все текущие outbox kinds — idempotent inserts через
 * ON CONFLICT DO NOTHING + Idempotency-Key, поэтому 409 в норме не
 * прилетит. Но wiring безопасный — body парсится best-effort, на любых
 * проблемах просто проброс'ним original'ьную error без modal'а.
 */
async function maybeSurface409(
  resp: Response,
  kind: string,
  opId: string,
  payload: unknown,
): Promise<void> {
  if (resp.status !== 409) return;
  type Body = { error?: { code?: string; message?: string }; server?: unknown };
  let body: Body | null = null;
  try {
    body = (await resp.clone().json()) as Body;
  } catch {
    return;
  }
  if (body?.error?.code !== 'version_mismatch') return;
  const local = JSON.stringify(payload, null, 2);
  const server = body.server
    ? JSON.stringify(body.server, null, 2)
    : (body.error?.message ?? '');
  emitConflict({
    kind,
    id: opId,
    local: { body: local },
    server: { body: server },
    // Outbox-уровень: мы не знаем как «retry с server version», т.к.
    // payload-shape kind-dependent. Все три handler'а сейчас no-op;
    // юзер ткнёт Accept server (closes modal) → next sync pull заменит
    // local cache актуальными данными. Этого достаточно как fallback —
    // полный retry-merge per-kind можно добавить когда первый реально
    // конфликтующий outbox-kind появится.
    onKeepLocal: async () => {
      /* no-op — backend гарантия идёт через DB-constraint, ре-try не имеет
         смысла без version'а */
    },
    onAcceptServer: async () => {
      /* no-op — next sync pull актуализирует local cache */
    },
    onMergeManually: async () => {
      /* no-op — нет endpoint'а для re-submit с merged body */
    },
  });
}

export function wireOutboxExecutors(): void {
  // ── editor.create_room ────────────────────────────────────────────────
  registerExecutor('editor.create_room', async (payload, opId) => {
    const p = payload as CreateEditorRoomPayload;
    const resp = await fetch(`${API_BASE_URL}/api/v1/editor/room`, {
      method: 'POST',
      headers: { ...authHeaders(), 'idempotency-key': p.clientId },
      body: JSON.stringify({ type: p.type, language: p.language }),
    });
    if (!resp.ok) {
      await maybeSurface409(resp, 'editor_room', opId, payload);
      throw rpcError('editor.create_room', resp.status);
    }
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
  registerExecutor('whiteboard.create_room', async (payload, opId) => {
    const p = payload as CreateEditorRoomPayload;
    const resp = await fetch(`${API_BASE_URL}/api/v1/whiteboard/room`, {
      method: 'POST',
      headers: { ...authHeaders(), 'idempotency-key': p.clientId },
      body: '{}',
    });
    if (!resp.ok) {
      await maybeSurface409(resp, 'whiteboard_room', opId, payload);
      throw rpcError('whiteboard.create_room', resp.status);
    }
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

  // ── Phase 3.5 curation overrides ──────────────────────────────────────
  // Backend OverrideRepo.Insert использует ON CONFLICT DO NOTHING +
  // partial UNIQUE indexes (user, target, url, action) — replay безопасен.
  // Idempotency-Key header опционален — гарантия идёт от DB-constraint'а.

  registerExecutor('resource.add', async (payload, opId) => {
    const resp = await fetch(`${API_BASE_URL}/api/v1/curation/add-resource`, {
      method: 'POST',
      headers: { ...authHeaders(), 'idempotency-key': opId },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      await maybeSurface409(resp, 'resource', opId, payload);
      throw rpcError('resource.add', resp.status);
    }
  });

  registerExecutor('resource.hide', async (payload, opId) => {
    const resp = await fetch(`${API_BASE_URL}/api/v1/curation/hide-resource`, {
      method: 'POST',
      headers: { ...authHeaders(), 'idempotency-key': opId },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      await maybeSurface409(resp, 'resource', opId, payload);
      throw rpcError('resource.hide', resp.status);
    }
  });

  registerExecutor('resource.unhelpful', async (payload, opId) => {
    const resp = await fetch(`${API_BASE_URL}/api/v1/curation/mark-unhelpful`, {
      method: 'POST',
      headers: { ...authHeaders(), 'idempotency-key': opId },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      await maybeSurface409(resp, 'resource', opId, payload);
      throw rpcError('resource.unhelpful', resp.status);
    }
  });

  registerExecutor('resource.replace', async (payload, opId) => {
    const resp = await fetch(`${API_BASE_URL}/api/v1/curation/replace-resource`, {
      method: 'POST',
      headers: { ...authHeaders(), 'idempotency-key': opId },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      await maybeSurface409(resp, 'resource', opId, payload);
      throw rpcError('resource.replace', resp.status);
    }
  });

  // ── Phase 5 5a reflection.submit ──────────────────────────────────────
  // Local fallback grade пишется сразу (наивная эвристика, см
  // ReflectionModal). Server overwrite через UPDATE user_resource_log
  // idempotent — quality_score scalar (overwrite, не accumulate).
  registerExecutor('reflection.submit', async (payload, opId) => {
    const resp = await fetch(`${API_BASE_URL}/api/v1/curation/reflection`, {
      method: 'POST',
      headers: { ...authHeaders(), 'idempotency-key': opId },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      await maybeSurface409(resp, 'reflection', opId, payload);
      throw rpcError('reflection.submit', resp.status);
    }
  });

  // Drain re-attempts via Connect-RPC client (same path как online finish).
  // Если backend не идемпотентен — non-2xx → throw → bumpAttempt → eventually
  // dead после MAX_ATTEMPTS. Reflection text уже donated с первой попытки.
  registerExecutor('focus.end', async (payload) => {
    const p = payload as {
      sessionId: string;
      pomodorosCompleted: number;
      secondsFocused: number;
      reflection?: string;
    };
    await endFocusSession(p);
  });

  // ── Phase 4 external_activity.log ─────────────────────────────────────
  // Backend идемпотентен через source+occurred_at+topic uniqueness.
  registerExecutor('external_activity.log', async (payload, opId) => {
    const resp = await fetch(`${API_BASE_URL}/api/v1/hone/external-activity`, {
      method: 'POST',
      headers: { ...authHeaders(), 'idempotency-key': opId },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      await maybeSurface409(resp, 'external_activity', opId, payload);
      throw rpcError('external_activity.log', resp.status);
    }
  });

  // Backend SaveFocusReflection идемпотентна через UNIQUE(user_id, session_id)
  // ON CONFLICT DO UPDATE — replay safe, latest write wins. Payload — JSON
  // wire-shape с ISO-string timestamps (Date.toJSON), мы их parse'им обратно
  // в Date перед invocation'ом RPC wrapper'а.
  registerExecutor('focus.reflection', async (payload) => {
    const p = payload as {
      sessionId: string;
      focusMode: string;
      durationSeconds: number;
      grade: number;
      notes: string;
      taskPinned?: string;
      startedAt: string;
      endedAt: string;
    };
    await saveFocusReflection({
      sessionId: p.sessionId,
      // Cast to FocusMode is safe — backend rejects invalid mode и помечает
      // op nonRetryable через 4xx.
      focusMode: p.focusMode as Parameters<typeof saveFocusReflection>[0]['focusMode'],
      durationSeconds: p.durationSeconds,
      grade: p.grade,
      notes: p.notes,
      taskPinned: p.taskPinned ?? '',
      startedAt: new Date(p.startedAt),
      endedAt: new Date(p.endedAt),
    });
  });

}
