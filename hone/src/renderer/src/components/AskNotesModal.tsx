// AskNotesModal — ⌘⇧L modal на странице Notes.
//
// RAG-флоу: юзер вводит вопрос → askNotes() → markdown ответ + цитации
// chip-list внизу. Click по chip — закрывает модалку и открывает заметку.
//
// History: localStorage hone:notes:qa-history хранит последние 10 вопросов;
// показываем как chips под input'ом, пока inputs пустой.
import { useCallback, useEffect, useRef, useState } from 'react';

import { askNotes, type AskAnswer, type Citation } from '../api/intelligence';
import { MarkdownView } from './MarkdownView';

const HISTORY_KEY = 'hone:notes:qa-history';
const HISTORY_MAX = 10;

function loadHistory(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x) => typeof x === 'string').slice(0, HISTORY_MAX);
  } catch {
    return [];
  }
}

function pushHistory(q: string): string[] {
  const cur = loadHistory();
  const next = [q, ...cur.filter((x) => x !== q)].slice(0, HISTORY_MAX);
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export interface AskNotesModalProps {
  onClose: () => void;
  onOpenNote: (noteId: string) => void;
}

export function AskNotesModal({ onClose, onOpenNote }: AskNotesModalProps) {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Auto-focus on mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed) return;
      setLoading(true);
      setError(null);
      setAnswer(null);
      try {
        const a = await askNotes(trimmed);
        setAnswer(a);
        setHistory(pushHistory(trimmed));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Coach is offline');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '14vh',
        zIndex: 50,
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480,
          maxWidth: '92vw',
          maxHeight: '70vh',
          background: 'rgba(28,28,30,0.96)',
          color: 'rgba(255,255,255,0.92)',
          borderRadius: 14,
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 20px 64px rgba(0,0,0,0.55)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: 'ui-sans-serif, -apple-system, system-ui, sans-serif',
          animation: 'askPop 220ms ease-out',
        }}
      >
        <input
          ref={inputRef}
          type="text"
          placeholder="Ask your notes…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit(q);
            }
          }}
          style={{
            background: 'transparent',
            border: 'none',
            outline: 'none',
            padding: '14px 18px',
            fontSize: 14,
            color: 'rgba(255,255,255,0.95)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
        />

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '14px 18px',
            fontSize: 13,
            lineHeight: 1.55,
          }}
        >
          {/* History chips when empty */}
          {!loading && !answer && !error && (
            history.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {history.map((h, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setQ(h);
                      void submit(h);
                    }}
                    style={chipStyle}
                  >
                    {h.length > 40 ? `${h.slice(0, 40)}…` : h}
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ color: 'rgba(255,255,255,0.4)' }}>
                Type a question and press Enter. I’ll search your notes and answer with citations.
              </div>
            )
          )}

          {loading && (
            <div style={{ display: 'flex', gap: 6, color: 'rgba(255,255,255,0.5)' }}>
              <span style={dotStyle(0)} />
              <span style={dotStyle(180)} />
              <span style={dotStyle(360)} />
            </div>
          )}

          {error && (
            <div style={{ color: 'rgba(255,180,180,0.85)' }}>
              Coach is offline.
            </div>
          )}

          {answer && (
            <>
              <MarkdownView source={answer.answerMd} />
              {answer.citations.length > 0 && (
                <div
                  style={{
                    marginTop: 14,
                    paddingTop: 10,
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                  }}
                >
                  {answer.citations.map((c, i) => (
                    <CitationChip
                      key={c.noteId + i}
                      idx={i + 1}
                      citation={c}
                      onClick={() => {
                        onOpenNote(c.noteId);
                        onClose();
                      }}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const chipStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 999,
  padding: '4px 10px',
  fontSize: 12,
  color: 'rgba(255,255,255,0.75)',
  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
  cursor: 'pointer',
};

function dotStyle(delay: number): React.CSSProperties {
  return {
    width: 5,
    height: 5,
    borderRadius: '50%',
    background: 'currentColor',
    display: 'inline-block',
    animation: `briefDot 1.2s ease-in-out ${delay}ms infinite`,
  };
}

function CitationChip({
  idx,
  citation,
  onClick,
}: {
  idx: number;
  citation: Citation;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={citation.snippet}
      style={{
        ...chipStyle,
        background: 'rgba(120,160,255,0.07)',
        borderColor: 'rgba(120,160,255,0.18)',
        color: 'rgba(190,210,255,0.92)',
      }}
    >
      [{idx}] {citation.title.length > 32 ? `${citation.title.slice(0, 32)}…` : citation.title}
    </button>
  );
}

// Inject pop keyframes (shared brief dot keyframes installed by DailyBriefPanel).
if (typeof document !== 'undefined' && !document.getElementById('hone-ask-kf')) {
  const style = document.createElement('style');
  style.id = 'hone-ask-kf';
  style.textContent = `
    @keyframes askPop { from { opacity: 0; transform: scale(0.96) } to { opacity: 1; transform: scale(1) } }
    @keyframes briefDot { 0%,100% { opacity: 0.3 } 50% { opacity: 1 } }
  `;
  document.head.appendChild(style);
}
