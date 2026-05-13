// TasksSuggestionsCard — Phase K Wave 15 «Coach reads notes → suggests tasks».
//
// Collapsible-ish card: header показывает количество suggestions,
// expanded list — каждая строка с заголовком + цитатой + Add/Skip.
//
// Поведение:
//   - mount → fetch suggestTasksFromNotes(7).
//   - empty list → not render'им card (zero-friction zero state).
//   - 503 (ErrLLMUnavailable) → silent: show ничего, чтобы не пугать
//     юзеров без wired LLM.
//
// «Добавить» — one-click acceptTaskSuggestion → задача в backlog.
// На success скрываем suggestion из локального state (cache backend сам
// инвалидирует).
import React, { useEffect, useState } from 'react';

import {
  suggestTasksFromNotes,
  acceptTaskSuggestion,
  type TaskSuggestion,
} from '../../api/hone';

interface State {
  loading: boolean;
  items: TaskSuggestion[];
  cachedAt: string;
  error: 'none' | 'unavailable' | 'other';
}

const initial: State = {
  loading: true,
  items: [],
  cachedAt: '',
  error: 'none',
};

export const TasksSuggestionsCard: React.FC<{ onAccepted?: () => void }> = ({ onAccepted }) => {
  const [state, setState] = useState<State>(initial);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await suggestTasksFromNotes(7);
        if (cancelled) return;
        setState({ loading: false, items: res.suggestions, cachedAt: res.cachedAt, error: 'none' });
      } catch (e) {
        if (cancelled) return;
        // 503 / Unimplemented — feature not wired (LLM missing). Тихо
        // прячем card. Любая другая ошибка тоже не блокирует TaskBoard.
        const msg = e instanceof Error ? e.message : String(e);
        const unavailable = /llm.*unavailable|unimplemented|503/i.test(msg);
        setState({
          loading: false,
          items: [],
          cachedAt: '',
          error: unavailable ? 'unavailable' : 'other',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const accept = async (s: TaskSuggestion) => {
    // Optimistic: убираем из list сразу. Если RPC падает, не вернём —
    // юзер может попробовать через minute / 1h cache refresh.
    setState((prev) => ({ ...prev, items: prev.items.filter((it) => it.id !== s.id) }));
    try {
      await acceptTaskSuggestion(s.title, s.sourceNoteId);
      onAccepted?.();
    } catch {
      /* swallow — UI уже изменился */
    }
  };

  const dismiss = (s: TaskSuggestion) => {
    setState((prev) => ({ ...prev, items: prev.items.filter((it) => it.id !== s.id) }));
  };

  if (state.loading) return null;
  if (state.error !== 'none') return null;
  if (state.items.length === 0) return null;

  return (
    <section
      style={{
        margin: '0 0 16px',
        padding: '14px 16px 12px',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 10,
        fontFamily: 'inherit',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <div
          style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 10,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--ink-60)',
          }}
        >
          из заметок · {state.items.length} {state.cachedAt ? '· cached' : ''}
        </div>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {state.items.map((s) => (
          <li
            key={s.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              gap: 10,
              padding: '8px 10px',
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.05)',
              borderRadius: 8,
              alignItems: 'start',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.35 }}>
                {s.title}
              </div>
              {s.sourceExcerpt && (
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 11.5,
                    color: 'var(--ink-40)',
                    lineHeight: 1.45,
                    whiteSpace: 'pre-wrap',
                    fontFamily: '"JetBrains Mono", monospace',
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                  }}
                >
                  {s.sourceExcerpt}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => void accept(s)}
                className="focus-ring"
                title="Добавить как задачу"
                style={{
                  padding: '4px 10px',
                  fontSize: 11,
                  background: 'rgba(255,255,255,0.92)',
                  color: '#0a0a0a',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: 600,
                  letterSpacing: '0.02em',
                }}
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => dismiss(s)}
                className="focus-ring"
                title="Не сейчас"
                style={{
                  padding: '4px 8px',
                  fontSize: 11,
                  background: 'transparent',
                  color: 'var(--ink-40)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Skip
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};
