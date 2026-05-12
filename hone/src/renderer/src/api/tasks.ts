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
  // Phase J / H3 (P1, 2026-05-12): user-asserted kind flag. When true,
  // background re-categorisers (BulkAutoCategorise, coach_listener) skip
  // this card. Set via updateTaskKind(taskId, kind, /*manualOverride*/ true).
  manualKindOverride?: boolean;
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

// ─── Phase J / H3 (P1, 2026-05-12) — manual override + bulk categorise ──

// updateTaskKind — manual chip-picker path. Flips manual_kind_override=true
// on the server so background re-categorisers skip this card going forward.
export async function updateTaskKind(
  taskId: string,
  kind: TaskKind,
  manualOverride: boolean = true,
): Promise<TaskCard> {
  // Proto field is `manual_override`; backend defaults to true when the
  // bool is false, so we always set it explicitly here.
  const body = JSON.stringify({ kind: kindToProtoEnum(kind), manualOverride });
  const resp = await fetch(`${API_BASE_URL}/api/v1/hone/tasks/${taskId}/kind`, {
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': 'application/json' },
    body,
  });
  if (!resp.ok) throw new Error(`updateTaskKind: ${resp.status}`);
  return normalizeTask((await resp.json()) as TaskCard);
}

// BulkAutoCategoriseEvent — one packet of the streaming response.
export interface BulkAutoCategoriseEvent {
  taskId: string;
  kind: TaskKind;
  reasoning: string;
  confidence: number;
  processed: number;
  total: number;
  done: boolean;
}

// bulkAutoCategorise — kicks off the server-streaming RPC. Yields each
// event to `onEvent`; promise resolves when stream closes (done=true or
// network end). Pass empty taskIds to let server auto-pick all eligible
// open tasks (manual_kind_override=false). The backend transport is
// Connect server-stream; we read the body as NDJSON (Connect's
// `application/connect+json` codec emits one envelope per task) and
// fall through to fetch's ReadableStream API.
//
// Implementation note: full Connect-Go client is shipped via codegen
// в other surfaces (web). Здесь Hone uses plain fetch + ReadableStream
// (smaller bundle, no extra dep) — we encode the JSON request and read
// `\n`-separated frames produced by vanguard transcoder.
export async function bulkAutoCategorise(
  taskIds: string[],
  onEvent: (e: BulkAutoCategoriseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  // The Connect HTTP/1.1 entry point for streaming RPCs lives под
  // /druz9.v1.HoneService/BulkAutoCategorise. We POST a JSON envelope
  // (Connect's «protocol: connect» JSON codec) и parse the streamed
  // EnvelopedMessage frames.
  const headers: Record<string, string> = {
    ...authHeaders(),
    'content-type': 'application/connect+json',
    'connect-protocol-version': '1',
  };
  const body = JSON.stringify({ taskIds });
  // Frame encoding для request: 5-byte prefix (flag byte 0 + uint32-BE length)
  // followed by JSON body. Reuse a small TextEncoder.
  const enc = new TextEncoder();
  const jsonBytes = enc.encode(body);
  const frame = new Uint8Array(5 + jsonBytes.byteLength);
  // flag byte 0 = uncompressed
  const view = new DataView(frame.buffer);
  view.setUint32(1, jsonBytes.byteLength, false);
  frame.set(jsonBytes, 5);

  const resp = await fetch(`${API_BASE_URL}/druz9.v1.HoneService/BulkAutoCategorise`, {
    method: 'POST',
    headers,
    body: frame,
    signal,
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`bulkAutoCategorise: ${resp.status}`);
  }

  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  // Frame-streaming buffer. Use a plain number[] for accumulation so
  // TypeScript's Uint8Array generic (ArrayBuffer vs ArrayBufferLike)
  // doesn't trip on assignment from stream reads.
  let buf: number[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    for (let i = 0; i < value.length; i++) buf.push(value[i]);
    // Process every complete frame in buffer.
    while (buf.length >= 5) {
      const flags = buf[0];
      // uint32 big-endian
      const len = (buf[1] << 24) | (buf[2] << 16) | (buf[3] << 8) | buf[4];
      if (buf.length < 5 + len) break; // frame incomplete
      const payloadBytes = Uint8Array.from(buf.slice(5, 5 + len));
      buf = buf.slice(5 + len);
      const isEnd = (flags & 0x02) !== 0;
      if (isEnd) {
        // End-of-stream metadata; we ignore (could carry trailing errors).
        continue;
      }
      try {
        const obj = JSON.parse(dec.decode(payloadBytes)) as {
          taskId?: string;
          kind?: string;
          reasoning?: string;
          confidence?: number;
          processed?: number;
          total?: number;
          done?: boolean;
        };
        onEvent({
          taskId: obj.taskId ?? '',
          kind: normEnum('TASK_KIND_', obj.kind) as TaskKind,
          reasoning: obj.reasoning ?? '',
          confidence: typeof obj.confidence === 'number' ? obj.confidence : 0,
          processed: typeof obj.processed === 'number' ? obj.processed : 0,
          total: typeof obj.total === 'number' ? obj.total : 0,
          done: obj.done === true,
        });
      } catch {
        // Malformed frame — ignore, continue draining.
      }
    }
  }
}

// kindToProtoEnum — frontend uses lowercase, proto-bin expects ALL_CAPS
// enum names в JSON-encoded Connect messages. Vanguard transcoder может
// принять оба, но мы шлём канонический ALL_CAPS чтобы избежать «invalid
// enum value» 400 от строгих codecs.
function kindToProtoEnum(k: TaskKind): string {
  return `TASK_KIND_${k.toUpperCase()}`;
}

// ─── Cursor SSE ─────────────────────────────────────────────────────────

export type CursorEventKind =
  | 'cursor.move'
  | 'card.focus'
  | 'card.thinking'
  | 'card.comment'
  | 'card.move'
  // Phase J / H3 — emitted by CreateTask / BulkAutoCategorise когда LLM
  // присваивает kind. Frontend показывает CategorizeToast.
  | 'card.categorise';

export interface CursorEvent {
  kind: CursorEventKind;
  taskId?: string;
  toColumn?: TaskStatus;
  fromColumn?: TaskStatus;
  body?: string;
  occurredAt: string;
  // Phase J / H3 — card.categorise payload extension.
  detectedKind?: TaskKind;
  confidence?: number;
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
    ['cursor.move', 'card.focus', 'card.thinking', 'card.comment', 'card.move', 'card.categorise'] as const
  ).forEach((kind) => es.addEventListener(kind, handler as EventListener));
  return () => es.close();
}
