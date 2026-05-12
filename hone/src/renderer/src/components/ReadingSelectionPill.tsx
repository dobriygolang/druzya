// ReadingSelectionPill — selection-level «Объяснить» pill для Hone Reading.
//
// Sergey 2026-05-01 spec: «selected text → объясни этот абзац». Listening
// to global selectionchange'у; когда выделение лежит внутри `containerRef`
// и не пустое, рендерим маленький floating button у нижнего края selection
// rectangle. Click → AICoachPill drawer с contextNote = «Студент выделил
// в материале X: "<selected>"».
//
// Persona — по active study mode (как у material-level pill в Reading).
import { useEffect, useRef, useState } from 'react';

import { AICoachPill } from './AICoachPill';
import { useTrackStore } from '../stores/track';

interface Props {
  /** Контейнер reader-body — selection регистрируется только если внутри. */
  containerRef: React.RefObject<HTMLElement>;
  /** Title материала — попадает в context для grounding'а. */
  materialTitle: string;
}

interface Pill {
  text: string;
  x: number;
  y: number;
}

const MIN_LEN = 12;
const MAX_LEN = 1200;

export function ReadingSelectionPill({ containerRef, materialTitle }: Props) {
  const [pill, setPill] = useState<Pill | null>(null);
  const [open, setOpen] = useState(false);
  const [contextNote, setContextNote] = useState('');
  const activeTrack = useTrackStore((s) => s.activeTrack);
  const lastSelectionRef = useRef('');

  useEffect(() => {
    const onSelectionChange = () => {
      // While drawer открыт — не пересчитываем; selection внутри drawer'а
      // (если юзер выделит наш ответ) триггернул бы pill повторно.
      if (open) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setPill(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const container = containerRef.current;
      if (!container) {
        setPill(null);
        return;
      }
      // Selection должен лежать внутри ridid контейнера reader'а.
      if (!container.contains(range.commonAncestorContainer)) {
        setPill(null);
        return;
      }
      const text = sel.toString().trim();
      if (text.length < MIN_LEN) {
        setPill(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        setPill(null);
        return;
      }
      lastSelectionRef.current = text.slice(0, MAX_LEN);
      setPill({
        text: lastSelectionRef.current,
        x: rect.left + rect.width / 2 + window.scrollX,
        y: rect.bottom + 6 + window.scrollY,
      });
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [containerRef, open]);

  const onAsk = () => {
    if (!pill) return;
    setContextNote(
      `Студент читает «${materialTitle}» и выделил абзац: "${pill.text}". Объясни этот абзац: основные идеи, нюансы которые легко упустить.`,
    );
    setOpen(true);
    setPill(null);
  };

  const persona = pickPersona(activeTrack);

  return (
    <>
      {pill && (
        <button
          type="button"
          onClick={onAsk}
          className="mono focus-ring motion-press"
          style={{
            position: 'absolute',
            left: pill.x,
            top: pill.y,
            transform: 'translateX(-50%)',
            zIndex: 50,
            padding: '5px 10px',
            fontSize: 10,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--ink-90)',
            background: 'var(--surface-2)',
            border: '1px solid var(--hair-2)',
            borderRadius: 999,
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
          }}
        >
          ✦ Объяснить
        </button>
      )}
      <AICoachPill
        personaSlug={persona.slug}
        coachName={persona.name}
        contextNote={contextNote}
        controlledOpen={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

// Display-name role-only lowercase per memory/feedback_persona_names.md.
function pickPersona(activeTrack: 'general' | 'dev' | 'english' | 'go'): {
  slug: string;
  name: string;
} {
  switch (activeTrack) {
    case 'go':
      return { slug: 'go-coach', name: 'go coach' };
    case 'english':
      return { slug: 'english-coach', name: 'english coach' };
    default:
      return { slug: 'algo-coach', name: 'algo coach' };
  }
}
