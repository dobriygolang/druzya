// Click-to-record hotkey control. Replaces the read-only <Kbd> row in
// Settings → Горячие клавиши so users can rebind without editing a
// JSON file.
//
// Interaction:
//   click the pill → state: recording (red pulsing dot, "нажми клавиши")
//   press a chord (modifier + key) → state: idle, saves the override
//   press Escape → state: idle, no change
//   click the "сброс" link → clears the override, falls back to the
//                            server default

import { useCallback, useEffect, useState } from 'react';

import type { HotkeyAction } from '@shared/types';
import { Kbd, StatusDot } from './primitives';

export interface HotkeyRecorderProps {
  action: HotkeyAction;
  /** Current effective accelerator (default OR user override). */
  accelerator: string;
  /** True when this row's accelerator has been overridden locally. */
  isOverridden: boolean;
  onSave: (accelerator: string) => void;
  onReset: () => void;
}

export function HotkeyRecorder({
  action: _action,
  accelerator,
  isOverridden,
  onSave,
  onReset,
}: HotkeyRecorderProps) {
  const [recording, setRecording] = useState(false);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!recording) return;
      // Eat everything while recording — don't let the event submit a form
      // or trigger other shortcuts in the page.
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setRecording(false);
        return;
      }

      const accel = toAccelerator(e);
      if (!accel) return; // bare modifier — keep listening
      onSave(accel);
      setRecording(false);
    },
    [recording, onSave],
  );

  useEffect(() => {
    if (!recording) return;
    // Capture phase so we intercept before any inner handlers.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording, onKeyDown]);

  if (recording) {
    return (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 10px',
          background: 'rgba(255, 69, 58, 0.12)',
          border: '1px solid rgba(255, 69, 58, 0.45)',
          borderRadius: 'var(--r-btn)',
          fontSize: 11,
          fontFamily: 'var(--d9-font-mono)',
          color: 'var(--d9-err)',
        }}
      >
        <StatusDot state="recording" size={6} />
        <span>нажми клавиши · Esc для отмены</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button
        onClick={() => setRecording(true)}
        title="Нажми для перезаписи"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 6px',
          background: 'transparent',
          border: '1px solid transparent',
          borderRadius: 4,
          cursor: 'pointer',
          color: 'inherit',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
          e.currentTarget.style.borderColor = 'var(--d9-hairline)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.borderColor = 'transparent';
        }}
      >
        <Kbd>{accelerator}</Kbd>
      </button>
      {isOverridden && (
        <button
          onClick={onReset}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--d9-ink-mute)',
            fontSize: 10.5,
            fontFamily: 'var(--d9-font-mono)',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          сброс
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

/**
 * Translate a KeyboardEvent into an Electron accelerator string.
 * Returns null for modifier-only presses so the recorder keeps
 * listening until the user hits a real key.
 */
function toAccelerator(e: KeyboardEvent): string | null {
  const mods: string[] = [];
  // On Mac, `metaKey` is Command. We normalize to CommandOrControl so
  // the same binding works if the user ever moves to Windows/Linux.
  if (e.metaKey || e.ctrlKey) mods.push('CommandOrControl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');

  const bare = e.key;
  if (bare === 'Control' || bare === 'Meta' || bare === 'Alt' || bare === 'Shift') return null;

  const keyPart = normalizeKey(bare, e.code);
  if (!keyPart) return null;

  // An accelerator without a modifier is allowed by Electron but
  // almost always a footgun (e.g. "S" swallows the letter everywhere
  // in the OS). We keep those valid but the UX encourages a modifier.
  return [...mods, keyPart].join('+');
}

function normalizeKey(k: string, code: string): string | null {
  // Letters / digits from e.key — uppercase the letter so accelerators
  // are canonical ("S", not "s").
  if (k.length === 1) {
    const upper = k.toUpperCase();
    if (/^[A-Z0-9]$/.test(upper)) return upper;
    // Punctuation: pass through as-is; Electron accepts `~`, `!`, etc.
    return k;
  }
  // Arrow keys, function keys, etc.
  const named: Record<string, string> = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ' ': 'Space',
    Enter: 'Return',
    Escape: 'Esc',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
  };
  if (named[k]) return named[k];
  if (/^F\d{1,2}$/.test(k)) return k; // F1..F12
  // Fall back to e.code for edge keys like numpad variants.
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Key')) return code.slice(3);
  return null;
}
