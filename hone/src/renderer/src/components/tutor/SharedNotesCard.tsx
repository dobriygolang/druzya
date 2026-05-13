// SharedNotesCard — Phase K T4 (P1) 2026-05-13.
//
// Student-side card on TutorAssignments. Surfaces a single session note
// the tutor opted to share post-event. Expandable: collapsed shows
// event title + tutor + date + 2-line preview; clicking expands to full
// markdown.
//
// Visual rules (b/w only):
//   - Hairline ink-ramp stroke. var(--red) reserved для «new since last
//     viewed» 1.5px stripe accent (signals «fresh note»).
//   - No emoji / no chips on coloured backgrounds.

import { useState } from 'react';

import type { SharedSessionNote } from '../../api/tutor';

interface Props {
  note: SharedSessionNote;
  /** When true, renders the «new» red stripe accent. Driven by parent's
   *  last-viewed-at stored locally (Phase K T4 §F polish). */
  isFresh?: boolean;
}

const monoFont = "'JetBrains Mono', ui-monospace, monospace";

const captionMonoTiny: React.CSSProperties = {
  fontFamily: monoFont,
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-40)',
};

function formatSharedAt(d: Date | null): string {
  if (!d) return '';
  const ms = Date.now() - d.getTime();
  if (ms < 60 * 60 * 1000) return 'just now';
  if (ms < 24 * 60 * 60 * 1000) {
    const h = Math.floor(ms / (60 * 60 * 1000));
    return `${h}h ago`;
  }
  if (ms < 7 * 24 * 60 * 60 * 1000) {
    const dd = Math.floor(ms / (24 * 60 * 60 * 1000));
    return `${dd}d ago`;
  }
  return d.toLocaleDateString();
}

// Take first 2 lines or first 140 chars for the collapsed preview.
function previewOf(md: string): string {
  if (!md) return '';
  const lines = md.split('\n').slice(0, 2);
  const head = lines.join(' ').trim();
  return head.length > 140 ? `${head.slice(0, 140)}…` : head;
}

export function SharedNotesCard({ note, isFresh }: Props) {
  const [expanded, setExpanded] = useState(false);
  const preview = previewOf(note.sharedContentMd);

  return (
    <article
      style={{
        padding: '14px 16px 12px',
        background: 'transparent',
        border: '1px solid var(--hair-2)',
        borderRadius: 'var(--radius-outer)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        position: 'relative',
      }}
    >
      {isFresh && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: -12,
            top: 14,
            bottom: 14,
            width: 1.5,
            background: 'var(--red)',
          }}
        />
      )}
      <div style={captionMonoTiny}>
        SHARED NOTE · {formatSharedAt(note.sharedAt)}
      </div>

      <div
        className="flex-wrap-row"
        style={{ alignItems: 'baseline', gap: 12, minWidth: 0 }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 'var(--type-h3-size)',
            lineHeight: 'var(--type-h3-lh)',
            letterSpacing: 'var(--type-h3-ls)',
            fontWeight: 'var(--type-h3-weight)',
            color: 'var(--ink)',
            flex: 1,
            minWidth: 0,
          }}
        >
          {note.eventTitle || 'Session'}
        </h3>
        <span
          style={{
            ...captionMonoTiny,
            color: 'var(--ink-60)',
            flex: '0 0 auto',
            textTransform: 'none',
            letterSpacing: '0.02em',
            fontSize: 11,
          }}
        >
          tutor {note.tutorDisplayName || '—'}
        </span>
      </div>

      {/* Collapsed preview / expanded full content */}
      {!expanded ? (
        <>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              lineHeight: 1.55,
              color: 'var(--ink-60)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {preview}
          </p>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="focus-ring motion-press"
            style={{
              alignSelf: 'flex-start',
              background: 'transparent',
              border: 0,
              color: 'var(--ink-60)',
              padding: '4px 0',
              fontFamily: monoFont,
              fontSize: 11,
              letterSpacing: '0.04em',
              cursor: 'pointer',
              textDecoration: 'underline',
              textUnderlineOffset: 3,
              textDecorationColor: 'var(--hair-2)',
            }}
          >
            Read full note
          </button>
        </>
      ) : (
        <>
          <pre
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              fontFamily: 'inherit',
              fontSize: 13,
              lineHeight: 1.6,
              color: 'var(--ink)',
              maxHeight: 480,
              overflowY: 'auto',
            }}
          >
            {note.sharedContentMd}
          </pre>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="focus-ring motion-press"
            style={{
              alignSelf: 'flex-start',
              background: 'transparent',
              border: 0,
              color: 'var(--ink-60)',
              padding: '4px 0',
              fontFamily: monoFont,
              fontSize: 11,
              letterSpacing: '0.04em',
              cursor: 'pointer',
              textDecoration: 'underline',
              textUnderlineOffset: 3,
              textDecorationColor: 'var(--hair-2)',
            }}
          >
            Collapse
          </button>
        </>
      )}
    </article>
  );
}
