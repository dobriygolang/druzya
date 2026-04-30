// Writing — Wave 4.4 Writing-as-Focus.
//
// Layout: vertical column.
//   - title input + textarea (the draft)
//   - "Get feedback" button → LLM round-trip
//   - feedback panel: overall score chip + per-issue rows
//   - "Save to Notes" button piggybacks on api/hone.createNote
//
// The page deliberately does NOT auto-grade on every keystroke — the
// model latency is 5-15s and the user isn't necessarily wanting
// continuous feedback while writing. They click when they're done.
//
// No persistence on this page itself: text lives in component state
// and disappears on navigation. Save-to-Notes is the escape hatch.

import { useCallback, useMemo, useState } from 'react';

import { createNote } from '../api/hone';
import {
  gradeEnglishWriting,
  type WritingFeedback,
  type WritingIssue,
  type WritingIssueCategory,
} from '../api/writing';

type GradingState =
  | { kind: 'idle' }
  | { kind: 'grading' }
  | { kind: 'graded'; feedback: WritingFeedback }
  | { kind: 'error'; message: string };

const CATEGORY_LABEL: Record<WritingIssueCategory, string> = {
  grammar: 'GRAMMAR',
  vocab: 'VOCAB',
  style: 'STYLE',
  clarity: 'CLARITY',
};

const CATEGORY_STRIPE: Record<WritingIssueCategory, string> = {
  grammar: 'rgb(248, 113, 113)',
  vocab: 'rgb(96, 165, 250)',
  style: 'rgb(251, 191, 36)',
  clarity: 'rgb(167, 139, 250)',
};

export function WritingPage() {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [grading, setGrading] = useState<GradingState>({ kind: 'idle' });
  const [savedNoteFlash, setSavedNoteFlash] = useState(false);

  const wordCount = useMemo(() => {
    const t = text.trim();
    if (!t) return 0;
    return t.split(/\s+/).length;
  }, [text]);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (trimmed === '') {
      setGrading({ kind: 'error', message: 'Write something first.' });
      return;
    }
    setGrading({ kind: 'grading' });
    try {
      const fb = await gradeEnglishWriting({ text: trimmed, title: title.trim() });
      setGrading({ kind: 'graded', feedback: fb });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      setGrading({ kind: 'error', message: msg });
    }
  }, [text, title]);

  const reset = useCallback(() => {
    setGrading({ kind: 'idle' });
  }, []);

  const saveToNotes = useCallback(async () => {
    const t = title.trim() || 'Writing draft';
    try {
      await createNote(t, text.trim(), null);
      setSavedNoteFlash(true);
      window.setTimeout(() => setSavedNoteFlash(false), 1800);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      window.alert(`Не получилось сохранить в Notes: ${msg}`);
    }
  }, [title, text]);

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        animationDuration: '320ms',
        paddingTop: 96,
        paddingBottom: 120,
        overflowY: 'auto',
      }}
    >
      <div style={{ width: 760, maxWidth: '92%', margin: '0 auto', padding: '0 24px' }}>
        <header style={{ marginBottom: 24 }}>
          <div
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '0.24em',
              color: 'var(--ink-40)',
              marginBottom: 4,
            }}
          >
            WRITING · ENGLISH
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 40,
              fontWeight: 500,
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
              color: 'var(--ink)',
            }}
          >
            Draft &amp; grade
          </h1>
          <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--ink-60)', maxWidth: 560 }}>
            Напиши параграф или короткое эссе. AI вернёт список конкретных
            issues с предложенными правками.
          </p>
        </header>

        <label style={labelStyle}>
          <span style={labelTextStyle}>TITLE (optional)</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What's this piece about?"
            style={inputStyle}
            disabled={grading.kind === 'grading'}
          />
        </label>

        <label style={{ ...labelStyle, marginTop: 18 }}>
          <span style={labelTextStyle}>DRAFT</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Start writing here…"
            rows={16}
            style={{
              ...inputStyle,
              fontFamily: 'ui-serif, Georgia, "Times New Roman", serif',
              fontSize: 16,
              lineHeight: 1.7,
              minHeight: 320,
            }}
            disabled={grading.kind === 'grading'}
          />
        </label>

        <div
          style={{
            marginTop: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <button
            type="button"
            onClick={() => void submit()}
            disabled={grading.kind === 'grading' || text.trim() === ''}
            style={primaryBtnStyle}
          >
            {grading.kind === 'grading' ? 'Grading…' : 'Get feedback'}
          </button>
          <button
            type="button"
            onClick={() => void saveToNotes()}
            disabled={text.trim() === ''}
            style={secondaryBtnStyle}
          >
            Save to Notes
          </button>
          {savedNoteFlash && (
            <span style={{ fontSize: 12, color: 'rgb(74, 222, 128)' }}>Saved →</span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-40)' }}>
            {wordCount} words
          </span>
        </div>

        {grading.kind === 'error' && (
          <p style={{ marginTop: 12, color: 'rgb(248, 113, 113)', fontSize: 12 }}>
            {grading.message}
          </p>
        )}

        {grading.kind === 'graded' && (
          <FeedbackPanel
            feedback={grading.feedback}
            text={text}
            onApply={(issue) => {
              // One-click "accept suggestion": replace the first occurrence of
              // the excerpt with the suggested text. Cheap and predictable;
              // user can hit Get feedback again if they want a fresh pass.
              const next = applyIssueOnce(text, issue);
              if (next !== null) {
                setText(next);
              }
            }}
            onReset={reset}
          />
        )}
      </div>
    </div>
  );
}

// FeedbackPanel renders the overall score chip + a list of per-issue rows.
// Kept side-by-side with the textarea (same column, just below) rather than
// in a sidebar — issues reference text excerpts and the user is reading
// top-to-bottom anyway.
function FeedbackPanel({
  feedback,
  text,
  onApply,
  onReset,
}: {
  feedback: WritingFeedback;
  text: string;
  onApply: (issue: WritingIssue) => void;
  onReset: () => void;
}) {
  const score = feedback.overallScore;
  const tier: 'strong' | 'mid' | 'weak' = score >= 80 ? 'strong' : score >= 50 ? 'mid' : 'weak';
  const stripe =
    tier === 'strong' ? 'rgb(74, 222, 128)' : tier === 'mid' ? 'rgb(251, 191, 36)' : 'rgb(248, 113, 113)';
  const label =
    tier === 'strong' ? 'Strong' : tier === 'mid' ? 'OK — some gaps' : 'Needs work';

  return (
    <section
      style={{
        marginTop: 28,
        paddingTop: 22,
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div
        style={{
          padding: '14px 16px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderLeft: `3px solid ${stripe}`,
          borderRadius: 10,
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <div>
          <div
            className="mono"
            style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--ink-40)' }}
          >
            OVERALL
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 28, fontWeight: 500, color: 'var(--ink)' }}>{score}</span>
            <span style={{ fontSize: 12, color: 'var(--ink-40)' }}>/ 100</span>
            <span style={{ fontSize: 13, color: 'var(--ink-60)', marginLeft: 8 }}>{label}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onReset}
          style={{
            ...secondaryBtnStyle,
            marginLeft: 'auto',
            padding: '6px 12px',
            fontSize: 12,
          }}
        >
          Edit more
        </button>
      </div>

      {feedback.issues.length === 0 ? (
        <p style={{ color: 'var(--ink-60)', fontSize: 13 }}>
          AI didn&apos;t flag anything. Looks clean.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {feedback.issues.map((issue, i) => (
            <li key={i}>
              <IssueRow issue={issue} present={containsExcerpt(text, issue.excerpt)} onApply={() => onApply(issue)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function IssueRow({
  issue,
  present,
  onApply,
}: {
  issue: WritingIssue;
  present: boolean;
  onApply: () => void;
}) {
  return (
    <article
      style={{
        padding: '12px 14px',
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderLeft: `3px solid ${CATEGORY_STRIPE[issue.category]}`,
        borderRadius: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span
          className="mono"
          style={{
            fontSize: 9,
            letterSpacing: '0.2em',
            color: CATEGORY_STRIPE[issue.category],
          }}
        >
          {CATEGORY_LABEL[issue.category]}
        </span>
        <button
          type="button"
          onClick={onApply}
          disabled={!present}
          style={{
            ...secondaryBtnStyle,
            marginLeft: 'auto',
            padding: '3px 10px',
            fontSize: 10,
            opacity: present ? 1 : 0.4,
            cursor: present ? 'pointer' : 'not-allowed',
          }}
          title={present ? 'Replace excerpt with suggestion' : 'Excerpt no longer in draft'}
        >
          Apply fix
        </button>
      </div>
      <div style={{ fontSize: 13, color: 'var(--ink-60)', marginBottom: 4, fontStyle: 'italic' }}>
        «{issue.excerpt}»
      </div>
      <div style={{ fontSize: 14, color: 'var(--ink)', marginBottom: 4 }}>{issue.suggestion}</div>
      {issue.explanation && (
        <div style={{ fontSize: 12, color: 'var(--ink-40)', lineHeight: 1.5 }}>
          {issue.explanation}
        </div>
      )}
    </article>
  );
}

// applyIssueOnce — replace the first occurrence of issue.excerpt with
// issue.suggestion. Returns the new text, or null if the excerpt is no
// longer present (user already edited that span).
function applyIssueOnce(text: string, issue: WritingIssue): string | null {
  const idx = text.indexOf(issue.excerpt);
  if (idx === -1) return null;
  return text.slice(0, idx) + issue.suggestion + text.slice(idx + issue.excerpt.length);
}

function containsExcerpt(text: string, excerpt: string): boolean {
  return excerpt.length > 0 && text.indexOf(excerpt) !== -1;
}

const labelStyle: React.CSSProperties = { display: 'block' };
const labelTextStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 10,
  letterSpacing: '0.16em',
  color: 'var(--ink-40)',
  marginBottom: 6,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8,
  color: 'var(--ink)',
  padding: '8px 12px',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
};
const primaryBtnStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.1)',
  border: '1px solid rgba(255,255,255,0.16)',
  color: 'var(--ink)',
  padding: '8px 16px',
  borderRadius: 8,
  fontSize: 13,
  cursor: 'pointer',
};
const secondaryBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(255,255,255,0.08)',
  color: 'var(--ink-60)',
  padding: '8px 16px',
  borderRadius: 8,
  fontSize: 13,
  cursor: 'pointer',
};
