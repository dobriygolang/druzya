// api/whiteboard.ts — Connect-RPC wrapper + WebSocket helper для
// multiplayer-whiteboard'ов (shared Excalidraw через Yjs).
//
// Контракт бэка: backend/services/whiteboard_rooms/ports/ws.go
// Envelope{kind, data}. Kinds:
//   snapshot   — S→C, full Yjs state на join
//   update     — C→S→C, Yjs delta, payload.update: base64
//   awareness  — C↔S↔C, opaque presence frame
//   ping/pong  — keepalive
import { createPromiseClient } from '@connectrpc/connect';
import { WhiteboardRoomsService } from '@generated/pb/druz9/v1/whiteboard_rooms_connect';

import { API_BASE_URL, DEV_BEARER_TOKEN } from './config';
import { useSessionStore } from '../stores/session';
import { transport } from './transport';
import { b64ToBytes, bytesToB64 } from './editor';

// ─── Domain POJOs ───────────────────────────────────────────────────────────

export interface WhiteboardParticipant {
  userId: string;
  username: string;
  joinedAt: Date | null;
}

export interface WhiteboardRoom {
  id: string;
  ownerId: string;
  title: string;
  wsUrl: string;
  expiresAt: Date | null;
  createdAt: Date | null;
  participants: WhiteboardParticipant[];
}

function protoTs(ts: { seconds: bigint; nanos: number } | undefined): Date | null {
  if (!ts) return null;
  return new Date(Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000));
}

function unwrapRoom(r: {
  id: string;
  ownerId: string;
  title: string;
  wsUrl: string;
  expiresAt?: { seconds: bigint; nanos: number };
  createdAt?: { seconds: bigint; nanos: number };
  participants: { userId: string; username: string; joinedAt?: { seconds: bigint; nanos: number } }[];
}): WhiteboardRoom {
  return {
    id: r.id,
    ownerId: r.ownerId,
    title: r.title,
    wsUrl: r.wsUrl,
    expiresAt: protoTs(r.expiresAt),
    createdAt: protoTs(r.createdAt),
    participants: r.participants.map((p) => ({
      userId: p.userId,
      username: p.username,
      joinedAt: protoTs(p.joinedAt),
    })),
  };
}

const client = createPromiseClient(WhiteboardRoomsService, transport);

// ─── RPC wrappers ───────────────────────────────────────────────────────────

export async function createWhiteboardRoom(title: string): Promise<WhiteboardRoom> {
  const resp = await client.createRoom({ title });
  return unwrapRoom(resp as never);
}

export async function getWhiteboardRoom(roomId: string): Promise<WhiteboardRoom> {
  const resp = await client.getRoom({ roomId });
  return unwrapRoom(resp as never);
}

export async function listMyWhiteboardRooms(): Promise<WhiteboardRoom[]> {
  const resp = await client.listMyRooms({});
  return (resp.items ?? []).map((r) => unwrapRoom(r as never));
}

// ─── Visibility (private | shared) — Phase C-7+ ──────────────────────────
//
// Не Connect-RPC а REST: бэкенд экспонирует через
// /api/v1/whiteboard/room/{id}/visibility (см. services/whiteboard_rooms.go).
// Делается так чтобы не тащить proto-regen ради одного boolean-поля.

export type WhiteboardVisibility = 'private' | 'shared';

function visAuthHeaders(): Record<string, string> {
  const token = useSessionStore.getState().accessToken ?? DEV_BEARER_TOKEN;
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (token) h.authorization = `Bearer ${token}`;
  try {
    const did = window.localStorage.getItem('hone:device-id');
    if (did) h['x-device-id'] = did;
  } catch {
    /* ignore */
  }
  return h;
}

export async function getRoomVisibility(roomId: string): Promise<WhiteboardVisibility> {
  const resp = await fetch(`${API_BASE_URL}/api/v1/whiteboard/room/${roomId}/visibility`, {
    headers: visAuthHeaders(),
  });
  if (!resp.ok) throw new Error(`get visibility: ${resp.status}`);
  const j = (await resp.json()) as { visibility: WhiteboardVisibility };
  return j.visibility;
}

export async function setRoomVisibility(
  roomId: string,
  visibility: WhiteboardVisibility,
): Promise<WhiteboardVisibility> {
  const resp = await fetch(`${API_BASE_URL}/api/v1/whiteboard/room/${roomId}/visibility`, {
    method: 'POST',
    headers: visAuthHeaders(),
    body: JSON.stringify({ visibility }),
  });
  if (!resp.ok) throw new Error(`set visibility: ${resp.status}`);
  const j = (await resp.json()) as { visibility: WhiteboardVisibility };
  return j.visibility;
}

export async function deleteWhiteboardRoom(roomId: string): Promise<boolean> {
  const resp = await client.deleteRoom({ roomId });
  return resp.deleted;
}

// ─── WebSocket helper ───────────────────────────────────────────────────────

export interface WhiteboardWsEnvelope {
  kind: string;
  data?: unknown;
}

export type WhiteboardWsStatus = 'connecting' | 'open' | 'reconnecting' | 'failed' | 'closed';

export interface WhiteboardWsOptions {
  roomId: string;
  onEnvelope: (env: WhiteboardWsEnvelope) => void;
  onStatus: (s: WhiteboardWsStatus) => void;
}

export interface WhiteboardWsHandle {
  send: (env: WhiteboardWsEnvelope) => boolean;
  close: () => void;
}

export function connectWhiteboardWs(opts: WhiteboardWsOptions): WhiteboardWsHandle {
  const token = useSessionStore.getState().accessToken ?? DEV_BEARER_TOKEN;
  if (!token) {
    opts.onStatus('failed');
    return { send: () => false, close: () => undefined };
  }
  const base = API_BASE_URL.replace(/^http/, 'ws');
  const url = `${base}/ws/whiteboard/${encodeURIComponent(opts.roomId)}?token=${encodeURIComponent(token)}`;

  let ws: WebSocket | null = null;
  let attempts = 0;
  let timer: number | null = null;
  let closed = false;

  // DEBUG-логи под `hone:debug:ws` localStorage flag. Включается через
  // DevTools console: localStorage.setItem('hone:debug:ws', '1'). Помогает
  // юзеру самому debug'ить realtime sync без bothered'а на backend deploy.
  const dbg = (() => {
    try {
      return window.localStorage.getItem('hone:debug:ws') === '1';
    } catch {
      return false;
    }
  })();
  const log = (...args: unknown[]) => {
    if (dbg) console.log('[wb.ws]', ...args);
  };

  const open = () => {
    opts.onStatus(attempts === 0 ? 'connecting' : 'reconnecting');
    log('open attempt', { url, attempts });
    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      attempts = 0;
      log('OPEN');
      opts.onStatus('open');
    };
    ws.onmessage = (ev) => {
      try {
        const data = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer);
        const env = JSON.parse(data) as WhiteboardWsEnvelope;
        log('RECV', env.kind, { bytes: data.length });
        opts.onEnvelope(env);
      } catch {
        /* malformed frame — backend always sends JSON */
      }
    };
    ws.onclose = (ev) => {
      log('CLOSE', { code: ev.code, reason: ev.reason, attempts });
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
    ws.onerror = (e) => {
      log('ERROR', e);
      /* closure handler reconnects */
    };
  };

  open();

  return {
    send: (env) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        log('SEND drop (not open)', { kind: env.kind, readyState: ws?.readyState });
        return false;
      }
      const payload = JSON.stringify(env);
      log('SEND', env.kind, { bytes: payload.length });
      ws.send(payload);
      return true;
    },
    close: () => {
      closed = true;
      if (timer !== null) window.clearTimeout(timer);
      ws?.close();
    },
  };
}

// Re-export base64 helpers so Whiteboard.tsx doesn't reach into editor.ts.
export { b64ToBytes, bytesToB64 };
