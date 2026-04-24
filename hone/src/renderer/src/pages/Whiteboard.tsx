// Whiteboard — реальный CRUD + AI critique stream + save-as-note.
//
// Phase 5b ограничения: tldraw-редактор не привезён ещё, держим placeholder
// SVG и не персистим shapes. Что РЕАЛЬНО работает: загрузка списка досок,
// автосоздание дефолтной доски при пустом списке, ⌘E запуск критики через
// сервер-стрим, сборка markdown'а из стрима, кнопка «save as note».
//
// Stream-аккумуляция: каждый CritiquePacket добавляется в карту по секциям.
// Когда стрим закрылся (done=true в последнем пакете), мы знаем что markdown
// готов и можно показать «Save as note».
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConnectError, Code } from '@connectrpc/connect';

import { Icon } from '../components/primitives/Icon';
import {
  listWhiteboards,
  createWhiteboard,
  critiqueWhiteboardStream,
  saveCritiqueAsNote,
  type WhiteboardSummary,
  type CritiquePacket,
} from '../api/hone';

interface BoardState {
  status: 'loading' | 'ok' | 'error';
  current: WhiteboardSummary | null;
  error: string | null;
  errorCode: Code | null;
}

const INITIAL_BOARD: BoardState = {
  status: 'loading',
  current: null,
  error: null,
  errorCode: null,
};

interface CritiqueState {
  status: 'idle' | 'streaming' | 'done' | 'error';
  sections: Record<string, string>; // section → accumulated text
  order: string[]; // порядок появления секций для рендера
  error: string | null;
}

const INITIAL_CRITIQUE: CritiqueState = { status: 'idle', sections: {}, order: [], error: null };

function critiqueToMarkdown(c: CritiqueState): string {
  return c.order
    .map((sec) => `## ${sec.toUpperCase()}\n\n${(c.sections[sec] ?? '').trim()}`)
    .join('\n\n');
}

export function WhiteboardPage() {
  const [tool, setTool] = useState('V');
  const [board, setBoard] = useState<BoardState>(INITIAL_BOARD);
  const [critique, setCritique] = useState<CritiqueState>(INITIAL_CRITIQUE);
  const [savingNote, setSavingNote] = useState(false);
  const [savedNoteFlash, setSavedNoteFlash] = useState(false);
  const ensuringRef = useRef(false);

  // Bootstrap: если нет доски — автосоздаём одну. Иначе работаем с первой.
  useEffect(() => {
    if (ensuringRef.current) return;
    ensuringRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const boards = await listWhiteboards();
        if (cancelled) return;
        if (boards.length > 0) {
          setBoard({
            status: 'ok',
            current: boards[0] ?? null,
            error: null,
            errorCode: null,
          });
          return;
        }
        const created = await createWhiteboard('Untitled board', '');
        if (cancelled) return;
        setBoard({
          status: 'ok',
          current: { id: created.id, title: created.title, updatedAt: created.updatedAt },
          error: null,
          errorCode: null,
        });
      } catch (err: unknown) {
        if (cancelled) return;
        const ce = ConnectError.from(err);
        setBoard({
          status: 'error',
          current: null,
          error: ce.rawMessage || ce.message,
          errorCode: ce.code,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCritiqueToggle = async () => {
    if (!board.current) return;
    if (critique.status === 'streaming') return;
    if (critique.status === 'done' || critique.status === 'error') {
      // Toggle off → reset.
      setCritique(INITIAL_CRITIQUE);
      return;
    }
    setCritique({ status: 'streaming', sections: {}, order: [], error: null });
    try {
      await critiqueWhiteboardStream(board.current.id, (pkt: CritiquePacket) => {
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
      // Гарантия: даже если stream завершился без done=true пакета, mark as done.
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
    if (!board.current || critique.status !== 'done') return;
    const md = critiqueToMarkdown(critique);
    if (!md.trim()) return;
    setSavingNote(true);
    try {
      await saveCritiqueAsNote({
        whiteboardId: board.current.id,
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

  const critiqueButtonLabel = useMemo(() => {
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
  }, [critique.status]);

  return (
    <div className="fadein" style={{ position: 'absolute', inset: 0 }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* Placeholder SVG sketch — реальный tldraw в Phase 5c */}
      <PlaceholderSketch />

      {/* Critique panel */}
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
            fontSize: 13,
            color: 'var(--ink-90)',
            lineHeight: 1.75,
            letterSpacing: '-0.005em',
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '.22em',
              color: 'var(--ink-40)',
              marginBottom: 16,
            }}
          >
            SENIOR REVIEW
            {critique.status === 'streaming' && ' · STREAMING…'}
          </div>
          {critique.error ? (
            <p style={{ color: 'var(--ink-60)' }}>{critique.error}</p>
          ) : (
            critique.order.map((sec) => (
              <div key={sec} style={{ marginBottom: 18 }}>
                <div
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: 'var(--ink-60)',
                    letterSpacing: '.18em',
                    marginBottom: 6,
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
                padding: '8px 14px',
                fontSize: 12,
                fontWeight: 500,
                borderRadius: 999,
                background: savedNoteFlash ? 'rgba(255,255,255,0.18)' : '#fff',
                color: savedNoteFlash ? 'var(--ink)' : '#000',
                transition: 'background 200ms ease, color 200ms ease',
              }}
            >
              {savingNote
                ? 'Saving…'
                : savedNoteFlash
                  ? '✓ Saved as note'
                  : 'Save as note'}
            </button>
          )}
        </div>
      )}

      <div style={{ position: 'absolute', top: 86, right: 32 }}>
        <button
          onClick={handleCritiqueToggle}
          disabled={!board.current || critique.status === 'streaming'}
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

      {/* Tool row — positioned ABOVE the persistent timer dock. */}
      <div
        style={{
          position: 'absolute',
          bottom: 92,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 4,
          padding: 6,
          borderRadius: 999,
          background: 'rgba(10,10,10,0.72)',
          border: '1px solid rgba(255,255,255,0.08)',
          backdropFilter: 'blur(18px)',
        }}
      >
        {['V', 'R', 'O', 'L', 'T', 'E'].map((k) => {
          const active = tool === k;
          return (
            <button
              key={k}
              onClick={() => setTool(k)}
              className="focus-ring mono"
              style={{
                width: 32,
                height: 32,
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 500,
                background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
                color: active ? 'var(--ink)' : 'var(--ink-60)',
              }}
            >
              {k}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PlaceholderSketch() {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 1600 900"
      preserveAspectRatio="xMidYMid meet"
      style={{ position: 'absolute', inset: 0 }}
    >
      <g transform="translate(560 360)">
        <rect
          width="200"
          height="110"
          rx="6"
          fill="rgba(255,255,255,0.025)"
          stroke="rgba(255,255,255,0.75)"
          strokeWidth="1.3"
        />
        <text x="16" y="32" fill="rgba(255,255,255,0.95)" fontFamily="JetBrains Mono" fontSize="15">
          api
        </text>
        <text x="16" y="56" fill="rgba(255,255,255,0.45)" fontFamily="Inter" fontSize="12">
          Go · 3 replicas
        </text>
        <text x="16" y="84" fill="rgba(255,255,255,0.4)" fontFamily="JetBrains Mono" fontSize="11">
          /v1/*
        </text>
      </g>
      <g transform="translate(920 290)">
        <circle
          cx="70"
          cy="70"
          r="66"
          fill="rgba(255,255,255,0.02)"
          stroke="rgba(255,255,255,0.75)"
          strokeWidth="1.3"
        />
        <text
          x="70"
          y="66"
          textAnchor="middle"
          fill="rgba(255,255,255,0.95)"
          fontFamily="JetBrains Mono"
          fontSize="15"
        >
          postgres
        </text>
        <text
          x="70"
          y="86"
          textAnchor="middle"
          fill="rgba(255,255,255,0.4)"
          fontFamily="Inter"
          fontSize="12"
        >
          primary + RR
        </text>
      </g>
      <g transform="translate(920 510)">
        <circle
          cx="70"
          cy="70"
          r="66"
          fill="rgba(255,255,255,0.02)"
          stroke="rgba(255,255,255,0.75)"
          strokeWidth="1.3"
        />
        <text
          x="70"
          y="66"
          textAnchor="middle"
          fill="rgba(255,255,255,0.95)"
          fontFamily="JetBrains Mono"
          fontSize="15"
        >
          s3
        </text>
        <text
          x="70"
          y="86"
          textAnchor="middle"
          fill="rgba(255,255,255,0.4)"
          fontFamily="Inter"
          fontSize="12"
        >
          blobs
        </text>
      </g>
      <g transform="translate(320 390)">
        <rect
          width="150"
          height="70"
          rx="6"
          fill="none"
          stroke="rgba(255,255,255,0.4)"
          strokeWidth="1.2"
          strokeDasharray="4 4"
        />
        <text x="16" y="30" fill="rgba(255,255,255,0.7)" fontFamily="JetBrains Mono" fontSize="13">
          client
        </text>
        <text x="16" y="52" fill="rgba(255,255,255,0.4)" fontFamily="Inter" fontSize="11">
          web / ios
        </text>
      </g>
      <defs>
        <marker
          id="ahw"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="rgba(255,255,255,0.8)" />
        </marker>
      </defs>
      <path
        d="M470,422 L560,415"
        stroke="rgba(255,255,255,0.6)"
        strokeWidth="1.2"
        fill="none"
        markerEnd="url(#ahw)"
      />
      <path
        d="M760,385 L920,355"
        stroke="rgba(255,255,255,0.6)"
        strokeWidth="1.2"
        fill="none"
        markerEnd="url(#ahw)"
      />
      <path
        d="M760,440 L920,575"
        stroke="rgba(255,255,255,0.6)"
        strokeWidth="1.2"
        fill="none"
        markerEnd="url(#ahw)"
      />
    </svg>
  );
}
