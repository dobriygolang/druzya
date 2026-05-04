// ExternalActivityModal — structured form для логирования внешних занятий
// (LeetCode / Coursera / YouTube / книги). НЕ чат: явная associarion с
// GPT-чатом — плохая (Sergey 2026-05-01). Form: source dropdown + topic
// autocomplete по atlas-узлам + duration + notes.
import { useEffect, useRef, useState } from 'react';

import {
  addExternalActivity,
  EXTERNAL_SOURCES,
  searchAtlasTopics,
  type AtlasTopicSuggestion,
  type ExternalSource,
} from '../api/external';

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

interface TopicSelection {
  // atlasNodeId пустой → используется свободный текст.
  atlasNodeId: string;
  text: string;
}

export function ExternalActivityModal({ onClose, onSaved }: Props) {
  const [source, setSource] = useState<ExternalSource>('leetcode');
  const [topic, setTopic] = useState<TopicSelection>({ atlasNodeId: '', text: '' });
  const [suggestions, setSuggestions] = useState<AtlasTopicSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [duration, setDuration] = useState(30);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  // Debounced atlas-topic autocomplete. Only triggers when юзер вводит
  // free-text — если уже выбран узел, suggestions скрыты.
  useEffect(() => {
    if (!showSuggestions || topic.atlasNodeId) {
      setSuggestions([]);
      return;
    }
    const prefix = topic.text.trim();
    if (prefix.length < 2) {
      setSuggestions([]);
      return;
    }
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void searchAtlasTopics(prefix, 8)
        .then(setSuggestions)
        .catch(() => setSuggestions([]));
    }, 220);
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, [topic.text, topic.atlasNodeId, showSuggestions]);

  // ESC closes modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!topic.text.trim()) {
      setError('Укажи topic.');
      return;
    }
    if (duration < 1 || duration > 600) {
      setError('Duration должен быть от 1 до 600 минут.');
      return;
    }
    setBusy(true);
    try {
      await addExternalActivity({
        source,
        topicAtlasNodeId: topic.atlasNodeId || undefined,
        topicFreeText: topic.text.trim(),
        durationMin: duration,
        notes: notes.trim() || undefined,
      });
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true">
      <div style={backdropStyle} onClick={onClose} />
      <div style={modalStyle}>
        <header style={headerStyle}>
          <span className="mono" style={titleStyle}>
            + ВНЕШНЕЕ ЗАНЯТИЕ
          </span>
          <button
            type="button"
            onClick={onClose}
            className="mono focus-ring"
            style={closeBtnStyle}
            aria-label="Закрыть"
          >
            ✕
          </button>
        </header>
        <form onSubmit={onSubmit} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Field label="Источник">
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as ExternalSource)}
              style={selectStyle}
              disabled={busy}
            >
              {EXTERNAL_SOURCES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Topic">
            <div style={{ position: 'relative' }}>
              <input
                value={topic.text}
                onChange={(e) =>
                  setTopic({ atlasNodeId: '', text: e.target.value })
                }
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => window.setTimeout(() => setShowSuggestions(false), 120)}
                placeholder="например, BFS на деревьях"
                style={inputStyle}
                disabled={busy}
              />
              {showSuggestions && suggestions.length > 0 && (
                <div style={suggestStyle}>
                  {suggestions.map((s) => (
                    <button
                      key={s.atlasNodeId}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setTopic({ atlasNodeId: s.atlasNodeId, text: s.title });
                        setShowSuggestions(false);
                      }}
                      style={suggestItemStyle}
                    >
                      <span style={{ color: 'var(--ink-90)' }}>{s.title}</span>
                      <span className="mono" style={{ fontSize: 9, color: 'var(--ink-40)', letterSpacing: '0.16em' }}>
                        {s.section}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {topic.atlasNodeId && (
                <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-60)' }}>
                  Привязано к atlas-узлу. Очистить — измени текст.
                </div>
              )}
            </div>
          </Field>

          <Field label="Минут">
            <input
              type="number"
              value={duration}
              min={1}
              max={600}
              onChange={(e) => setDuration(Number(e.target.value))}
              style={{ ...inputStyle, width: 100 }}
              disabled={busy}
            />
          </Field>

          <Field label="Заметка (опционально)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="что прошло, что застряло…"
              style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
              disabled={busy}
            />
          </Field>

          {error && <div style={errStyle}>{error}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={onClose} disabled={busy} style={secondaryBtnStyle}>
              Отмена
            </button>
            <button type="submit" disabled={busy} style={primaryBtnStyle}>
              {busy ? 'Сохраняю…' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--ink-40)', textTransform: 'uppercase' }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 70,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
const backdropStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
};
const modalStyle: React.CSSProperties = {
  position: 'relative',
  width: 'min(480px, 92vw)',
  maxHeight: '92vh',
  overflowY: 'auto',
  background: 'var(--bg-elevated, #161616)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 8,
};
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '14px 18px',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
};
const titleStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.18em',
  color: 'var(--ink-90)',
};
const closeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--ink-60)',
  fontSize: 12,
  cursor: 'pointer',
  padding: 4,
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 6,
  color: 'var(--ink-90)',
  fontSize: 13,
  outline: 'none',
};
const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: 'none',
  cursor: 'pointer',
};
const suggestStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  left: 0,
  right: 0,
  background: 'var(--bg-elevated, #161616)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 6,
  zIndex: 5,
  display: 'flex',
  flexDirection: 'column',
  maxHeight: 220,
  overflowY: 'auto',
};
const suggestItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 10px',
  background: 'transparent',
  border: 'none',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  textAlign: 'left',
  cursor: 'pointer',
  fontSize: 13,
  color: 'var(--ink-90)',
};
const errStyle: React.CSSProperties = {
  color: '#e89090',
  fontSize: 12,
  background: 'rgba(255,80,80,0.08)',
  padding: '6px 10px',
  borderRadius: 6,
};
const primaryBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  background: 'var(--ink-90)',
  color: '#000',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
};
const secondaryBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  background: 'transparent',
  color: 'var(--ink-60)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
};
