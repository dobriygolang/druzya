// Whiteboard — tldraw-powered canvas с персистентностью через backend
// UpdateWhiteboard + AI critique stream + SaveCritiqueAsNote.
//
// Поток:
//   1. bootstrap: listWhiteboards → если пусто, create «Untitled board».
//      Иначе берём первую.
//   2. getWhiteboard(id) — достаём stateJson (может быть "" для новых).
//   3. рендерим <Tldraw> с persistenceKey + onMount → editor available.
//      stateJson НЕ пустой — вызываем `editor.store.loadSnapshot(parsed)`.
//   4. Подписываемся на editor.store.listen() (changes), debounced 1.5с
//      запускает UpdateWhiteboard с свежим getSnapshot + version.
//   5. ⌘E → critiqueWhiteboardStream, аккумулируем по секциям.
//   6. После стрима — «Save as note» → saveCritiqueAsNote.
//
// Optimistic-concurrency: мы держим version локально; UpdateWhiteboard
// возвращает новый version'у и мы перезаписываем. При ErrStaleVersion
// (Code.Aborted) логируем и отказываемся сохранять без пере-load'а (для
// v0 ОК — один юзер / одна машина одновременно).
import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectError, Code } from '@connectrpc/connect';
import { Tldraw, type Editor, type StoreSnapshot, type TLRecord } from 'tldraw';
import 'tldraw/tldraw.css';

import { Icon } from '../components/primitives/Icon';
import {
  listWhiteboards,
  createWhiteboard,
  getWhiteboard,
  updateWhiteboard,
  critiqueWhiteboardStream,
  saveCritiqueAsNote,
  type Whiteboard,
  type CritiquePacket,
} from '../api/hone';

interface BoardState {
  status: 'loading' | 'ok' | 'error';
  board: Whiteboard | null;
  error: string | null;
  errorCode: Code | null;
}

const INITIAL_BOARD: BoardState = {
  status: 'loading',
  board: null,
  error: null,
  errorCode: null,
};

interface CritiqueState {
  status: 'idle' | 'streaming' | 'done' | 'error';
  sections: Record<string, string>;
  order: string[];
  error: string | null;
}

const INITIAL_CRITIQUE: CritiqueState = { status: 'idle', sections: {}, order: [], error: null };

function critiqueToMarkdown(c: CritiqueState): string {
  return c.order
    .map((sec) => `## ${sec.toUpperCase()}\n\n${(c.sections[sec] ?? '').trim()}`)
    .join('\n\n');
}

export function WhiteboardPage() {
  const [board, setBoard] = useState<BoardState>(INITIAL_BOARD);
  const [critique, setCritique] = useState<CritiqueState>(INITIAL_CRITIQUE);
  const [savingNote, setSavingNote] = useState(false);
  const [savedNoteFlash, setSavedNoteFlash] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const editorRef = useRef<Editor | null>(null);
  const versionRef = useRef(0);
  const saveTimer = useRef<number | null>(null);
  const bootstrapRef = useRef(false);

  // Bootstrap.
  useEffect(() => {
    if (bootstrapRef.current) return;
    bootstrapRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const boards = await listWhiteboards();
        if (cancelled) return;
        const targetId = boards[0]?.id;
        let wb: Whiteboard;
        if (targetId) {
          wb = await getWhiteboard(targetId);
        } else {
          wb = await createWhiteboard('Untitled board', '');
        }
        if (cancelled) return;
        versionRef.current = wb.version;
        setBoard({ status: 'ok', board: wb, error: null, errorCode: null });
      } catch (err: unknown) {
        if (cancelled) return;
        const ce = ConnectError.from(err);
        setBoard({
          status: 'error',
          board: null,
          error: ce.rawMessage || ce.message,
          errorCode: ce.code,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Save снимает snapshot tldraw и пушит в backend.
  const flushSave = useCallback(async () => {
    const editor = editorRef.current;
    const current = board.board;
    if (!editor || !current) return;
    const snapshot = editor.store.getStoreSnapshot();
    const json = JSON.stringify(snapshot);
    try {
      const updated = await updateWhiteboard({
        id: current.id,
        title: current.title,
        stateJson: json,
        expectedVersion: versionRef.current,
      });
      versionRef.current = updated.version;
      setSaveError(null);
      setBoard((prev) => (prev.board ? { ...prev, board: updated } : prev));
    } catch (err: unknown) {
      const ce = ConnectError.from(err);
      setSaveError(ce.rawMessage || ce.message);
    }
  }, [board.board]);

  const onMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      // Load existing snapshot if present.
      const json = board.board?.stateJson;
      if (json) {
        try {
          const parsed = JSON.parse(json) as StoreSnapshot<TLRecord>;
          editor.store.loadStoreSnapshot(parsed);
        } catch {
          // Non-fatal — начинаем с пустого canvas'а.
        }
      }
      // Дебаунс-save на изменения store'а.
      const unsubscribe = editor.store.listen(
        () => {
          if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
          saveTimer.current = window.setTimeout(() => {
            void flushSave();
          }, 1500);
        },
        { scope: 'document', source: 'user' },
      );
      return () => {
        unsubscribe();
        if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      };
    },
    [board.board, flushSave],
  );

  // ⌘E — toggle critique. Когда idle → start stream. Когда done/error →
  // reset. Streaming — игнорируем повторный тычок.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        void handleCritiqueToggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.board, critique.status]);

  const handleCritiqueToggle = async () => {
    if (!board.board) return;
    if (critique.status === 'streaming') return;
    if (critique.status === 'done' || critique.status === 'error') {
      setCritique(INITIAL_CRITIQUE);
      return;
    }
    // Перед критикой flush текущий state чтобы бекенд видел свежий snapshot.
    await flushSave();
    setCritique({ status: 'streaming', sections: {}, order: [], error: null });
    try {
      await critiqueWhiteboardStream(board.board.id, (pkt: CritiquePacket) => {
        setCritique((prev) => {
          const sections = { ...prev.sections };
          const order = prev.order.includes(pkt.section)
            ? prev.order
            : [...prev.order, pkt.section];
          sections[pkt.section] = (sections[pkt.section] ?? '') + pkt.delta;
          return {
            status: pkt.done ? 'done' : 'streaming',
            sections,
            order,
            error: null,
          };
        });
      });
      setCritique((prev) =>
        prev.status === 'streaming' ? { ...prev, status: 'done' } : prev,
      );
    } catch (err: unknown) {
      const ce = ConnectError.from(err);
      setCritique((prev) => ({
        ...prev,
        status: 'error',
        error: ce.rawMessage || ce.message,
      }));
    }
  };

  const handleSaveAsNote = async () => {
    if (!board.board || critique.status !== 'done') return;
    const md = critiqueToMarkdown(critique);
    if (!md.trim()) return;
    setSavingNote(true);
    try {
      await saveCritiqueAsNote({
        whiteboardId: board.board.id,
        bodyMd: md,
      });
      setSavedNoteFlash(true);
      window.setTimeout(() => setSavedNoteFlash(false), 2200);
    } catch (err: unknown) {
      const ce = ConnectError.from(err);
      setCritique((prev) => ({
        ...prev,
        error: ce.rawMessage || ce.message,
      }));
    } finally {
      setSavingNote(false);
    }
  };

  const critiquePanelOpen = critique.status !== 'idle';
  const showSaveButton = critique.status === 'done' && critique.order.length > 0;

  const critiqueButtonLabel = (() => {
    switch (critique.status) {
      case 'streaming':
        return 'Critiquing…';
      case 'done':
        return 'Hide critique';
      case 'error':
        return 'Retry critique';
      default:
        return '⌘E critique';
    }
  })();

  return (
    <div className="fadein" style={{ position: 'absolute', inset: 0 }}>
      {board.status === 'loading' && (
        <div
          className="mono"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            letterSpacing: '.2em',
            color: 'var(--ink-40)',
          }}
        >
          LOADING BOARD…
        </div>
      )}
      {board.status === 'error' && (
        <div
          className="mono"
          style={{
            position: 'absolute',
            top: 86,
            left: 32,
            fontSize: 11,
            color: 'var(--ink-40)',
          }}
        >
          {board.errorCode === Code.Unauthenticated
            ? 'Sign in to use whiteboards'
            : `Whiteboard offline: ${board.error ?? ''}`}
        </div>
      )}

      {board.status === 'ok' && board.board && (
        <div
          className="hone-tldraw-mount"
          style={{ position: 'absolute', inset: 0 }}
        >
          <Tldraw
            onMount={onMount}
            // persistenceKey даёт локальный IndexedDB backup на случай
            // временной потери коннекта к бекенду; не подменяет main
            // source-of-truth (UpdateWhiteboard).
            persistenceKey={`hone:${board.board.id}`}
            hideUi={false}
            inferDarkMode
          />
        </div>
      )}

      {/* Critique panel overlay */}
      {critiquePanelOpen && (
        <div
          className="fadein"
          style={{
            position: 'absolute',
            top: 120,
            right: 80,
            width: 440,
            maxHeight: 'calc(100% - 240px)',
            overflowY: 'auto',
            padding: '18px 22px',
            background: 'rgba(8,8,8,0.92)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 12,
            fontSize: 13,
            color: 'var(--ink-90)',
            lineHeight: 1.75,
            letterSpacing: '-0.005em',
            backdropFilter: 'blur(18px)',
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '.22em',
              color: 'var(--ink-40)',
              marginBottom: 12,
            }}
          >
            SENIOR REVIEW
            {critique.status === 'streaming' && ' · STREAMING…'}
          </div>
          {critique.error ? (
            <p style={{ color: 'var(--ink-60)' }}>{critique.error}</p>
          ) : (
            critique.order.map((sec) => (
              <div key={sec} style={{ marginBottom: 14 }}>
                <div
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: 'var(--ink-60)',
                    letterSpacing: '.18em',
                    marginBottom: 4,
                  }}
                >
                  {sec.toUpperCase()}
                </div>
                <p style={{ margin: 0 }}>{critique.sections[sec]}</p>
              </div>
            ))
          )}

          {showSaveButton && (
            <button
              onClick={handleSaveAsNote}
              disabled={savingNote}
              className="focus-ring"
              style={{
                marginTop: 8,
                padding: '7px 13px',
                fontSize: 12,
                fontWeight: 500,
                borderRadius: 999,
                background: savedNoteFlash ? 'rgba(255,255,255,0.18)' : '#fff',
                color: savedNoteFlash ? 'var(--ink)' : '#000',
                transition: 'background 200ms ease',
              }}
            >
              {savingNote ? 'Saving…' : savedNoteFlash ? '✓ Saved as note' : 'Save as note'}
            </button>
          )}
        </div>
      )}

      <div style={{ position: 'absolute', top: 86, right: 32, zIndex: 20 }}>
        <button
          onClick={() => void handleCritiqueToggle()}
          disabled={!board.board || critique.status === 'streaming'}
          className="focus-ring"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 13px',
            borderRadius: 999,
            background: critiquePanelOpen ? '#fff' : 'rgba(255,255,255,0.06)',
            color: critiquePanelOpen ? '#000' : 'var(--ink)',
            fontSize: 12.5,
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <Icon name="sparkle" size={12} /> {critiqueButtonLabel}
        </button>
      </div>

      {saveError && (
        <div
          className="mono"
          style={{
            position: 'absolute',
            bottom: 120,
            left: 32,
            fontSize: 10,
            color: 'var(--ink-40)',
            letterSpacing: '.12em',
          }}
        >
          SAVE: {saveError}
        </div>
      )}
    </div>
  );
}
