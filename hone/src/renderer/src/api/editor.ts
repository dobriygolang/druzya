// api/editor.ts — Connect-RPC wrapper + WebSocket helper для
// collaborative code rooms.
//
// Архитектура (мирроит pairEditor.ts из web'а):
//   1. Connect-RPC endpoints (CreateRoom, GetRoom, CreateInvite, Freeze,
//      Replay) — вызываются как обычные async-функции.
//   2. WebSocket `/ws/editor/{roomId}?token=…` — отдельный canal для ops
//      + cursor + presence. Connect не транскодит WS, так что это
//      raw-WebSocket.
//
// Серверный протокол (см backend/services/editor/ports/ws.go):
//   Envelope{kind, data}. Клиенту важные kind'ы:
//     snapshot        — full document state (на join)
//     op              — Yjs delta {seq, user_id, payload: []byte (base64)}
//     cursor          — {user_id, line, column}
//     participant_joined / participant_left / role_change / freeze / error / pong
//
// Yjs transport: payload — raw Yjs update bytes, base64'нутые в json. На
// стороне клиента собираем Y.Doc и применяем apply/encode через Y.
import { createPromiseClient } from '@connectrpc/connect';
import { EditorService } from '@generated/pb/druz9/v1/editor_connect';
import { Language } from '@generated/pb/druz9/v1/common_pb';

import { API_BASE_URL } from './config';
import { useSessionStore } from '../stores/session';
import { DEV_BEARER_TOKEN } from './config';
import { transport } from './transport';

// ─── Domain POJOs ───────────────────────────────────────────────────────────

export type RoomType = 'practice' | 'interview' | 'pair_mock';
export type EditorRole = 'OWNER' | 'INTERVIEWER' | 'CANDIDATE' | 'OBSERVER' | string;

export interface EditorRoom {
  id: string;
  ownerId: string;
  type: RoomType | string;
  language: Language;
  isFrozen: boolean;
  participants: EditorParticipant[];
  wsUrl: string;
  expiresAt: Date | null;
}

export interface EditorParticipant {
  userId: string;
  username: string;
  role: EditorRole;
}

export interface InviteLink {
  url: string;
  expiresAt: Date | null;
}

const client = createPromiseClient(EditorService, transport);

function protoTs(ts: { seconds: bigint; nanos: number } | undefined): Date | null {
  if (!ts) return null;
  return new Date(Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000));
}

function unwrapRoom(r: {
  id: string;
  ownerId: string;
  type: string;
  language: Language;
  isFrozen: boolean;
  participants: { userId: string; username: string; role: number | string }[];
  wsUrl: string;
  expiresAt?: { seconds: bigint; nanos: number };
}): EditorRoom {
  return {
    id: r.id,
    ownerId: r.ownerId,
    type: r.type,
    language: r.language,
    isFrozen: r.isFrozen,
    participants: r.participants.map((p) => ({
      userId: p.userId,
      username: p.username,
      role: String(p.role) as EditorRole,
    })),
    wsUrl: r.wsUrl,
    expiresAt: protoTs(r.expiresAt),
  };
}

// ─── RPC wrappers ───────────────────────────────────────────────────────────

export async function createRoom(args: {
  type: RoomType;
  taskId?: string;
  language: Language;
}): Promise<EditorRoom> {
  const resp = await client.createRoom({
    type: args.type,
    taskId: args.taskId ?? '',
    language: args.language,
  });
  return unwrapRoom(resp as never);
}

export async function getRoom(roomId: string): Promise<EditorRoom> {
  const resp = await client.getRoom({ roomId });
  return unwrapRoom(resp as never);
}

export async function createInvite(roomId: string): Promise<InviteLink> {
  const resp = await client.createInvite({ roomId });
  return { url: resp.url, expiresAt: protoTs(resp.expiresAt) };
}

export async function freezeRoom(roomId: string, frozen: boolean): Promise<EditorRoom> {
  const resp = await client.freezeRoom({ roomId, frozen });
  return unwrapRoom(resp as never);
}

// ─── RunCode ───────────────────────────────────────────────────────────────

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timeMs: number;
  status: string;
}

/**
 * runCode — executes `code` against the sandboxed Judge0 backend bound to
 * the room. Output is ephemeral (no server-side history). Caller must be
 * a participant of the room. Errors bubble up as ConnectError — the UI
 * maps:
 *   - Code.Unavailable        → «Sandbox not configured»
 *   - Code.ResourceExhausted  → «Slow down — limit reached»
 *   - else                    → generic error
 */
export async function runCode(
  roomId: string,
  code: string,
  language: Language,
): Promise<RunResult> {
  const resp = await client.runCode({ roomId, code, language });
  return {
    stdout: resp.stdout,
    stderr: resp.stderr,
    exitCode: resp.exitCode,
    timeMs: resp.timeMs,
    status: resp.status,
  };
}

// ─── WebSocket helper ───────────────────────────────────────────────────────

export interface EditorWsEnvelope {
  kind: string;
  data?: unknown;
}

export type EditorWsStatus = 'connecting' | 'open' | 'reconnecting' | 'failed' | 'closed';

export interface EditorWsOptions {
  roomId: string;
  /** Получатель получает снапшот + все ops. Вернуть false из onEnvelope,
   *  чтобы прекратить обработку дальше (на freeze, например). */
  onEnvelope: (env: EditorWsEnvelope) => void;
  onStatus: (s: EditorWsStatus) => void;
}

export interface EditorWsHandle {
  send: (env: EditorWsEnvelope) => boolean;
  close: () => void;
}

/**
 * connectEditorWs — упрощённая обёртка над WebSocket с exp backoff
 * переподключением. В отличие от React-hook'а из web'а, даём imperative
 * handle — упрощает интеграцию с Y.Doc observer'ом на стороне EditorPage.
 */
export function connectEditorWs(opts: EditorWsOptions): EditorWsHandle {
  const token = useSessionStore.getState().accessToken ?? DEV_BEARER_TOKEN;
  if (!token) {
    opts.onStatus('failed');
    return { send: () => false, close: () => undefined };
  }
  const base = API_BASE_URL.replace(/^http/, 'ws');
  const url = `${base}/ws/editor/${encodeURIComponent(opts.roomId)}?token=${encodeURIComponent(token)}`;

  let ws: WebSocket | null = null;
  let attempts = 0;
  let timer: number | null = null;
  let closed = false;

  const open = () => {
    opts.onStatus(attempts === 0 ? 'connecting' : 'reconnecting');
    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      attempts = 0;
      opts.onStatus('open');
    };
    ws.onmessage = (ev) => {
      try {
        const data = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer);
        const env = JSON.parse(data) as EditorWsEnvelope;
        opts.onEnvelope(env);
      } catch {
        /* malformed frame — backend always sends JSON */
      }
    };
    ws.onclose = () => {
      if (closed) {
        opts.onStatus('closed');
        return;
      }
      attempts += 1;
      if (attempts > 5) {
        opts.onStatus('failed');
        return;
      }
      const backoff = Math.min(10_000, 500 * 2 ** attempts);
      timer = window.setTimeout(open, backoff);
    };
    ws.onerror = () => {
      /* closure handler reconnects */
    };
  };

  open();

  return {
    send: (env) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(env));
      return true;
    },
    close: () => {
      closed = true;
      if (timer !== null) window.clearTimeout(timer);
      ws?.close();
    },
  };
}

// ─── base64 helpers for Yjs payload ↔ transport ────────────────────────────

export function bytesToB64(buf: Uint8Array): string {
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]!);
  return btoa(s);
}

export function b64ToBytes(b64: string): Uint8Array {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export { Language };
