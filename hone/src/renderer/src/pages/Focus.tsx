// Focus — lifecycle-owning версия focus-page. Создаёт сессию в бекенде
// при маунте, держит её id в локальном стейте, шлёт EndFocusSession с
// опциональным reflection текстом при выходе.
//
// Почему session-state живёт здесь, а не в App: App уже знает про timer +
// running, но session id релевантен только внутри Focus'а и не нужен
// остальным страницам. Держим ближе к месту использования; App уводит
// пользователя из focus'а через onEnd callback (флаг running + remain
// сбрасывает сам App).
//
// Reflection — опциональная модалка «what did you do». На submit (или
// Skip) отправляем EndFocusSession и вызываем onEnd. Пустая строка — OK:
// бэкенд интерпретирует пустой reflection как «reflection не пишем».
import { useEffect, useRef, useState } from 'react';
import { ConnectError } from '@connectrpc/connect';

import { Kbd } from '../components/primitives/Kbd';
import { startFocusSession, endFocusSession, type FocusSession } from '../api/hone';

interface FocusPageProps {
  remain: number; // seconds ticking down, owned by App
  pomodoroSeconds: number; // Total seconds per pomodoro
  planItemId?: string;
  pinnedTitle?: string;
  // Called after EndFocusSession resolves (or after the user skips reflection).
  // App listens and returns user to home + resets the timer.
  onEnd: () => void;
  // Called when the user explicitly stops (S) — App uses this to stop
  // ticking immediately so secondsFocused is captured accurately.
  onStopTick: () => void;
  // Flag telling us the user hit "S" at App-level — triggers reflection
  // modal.
  stopRequested: boolean;
}

export function FocusPage({
  remain,
  pomodoroSeconds,
  planItemId,
  pinnedTitle,
  onEnd,
  onStopTick,
  stopRequested,
}: FocusPageProps) {
  const [session, setSession] = useState<FocusSession | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [showReflection, setShowReflection] = useState(false);
  const [reflection, setReflection] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Guard: useEffect в Strict Mode вызывается дважды на dev-mount —
  // без этой защиты мы бы делали два StartFocusSession. Ref не триггерит
  // re-render, оставляет эффект чистым.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    startFocusSession({
      planItemId,
      pinnedTitle,
      mode: 'pomodoro',
    })
      .then((s) => setSession(s))
      .catch((err: unknown) => {
        const ce = ConnectError.from(err);
        setStartError(ce.rawMessage || ce.message);
      });
  }, [planItemId, pinnedTitle]);

  // Когда App сообщает "stopRequested" — открываем reflection modal.
  // Auto-end по remain===0 тоже идёт через этот путь (App выставит флаг).
  useEffect(() => {
    if (stopRequested && session && !showReflection && !submitting) {
      onStopTick();
      setShowReflection(true);
    }
  }, [stopRequested, session, showReflection, submitting, onStopTick]);

  const secondsFocused = Math.max(0, pomodoroSeconds - remain);

  const handleSubmit = async (withReflection: boolean) => {
    if (!session) {
      onEnd();
      return;
    }
    setSubmitting(true);
    try {
      await endFocusSession({
        sessionId: session.id,
        pomodorosCompleted: remain === 0 ? 1 : 0,
        secondsFocused,
        reflection: withReflection ? reflection.trim() : '',
      });
    } catch {
      // не фейлим UI — сессия уже длилась, пользователю неважно.
    } finally {
      setSubmitting(false);
      onEnd();
    }
  };

  const mm = String(Math.floor(remain / 60)).padStart(2, '0');
  const ss = String(remain % 60).padStart(2, '0');
  const display = pinnedTitle || session?.pinnedTitle || 'Focus session';

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 36,
      }}
    >
      <div
        className="mono"
        style={{ fontSize: 11, letterSpacing: '0.24em', color: 'var(--ink-40)' }}
      >
        FOCUSING ON
      </div>
      <div style={{ fontSize: 15, color: 'var(--ink-90)', marginTop: -18, textAlign: 'center', maxWidth: '80%' }}>
        {display}
      </div>
      <div
        className="mono"
        style={{
          fontSize: 'clamp(120px, 18vw, 220px)',
          fontWeight: 200,
          letterSpacing: '-0.04em',
          color: 'var(--ink)',
          lineHeight: 1,
        }}
      >
        {mm}
        <span style={{ color: 'var(--ink-40)' }}>:</span>
        {ss}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span
          className="mono"
          style={{ fontSize: 11, color: 'var(--ink-40)', letterSpacing: '0.22em' }}
        >
          POMODORO 1 / 4
        </span>
        {session && (
          <>
            <span
              style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--red)' }}
              className="red-pulse"
            />
            <span
              className="mono"
              style={{ fontSize: 11, color: 'var(--red)', letterSpacing: '0.22em' }}
            >
              LIVE
            </span>
          </>
        )}
      </div>

      {startError && (
        <div
          className="mono"
          style={{ fontSize: 11, color: 'var(--ink-40)', marginTop: -12 }}
        >
          Session not persisted: {startError}
        </div>
      )}

      <div
        className="mono no-select"
        style={{
          position: 'absolute',
          bottom: 44,
          fontSize: 11,
          color: 'var(--ink-40)',
          letterSpacing: '0.04em',
        }}
      >
        <Kbd>␣</Kbd> pause <span style={{ opacity: 0.4, padding: '0 10px' }}>·</span>
        <Kbd>S</Kbd> stop <span style={{ opacity: 0.4, padding: '0 10px' }}>·</span>
        <Kbd>esc</Kbd> exit
      </div>

      {showReflection && (
        <ReflectionModal
          value={reflection}
          onChange={setReflection}
          onSubmit={() => handleSubmit(true)}
          onSkip={() => handleSubmit(false)}
          submitting={submitting}
          secondsFocused={secondsFocused}
        />
      )}
    </div>
  );
}

interface ReflectionModalProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onSkip: () => void;
  submitting: boolean;
  secondsFocused: number;
}

function ReflectionModal({
  value,
  onChange,
  onSubmit,
  onSkip,
  submitting,
  secondsFocused,
}: ReflectionModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const mins = Math.round(secondsFocused / 60);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !submitting) {
      e.preventDefault();
      if (value.trim()) onSubmit();
      else onSkip();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onSkip();
    }
  };

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 70,
        background: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(16px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: 520,
          maxWidth: '90%',
          padding: '40px 36px',
          background: 'rgba(8,8,8,0.94)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 14,
        }}
      >
        <div
          className="mono"
          style={{ fontSize: 10, letterSpacing: '.24em', color: 'var(--ink-40)' }}
        >
          {mins} MIN FOCUSED
        </div>
        <h2 style={{ margin: '16px 0 24px', fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em' }}>
          What did you do?
        </h2>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
          placeholder="One line, optional."
          disabled={submitting}
          style={{
            width: '100%',
            fontSize: 15,
            color: 'var(--ink)',
            padding: '10px 0',
            borderBottom: '1px solid rgba(255,255,255,0.15)',
            background: 'transparent',
          }}
        />
        <div
          style={{
            marginTop: 24,
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            justifyContent: 'flex-end',
          }}
        >
          <button
            onClick={onSkip}
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
            SKIP
          </button>
          <button
            onClick={onSubmit}
            disabled={submitting || !value.trim()}
            className="focus-ring"
            style={{
              padding: '9px 18px',
              fontSize: 13,
              fontWeight: 500,
              borderRadius: 999,
              background: value.trim() && !submitting ? '#fff' : 'rgba(255,255,255,0.08)',
              color: value.trim() && !submitting ? '#000' : 'var(--ink-60)',
            }}
          >
            {submitting ? 'Saving…' : 'Save note ↵'}
          </button>
        </div>
      </div>
    </div>
  );
}
