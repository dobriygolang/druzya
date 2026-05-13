// Title + textarea + «Get feedback» → LLM grading с per-issue Apply Fix.
import { useCallback, useMemo, useState } from 'react'

import { AICoachPill } from '../../components/AICoachPill'
import {
  useGradeWritingMutation,
} from '../../lib/queries/lingua'
import type {
  WritingFeedback,
  WritingIssue,
  WritingIssueCategory,
} from '../../api/lingua/writing'

type GradingState =
  | { kind: 'idle' }
  | { kind: 'graded'; feedback: WritingFeedback }

const CATEGORY_LABEL: Record<WritingIssueCategory, string> = {
  grammar: 'GRAMMAR',
  vocab: 'VOCAB',
  style: 'STYLE',
  clarity: 'CLARITY',
}

// B/W stripe ramp by category (no hue, just opacity).
const CATEGORY_STRIPE: Record<WritingIssueCategory, string> = {
  grammar: 'rgba(255, 255, 255, 0.75)',
  vocab: 'rgba(255, 255, 255, 0.55)',
  style: 'rgba(255, 255, 255, 0.65)',
  clarity: 'rgba(255, 255, 255, 0.45)',
}

export default function WritingPage() {
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [grading, setGrading] = useState<GradingState>({ kind: 'idle' })
  const gradeMut = useGradeWritingMutation()

  const wordCount = useMemo(() => {
    const t = text.trim()
    if (!t) return 0
    return t.split(/\s+/).length
  }, [text])

  const submit = useCallback(async () => {
    const trimmed = text.trim()
    if (trimmed === '') return
    try {
      const fb = await gradeMut.mutateAsync({ text: trimmed, title: title.trim() })
      setGrading({ kind: 'graded', feedback: fb })
    } catch {
      // Mutation error surfaces below via gradeMut.error.
    }
  }, [text, title, gradeMut])

  const reset = useCallback(() => {
    setGrading({ kind: 'idle' })
    gradeMut.reset()
  }, [gradeMut])

  const isGrading = gradeMut.isPending
  const errMsg = gradeMut.error?.message

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          Writing · Lingua
        </div>
        <h1 className="font-display text-[28px] font-bold leading-tight tracking-tight text-text-primary">
          Draft &amp; grade
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-text-secondary">
          Напиши параграф или короткое эссе. AI вернёт список конкретных issues с предложенными правками.
        </p>
      </header>

      <label className="block">
        <span className="mb-2 block font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">
          Title (optional)
        </span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What's this piece about?"
          className="w-full border-0 border-b border-border bg-transparent px-0 py-2 text-sm text-text-primary outline-none transition-colors focus:border-border-strong"
          disabled={isGrading}
        />
      </label>

      <label className="mt-5 block">
        <span className="mb-2 block font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">
          Draft
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Start writing here…"
          rows={16}
          className="block w-full resize-y border-0 border-b border-border bg-transparent px-0 py-2 text-[17px] leading-[1.7] text-text-primary outline-none transition-colors focus:border-border-strong"
          style={{ fontFamily: 'ui-serif, Georgia, "Times New Roman", serif', minHeight: 320 }}
          disabled={isGrading}
        />
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={isGrading || text.trim() === ''}
          className="rounded-md bg-text-primary px-4 py-2 text-[13px] font-medium text-bg transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isGrading ? 'Grading…' : 'Get feedback'}
        </button>
        <span className="ml-auto font-mono text-xs text-text-muted">{wordCount} words</span>
      </div>

      {errMsg && (
        <p role="alert" className="mt-3.5 flex items-start gap-2.5 text-xs" style={{ color: '#FF3B30' }}>
          <span aria-hidden className="mt-1.5 inline-block h-[1.5px] w-6" style={{ background: '#FF3B30' }} />
          <span>{errMsg}</span>
        </p>
      )}

      {grading.kind === 'graded' && (
        <FeedbackPanel
          feedback={grading.feedback}
          text={text}
          title={title}
          onApply={(issue) => {
            const next = applyIssueOnce(text, issue)
            if (next !== null) setText(next)
          }}
          onReset={reset}
        />
      )}
    </div>
  )
}

function FeedbackPanel({
  feedback,
  text,
  title,
  onApply,
  onReset,
}: {
  feedback: WritingFeedback
  text: string
  title: string
  onApply: (issue: WritingIssue) => void
  onReset: () => void
}) {
  const score = feedback.overallScore
  const tier: 'strong' | 'mid' | 'weak' = score >= 80 ? 'strong' : score >= 50 ? 'mid' : 'weak'
  const stripe =
    tier === 'strong' ? 'rgba(255, 255, 255, 0.85)' : tier === 'mid' ? 'rgba(255, 255, 255, 0.55)' : '#FF3B30'
  const label = tier === 'strong' ? 'Strong' : tier === 'mid' ? 'OK — some gaps' : 'Needs work'

  const overallContext = useMemo(() => {
    const excerpt = text.replace(/\s+/g, ' ').trim().slice(0, 800)
    const tail = text.length > 800 ? '…' : ''
    const issueLines = feedback.issues
      .slice(0, 6)
      .map((iss) => `- [${CATEGORY_LABEL[iss.category]}] «${iss.excerpt}» → ${iss.suggestion}`)
      .join('\n')
    return [
      `Student wrote a draft${title ? ` titled «${title}»` : ''}.`,
      `Overall AI score: ${score}/100 (${label}).`,
      `Draft excerpt: ${excerpt}${tail}`,
      feedback.issues.length > 0 ? `Top issues:\n${issueLines}` : 'No issues flagged.',
    ].join('\n\n')
  }, [text, title, score, label, feedback.issues])

  return (
    <section className="mt-8 border-t border-border pt-6">
      <div
        className="mb-4 flex flex-wrap items-center gap-3.5 rounded-md border border-border bg-transparent px-4 py-3.5"
        style={{ borderLeft: `3px solid ${stripe}` }}
      >
        <div className="min-w-0">
          <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-text-muted">Overall</div>
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-3xl font-semibold tracking-tight text-text-primary">{score}</span>
            <span className="font-mono text-xs text-text-muted">/ 100</span>
            <span className="ml-2 text-sm text-text-secondary">{label}</span>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <AICoachPill
            personaSlug="english-coach"
            coachName="english coach"
            contextNote={overallContext}
            label="Спросить coach'а про это эссе"
          />
          <button
            type="button"
            onClick={onReset}
            className="rounded-md border border-border bg-transparent px-3.5 py-1.5 text-xs text-text-secondary hover:bg-surface-2"
          >
            Edit more
          </button>
        </div>
      </div>

      {feedback.issues.length === 0 ? (
        <p className="text-sm text-text-secondary">AI didn&apos;t flag anything. Looks clean.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {feedback.issues.map((issue, i) => (
            <li key={i}>
              <IssueRow
                issue={issue}
                present={containsExcerpt(text, issue.excerpt)}
                onApply={() => onApply(issue)}
                title={title}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function IssueRow({
  issue,
  present,
  onApply,
  title,
}: {
  issue: WritingIssue
  present: boolean
  onApply: () => void
  title: string
}) {
  const issueContext = useMemo(() => {
    return [
      `Student is reviewing a writing issue${title ? ` from draft «${title}»` : ''}.`,
      `Rubric category: ${CATEGORY_LABEL[issue.category]}.`,
      `Excerpt: «${issue.excerpt}»`,
      `Suggested fix: ${issue.suggestion}`,
      issue.explanation ? `AI explanation: ${issue.explanation}` : '',
      'Explain why this category matters (rubric criterion) and 1-2 general rules the student can apply next time. Avoid just rephrasing — teach the principle.',
    ]
      .filter(Boolean)
      .join('\n\n')
  }, [issue, title])

  return (
    <article
      className="rounded-md border border-border bg-transparent px-3.5 py-3"
      style={{ borderLeft: `3px solid ${CATEGORY_STRIPE[issue.category]}` }}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span
          className="font-mono text-[9px] uppercase tracking-[0.08em]"
          style={{ color: CATEGORY_STRIPE[issue.category] }}
        >
          {CATEGORY_LABEL[issue.category]}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <AICoachPill
            personaSlug="english-coach"
            coachName="english coach"
            contextNote={issueContext}
            label="Ask coach"
          />
          <button
            type="button"
            onClick={onApply}
            disabled={!present}
            className="rounded-md border border-border bg-transparent px-2.5 py-1 text-[10px] text-text-secondary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
            title={present ? 'Replace excerpt with suggestion' : 'Excerpt no longer in draft'}
          >
            Apply fix
          </button>
        </div>
      </div>
      <div className="mb-1.5 font-serif text-sm italic text-text-secondary">«{issue.excerpt}»</div>
      <div className="mb-1 text-sm leading-snug text-text-primary">{issue.suggestion}</div>
      {issue.explanation && (
        <div className="text-xs leading-relaxed text-text-muted">{issue.explanation}</div>
      )}
    </article>
  )
}

function applyIssueOnce(text: string, issue: WritingIssue): string | null {
  const idx = text.indexOf(issue.excerpt)
  if (idx === -1) return null
  return text.slice(0, idx) + issue.suggestion + text.slice(idx + issue.excerpt.length)
}

function containsExcerpt(text: string, excerpt: string): boolean {
  return excerpt.length > 0 && text.indexOf(excerpt) !== -1
}
