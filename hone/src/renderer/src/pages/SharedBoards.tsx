// SharedBoards — multiplayer Excalidraw whiteboards (bible §9 Phase 6.5.4).
//
// Архитектура: каждая room имеет Y.Doc на клиенте, sync'ится через
// /ws/whiteboard/{id} (opaque relay). На клиенте Y.Map<'scene'> хранит
// сериализованный elements-массив; локальный change → Y.Map.set →
// автоматически распространяется через WS. Remote update → observe →
// excalidrawAPI.updateScene.
//
// MVP-trade-off: scene хранится как один JSON-string в Y.Map. Это
// last-writer-wins per change, не fine-grained CRDT. Достаточно для
// типичного use-case (разные люди рисуют разные области canvas'а).
// Per-element CRDT-merge (Y.Array<Y.Map>) — TODO Phase 7 если будут
// жалобы на конфликты.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConnectError, Code } from '@connectrpc/connect';
import * as Y from 'yjs';
import { Excalidraw } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';

import { WEB_BASE_URL } from '../api/config';
import {
  createWhiteboardRoom,
  getWhiteboardRoom,
  listMyWhiteboardRooms,
  deleteWhiteboardRoom,
  connectWhiteboardWs,
  b64ToBytes,
  bytesToB64,
  type WhiteboardRoom,
  type WhiteboardWsStatus,
} from '../api/whiteboard';

type Page = { kind: 'list' } | { kind: 'room'; roomId: string };

export function SharedBoardsPage() {
  const [page, setPage] = useState<Page>({ kind: 'list' });
  if (page.kind === 'list') {
    return <RoomsList onOpenRoom={(id) => setPage({ kind: 'room', roomId: id })} />;
  }
  return <RoomView roomId={page.roomId} onBack={() => setPage({ kind: 'list' })} />;
}

// ─── Rooms list ────────────────────────────────────────────────────────────

function RoomsList({ onOpenRoom }: { onOpenRoom: (id: string) => void }) {
  const [rooms, setRooms] = useState<WhiteboardRoom[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [joinId, setJoinId] = useState('');

  const reload = useCallback(async () => {
    try {
      const list = await listMyWhiteboardRooms();
      setRooms(list);
      setError(null);
    } catch (err: unknown) {
      const ce = ConnectError.from(err);
      setError(ce.rawMessage || ce.message);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const r = await createWhiteboardRoom('Untitled board');
      onOpenRoom(r.id);
    } catch (err: unknown) {
      const ce = ConnectError.from(err);
      setError(ce.rawMessage || ce.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteWhiteboardRoom(id);
      await reload();
    } catch (err: unknown) {
      const ce = ConnectError.from(err);
      setError(ce.rawMessage || ce.message);
    }
  };

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ width: 640, maxWidth: '90%' }}>
        <div
          className="mono"
          style={{ fontSize: 10, letterSpacing: '.24em', color: 'var(--ink-40)' }}
        >
          SHARED BOARDS
        </div>
        <h1
          style={{
            margin: '14px 0 8px',
            fontSize: 40,
            fontWeight: 400,
            letterSpacing: '-0.025em',
            lineHeight: 1.05,
          }}
        >
          Draw together. Live.
        </h1>
        <p style={{ margin: '0 0 32px', fontSize: 14, color: 'var(--ink-60)', lineHeight: 1.6 }}>
          Multiplayer Excalidraw. Один URL — поделись и оба видите canvas в real-time.
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 26 }}>
          <button
            onClick={() => void handleCreate()}
            disabled={creating}
            className="focus-ring"
            style={{
              padding: '9px 20px',
              borderRadius: 999,
              background: '#fff',
              color: '#000',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            {creating ? 'Creating…' : '+ New board'}
          </button>
          <button
            onClick={() => void reload()}
            className="focus-ring mono"
            style={{
              padding: '9px 14px',
              fontSize: 11,
              letterSpacing: '.14em',
              color: 'var(--ink-60)',
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'transparent',
            }}
          >
            REFRESH
          </button>
        </div>

        <div
          className="mono"
          style={{ fontSize: 10, letterSpacing: '.18em', color: 'var(--ink-40)', marginBottom: 10 }}
        >
          JOIN BY ID
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const id = extractRoomId(joinId);
            if (id) onOpenRoom(id);
          }}
          style={{ display: 'flex', gap: 8, marginBottom: 28 }}
        >
          <input
            value={joinId}
            onChange={(e) => setJoinId(e.target.value)}
            placeholder="room-id или полный URL…"
            style={{
              flex: 1,
              padding: '9px 12px',
              borderRadius: 8,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--ink)',
              fontSize: 13,
            }}
          />
          <button
            type="submit"
            className="focus-ring"
            style={{
              padding: '9px 18px',
              borderRadius: 8,
              background: 'rgba(255,255,255,0.06)',
              color: 'var(--ink)',
              fontSize: 13,
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            Join
          </button>
        </form>

        {rooms === null ? (
          <p className="mono" style={{ fontSize: 11, color: 'var(--ink-40)' }}>
            LOADING…
          </p>
        ) : rooms.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--ink-40)' }}>
            Пока ни одной board'ы. Создай новую сверху.
          </p>
        ) : (
          <div>
            <div
              className="mono"
              style={{ fontSize: 10, letterSpacing: '.18em', color: 'var(--ink-40)', marginBottom: 10 }}
            >
              MY BOARDS
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {rooms.map((r) => (
                <li
                  key={r.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '11px 14px',
                    marginBottom: 6,
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 8,
                  }}
                >
                  <button
                    onClick={() => onOpenRoom(r.id)}
                    style={{
                      flex: 1,
                      textAlign: 'left',
                      background: 'transparent',
                      color: 'var(--ink)',
                      fontSize: 13,
                    }}
                  >
                    {r.title || 'Untitled board'}
                    <span
                      className="mono"
                      style={{ marginLeft: 10, fontSize: 10, color: 'var(--ink-40)' }}
                    >
                      {r.participants.length} participant
                      {r.participants.length === 1 ? '' : 's'}
                    </span>
                  </button>
                  <button
                    onClick={() => void handleDelete(r.id)}
                    className="mono"
                    title="Delete"
                    style={{
                      marginLeft: 8,
                      padding: '4px 10px',
                      fontSize: 10,
                      letterSpacing: '.14em',
                      color: 'var(--ink-40)',
                      background: 'transparent',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 6,
                    }}
                  >
                    DELETE
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <p className="mono" style={{ marginTop: 16, fontSize: 11, color: 'var(--ink-40)' }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Single room view ──────────────────────────────────────────────────────

function RoomView({ roomId, onBack }: { roomId: string; onBack: () => void }) {
  const parsedId = useMemo(() => extractRoomId(roomId), [roomId]);
  const [room, setRoom] = useState<WhiteboardRoom | null>(null);
  const [loadError, setLoadError] = useState<{ code: Code | null; msg: string } | null>(null);
  const [wsStatus, setWsStatus] = useState<WhiteboardWsStatus>('connecting');
  const [copied, setCopied] = useState(false);

  const ydocRef = useRef<Y.Doc | null>(null);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const sendRef = useRef<((u: Uint8Array) => void) | null>(null);
  const wsCloseRef = useRef<(() => void) | null>(null);
  const applyingRemoteRef = useRef(false);
  const debounceRef = useRef<number | null>(null);

  // Load room meta.
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    getWhiteboardRoom(parsedId)
      .then((r) => {
        if (cancelled) return;
        setRoom(r);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const ce = ConnectError.from(err);
        setLoadError({ code: ce.code, msg: ce.rawMessage || ce.message });
      });
    return () => {
      cancelled = true;
    };
  }, [parsedId]);

  // Yjs + WebSocket lifecycle.
  useEffect(() => {
    if (!room) return;
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;
    const yScene = ydoc.getMap<string>('scene');

    // Y.Doc → WS: каждый local update сериализуется как binary diff и
    // отправляется на сервер. origin === 'remote' блокирует echo.
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote') return;
      sendRef.current?.(update);
    };
    ydoc.on('update', onUpdate);

    // WS → Y.Doc.
    const handle = connectWhiteboardWs({
      roomId: room.id,
      onStatus: setWsStatus,
      onEnvelope: (env) => {
        if (env.kind === 'snapshot' || env.kind === 'update') {
          const data = env.data as { update?: string };
          if (data?.update) {
            Y.applyUpdate(ydoc, b64ToBytes(data.update), 'remote');
          }
        }
      },
    });
    wsCloseRef.current = handle.close;
    sendRef.current = (update: Uint8Array) => {
      handle.send({ kind: 'update', data: { update: bytesToB64(update) } });
    };

    // Y.Map → Excalidraw scene. Every set() → observe → updateScene.
    const onSceneChange = () => {
      const json = yScene.get('elements');
      if (!json || !apiRef.current) return;
      try {
        const elements = JSON.parse(json);
        applyingRemoteRef.current = true;
        apiRef.current.updateScene({ elements });
      } catch {
        /* ignore parse errors — peer pushed garbage */
      } finally {
        // Yield so onChange sees the flag set during the same tick when
        // Excalidraw fires its own follow-up onChange.
        queueMicrotask(() => {
          applyingRemoteRef.current = false;
        });
      }
    };
    yScene.observe(onSceneChange);

    return () => {
      yScene.unobserve(onSceneChange);
      ydoc.off('update', onUpdate);
      ydoc.destroy();
      ydocRef.current = null;
      wsCloseRef.current?.();
      wsCloseRef.current = null;
      sendRef.current = null;
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, [room]);

  // Excalidraw → Y.Map. Debounced 80ms — purely cosmetic; Yjs already
  // batches in-memory. Avoids fan-out spam during a 60-Hz drag.
  const handleExcalidrawChange = useCallback(
    (elements: readonly unknown[]) => {
      if (applyingRemoteRef.current) return;
      const ydoc = ydocRef.current;
      if (!ydoc) return;
      const yScene = ydoc.getMap<string>('scene');
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        const json = JSON.stringify(elements);
        if (yScene.get('elements') === json) return;
        yScene.set('elements', json);
      }, 80);
    },
    [],
  );

  const shareURL = `${WEB_BASE_URL}/whiteboard/${parsedId}`;
  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(shareURL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };
  const handleOpenWeb = async () => {
    const bridge = typeof window !== 'undefined' ? window.hone : undefined;
    if (bridge) await bridge.shell.openExternal(shareURL);
    else window.open(shareURL, '_blank');
  };

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        paddingTop: 80,
        paddingBottom: 32,
        display: 'grid',
        gridTemplateRows: 'auto 1fr',
      }}
    >
      <header
        style={{
          padding: '10px 24px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <button
          onClick={onBack}
          className="focus-ring mono"
          style={{
            padding: '5px 10px',
            fontSize: 10,
            letterSpacing: '.12em',
            color: 'var(--ink-40)',
            borderRadius: 6,
          }}
        >
          ← BACK
        </button>
        <div className="mono" style={{ fontSize: 11, color: 'var(--ink-60)' }}>
          {loadError
            ? `error: ${loadErrorLabel(loadError)}`
            : room
              ? `${room.title || 'Untitled board'} · ${room.participants.length} participant${room.participants.length === 1 ? '' : 's'}`
              : 'loading…'}
        </div>
        {room && (
          <span
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '.18em',
              color: wsStatus === 'open' ? 'var(--ink)' : 'var(--red)',
            }}
          >
            · {wsStatus.toUpperCase()}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {room && (
          <>
            <button
              onClick={() => void handleShare()}
              className="focus-ring mono"
              style={{
                padding: '6px 12px',
                fontSize: 10,
                letterSpacing: '.14em',
                color: copied ? 'var(--ink)' : 'var(--ink-60)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 999,
                background: 'transparent',
              }}
            >
              {copied ? '✓ COPIED' : 'COPY URL'}
            </button>
            <button
              onClick={() => void handleOpenWeb()}
              className="focus-ring"
              style={{
                padding: '6px 14px',
                fontSize: 12,
                borderRadius: 999,
                background: '#fff',
                color: '#000',
                fontWeight: 500,
              }}
            >
              Open on web ↗
            </button>
          </>
        )}
      </header>

      <div style={{ position: 'relative', overflow: 'hidden', background: '#0a0a0a' }}>
        {room && !loadError && (
          <Excalidraw
            theme="dark"
            excalidrawAPI={(api) => {
              apiRef.current = api;
            }}
            onChange={handleExcalidrawChange}
            UIOptions={{
              canvasActions: { saveToActiveFile: false, loadScene: false, export: false },
            }}
          />
        )}
      </div>

      {loadError && (
        <div
          className="mono"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            color: 'var(--ink-40)',
          }}
        >
          {loadErrorLabel(loadError)}
        </div>
      )}
    </div>
  );
}

function extractRoomId(input: string): string {
  const trimmed = input.trim();
  const m = trimmed.match(/\/whiteboard\/([a-f0-9-]{8,})/i);
  if (m) return m[1]!;
  return trimmed;
}

function loadErrorLabel(err: { code: Code | null; msg: string }): string {
  switch (err.code) {
    case Code.NotFound:
      return 'Board not found.';
    case Code.PermissionDenied:
      return 'You are not a participant.';
    case Code.Unauthenticated:
      return 'Sign in to join the board.';
    case Code.FailedPrecondition:
      return 'Board expired.';
    default:
      return err.msg;
  }
}
