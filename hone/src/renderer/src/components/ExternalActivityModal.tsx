// ExternalActivityModal — structured form для логирования внешних занятий
// (LeetCode / Coursera / YouTube / книги). НЕ чат: явная associarion с
import { useEffect, useRef, useState } from 'react';

import { useT } from '@d9-i18n';

import {
  addExternalActivity,
  getExternalSources,
  searchAtlasTopics,
  type AtlasTopicSuggestion,
  type ExternalSource,
} from '../api/external';
import { Modal } from './primitives/Modal';
import { motion as motionTokens } from '../lib/design-tokens';

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
  const t = useT();
  const [open, setOpen] = useState(true);
  const [source, setSource] = useState<ExternalSource>('leetcode');
  const [topic, setTopic] = useState<TopicSelection>({ atlasNodeId: '', text: '' });
  const [suggestions, setSuggestions] = useState<AtlasTopicSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [duration, setDuration] = useState(30);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  // Smooth exit: flip open → Modal exit anim → parent unmounts.
  function close() {
    setOpen(false);
    window.setTimeout(onClose, motionTokens.dur.medium);
  }

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

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!topic.text.trim()) {
      setError(t('hone.external.err.topic_required'));
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
      // Smooth exit + parent callback. onSaved triggers parent UI refresh.
      setOpen(false);
      window.setTimeout(() => {
        onSaved();
      }, motionTokens.dur.medium);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={close} size="md">
      <header style={headerStyle}>
        <span className="mono" style={titleStyle}>
          + ВНЕШНЕЕ ЗАНЯТИЕ
        </span>
      </header>
      <form onSubmit={onSubmit} style={{ paddingTop: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label={t('hone.external.field.source')}>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as ExternalSource)}
            style={selectStyle}
            disabled={busy}
            aria-label={t('hone.external.field.source')}
          >
            {getExternalSources().map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('hone.external.field.topic')}>
          <div style={{ position: 'relative' }}>
            <input
              value={topic.text}
              onChange={(e) => setTopic({ atlasNodeId: '', text: e.target.value })}
              onFocus={(e) => {
                setShowSuggestions(true);
                e.currentTarget.style.borderBottomColor = 'var(--ink)';
              }}
              onBlur={(e) => {
                window.setTimeout(() => setShowSuggestions(false), 120);
                e.currentTarget.style.borderBottomColor = 'var(--hair-2)';
              }}
              placeholder={t('hone.external.field.topic_placeholder')}
              style={inputStyle}
              disabled={busy}
              aria-label={t('hone.external.field.topic')}
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
                    <span className="mono" style={{ fontSize: 10, color: 'var(--ink-40)', letterSpacing: '0.08em' }}>
                      {s.section}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {topic.atlasNodeId && (
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-60)' }}>
                {t('hone.external.atlas_pinned_hint')}
              </div>
            )}
          </div>
        </Field>

        <Field label={t('hone.external.field.minutes')}>
          <input
            type="number"
            value={duration}
            min={1}
            max={600}
            onChange={(e) => setDuration(Number(e.target.value))}
            onFocus={(e) => (e.currentTarget.style.borderBottomColor = 'var(--ink)')}
            onBlur={(e) => (e.currentTarget.style.borderBottomColor = 'var(--hair-2)')}
            style={{ ...inputStyle, maxWidth: 120 }}
            disabled={busy}
            aria-label={t('hone.external.field.minutes')}
          />
        </Field>

        <Field label={t('hone.external.field.note')}>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onFocus={(e) => (e.currentTarget.style.borderBottomColor = 'var(--ink)')}
            onBlur={(e) => (e.currentTarget.style.borderBottomColor = 'var(--hair-2)')}
            rows={3}
            placeholder={t('hone.external.field.note_placeholder')}
            style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
            disabled={busy}
            aria-label={t('hone.external.field.note')}
          />
        </Field>

        {error && (
          <div style={errStyle}>
            <span aria-hidden="true" style={{ display: 'inline-block', width: 24, height: 1.5, background: 'var(--red)', marginTop: 6, flex: '0 0 auto' }} />
            <span>{error}</span>
          </div>
        )}

        <div className="flex-wrap-row" style={{ justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="mono focus-ring motion-press"
            style={secondaryBtnStyle}
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={busy}
            className="focus-ring motion-press"
            style={primaryBtnStyle}
          >
            {busy ? t('hone.external.cta.saving') : t('hone.external.cta.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="mono" style={{ fontSize: 10, letterSpacing: '0.08em', color: 'var(--ink-40)', textTransform: 'uppercase' }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingBottom: 14,
  borderBottom: '1px solid var(--hair)',
};
const titleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-60)',
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 0',
  background: 'transparent',
  border: 0,
  borderBottom: '1px solid var(--hair-2)',
  color: 'var(--ink)',
  fontSize: 14,
  outline: 'none',
  transition: 'border-color var(--motion-dur-small) var(--motion-ease-decelerate)',
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
  background: 'var(--surface)',
  border: '1px solid var(--hair-2)',
  borderRadius: 'var(--radius-inner)',
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
  padding: '8px 12px',
  background: 'transparent',
  border: 0,
  borderBottom: '1px solid var(--hair)',
  textAlign: 'left',
  cursor: 'pointer',
  fontSize: 13,
  color: 'var(--ink-90)',
};
const errStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  color: 'var(--red)',
  fontSize: 12,
};
const primaryBtnStyle: React.CSSProperties = {
  padding: '8px 18px',
  background: 'var(--ink)',
  color: 'var(--surface)',
  border: 0,
  borderRadius: 'var(--radius-inner)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};
const secondaryBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  background: 'transparent',
  color: 'var(--ink-60)',
  border: '1px solid var(--hair-2)',
  borderRadius: 'var(--radius-inner)',
  cursor: 'pointer',
  fontSize: 13,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};
