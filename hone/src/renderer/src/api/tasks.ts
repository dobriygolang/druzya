// tasks.ts — REST client for the Hone TaskBoard.
//
// Endpoints (all auth via the existing Bearer-token middleware):
//   GET    /api/v1/hone/tasks                — list user's tasks
//   POST   /api/v1/hone/tasks                — create custom task
//   POST   /api/v1/hone/tasks/{id}/status    — move column
//   DELETE /api/v1/hone/tasks/{id}           — delete
//   GET    /api/v1/hone/tasks/{id}/comments  — comments thread
//   POST   /api/v1/hone/tasks/{id}/comments  — add user comment
//   GET    /api/v1/hone/tasks/events/stream  — SSE cursor stream
import { API_BASE_URL, DEV_BEARER_TOKEN } from './config';
import { useSessionStore } from '../stores/session';

function authHeaders(): Record<string, string> {
  const token = useSessionStore.getState().accessToken ?? DEV_BEARER_TOKEN;
  return token ? { authorization: `Bearer ${token}` } : {};
}

export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done' | 'dismissed';
export type TaskKind = 'algo' | 'sysdesign' | 'quiz' | 'reflection' | 'reading' | 'custom';
export type TaskSource = 'ai' | 'user';

export interface TaskCard {
  id: string;
  status: TaskStatus;
  kind: TaskKind;
  source: TaskSource;
  title: string;
  briefMd: string;
  skillKey?: string;
  deepLink?: string;
  recommendedReading?: string[];
  priority: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface TaskComment {
  id: string;
  authorKind: 'ai' | 'user';
  bodyMd: string;
  createdAt: string;
}

// normalizeTask — proto-enum constants («TASK_STATUS_TODO») → domain
// strings («todo»). Backend сейчас возвращает proto enum names в JSON
// (vanguard transcoder + connect protobuf default); frontend ожидает
// snake_case. Без этого TaskBoard column filter не находит cards.
function normEnum(prefix: string, v: string | undefined): string {
  if (!v) return ''
  const s = String(v).toUpperCase()
  if (s.startsWith(prefix)) return s.slice(prefix.length).toLowerCase()
  return s.toLowerCase()
}

function normalizeTask(t: TaskCard): TaskCard {
  return {
    ...t,
    status: normEnum('TASK_STATUS_', t.status as string) as TaskStatus,
    kind: normEnum('TASK_KIND_', t.kind as string) as TaskKind,
    source: normEnum('TASK_SOURCE_', t.source as string) as TaskCard['source'],
  }
}

export async function listTasks(): Promise<TaskCard[]> {
  const resp = await fetch(`${API_BASE_URL}/api/v1/hone/tasks`, {
    headers: authHeaders(),
  });
  if (!resp.ok) throw new Error(`listTasks: ${resp.status}`);
  const j = (await resp.json()) as { tasks: TaskCard[] };
  return (j.tasks ?? []).map(normalizeTask);
}

export async function createTask(input: {
  kind: TaskKind;
  title: string;
  briefMd?: string;
  skillKey?: string;
  deepLink?: string;
}): Promise<TaskCard> {
  const resp = await fetch(`${API_BASE_URL}/api/v1/hone/tasks`, {
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!resp.ok) throw new Error(`createTask: ${resp.status}`);
  return normalizeTask((await resp.json()) as TaskCard);
}

export async function moveTaskStatus(taskId: string, status: TaskStatus): Promise<TaskCard> {
  const resp = await fetch(`${API_BASE_URL}/api/v1/hone/tasks/${taskId}/status`, {
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!resp.ok) throw new Error(`moveTaskStatus: ${resp.status}`);
  return normalizeTask((await resp.json()) as TaskCard);
}

export async function deleteTask(taskId: string): Promise<void> {
  const resp = await fetch(`${API_BASE_URL}/api/v1/hone/tasks/${taskId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!resp.ok) throw new Error(`deleteTask: ${resp.status}`);
}

export async function listTaskComments(taskId: string): Promise<TaskComment[]> {
  const resp = await fetch(`${API_BASE_URL}/api/v1/hone/tasks/${taskId}/comments`, {
    headers: authHeaders(),
  });
  if (!resp.ok) throw new Error(`listTaskComments: ${resp.status}`);
  const j = (await resp.json()) as { comments: TaskComment[] };
  return j.comments ?? [];
}

export async function addTaskComment(taskId: string, bodyMd: string): Promise<TaskComment> {
  const resp = await fetch(`${API_BASE_URL}/api/v1/hone/tasks/${taskId}/comments`, {
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ bodyMd }),
  });
  if (!resp.ok) throw new Error(`addTaskComment: ${resp.status}`);
  return (await resp.json()) as TaskComment;
}

// ─── Cursor SSE ─────────────────────────────────────────────────────────

export type CursorEventKind =
  | 'cursor.move'
  | 'card.focus'
  | 'card.thinking'
  | 'card.comment'
  | 'card.move';

export interface CursorEvent {
  kind: CursorEventKind;
  taskId?: string;
  toColumn?: TaskStatus;
  fromColumn?: TaskStatus;
  body?: string;
  occurredAt: string;
}

// subscribeCursorEvents opens an SSE stream and yields each parsed event
// to the caller. The browser's EventSource doesn't accept custom headers,
// so we pass the bearer token via query string and the gateway accepts
// `?token=` in addition to the Authorization header for SSE routes.
//
// Returns a cleanup function that closes the stream.
export function subscribeCursorEvents(
  token: string,
  onEvent: (e: CursorEvent) => void,
): () => void {
  const url = `${API_BASE_URL}/api/v1/hone/tasks/events/stream?token=${encodeURIComponent(token)}`;
  const es = new EventSource(url);
  const handler = (ev: MessageEvent): void => {
    try {
      const parsed = JSON.parse(ev.data) as CursorEvent;
      onEvent(parsed);
    } catch {
      /* malformed line — ignore */
    }
  };
  // We use named events on the server (event: cursor.move\n) — but most
  // clients work fine listening for default `message`. Subscribe to all.
  es.addEventListener('message', handler as EventListener);
  (
    ['cursor.move', 'card.focus', 'card.thinking', 'card.comment', 'card.move'] as const
  ).forEach((kind) => es.addEventListener(kind, handler as EventListener));
  return () => es.close();
}
