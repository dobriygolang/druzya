// StandupModal — три классических standup-вопроса в одной модалке. На
// submit зовём RecordStandup, бекенд создаёт Note + (best-effort) патчит
// сегодняшний Plan дополнительным custom item'ом.
//
// UI: tab-flow между полями (Tab перескакивает yesterday → today →
// blockers → submit), Enter в самом нижнем поле субмитит, Esc отменяет.
// Пустую запись бекенд отвергает (ErrInvalidInput), мы блокируем кнопку
// до тех пор пока хотя бы одно поле непустое.
import { useEffect, useRef, useState } from 'react';
import { ConnectError } from '@connectrpc/connect';

import { recordStandup } from '../api/hone';

interface StandupModalProps {
  onClose: () => void;
}

export function StandupModal({ onClose }: StandupModalProps) {
  const [yesterday, setYesterday] = useState('');
  const [today, setToday] = useState('');
  const [blockers, setBlockers] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const yRef = useRef<HTMLTextAreaElement>(null!);

  useEffect(() => {
    yRef.current?.focus();
  }, []);

  const canSubmit =
    !submitting && (yesterday.trim() !== '' || today.trim() !== '' || blockers.trim() !== '');

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await recordStandup({
        yesterday: yesterday.trim(),
        today: today.trim(),
        blockers: blockers.trim(),
      });
      onClose();
    } catch (err: unknown) {
      const ce = ConnectError.from(err);
      setError(ce.rawMessage || ce.message);
      setSubmitting(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 65,
        background: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(16px)',
        display: 'flex',
        justifyContent: 'center',
        paddingTop: '10vh',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxWidth: '90%',
          height: 'fit-content',
          padding: '36px 40px 32px',
          background: 'rgba(8,8,8,0.94)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 14,
        }}
      >
        <div
          className="mono"
          style={{ fontSize: 10, letterSpacing: '.24em', color: 'var(--ink-40)' }}
        >
          DAILY STANDUP
        </div>
        <h2
          style={{
            margin: '12px 0 28px',
            fontSize: 24,
            fontWeight: 400,
            letterSpacing: '-0.015em',
          }}
        >
          Three questions.
        </h2>

        <Field
          label="Yesterday"
          value={yesterday}
          onChange={setYesterday}
          inputRef={yRef}
          onKeyDown={onKey}
          disabled={submitting}
        />
        <Field
          label="Today"
          value={today}
          onChange={setToday}
          onKeyDown={onKey}
          disabled={submitting}
        />
        <Field
          label="Blockers"
          value={blockers}
          onChange={setBlockers}
          onKeyDown={onKey}
          disabled={submitting}
        />

        {error && (
          <p
            className="mono"
            style={{ marginTop: 12, fontSize: 11, color: 'var(--ink-40)' }}
          >
            {error}
          </p>
        )}

        <div
          style={{
            marginTop: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span
            className="mono"
            style={{ fontSize: 10, letterSpacing: '.12em', color: 'var(--ink-40)' }}
          >
            ⌘↵ TO SAVE
          </span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onClose}
              disabled={submitting}
              className="focus-ring mono"
              style={{
                padding: '8px 14px',
                fontSize: 11,
                letterSpacing: '.1em',
                color: 'var(--ink-60)',
                borderRadius: 8,
              }}
            >
              CANCEL
            </button>
            <button
              onClick={submit}
              disabled={!canSubmit}
              className="focus-ring"
              style={{
                padding: '9px 18px',
                fontSize: 13,
                fontWeight: 500,
                borderRadius: 999,
                background: canSubmit ? '#fff' : 'rgba(255,255,255,0.08)',
                color: canSubmit ? '#000' : 'var(--ink-60)',
              }}
            >
              {submitting ? 'Saving…' : 'Save standup'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  inputRef?: React.RefObject<HTMLTextAreaElement>;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  disabled?: boolean;
}

function Field({ label, value, onChange, inputRef, onKeyDown, disabled }: FieldProps) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span
        className="mono"
        style={{
          display: 'block',
          fontSize: 10,
          letterSpacing: '.18em',
          color: 'var(--ink-40)',
          marginBottom: 6,
        }}
      >
        {label.toUpperCase()}
      </span>
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        rows={2}
        style={{
          width: '100%',
          background: 'transparent',
          color: 'var(--ink)',
          fontSize: 14,
          lineHeight: 1.5,
          padding: '8px 0',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          resize: 'none',
        }}
      />
    </label>
  );
}
