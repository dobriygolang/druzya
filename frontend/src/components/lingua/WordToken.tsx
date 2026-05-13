// Splits body text на абзацы → tokens. «Слово» = 2+ Unicode-letter подряд.
// Punctuation сохраняется как non-clickable gaps. Click на слово → popover
// callback (handled by parent — обычно мутация addVocab).
//
// B/W only: hover подсветка через bg-surface-3 (tailwind token). Без inline
// rgba(...) — всё в tokens чтобы dark theme был consistent.
import { useMemo } from 'react'

const WORD_RE = /[\p{L}\p{M}'’]+/gu

interface Token {
  kind: 'word' | 'gap'
  text: string
  start: number
}

interface SentenceSpan {
  start: number
  end: number
  text: string
}

interface WordTokenizedTextProps {
  /** Markdown-ish body. We don't render markdown syntax — only flat text. */
  text: string
  onWordClick: (word: string, context: string, e: React.MouseEvent<HTMLSpanElement>) => void
  /** Optional serif body styling for reader mode. */
  serif?: boolean
}

/** WordTokenizedText — full body splitter. Renders one <p> per paragraph,
 *  with clickable word spans interleaved with non-clickable gap text. */
export function WordTokenizedText({ text, onWordClick, serif = false }: WordTokenizedTextProps) {
  const paragraphs = useMemo(() => text.split(/\n\s*\n/), [text])
  return (
    <div
      className={
        serif
          ? 'font-serif text-[18px] leading-[1.7] text-text-primary'
          : 'text-[17px] leading-[1.7] text-text-primary'
      }
      style={serif ? { fontFamily: 'ui-serif, Georgia, "Times New Roman", serif' } : undefined}
    >
      {paragraphs.map((p, i) => (
        <Paragraph key={i} text={p} onWordClick={onWordClick} />
      ))}
    </div>
  )
}

function Paragraph({
  text,
  onWordClick,
}: {
  text: string
  onWordClick: WordTokenizedTextProps['onWordClick']
}) {
  const sentences = useMemo(() => splitSentences(text), [text])
  const tokens = useMemo(() => tokenize(text), [text])
  return (
    <p className="mb-[1.2em] last:mb-0">
      {tokens.map((tok, i) => {
        if (tok.kind === 'word') {
          const ctx = findSentenceFor(sentences, tok.start)
          const word = tok.text.toLowerCase()
          return (
            <span
              key={i}
              role="button"
              tabIndex={-1}
              onClick={(e) => onWordClick(word, ctx, e)}
              className="cursor-pointer rounded-sm px-px transition-colors hover:bg-surface-3"
            >
              {tok.text}
            </span>
          )
        }
        return <span key={i}>{tok.text}</span>
      })}
    </p>
  )
}

function tokenize(s: string): Token[] {
  const out: Token[] = []
  let lastIdx = 0
  for (const m of s.matchAll(WORD_RE)) {
    const start = m.index ?? 0
    if (start > lastIdx) out.push({ kind: 'gap', text: s.slice(lastIdx, start), start: lastIdx })
    out.push({ kind: 'word', text: m[0], start })
    lastIdx = start + m[0].length
  }
  if (lastIdx < s.length) out.push({ kind: 'gap', text: s.slice(lastIdx), start: lastIdx })
  return out
}

function splitSentences(s: string): SentenceSpan[] {
  const out: SentenceSpan[] = []
  let start = 0
  const re = /[.!?]+\s+/g
  for (const m of s.matchAll(re)) {
    const end = (m.index ?? 0) + m[0].length
    out.push({ start, end, text: s.slice(start, end).trim() })
    start = end
  }
  if (start < s.length) out.push({ start, end: s.length, text: s.slice(start).trim() })
  return out
}

function findSentenceFor(sentences: SentenceSpan[], pos: number): string {
  for (const s of sentences) {
    if (pos >= s.start && pos < s.end) return s.text
  }
  return sentences.length > 0 ? sentences[0].text : ''
}

// ── VocabPopover ──────────────────────────────────────────────────────────

export interface VocabPopoverAnchor {
  word: string
  context: string
  anchor: { x: number; y: number }
}

interface VocabPopoverProps {
  popover: VocabPopoverAnchor
  onSave: (translation: string) => void
  onCancel: () => void
}

import { useEffect, useRef, useState } from 'react'

/** VocabPopover — small floating input that captures translation + saves
 *  (word, translation, contextMd) via parent callback. Position is anchor-
 *  relative; clamped to keep within viewport. */
export function VocabPopover({ popover, onSave, onCancel }: VocabPopoverProps) {
  const [translation, setTranslation] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Clamp position so popover stays on-screen. 280px width + 180px max height
  // are baked in to match the rendered card below.
  const left = typeof window !== 'undefined' ? Math.max(8, Math.min(popover.anchor.x - 140, window.innerWidth - 300)) : popover.anchor.x
  const top = typeof window !== 'undefined' ? Math.min(popover.anchor.y, window.innerHeight - 200) : popover.anchor.y

  return (
    <div
      role="dialog"
      aria-label="Add word to vocabulary"
      className="fixed z-[500] w-[280px] rounded-lg border border-border-strong bg-surface-1 p-3 shadow-card"
      style={{ left, top }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
      }}
    >
      <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-text-muted">
        Add to SRS
      </div>
      <div className="mt-1 text-base font-medium text-text-primary">{popover.word}</div>
      <input
        ref={inputRef}
        type="text"
        value={translation}
        onChange={(e) => setTranslation(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onSave(translation)
          }
        }}
        placeholder="translation (optional)"
        className="mt-2 w-full rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm text-text-primary outline-none focus:border-border-strong"
      />
      <div className="mt-2.5 flex gap-1.5">
        <button
          type="button"
          onClick={() => onSave(translation)}
          className="rounded-md border border-border-strong bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-3"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border bg-transparent px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-2"
        >
          Skip
        </button>
      </div>
    </div>
  )
}
