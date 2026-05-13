// Combined voice-capture trigger sitting in the expanded header. Pops a
// menu with two independent source toggles (system audio, mic). Stealth
// sensitive: starting/stopping native audio capture and gating it behind
// the consent prompt.

import { useEffect, useRef, useState } from 'react';

import { useAudioCaptureStore } from '../../../stores/audio-capture';
import { useCoachStore } from '../../../stores/coach';
import { hasVoiceConsent, requestVoiceConsent } from '../lib/voiceConsent';

/**
 * VoiceToggleCombined — single combined trigger вместо двух отдельных
 * кнопок (system/mic). Click открывает popover с двумя radio-style
 * row'ами. Обе source'а независимы, могут быть оба ON одновременно.
 * Compact UX: 90% юзеров используют один source, две отдельных
 * кнопки confused «какую нажать».
 */
export function VoiceToggleCombined() {
  const sysState = useAudioCaptureStore((s) => s.system.state);
  const micState = useAudioCaptureStore((s) => s.mic.state);
  const sysStartedAt = useAudioCaptureStore((s) => s.system.startedAt);
  const micStartedAt = useAudioCaptureStore((s) => s.mic.startedAt);
  const available = useAudioCaptureStore((s) => s.available);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const anyActive = sysState === 'running' || sysState === 'starting'
    || micState === 'running' || micState === 'starting';
  useEffect(() => {
    if (!anyActive) return;
    const h = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(h);
  }, [anyActive]);

  if (!available) return null;

  const earliest = (() => {
    const ts: number[] = [];
    if (sysStartedAt) ts.push(sysStartedAt);
    if (micStartedAt) ts.push(micStartedAt);
    return ts.length ? Math.min(...ts) : null;
  })();
  const elapsed = earliest ? Math.max(0, Math.floor((Date.now() - earliest) / 1000)) : 0;
  const mm = Math.floor(elapsed / 60);
  const ss = elapsed % 60;
  const elapsedLabel = `${mm}:${ss.toString().padStart(2, '0')}`;
  const label = anyActive ? `● ${elapsedLabel}` : 'Слушать';

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        title={anyActive ? 'Управление voice capture' : 'Включить транскрипцию'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-pressed={anyActive}
        style={{
          padding: '4px 10px',
          marginRight: 4,
          borderRadius: 7,
          background: anyActive ? 'rgba(255, 59, 48, 0.15)' : 'rgba(255, 255, 255, 0.04)',
          border: `0.5px solid ${anyActive ? 'rgba(255, 59, 48, 0.5)' : 'var(--d9-hairline)'}`,
          color: anyActive ? 'var(--d9-accent)' : 'var(--d9-ink-mute)',
          fontSize: 11.5,
          fontFamily: anyActive ? 'var(--d9-font-mono)' : 'inherit',
          letterSpacing: '-0.005em',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--gap-row)',
          transition:
            'background var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard)',
        }}
      >
        <span style={{ display: 'none' }}>{tick}</span>
        {label}
        <span style={{ fontSize: 8, color: anyActive ? 'rgba(255, 59, 48, 0.6)' : 'var(--d9-ink-ghost)' }}>▾</span>
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            marginTop: 4,
            minWidth: 240,
            background: 'rgba(20, 20, 20, 0.96)',
            border: '0.5px solid var(--d9-hairline-b)',
            borderRadius: 8,
            backdropFilter: 'blur(12px)',
            boxShadow: '0 8px 24px -4px rgba(0,0,0,0.5)',
            padding: 4,
            zIndex: 1000,
          }}
        >
          <SourceMenuItem source="system" label="Системный звук" hint="Звонки, видео в браузере" onAction={() => setOpen(false)} />
          <SourceMenuItem source="mic" label="Микрофон" hint="Твой голос" onAction={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

function SourceMenuItem({
  source,
  label,
  hint,
  onAction,
}: {
  source: 'system' | 'mic';
  label: string;
  hint: string;
  onAction: () => void;
}) {
  const slice = useAudioCaptureStore((s) => (source === 'system' ? s.system : s.mic));
  const start = useAudioCaptureStore((s) => s.start);
  const stop = useAudioCaptureStore((s) => s.stop);
  const setCoachEnabled = useCoachStore((s) => s.setEnabled);
  const recording = slice.state === 'running';
  const busy = slice.state === 'starting' || slice.state === 'stopping';

  const beginListening = () => {
    if (source === 'system') void setCoachEnabled(true);
    void start(source);
  };

  const onClick = () => {
    if (busy) return;
    if (recording) {
      const other = source === 'system' ? useAudioCaptureStore.getState().mic : useAudioCaptureStore.getState().system;
      const otherActive = other.state === 'running' || other.state === 'starting';
      if (!otherActive && source === 'system') void setCoachEnabled(false);
      void stop(source);
      onAction();
      return;
    }
    if (!hasVoiceConsent()) {
      requestVoiceConsent(beginListening);
      onAction();
      return;
    }
    beginListening();
    onAction();
  };

  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={recording}
      onClick={onClick}
      disabled={busy}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '7px 10px',
        background: 'transparent',
        border: 0,
        color: 'var(--d9-ink)',
        textAlign: 'left',
        cursor: busy ? 'wait' : 'pointer',
        borderRadius: 4,
        fontFamily: 'inherit',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          flex: 'none',
          background: recording ? 'var(--d9-accent)' : 'transparent',
          border: recording ? 'none' : '1px solid var(--d9-ink-ghost)',
          animation: recording ? 'd9-pulse 1.4s ease-in-out infinite' : undefined,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--d9-ink)' }}>{label}</div>
        <div style={{ fontSize: 10, color: 'var(--d9-ink-mute)', letterSpacing: '-0.005em' }}>{hint}</div>
      </div>
      <span
        style={{
          fontSize: 10,
          fontFamily: 'var(--d9-font-mono)',
          color: recording ? 'var(--d9-accent)' : 'var(--d9-ink-ghost)',
        }}
      >
        {busy ? '…' : recording ? 'ON' : 'OFF'}
      </span>
    </button>
  );
}
