// B/W only: categorical visual через stroke style, не цвет.
//   match      → plain text, no border
//   substitute → dotted border, expected + actual stacked
//   miss       → dashed border with strike-through
//   extra      → dashed border, prefixed with "+"
import { type CSSProperties } from 'react'

import type { WordDiff as WordDiffData } from '../../api/lingua/speaking'

interface Props {
  diffs: WordDiffData[]
}

export function WordDiffView({ diffs }: Props) {
  if (diffs.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface-1 px-3 py-2 text-xs text-text-muted">
        No word-level breakdown — try speaking the full prompt.
      </div>
    )
  }
  return (
    <div
      role="list"
      aria-label="Word-level pronunciation alignment"
      className="flex flex-wrap gap-1.5 font-mono text-xs"
    >
      {diffs.map((d, i) => (
        <WordChip key={i} diff={d} />
      ))}
    </div>
  )
}

function WordChip({ diff }: { diff: WordDiffData }) {
  switch (diff.status) {
    case 'match':
      return (
        <span role="listitem" style={chipBase} className="border border-transparent text-text-primary">
          {diff.expected || diff.actual}
        </span>
      )
    case 'substitute':
      return (
        <span
          role="listitem"
          style={chipBase}
          className="inline-flex flex-col items-center border border-dotted border-border-strong text-text-primary"
          title={`Expected "${diff.expected}", heard "${diff.actual}"`}
        >
          <span className="text-[10px] text-text-secondary">{diff.expected}</span>
          <span className="text-xs text-text-primary">{diff.actual}</span>
        </span>
      )
    case 'miss':
      return (
        <span
          role="listitem"
          style={chipBase}
          className="border border-dashed border-border-strong text-text-secondary line-through"
          title={`Missed word "${diff.expected}"`}
        >
          {diff.expected}
        </span>
      )
    case 'extra':
      return (
        <span
          role="listitem"
          style={chipBase}
          className="border border-dashed border-border-strong italic text-text-secondary"
          title={`Extra word "${diff.actual}"`}
        >
          +{diff.actual}
        </span>
      )
    default:
      return null
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
}
