// AudioPlayer — Phase J / H4 Speaking surface audio player.
//
// Two flavors live here:
//   • <AudioPlayer src="...">   — plays a backend-served TTS asset (audio_url).
//   • <BlobPlayer blob={blob}>  — plays the local user-recording Blob.
//
// Both wrap a hidden <audio>; surface UI is play/replay + speed picker
// (0.75 / 1 / 1.25). 0.75 is useful for shadowing — slow down the
// reference before mimicking.
//
// TTS fallback: when src is empty, we use window.speechSynthesis для
// reading the prompt text aloud (cross-OS available, no API key). Quality
// is uneven but the alternative is silent. The `prompt` prop drives the
// fallback; UI shows the same play button.
//
// 2026-05-12: B/W only. Speed chip is hairline-bordered pill.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const SPEEDS = [0.75, 1, 1.25] as const;
type Speed = (typeof SPEEDS)[number];

const monoFont = "'JetBrains Mono', ui-monospace, monospace";

interface CommonProps {
  /** Optional: render compact (icon-only). Default = labelled. */
  compact?: boolean;
  /** Disable controls (e.g. during grading). */
  disabled?: boolean;
}

interface AudioPlayerProps extends CommonProps {
  src: string;
  /** Fallback text to speak via window.speechSynthesis when src is empty. */
  prompt?: string;
}

export function AudioPlayer({ src, prompt = '', compact = false, disabled = false }: AudioPlayerProps) {
  const [speed, setSpeed] = useState<Speed>(1);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ssuRef = useRef<SpeechSynthesisUtterance | null>(null);

  const hasSrc = src.trim() !== '';
  const ttsAvailable = !hasSrc && typeof window !== 'undefined' && 'speechSynthesis' in window && prompt.trim() !== '';

  useEffect(() => {
    return () => {
      // Cancel any in-flight TTS utterance on unmount.
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* speechSynthesis may be unavailable */
      }
    };
  }, []);

  const handlePlay = useCallback(() => {
    if (disabled) return;
    if (hasSrc) {
      const el = audioRef.current;
      if (!el) return;
      el.playbackRate = speed;
      el.currentTime = 0;
      void el.play();
      setPlaying(true);
    } else if (ttsAvailable) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
      const ssu = new SpeechSynthesisUtterance(prompt);
      ssu.lang = 'en-US';
      ssu.rate = speed;
      ssu.onend = () => setPlaying(false);
      ssu.onerror = () => setPlaying(false);
      ssuRef.current = ssu;
      window.speechSynthesis.speak(ssu);
      setPlaying(true);
    }
  }, [disabled, hasSrc, ttsAvailable, prompt, speed]);

  const stop = useCallback(() => {
    if (hasSrc) {
      audioRef.current?.pause();
    } else {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
    }
    setPlaying(false);
  }, [hasSrc]);

  const cycleSpeed = useCallback(() => {
    const idx = SPEEDS.indexOf(speed);
    const next = SPEEDS[(idx + 1) % SPEEDS.length] ?? 1;
    setSpeed(next);
    // Apply live if audio is currently playing.
    if (hasSrc && audioRef.current) {
      audioRef.current.playbackRate = next;
    }
  }, [speed, hasSrc]);

  const canPlay = hasSrc || ttsAvailable;

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button
        type="button"
        onClick={playing ? stop : handlePlay}
        disabled={disabled || !canPlay}
        className="focus-ring motion-press"
        style={playButtonStyle(disabled || !canPlay)}
        aria-label={playing ? 'Stop playback' : 'Play reference audio'}
      >
        {playing ? StopIcon() : PlayIcon()}
        {!compact && (
          <span style={{ marginLeft: 6, fontSize: 12 }}>{playing ? 'Stop' : 'Listen'}</span>
        )}
      </button>
      <button
        type="button"
        onClick={cycleSpeed}
        disabled={disabled || !canPlay}
        className="focus-ring motion-press"
        style={speedChipStyle(disabled || !canPlay)}
        aria-label={`Playback speed ${speed}×`}
        title="Cycle playback speed"
      >
        <span style={{ fontFamily: monoFont, fontSize: 10, letterSpacing: '0.04em' }}>
          {speed === 1 ? '1×' : `${speed}×`}
        </span>
      </button>
      {hasSrc && (
        <audio
          ref={audioRef}
          src={src}
          onEnded={() => setPlaying(false)}
          preload="auto"
          style={{ display: 'none' }}
        />
      )}
    </div>
  );
}

interface BlobPlayerProps extends CommonProps {
  blob: Blob | null;
}

export function BlobPlayer({ blob, compact = false, disabled = false }: BlobPlayerProps) {
  const objectUrl = useMemo(() => (blob ? URL.createObjectURL(blob) : ''), [blob]);
  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);
  if (!blob) {
    return null;
  }
  return <AudioPlayer src={objectUrl} compact={compact} disabled={disabled} />;
}

function playButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '6px 12px',
    background: 'transparent',
    color: 'var(--ink)',
    border: '1px solid var(--hair-2)',
    borderRadius: 999,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    fontSize: 12,
    transition:
      'background-color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
  };
}

function speedChipStyle(disabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4px 10px',
    background: 'transparent',
    color: 'var(--ink-60)',
    border: '1px solid var(--hair)',
    borderRadius: 999,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    transition:
      'background-color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
  };
}

function PlayIcon(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M3 2 L10 6 L3 10 Z" fill="currentColor" />
    </svg>
  );
}

function StopIcon(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <rect x="3" y="3" width="6" height="6" fill="currentColor" />
    </svg>
  );
}
