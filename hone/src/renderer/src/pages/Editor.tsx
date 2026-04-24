// Editor — collaborative code rooms.
//
// Два стейта:
//   - Rooms hub: список моих комнат + «New room» форма (language, type).
//   - Активная комната: CodeMirror 6 с Y.Doc bound'нутым к WebSocket'у.
//
// Yjs transport: backend шлёт/принимает `op` с raw Yjs updates (base64).
// Клиент поддерживает Y.Doc → Y.Text привязан к CodeMirror через
// y-codemirror.next (yCollab). Каждое изменение текста → updateV2 event
// → отправляем на сервер. Входящий op → applyUpdateV2.
//
// Share button: копирует `https://druz9.online/editor/<id>` в clipboard
// + открывает в браузере через shell.openExternal. Web использует тот же
// backend state — room консистентен.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConnectError, Code } from '@connectrpc/connect';
import * as Y from 'yjs';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { indentOnInput } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { go } from '@codemirror/lang-go';
import { oneDark } from '@codemirror/theme-one-dark';
import { yCollab } from 'y-codemirror.next';

import { WEB_BASE_URL } from '../api/config';
import {
  createRoom,
  getRoom,
  createInvite,
  connectEditorWs,
  b64ToBytes,
  bytesToB64,
  Language,
  type EditorRoom,
  type EditorWsStatus,
  type RoomType,
} from '../api/editor';

type Page = { kind: 'list' } | { kind: 'room'; roomId: string };

function langExt(lang: Language) {
  switch (lang) {
    case Language.GO:
      return [go()];
    case Language.PYTHON:
      return [python()];
    case Language.JAVASCRIPT:
    case Language.TYPESCRIPT:
      return [javascript({ typescript: lang === Language.TYPESCRIPT, jsx: false })];
    default:
      return [];
  }
}

function languageLabel(lang: Language): string {
  switch (lang) {
    case Language.GO:
      return 'Go';
    case Language.PYTHON:
      return 'Python';
    case Language.JAVASCRIPT:
      return 'JavaScript';
    case Language.TYPESCRIPT:
      return 'TypeScript';
    default:
      return '—';
  }
}

export function EditorPage() {
  const [page, setPage] = useState<Page>({ kind: 'list' });

  if (page.kind === 'list') {
    return <RoomsList onOpenRoom={(id) => setPage({ kind: 'room', roomId: id })} />;
  }
  return <RoomView roomId={page.roomId} onBack={() => setPage({ kind: 'list' })} />;
}

// ─── Rooms list (landing) ──────────────────────────────────────────────────

function RoomsList({ onOpenRoom }: { onOpenRoom: (id: string) => void }) {
  const [joinId, setJoinId] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (type: RoomType, language: Language) => {
    setCreating(true);
    setError(null);
    try {
      const r = await createRoom({ type, language });
      onOpenRoom(r.id);
    } catch (err: unknown) {
      const ce = ConnectError.from(err);
      setError(ce.rawMessage || ce.message);
    } finally {
      setCreating(false);
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
      <div style={{ width: 560, maxWidth: '90%' }}>
        <div
          className="mono"
          style={{ fontSize: 10, letterSpacing: '.24em', color: 'var(--ink-40)' }}
        >
          CODE ROOMS
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
          Write together. Quietly.
        </h1>
        <p style={{ margin: '0 0 32px', fontSize: 14, color: 'var(--ink-60)', lineHeight: 1.6 }}>
          Real-time collab. Ссылку можно открыть в браузере — состояние
          консистентно.
        </p>

        <div
          className="mono"
          style={{ fontSize: 10, letterSpacing: '.18em', color: 'var(--ink-40)', marginBottom: 10 }}
        >
          NEW ROOM
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 26 }}>
          {[
            { lang: Language.GO, label: 'Go', type: 'practice' as RoomType },
            { lang: Language.PYTHON, label: 'Python', type: 'practice' as RoomType },
            { lang: Language.JAVASCRIPT, label: 'JavaScript', type: 'practice' as RoomType },
            { lang: Language.TYPESCRIPT, label: 'TypeScript', type: 'practice' as RoomType },
          ].map(({ lang, label, type }) => (
            <button
              key={label}
              disabled={creating}
              onClick={() => void handleCreate(type, lang)}
              className="focus-ring"
              style={{
                padding: '8px 16px',
                borderRadius: 999,
                background: 'rgba(255,255,255,0.05)',
                color: 'var(--ink)',
                border: '1px solid rgba(255,255,255,0.1)',
                fontSize: 13,
              }}
            >
              + {label}
            </button>
          ))}
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
            const id = joinId.trim();
            if (id) onOpenRoom(id);
          }}
          style={{ display: 'flex', gap: 8 }}
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
              background: '#fff',
              color: '#000',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            Join
          </button>
        </form>

        {error && (
          <p
            className="mono"
            style={{ marginTop: 16, fontSize: 11, color: 'var(--ink-40)' }}
          >
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
  const [room, setRoom] = useState<EditorRoom | null>(null);
  const [loadError, setLoadError] = useState<{ code: Code | null; msg: string } | null>(null);
  const [wsStatus, setWsStatus] = useState<EditorWsStatus>('connecting');
  const [copied, setCopied] = useState(false);

  const ydocRef = useRef<Y.Doc | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const sendRef = useRef<((payload: Uint8Array) => void) | null>(null);
  const wsCloseRef = useRef<(() => void) | null>(null);

  // Load room meta.
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    getRoom(parsedId)
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

  // Init Y.Doc + WebSocket + CodeMirror.
  useEffect(() => {
    if (!room) return;
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;
    const ytext = ydoc.getText('code');

    // Local change → push update to server.
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      // Не ретранслируем apply'и от сервера (origin === 'remote').
      if (origin === 'remote') return;
      sendRef.current?.(update);
    };
    ydoc.on('update', onUpdate);

    // WebSocket.
    const handle = connectEditorWs({
      roomId: room.id,
      onStatus: setWsStatus,
      onEnvelope: (env) => {
        if (env.kind === 'snapshot' || env.kind === 'op') {
          const data = env.data as { payload?: string };
          if (data?.payload) {
            const bytes = b64ToBytes(data.payload);
            Y.applyUpdate(ydoc, bytes, 'remote');
          }
        }
      },
    });
    wsCloseRef.current = handle.close;
    sendRef.current = (update: Uint8Array) => {
      handle.send({ kind: 'op', data: { payload: bytesToB64(update) } });
    };

    // CodeMirror setup.
    const langCompartment = new Compartment();
    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        lineNumbers(),
        history(),
        indentOnInput(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        oneDark,
        langCompartment.of(langExt(room.language)),
        yCollab(ytext, null),
        EditorView.theme({
          '&': { height: '100%', fontSize: '13px' },
          '.cm-scroller': { fontFamily: 'var(--font-mono)' },
        }),
      ],
    });
    const mount = document.getElementById('hone-cm-mount');
    if (!mount) return;
    const view = new EditorView({ state, parent: mount });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
      ydoc.off('update', onUpdate);
      ydoc.destroy();
      ydocRef.current = null;
      wsCloseRef.current?.();
      wsCloseRef.current = null;
      sendRef.current = null;
    };
  }, [room]);

  const shareURL = `${WEB_BASE_URL}/editor/${parsedId}`;

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(shareURL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore — clipboard permission может быть denied */
    }
  };

  const handleOpenWeb = async () => {
    const bridge = typeof window !== 'undefined' ? window.hone : undefined;
    if (bridge) await bridge.shell.openExternal(shareURL);
    else window.open(shareURL, '_blank');
  };

  const handleInvite = async () => {
    if (!room) return;
    try {
      const invite = await createInvite(room.id);
      await navigator.clipboard.writeText(invite.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        paddingTop: 80,
        paddingBottom: 120,
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
              ? `${languageLabel(room.language)} · ${room.participants.length} participant${room.participants.length === 1 ? '' : 's'}`
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
            <Participants list={room.participants} />
            <button
              onClick={() => void handleInvite()}
              className="focus-ring mono"
              style={{
                padding: '6px 12px',
                fontSize: 10,
                letterSpacing: '.14em',
                color: 'var(--ink-60)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 999,
                background: 'transparent',
              }}
            >
              INVITE
            </button>
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

      <div id="hone-cm-mount" style={{ overflow: 'auto', background: '#0a0a0a' }} />

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

function Participants({ list }: { list: EditorRoom['participants'] }) {
  if (list.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {list.slice(0, 4).map((p) => (
        <span
          key={p.userId}
          title={`${p.username} · ${p.role}`}
          className="mono"
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(255,255,255,0.08)',
            color: 'var(--ink)',
            fontSize: 10,
            letterSpacing: '.04em',
            border: '1px solid rgba(255,255,255,0.1)',
          }}
        >
          {(p.username || '?').slice(0, 2).toUpperCase()}
        </span>
      ))}
      {list.length > 4 && (
        <span
          className="mono"
          style={{ fontSize: 10, color: 'var(--ink-40)', alignSelf: 'center' }}
        >
          +{list.length - 4}
        </span>
      )}
    </div>
  );
}

function extractRoomId(input: string): string {
  // Accept either raw UUID or full URL — полезно если юзер вставил ссылку.
  const trimmed = input.trim();
  const m = trimmed.match(/\/editor\/([a-f0-9-]{8,})/i);
  if (m) return m[1]!;
  return trimmed;
}

function loadErrorLabel(err: { code: Code | null; msg: string }): string {
  switch (err.code) {
    case Code.NotFound:
      return 'Room not found.';
    case Code.PermissionDenied:
      return 'You are not a participant.';
    case Code.Unauthenticated:
      return 'Sign in to join the room.';
    default:
      return err.msg;
  }
}
