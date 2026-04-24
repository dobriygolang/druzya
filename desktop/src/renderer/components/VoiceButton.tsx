// Mic / Stop button that wraps useVoice. Tri-state visual:
//   idle       — neutral mic icon
//   recording  — red dot + elapsed seconds (click to stop)
//   transcribing — animated caret + "…"
// Errors toast inline in the caller via `onError`.

import { useEffect, useRef } from 'react';

import { useVoice } from '../hooks/use-voice';
import { IconMic } from './icons';
import { IconButton, StatusDot } from './primitives';

export interface VoiceButtonProps {
  /** Called when transcription completes successfully. */
  onTranscript: (text: string) => void;
  onError?: (msg: string) => void;
  /** Fired from a global hotkey (voice_input) — toggles start/stop. */
  hotkeyToggle?: number;
}

export function VoiceButton({ onTranscript, onError, hotkeyToggle }: VoiceButtonProps) {
  const voice = useVoice(onTranscript);

  // Surface errors upstream then reset so the user can try again.
  useEffect(() => {
    if (voice.state === 'error' && voice.error && onError) onError(voice.error);
  }, [voice.state, voice.error, onError]);

  // Hotkey toggle — parent increments a counter on each fire. Track the
  // last seen value in a ref so we only react when it actually changes.
  // Using a ref (not didMount) survives StrictMode's effect double-invoke
  // and any re-renders caused by other prop changes.
  const lastToggleRef = useRef(hotkeyToggle);
  useEffect(() => {
    if (hotkeyToggle === undefined) return;
    if (lastToggleRef.current === hotkeyToggle) return;
    lastToggleRef.current = hotkeyToggle;
    if (voice.state === 'idle') void voice.start();
    else if (voice.state === 'recording') void voice.stop();
    // transcribing / error — ignore the hotkey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotkeyToggle]);

  if (voice.state === 'recording') {
    return (
      <button
        onClick={() => void voice.stop()}
        title="Остановить запись"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: 28,
          padding: '0 10px',
          background: 'rgba(255, 69, 58, 0.14)',
          color: 'var(--d-red)',
          border: '1px solid rgba(255, 69, 58, 0.45)',
          borderRadius: 'var(--r-btn)',
          fontSize: 11,
          fontFamily: 'var(--f-mono)',
          cursor: 'pointer',
        }}
      >
        <StatusDot state="recording" size={6} />
        {voice.elapsed.toFixed(1)}s
      </button>
    );
  }

  if (voice.state === 'transcribing') {
    return (
      <button
        disabled
        title="Распознаём…"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: 28,
          padding: '0 10px',
          background: 'var(--d-accent-soft)',
          color: 'var(--d-accent)',
          border: '1px solid var(--d-line)',
          borderRadius: 'var(--r-btn)',
          fontSize: 11,
          fontFamily: 'var(--f-mono)',
          cursor: 'default',
        }}
      >
        <StatusDot state="thinking" size={6} />
        транскрипция…
      </button>
    );
  }

  return (
    <IconButton
      title="Голос (⌘⇧V)"
      onClick={() => void voice.start()}
    >
      <IconMic size={15} />
    </IconButton>
  );
}
