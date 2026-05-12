// SpeakerLabel — C4 diarization manual relabel chip.
//
// Renders «Собеседник 2» / custom name; click opens inline input для
// переименования. Save → updates store через renameSpeaker, broadcasting
// в LLM-bound composeMerged. Speaker 0 (mic / «Я») — read-only anchor:
// rendered statically без edit affordance.
//
// Storage: client-only (см. audio-capture store). Не отправляется на
// backend — labels это UX prefs per session, нет ценности persisting
// между Cue installations. Save persists в localStorage по session-key
// (auto-cleared при clear() флоу).

import { useEffect, useRef, useState } from 'react';

import { useAudioCaptureStore } from '../stores/audio-capture';

interface SpeakerLabelProps {
  /** Speaker numeric id из diarizer. 0 = mic = «Я». 1..N = system speakers. */
  speakerId: number;
  /** Source флаг — нужен чтобы корректно вычислить label для legacy chunks
   *  (без speakerId). Mic source → «Я» unconditionally. */
  source: 'mic' | 'system';
  /** Compact mode — small inline chip без emphasis. Default = full chip.
   *  Compact используется в transcript stream paragraphs (heavy ratio), full
   *  — в transcript header / standalone speaker listings. */
  compact?: boolean;
}

/**
 * Renderer chip: shows current label, click opens inline editor.
 * NB: keyboard-friendly — Enter saves, Esc cancels, Tab moves focus.
 *
 * Speaker 0 (mic) — рендерится как plain text без button (нельзя
 * переименовать «Я»). Эта инвариант encoded в renameSpeaker(speakerId=0) noop.
 */
export function SpeakerLabel({ speakerId, source, compact = false }: SpeakerLabelProps) {
  const label = useAudioCaptureStore((s) => s.labelFor(speakerId, source));
  const renameSpeaker = useAudioCaptureStore((s) => s.renameSpeaker);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      // Sync draft → store value when entering edit mode (могло поменяться
      // через другую chip кнопку или Reset).
      setDraft(label);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [editing, label]);

  // Mic / speaker 0 — read-only static chip.
  const readOnly = source === 'mic' || speakerId === 0;

  if (readOnly) {
    return (
      <span
        style={{
          display: 'inline-block',
          padding: compact ? '1px 6px' : '2px 8px',
          borderRadius: 'var(--radius-inner)',
          fontSize: compact ? 10 : 11,
          fontWeight: 500,
          letterSpacing: '-0.005em',
          color: 'var(--d9-ink)',
          background: 'rgba(255,255,255,0.06)',
          border: '0.5px solid var(--d9-hairline)',
        }}
      >
        {label}
      </span>
    );
  }

  if (editing) {
    const commit = () => {
      renameSpeaker(speakerId, draft);
      setEditing(false);
    };
    const cancel = () => {
      setDraft(label);
      setEditing(false);
    };
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: compact ? '1px 4px' : '2px 6px',
          borderRadius: 'var(--radius-inner)',
          background: 'rgba(255,255,255,0.08)',
          border: '0.5px solid rgba(255,255,255,0.25)',
          fontSize: compact ? 10 : 11,
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={draft}
          maxLength={32}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
          }}
          aria-label={`Имя для ${label}`}
          style={{
            width: 100,
            minWidth: 60,
            background: 'transparent',
            color: 'var(--d9-ink)',
            border: 0,
            outline: 'none',
            fontSize: compact ? 10 : 11,
            fontFamily: 'inherit',
            padding: 0,
            letterSpacing: '-0.005em',
          }}
        />
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title={`Переименовать ${label} (Enter для save, Esc для cancel)`}
      aria-label={`Speaker: ${label}, click to rename`}
      style={{
        display: 'inline-block',
        padding: compact ? '1px 6px' : '2px 8px',
        borderRadius: 'var(--radius-inner)',
        fontSize: compact ? 10 : 11,
        fontWeight: 500,
        letterSpacing: '-0.005em',
        color: 'var(--d9-ink)',
        background: 'rgba(255,255,255,0.04)',
        border: '0.5px dashed var(--d9-hairline-b)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'background var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
        e.currentTarget.style.borderColor = 'var(--d9-hairline-b)';
      }}
    >
      {label}
    </button>
  );
}

// TODO(C4 follow-up): merge UI — кнопка «Merge into Speaker 1» когда юзер
// видит что diarizer ошибочно split'нул одного speaker'а на два. Сейчас
// fallback — relabel обоих identically (visual identity, но в LLM
// composeMerged они всё ещё две строки). Полноценный merge потребует
// pass'нуть merged-set в композитор: { fromId → intoId }.
