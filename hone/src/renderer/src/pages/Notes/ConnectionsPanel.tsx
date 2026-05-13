import { useEffect, useState } from 'react';
import { ConnectError } from '@connectrpc/connect';
import {
  getNoteConnectionsStream,
  suggestNoteLinks,
  type NoteConnection,
  type NoteLinkSuggestion,
} from '../../api/hone';

export interface ConnectionsPanelProps {
  noteId: string;
  onClose: () => void;
  onPick: (id: string) => void;
}

export function ConnectionsPanel({ noteId, onClose, onPick }: ConnectionsPanelProps) {
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [items, setItems] = useState<NoteConnection[]>([]);
  const [err, setErr] = useState<string | null>(null);
  // Phase 5 — AI-rerank suggestions: грузятся параллельно с embedding-only
  // stream'ом, чтобы юзер увидел оба раздела сразу. Suggestions с per-edge
  // `reason` живут в отдельной секции с акцент-полоской (mockup notes.html).
  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [aiItems, setAiItems] = useState<NoteLinkSuggestion[]>([]);
  const [aiErr, setAiErr] = useState<string | null>(null);
  // CI1: retry counter — bumps re-trigger обоих effect'ов (embed stream +
  // AI rerank) без дублирования fetch-логики.
  const [reload, setReload] = useState(0);
  // toast — single-line «linking … » при первом приходе AI-suggestion'ов.
  // Auto-hide через 4с; undo пока no-op (suggestion эфемерна — accept'нуть
  // её = вставить markdown-ссылку в body, что юзер делает руками).
  const [toast, setToast] = useState<{ from: string; to: string; score: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const acc: NoteConnection[] = [];
    setStatus('loading');
    setItems([]);
    getNoteConnectionsStream(noteId, (c) => {
      if (cancelled) return;
      acc.push(c);
      setItems([...acc]);
    })
      .then(() => {
        if (!cancelled) setStatus('ok');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const ce = ConnectError.from(e);
        setErr(ce.rawMessage || ce.message);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [noteId, reload]);

  useEffect(() => {
    let cancelled = false;
    setAiStatus('loading');
    setAiItems([]);
    setAiErr(null);
    suggestNoteLinks(noteId, 5)
      .then((suggs) => {
        if (cancelled) return;
        setAiItems(suggs);
        setAiStatus('ok');
        if (suggs.length > 0) {
          // Snippet headline для toast'а: «linking «<seedHint>» → «<top>» · 0.86».
          // SeedHint мы не знаем (нота открыта по noteId, title живёт в parent
          // компоненте) — показываем target и score, этого достаточно для UX.
          const top = suggs[0];
          setToast({ from: 'this note', to: top.targetTitle, score: top.score });
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const ce = ConnectError.from(e);
        setAiErr(ce.rawMessage || ce.message);
        setAiStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [noteId, reload]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 55,
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        justifyContent: 'flex-end',
      }}
      onClick={onClose}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          height: '100%',
          background: 'rgba(8,8,8,0.96)',
          borderLeft: '1px solid rgba(255,255,255,0.08)',
          padding: '90px 28px 40px',
          overflowY: 'auto',
        }}
      >
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.08em', color: 'var(--ink-40)' }}>
          CONNECTIONS {status === 'loading' && '· STREAMING…'}
        </div>
        <h3 style={{ margin: '10px 0 24px', fontSize: 22, fontWeight: 400, letterSpacing: '-0.015em' }}>
          What this note relates to.
        </h3>

        {status === 'error' && (
          // CI1: stripe + retry — вместо silent plain text.
          <div className="data-loader-error" style={{ marginTop: 4 }}>
            <div className="data-loader-error-stripe" />
            <div className="data-loader-error-body">
              <div className="data-loader-error-label">
                {err?.includes('embedding') ? 'Embeddings not available yet.' : 'Connections failed'}
              </div>
              {err && <div className="data-loader-error-detail">{err}</div>}
              <button
                type="button"
                className="data-loader-error-retry focus-ring motion-press"
                onClick={() => setReload((n) => n + 1)}
              >
                retry
              </button>
            </div>
          </div>
        )}
        {status === 'ok' && items.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--ink-60)' }}>
            Nothing above the similarity floor yet. Write a few more notes.
          </p>
        )}

        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {items.map((c, i) => (
            <li key={`${c.kind}:${c.targetId}:${i}`} style={{ padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <button
                onClick={() => (c.kind === 'note' ? onPick(c.targetId) : undefined)}
                className="focus-ring"
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  cursor: c.kind === 'note' ? 'pointer' : 'default',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: 13.5, color: 'var(--ink)' }}>
                    {c.displayTitle || '(untitled)'}
                  </span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--ink-40)', flexShrink: 0 }}>
                    {c.kind.toUpperCase()} · {(c.similarity * 100).toFixed(0)}%
                  </span>
                </div>
                {c.snippet && (
                  <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-60)', lineHeight: 1.5 }}>
                    {c.snippet}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>

        <div
          style={{
            marginTop: 28,
            paddingTop: 20,
            borderTop: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '0.08em',
              color: 'var(--ink-40)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span>AI-SUGGESTED</span>
            {aiStatus === 'loading' && (
              <span style={{ color: 'var(--ink-60)' }}>· RERANKING…</span>
            )}
            {aiStatus === 'ok' && aiItems.length > 0 && (
              <span style={{ color: 'var(--ink-60)' }}>· {aiItems.length}</span>
            )}
          </div>

          {aiStatus === 'error' && (
            // CI1: stripe + retry для AI-rerank секции.
            <div className="data-loader-error" style={{ marginTop: 10 }}>
              <div className="data-loader-error-stripe" />
              <div className="data-loader-error-body">
                <div className="data-loader-error-label">
                  {aiErr?.includes('llm') || aiErr?.includes('LLM')
                    ? 'AI rerank temporarily unavailable'
                    : 'AI rerank failed'}
                </div>
                {aiErr && <div className="data-loader-error-detail">{aiErr}</div>}
                <button
                  type="button"
                  className="data-loader-error-retry focus-ring motion-press"
                  onClick={() => setReload((n) => n + 1)}
                >
                  retry
                </button>
              </div>
            </div>
          )}
          {aiStatus === 'ok' && aiItems.length === 0 && (
            <p style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-60)' }}>
              No semantic links above the threshold. Add more notes.
            </p>
          )}

          <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
            {aiItems.map((s, i) => (
              <li
                key={`ai:${s.targetNoteId}:${i}`}
                style={{
                  padding: '12px 12px 12px 14px',
                  marginBottom: 8,
                  borderRadius: 6,
                  background: i === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
                  borderLeft: i === 0 ? '1.5px solid var(--red)' : '1px solid rgba(255,255,255,0.07)',
                }}
              >
                <button
                  onClick={() => onPick(s.targetNoteId)}
                  className="focus-ring"
                  style={{ display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 13.5, color: 'var(--ink)' }}>
                      {s.targetTitle || '(untitled)'}
                    </span>
                    <span
                      className="mono"
                      style={{ fontSize: 10, color: 'var(--ink-40)', flexShrink: 0, letterSpacing: '.08em' }}
                    >
                      AI · {(s.score * 100).toFixed(0)}%
                    </span>
                  </div>
                  {s.reason && (
                    <div
                      style={{
                        marginTop: 6,
                        fontSize: 12,
                        color: 'var(--ink-70)',
                        lineHeight: 1.5,
                        fontStyle: 'italic',
                      }}
                    >
                      {s.reason}
                    </div>
                  )}
                  {!s.reason && s.snippet && (
                    <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-60)', lineHeight: 1.5 }}>
                      {s.snippet}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="mono" style={{ marginTop: 20, fontSize: 10, color: 'var(--ink-40)', letterSpacing: '0.08em' }}>
          ESC TO CLOSE
        </div>
      </aside>

      {toast && (
        <div
          className="mono"
          role="status"
          style={{
            position: 'fixed',
            right: 20,
            bottom: 20,
            zIndex: 70,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            background: 'rgba(17,17,17,0.96)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8,
            fontSize: 10,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--ink-70)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}
        >
          <span
            className="red-pulse"
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: 'var(--red)',
              boxShadow: '0 0 0 2px rgba(255, 59, 48, 0.18)',
            }}
          />
          <span>
            linking «{toast.from}» → «{toast.to}» · score {toast.score.toFixed(2)}
          </span>
          <button
            onClick={() => setToast(null)}
            className="focus-ring"
            style={{
              marginLeft: 6,
              padding: '2px 6px',
              fontSize: 9,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 4,
              color: 'var(--ink-60)',
              cursor: 'pointer',
            }}
          >
            dismiss
          </button>
        </div>
      )}
    </div>
  );
}
