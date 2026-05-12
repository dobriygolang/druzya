// AICoachPill (Hone) — inline contextual chat-pill для AI-coach'а.
//
// Открывается inline drawer'ом справа. На первом open — adopt'имся к
// персоне (idempotent), thread reuse. Surface-context идёт system-episode'ом
// перед первым user-message'ем (см ai_tutor.SendMessage).
//
// Hone-styled: моно-шрифт, тёмный фон, минимум визуального шума —
// стиль «coach», не «GPT-чат».
import { useEffect, useRef, useState } from 'react';

import { adoptAITutor, sendAITutorMessage } from '../api/aiTutor';
import { useFocusTrap } from '../hooks/useFocusTrap';

type Turn = { role: 'user' | 'assistant'; content: string };

export interface AICoachPillProps {
  personaSlug: string;
  contextNote: string;
  label?: string;
  coachName?: string;
  /** External-controlled open state. Когда задан — внутренний button скрыт. */
  controlledOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function AICoachPill({
  personaSlug,
  contextNote,
  label = 'Спросить coach’а',
  coachName,
  controlledOpen,
  onOpenChange,
}: AICoachPillProps) {
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? !!controlledOpen : internalOpen;
  const setOpen = (v: boolean) => {
    if (isControlled) onOpenChange?.(v);
    else setInternalOpen(v);
  };
  const [threadId, setThreadId] = useState<string | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [adoptError, setAdoptError] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [contextSent, setContextSent] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // На каждое новое (re-)открытие сбрасываем contextSent чтобы свежий
  // contextNote ушёл LLM как system-episode перед первым user-message'ом.
  // Применимо и для standalone, и для controlled mode'а.
  useEffect(() => {
    if (open) setContextSent(false);
  }, [open, contextNote]);

  // Lazy adopt at first open. Reused across re-opens.
  useEffect(() => {
    if (!open || threadId || adopting) return;
    setAdopting(true);
    setAdoptError(false);
    void adoptAITutor(personaSlug)
      .then((r) => {
        setThreadId(r.threadId);
      })
      .catch(() => setAdoptError(true))
      .finally(() => setAdopting(false));
  }, [open, threadId, personaSlug, adopting]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, sending]);

  const onSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = draft.trim();
    if (!content || !threadId || sending) return;
    setDraft('');
    setSending(true);
    setSendError(null);
    setTurns((t) => [...t, { role: 'user', content }]);
    try {
      const r = await sendAITutorMessage({
        threadId,
        content,
        contextNote: contextSent ? undefined : contextNote,
      });
      setContextSent(true);
      setTurns((t) => [...t, { role: 'assistant', content: r.assistantContent }]);
    } catch (err) {
      setDraft(content);
      setTurns((t) => t.slice(0, -1));
      setSendError(err instanceof Error ? err.message : 'send failed');
    } finally {
      setSending(false);
    }
  };

  const trapRef = useFocusTrap(open);

  return (
    <>
      {!isControlled && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-haspopup="dialog"
          className="mono focus-ring"
          style={pillBtnStyle}
        >
          ✦ {label}
        </button>
      )}
      {open && (
        <div ref={trapRef} style={overlayStyle} role="dialog" aria-modal="true">
          <div style={backdropStyle} onClick={() => setOpen(false)} />
          <aside style={drawerStyle}>
            <header style={headerStyle}>
              <span className="mono" style={titleStyle}>
                ✦ {coachName ?? 'AI-COACH'}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="mono focus-ring"
                style={closeBtnStyle}
                aria-label="Закрыть"
              >
                ✕
              </button>
            </header>
            <div ref={scrollRef} style={messagesStyle}>
              {adoptError && (
                <div style={errStyle}>
                  Не получилось подключить coach'а. Закрой и попробуй снова.
                </div>
              )}
              {adopting && !threadId && (
                <div style={mutedStyle}>подключаюсь…</div>
              )}
              {threadId && turns.length === 0 && !sending && (
                <div style={mutedStyle}>
                  Coach видит контекст этого экрана. Задай вопрос — отвечу
                  с учётом твоей истории.
                </div>
              )}
              {turns.map((t, i) => (
                <div
                  key={i}
                  style={t.role === 'user' ? bubbleUserStyle : bubbleAsstStyle}
                >
                  {t.content}
                </div>
              ))}
              {sending && <div style={mutedStyle}>думаю…</div>}
              {sendError && <div style={errStyle}>{sendError}</div>}
            </div>
            <form onSubmit={onSend} style={formStyle}>
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void onSend(e as unknown as React.FormEvent);
                  }
                }}
                rows={2}
                placeholder="спроси coach'а…"
                disabled={!threadId || sending}
                style={textareaStyle}
              />
              <button
                type="submit"
                aria-label="Send message"
                disabled={!draft.trim() || !threadId || sending}
                className="mono focus-ring"
                style={sendBtnStyle}
              >
                ↩
              </button>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}

const pillBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '5px 10px',
  fontSize: 10,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-90)',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.18)',
  borderRadius: 999,
  cursor: 'pointer',
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 60,
  display: 'flex',
  justifyContent: 'flex-end',
};

const backdropStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(0,0,0,0.45)',
};

const drawerStyle: React.CSSProperties = {
  position: 'relative',
  width: 'min(420px, 96vw)',
  height: '100%',
  background: 'var(--bg-elevated, #161616)',
  borderLeft: '1px solid rgba(255,255,255,0.12)',
  display: 'flex',
  flexDirection: 'column',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '14px 16px',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
};

const titleStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.08em',
  color: 'var(--ink-90)',
  textTransform: 'uppercase',
};

const closeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--ink-60)',
  fontSize: 12,
  cursor: 'pointer',
  padding: 4,
};

const messagesStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '14px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const bubbleUserStyle: React.CSSProperties = {
  alignSelf: 'flex-end',
  maxWidth: '85%',
  padding: '8px 12px',
  borderRadius: 8,
  background: 'rgba(120,150,255,0.12)',
  color: 'var(--ink-90)',
  fontSize: 13,
  lineHeight: 1.45,
  whiteSpace: 'pre-wrap',
};

const bubbleAsstStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  maxWidth: '92%',
  padding: '8px 12px',
  borderRadius: 8,
  background: 'rgba(255,255,255,0.05)',
  color: 'var(--ink-90)',
  fontSize: 13,
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
};

const mutedStyle: React.CSSProperties = {
  color: 'var(--ink-40)',
  fontSize: 12,
  fontStyle: 'italic',
};

const errStyle: React.CSSProperties = {
  color: 'var(--red, #FF3B30)',
  fontSize: 12,
  background: 'rgba(255,59,48,0.08)',
  padding: '6px 10px',
  borderRadius: 6,
};

const formStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  gap: 8,
  padding: '12px 14px',
  borderTop: '1px solid rgba(255,255,255,0.08)',
};

const textareaStyle: React.CSSProperties = {
  flex: 1,
  resize: 'none',
  minHeight: 44,
  padding: '8px 10px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 6,
  color: 'var(--ink-90)',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
};

const sendBtnStyle: React.CSSProperties = {
  padding: '8px 12px',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.18)',
  borderRadius: 6,
  color: 'var(--ink-90)',
  cursor: 'pointer',
  fontSize: 14,
};
