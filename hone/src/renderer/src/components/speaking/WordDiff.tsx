// WordDiff — Phase J / H4 word-level alignment renderer.
//
// Receives the LLM's per-token alignment array and renders an inline
// stripe where each word carries its status as a hairline-bordered chip
// (B/W only — categorical visual via stroke style, не цвет):
//   match      → no border, plain text
//   substitute → dotted border, expected + actual stacked
//   miss       → dashed border with strike-through
//   extra      → dashed border, prefixed with "+"
//
// Spec mentions side-by-side waveform OR text diff — we ship text diff
// (cheaper, более readable). Waveform-style alignment would need DTW on
// the audio itself, deferred.
import { type CSSProperties } from 'react';

import type { WordDiff as WordDiffData } from '../../api/speaking';

interface Props {
  diffs: WordDiffData[];
}

const monoFont = "'JetBrains Mono', ui-monospace, monospace";

export function WordDiffView({ diffs }: Props) {
  if (diffs.length === 0) {
    return (
      <div style={emptyHint}>No word-level breakdown — try speaking the full prompt.</div>
    );
  }
  return (
    <div
      role="list"
      aria-label="Word-level pronunciation alignment"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        fontFamily: monoFont,
        fontSize: 12,
      }}
    >
      {diffs.map((d, i) => (
        <WordChip key={i} diff={d} />
      ))}
    </div>
  );
}

function WordChip({ diff }: { diff: WordDiffData }) {
  switch (diff.status) {
    case 'match':
      return (
        <span
          role="listitem"
          style={{
            ...chipBase,
            color: 'var(--ink-90)',
            border: '1px solid transparent',
          }}
        >
          {diff.expected || diff.actual}
        </span>
      );
    case 'substitute':
      return (
        <span
          role="listitem"
          style={{
            ...chipBase,
            border: '1px dotted var(--hair-2)',
            color: 'var(--ink)',
            display: 'inline-flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 0,
            padding: '4px 8px',
            lineHeight: 1.1,
          }}
          title={`Expected "${diff.expected}", heard "${diff.actual}"`}
        >
          <span style={{ color: 'var(--ink-60)', fontSize: 10 }}>{diff.expected}</span>
          <span style={{ color: 'var(--ink)', fontSize: 12 }}>{diff.actual}</span>
        </span>
      );
    case 'miss':
      return (
        <span
          role="listitem"
          style={{
            ...chipBase,
            border: '1px dashed var(--hair-2)',
            color: 'var(--ink-60)',
            textDecoration: 'line-through',
            textDecorationThickness: '1px',
            textDecorationColor: 'var(--ink-40)',
          }}
          title={`Missed word "${diff.expected}"`}
        >
          {diff.expected}
        </span>
      );
    case 'extra':
      return (
        <span
          role="listitem"
          style={{
            ...chipBase,
            border: '1px dashed var(--hair-2)',
            color: 'var(--ink-60)',
            fontStyle: 'italic',
          }}
          title={`Extra word "${diff.actual}"`}
        >
          +{diff.actual}
        </span>
      );
    default:
      return null;
  }
}

const chipBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '4px 8px',
  borderRadius: 6,
  background: 'transparent',
  whiteSpace: 'nowrap',
  minWidth: 0,
};

const emptyHint: CSSProperties = {
  padding: '10px 12px',
  border: '1px solid var(--hair)',
  borderRadius: 'var(--radius-inner)',
  fontSize: 12,
  color: 'var(--ink-40)',
};
