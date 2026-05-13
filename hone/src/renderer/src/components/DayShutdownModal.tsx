// DayShutdownModal — Phase K Wave 15 end-of-day shutdown ritual.
//
// Single modal with 3 textareas (done / pending / tomorrow). Submit →
// SubmitDayShutdown RPC, success closes the modal.
//
// Opens when:
//   1. Main process notification fires at the configured time (21:00
//      default) and the user clicks it → main emits `day-shutdown:open-modal`
//      IPC event → renderer App-level listener flips `open=true`.
//   2. User manually triggers via Palette (⌘K → «Закрыть день»).
//
// Prefill: if `getTodayShutdown.recorded` is true (юзер уже сегодня
// заполнял), модалка открывается с уже введёнными значениями — это
// поведение «обновить запись», не «начать заново».

import { useEffect, useState } from 'react';

import { submitDayShutdown, getTodayShutdown, type DayShutdown } from '../api/hone';

interface DayShutdownModalProps {
  open: boolean;
  onClose: () => void;
}

const PROMPT_DONE = 'Что сделал сегодня?';
const PROMPT_PENDING = 'Что не успел / висит?';
const PROMPT_TOMORROW = 'Что важно на завтра?';

export function DayShutdownModal({ open, onClose }: DayShutdownModalProps) {
  const [done, setDone] = useState('');
  const [pending, setPending] = useState('');
  const [tomorrow, setTomorrow] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState<DayShutdown | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Prefill from today's existing entry (if any).
    void getTodayShutdown()
      .then((snap) => {
        if (cancelled) return;
        if (snap.recorded && snap.shutdown) {
          setPrefilled(snap.shutdown);
          setDone(snap.shutdown.done);
          setPending(snap.shutdown.pending);
          setTomorrow(snap.shutdown.tomorrow);
        }
      })
      .catch(() => {
        /* prefill is best-effort; new entry path still works */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Esc closes; do NOT auto-submit on Enter (textarea needs Enter for newlines).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!submitting) onClose();
      }
      // ⌘Enter / Ctrl+Enter — quick submit.
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !submitting) {
        e.preventDefault();
        void handleSubmit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, submitting]);

  const handleSubmit = async () => {
    const d = done.trim();
    const p = pending.trim();
    const t = tomorrow.trim();
    if (!d && !p && !t) {
      setError('Заполни хотя бы одно поле.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      // Local YYYY-MM-DD so 23:55 entries land on today, not UTC tomorrow.
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      await submitDayShutdown({
        shutdownDate: `${yyyy}-${mm}-${dd}`,
        done: d,
        pending: p,
        tomorrow: t,
      });
      // Reset + close.
      setDone('');
      setPending('');
      setTomorrow('');
      setPrefilled(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Завершение дня"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 560,
          background: 'var(--bg-card, #0a0a0c)',
          border: '1px solid var(--ink-10)',
          borderRadius: 12,
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          color: 'var(--ink-90)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>
            Заверши день
          </h2>
          <span
            className="mono"
            style={{
              fontSize: 11,
              color: 'var(--ink-40)',
              letterSpacing: '0.04em',
            }}
          >
            {prefilled ? 'обновляем запись' : '60 секунд'}
          </span>
        </div>

        <Field
          label={PROMPT_DONE}
          value={done}
          onChange={setDone}
          autoFocus
          disabled={submitting}
        />
        <Field label={PROMPT_PENDING} value={pending} onChange={setPending} disabled={submitting} />
        <Field
          label={PROMPT_TOMORROW}
          value={tomorrow}
          onChange={setTomorrow}
          disabled={submitting}
        />

        {error && (
          <div
            className="mono"
            style={{
              fontSize: 11.5,
              color: 'var(--red, #ff3b30)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: 'inline-block',
                width: 24,
                height: 1.5,
                background: 'var(--red, #ff3b30)',
                marginTop: 5,
                flex: '0 0 auto',
              }}
            />
            <span>{error}</span>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="focus-ring"
            style={{
              padding: '8px 16px',
              fontSize: 12,
              background: 'transparent',
              border: '1px solid var(--ink-10)',
              borderRadius: 8,
              color: 'var(--ink-60)',
              cursor: submitting ? 'default' : 'pointer',
              fontFamily: 'inherit',
              letterSpacing: '0.04em',
            }}
          >
            Позже
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className="focus-ring"
            style={{
              padding: '8px 16px',
              fontSize: 12,
              background: '#ffffff',
              border: '1px solid #ffffff',
              borderRadius: 8,
              color: '#000000',
              cursor: submitting ? 'default' : 'pointer',
              fontFamily: 'inherit',
              letterSpacing: '0.04em',
              fontWeight: 500,
            }}
          >
            {submitting ? 'Сохраняю…' : prefilled ? 'Обновить' : 'Сохранить'}
            <span style={{ opacity: 0.6, marginLeft: 8 }}>⌘↵</span>
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
  autoFocus?: boolean;
  disabled?: boolean;
}

function Field({ label, value, onChange, autoFocus, disabled }: FieldProps) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span
        className="mono"
        style={{
          fontSize: 10.5,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--ink-40)',
        }}
      >
        {label}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        disabled={disabled}
        rows={2}
        className="focus-ring"
        spellCheck={false}
        style={{
          width: '100%',
          padding: '10px 12px',
          fontSize: 14,
          lineHeight: 1.5,
          background: 'transparent',
          border: '1px solid var(--ink-10)',
          borderRadius: 8,
          color: 'var(--ink-90)',
          outline: 'none',
          resize: 'vertical',
          minHeight: 56,
          fontFamily: 'inherit',
        }}
      />
    </label>
  );
}
