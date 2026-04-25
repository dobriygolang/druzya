// StandupOverlay — daily standup как floating-карточка поверх HomePage,
// не модалка-blocker. Въезжает снизу (slide-from-bottom) над dock'ом.
//
// UX: tab-flow yesterday → today → blockers → submit; ⌘↵ submit;
// Esc / Cancel закрывают. Mutually exclusive со Stats overlay
// (см. App.tsx — opening either closes the other).
import { useEffect, useRef, useState } from 'react';
import { ConnectError } from '@connectrpc/connect';

import { recordStandup } from '../api/hone';

interface StandupOverlayProps {
  onClose: () => void;
}

export function StandupOverlay({ onClose }: StandupOverlayProps) {
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
      void submit();
    }
  };

  return (
    <div
      className="slide-from-bottom"
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 110,
        transform: 'translateX(-50%)',
        width: 460,
        maxWidth: '92%',
        padding: '20px 22px 18px',
        background: 'rgba(10,10,10,0.92)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 14,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: '0 30px 80px -20px rgba(0,0,0,0.7)',
        zIndex: 14,
      }}
    >
      <div
        className="mono"
        style={{ fontSize: 9.5, letterSpacing: '.22em', color: 'var(--ink-40)' }}
      >
        DAILY STANDUP
      </div>
      <h2
        style={{
          margin: '6px 0 16px',
          fontSize: 17,
          fontWeight: 400,
          letterSpacing: '-0.01em',
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
      <Field label="Today" value={today} onChange={setToday} onKeyDown={onKey} disabled={submitting} />
      <Field
        label="Blockers"
        value={blockers}
        onChange={setBlockers}
        onKeyDown={onKey}
        disabled={submitting}
      />

      {error && (
        <p className="mono" style={{ marginTop: 8, fontSize: 10.5, color: 'var(--ink-40)' }}>
          {error}
        </p>
      )}

      <div
        style={{
          marginTop: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span
          className="mono"
          style={{ fontSize: 9.5, letterSpacing: '.14em', color: 'var(--ink-40)' }}
        >
          ⌘↵ TO SAVE
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onClose}
            disabled={submitting}
            className="focus-ring mono surface"
            style={{
              padding: '6px 12px',
              fontSize: 10.5,
              letterSpacing: '.1em',
              color: 'var(--ink-60)',
              borderRadius: 6,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            CANCEL
          </button>
          <button
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="focus-ring surface lift"
            style={{
              padding: '7px 16px',
              fontSize: 12.5,
              fontWeight: 500,
              borderRadius: 999,
              background: canSubmit ? '#fff' : 'rgba(255,255,255,0.08)',
              color: canSubmit ? '#000' : 'var(--ink-60)',
              border: 'none',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {submitting ? 'Saving…' : 'Save standup'}
          </button>
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
    <label style={{ display: 'block', marginBottom: 10 }}>
      <span
        className="mono"
        style={{
          display: 'block',
          fontSize: 9.5,
          letterSpacing: '.18em',
          color: 'var(--ink-40)',
          marginBottom: 4,
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
          fontSize: 13,
          lineHeight: 1.5,
          padding: '6px 0',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          resize: 'none',
        }}
      />
    </label>
  );
}
