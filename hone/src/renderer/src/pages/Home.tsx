// Home — landing page. Минималистичная: CanvasBg + Dock несут UI.
//
// После Focus refactor (apr 2026) Home получает три тонких overlay'а:
//   1. Pinned-task — подсказка «Working on …» если есть привязка из Today
//   2. Soft-timer — большой mm:ss в центре когда running, без агрессии
//      (не red, не pulsate); если не running — пусто как раньше
//   3. Reflection-prompt — после auto-end таймера, inline в нижнем правом
//      углу, не модалка-блокер
import { useEffect, useRef, useState } from 'react';

interface ReflectionPrompt {
  sessionId: string;
  secondsFocused: number;
  pomodorosCompleted: number;
}

interface HomePageProps {
  running: boolean;
  remain: number;
  pinnedTitle: string | null;
  reflectionPrompt: ReflectionPrompt | null;
  onStop: () => void;
  onSubmitReflection: (text: string) => void | Promise<void>;
  onDismissReflection: () => void;
}

export function HomePage({
  running,
  remain,
  pinnedTitle,
  reflectionPrompt,
  onStop,
  onSubmitReflection,
  onDismissReflection,
}: HomePageProps) {
  const mm = String(Math.floor(remain / 60)).padStart(2, '0');
  const ss = String(remain % 60).padStart(2, '0');

  return (
    <>
      {pinnedTitle && (running || remain < 25 * 60) && (
        <div
          className="mono fadein"
          style={{
            position: 'absolute',
            top: 100,
            left: 0,
            right: 0,
            textAlign: 'center',
            fontSize: 11,
            letterSpacing: '0.18em',
            color: 'var(--ink-40)',
          }}
        >
          WORKING ON · {pinnedTitle.toUpperCase()}
        </div>
      )}

      {running && (
        <div
          className="fadein"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 'clamp(96px, 14vw, 180px)',
              fontWeight: 200,
              letterSpacing: '-0.04em',
              color: 'var(--ink-90)',
              lineHeight: 1,
            }}
          >
            {mm}
            <span style={{ color: 'var(--ink-40)' }}>:</span>
            {ss}
          </div>
        </div>
      )}

      {running && (
        <button
          onClick={onStop}
          className="focus-ring mono"
          style={{
            position: 'absolute',
            bottom: 100,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '7px 16px',
            fontSize: 10,
            letterSpacing: '0.18em',
            color: 'var(--ink-40)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 999,
            background: 'transparent',
          }}
        >
          STOP
        </button>
      )}

      {reflectionPrompt && (
        <ReflectionInline
          prompt={reflectionPrompt}
          onSubmit={onSubmitReflection}
          onDismiss={onDismissReflection}
        />
      )}
    </>
  );
}

function ReflectionInline({
  prompt,
  onSubmit,
  onDismiss,
}: {
  prompt: ReflectionPrompt;
  onSubmit: (text: string) => void | Promise<void>;
  onDismiss: () => void;
}) {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    setSubmitting(true);
    try {
      await onSubmit(value);
    } finally {
      setSubmitting(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !submitting) {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onDismiss();
    }
  };

  const mins = Math.round(prompt.secondsFocused / 60);

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        bottom: 100,
        right: 32,
        width: 360,
        padding: '16px 18px',
        background: 'rgba(8,8,8,0.92)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        backdropFilter: 'blur(14px)',
      }}
    >
      <div
        className="mono"
        style={{ fontSize: 10, letterSpacing: '0.22em', color: 'var(--ink-40)' }}
      >
        {mins} MIN DONE · OPTIONAL NOTE
      </div>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKey}
        placeholder="What did you do?"
        disabled={submitting}
        style={{
          marginTop: 10,
          width: '100%',
          fontSize: 14,
          color: 'var(--ink)',
          padding: '6px 0',
          borderBottom: '1px solid rgba(255,255,255,0.12)',
          background: 'transparent',
        }}
      />
      <div
        style={{
          marginTop: 12,
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
        }}
      >
        <button
          onClick={onDismiss}
          disabled={submitting}
          className="mono"
          style={{
            padding: '5px 10px',
            fontSize: 10,
            letterSpacing: '0.14em',
            color: 'var(--ink-40)',
            background: 'transparent',
          }}
        >
          DISMISS
        </button>
        <button
          onClick={() => void submit()}
          disabled={submitting || !value.trim()}
          className="focus-ring mono"
          style={{
            padding: '5px 12px',
            fontSize: 10,
            letterSpacing: '0.14em',
            color: value.trim() ? 'var(--ink)' : 'var(--ink-40)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 999,
            background: 'transparent',
          }}
        >
          {submitting ? '…' : 'SAVE ↵'}
        </button>
      </div>
    </div>
  );
}
