// AskNotesModal — ⌘⇧L modal на странице Notes.
//
// RAG-флоу: юзер вводит вопрос → askNotes() → markdown ответ + цитации
// chip-list внизу. Click по chip — закрывает модалку и открывает заметку.
//
// History: localStorage hone:notes:qa-history хранит последние 10 вопросов;
// показываем как chips под input'ом, пока inputs пустой.
import { useCallback, useRef, useState } from 'react';

import { askNotes, type AskAnswer, type Citation } from '../api/intelligence';
import { MarkdownView } from './MarkdownView';
import { Modal } from './primitives/Modal';
import { motion as motionTokens } from '../lib/design-tokens';

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
  const [open, setOpen] = useState(true);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Smooth exit: flip open → Modal exit anim → parent unmounts.
  const close = useCallback(() => {
    setOpen(false);
    window.setTimeout(onClose, motionTokens.dur.medium);
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
    <Modal open={open} onClose={close} size="md" initialFocusRef={inputRef as React.RefObject<HTMLElement>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 220, maxHeight: '60vh' }}>
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
            flex: '0 0 auto',
            background: 'transparent',
            border: 0,
            borderBottom: '1px solid var(--hair-2)',
            outline: 'none',
            padding: '8px 0 10px',
            fontSize: 15,
            color: 'var(--ink)',
            transition: 'border-color var(--motion-dur-small) var(--motion-ease-decelerate)',
          }}
          onFocus={(e) => (e.currentTarget.style.borderBottomColor = 'var(--ink)')}
          onBlur={(e) => (e.currentTarget.style.borderBottomColor = 'var(--hair-2)')}
        />

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            fontSize: 13,
            lineHeight: 1.55,
            color: 'var(--ink-90)',
          }}
        >
          {/* History chips when empty */}
          {!loading && !answer && !error &&
            (history.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {history.map((h, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setQ(h);
                      void submit(h);
                    }}
                    className="focus-ring motion-hover-lift"
                    style={chipStyle}
                  >
                    {h.length > 40 ? `${h.slice(0, 40)}…` : h}
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ color: 'var(--ink-40)' }}>
                Type a question and press Enter. I’ll search your notes and answer with citations.
              </div>
            ))}

          {loading && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--ink-60)' }}>
              <span style={dotStyle(0)} />
              <span style={dotStyle(180)} />
              <span style={dotStyle(360)} />
            </div>
          )}

          {error && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, color: 'var(--red)' }}>
              <span aria-hidden="true" style={{ display: 'inline-block', width: 24, height: 1.5, background: 'var(--red)', marginTop: 8 }} />
              <span>Coach is offline.</span>
            </div>
          )}

          {answer && (
            <>
              <MarkdownView source={answer.answerMd} />
              {answer.citations.length > 0 && (
                <div
                  style={{
                    marginTop: 16,
                    paddingTop: 12,
                    borderTop: '1px solid var(--hair)',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  {answer.citations.map((c, i) => (
                    <CitationChip
                      key={c.noteId + i}
                      idx={i + 1}
                      citation={c}
                      onClick={() => {
                        onOpenNote(c.noteId);
                        close();
                      }}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

const chipStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--hair-2)',
  borderRadius: 999,
  padding: '5px 12px',
  fontSize: 12,
  color: 'var(--ink-60)',
  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
  cursor: 'pointer',
  transition:
    'background-color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
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
  // b/w + red rule: no blue tint. Citation chips use the same hairline ghost
  // as history chips, with a leading [N] index in --red to mark them as
  // load-bearing references (signal-stripe equivalent for inline chips).
  return (
    <button
      onClick={onClick}
      title={citation.snippet}
      className="focus-ring motion-hover-lift"
      style={{
        ...chipStyle,
        color: 'var(--ink)',
      }}
    >
      <span style={{ color: 'var(--red)', marginRight: 4 }}>[{idx}]</span>
      {citation.title.length > 32 ? `${citation.title.slice(0, 32)}…` : citation.title}
    </button>
  );
}

// Inject briefDot keyframes once (shared with DailyBriefPanel — defensive guard
// keeps it idempotent if either modal mounts first). Modal entry/exit anim is
// owned by the foundation Modal — no askPop keyframe here anymore.
if (typeof document !== 'undefined' && !document.getElementById('hone-ask-kf')) {
  const style = document.createElement('style');
  style.id = 'hone-ask-kf';
  style.textContent = `
    @keyframes briefDot { 0%,100% { opacity: 0.3 } 50% { opacity: 1 } }
  `;
  document.head.appendChild(style);
}
