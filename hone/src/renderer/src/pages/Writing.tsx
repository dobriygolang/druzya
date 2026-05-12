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
//
// 2026-05-12: v2 visual language — underline-only inputs, white primary
// pill, hairline ghost secondary, caption-mono labels 0.08em canonical,
// motion-press + focus-ring + token-based transitions.

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

// B/W rule: семантика категорий через icon + label, не цвет. Stripe →
// ink-ramp (4 уровня opacity вместо 4 hue).
const CATEGORY_STRIPE: Record<WritingIssueCategory, string> = {
  grammar: 'rgba(255, 255, 255, 0.75)',
  vocab: 'rgba(255, 255, 255, 0.55)',
  style: 'rgba(255, 255, 255, 0.65)',
  clarity: 'rgba(255, 255, 255, 0.45)',
};

const monoFont = "'JetBrains Mono', ui-monospace, monospace";

const captionMonoTiny: React.CSSProperties = {
  fontFamily: monoFont,
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-40)',
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
      className="motion-page-in"
      style={{
        position: 'absolute',
        inset: 0,
        paddingTop: 96,
        paddingBottom: 120,
        overflowY: 'auto',
      }}
    >
      <div style={{ width: 760, maxWidth: '92%', margin: '0 auto', padding: '0 24px' }}>
        <header style={{ marginBottom: 24 }}>
          <div style={{ ...captionMonoTiny, marginBottom: 6 }}>WRITING · ENGLISH</div>
          <h1
            style={{
              margin: 0,
              fontSize: 'var(--type-h1-size)',
              lineHeight: 'var(--type-h1-lh)',
              letterSpacing: 'var(--type-h1-ls)',
              fontWeight: 'var(--type-h1-weight)',
              color: 'var(--ink)',
            }}
          >
            Draft &amp; grade
          </h1>
          <p
            style={{
              margin: '12px 0 0',
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-lh)',
              color: 'var(--ink-60)',
              maxWidth: 560,
            }}
          >
            Напиши параграф или короткое эссе. AI вернёт список конкретных issues с
            предложенными правками.
          </p>
        </header>

        <label style={labelStyle}>
          <span style={labelTextStyle}>TITLE (optional)</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What's this piece about?"
            style={underlineInput}
            onFocus={onFocusBorder}
            onBlur={onBlurBorder}
            disabled={grading.kind === 'grading'}
          />
        </label>

        <label style={{ ...labelStyle, marginTop: 22 }}>
          <span style={labelTextStyle}>DRAFT</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Start writing here…"
            rows={16}
            style={{
              ...underlineInput,
              fontFamily: "'Instrument Serif', ui-serif, Georgia, 'Times New Roman', serif",
              fontSize: 17,
              lineHeight: 1.7,
              minHeight: 320,
              resize: 'vertical',
            }}
            onFocus={onFocusBorder}
            onBlur={onBlurBorder}
            disabled={grading.kind === 'grading'}
          />
        </label>

        <div
          className="flex-wrap-row"
          style={{
            marginTop: 16,
            alignItems: 'center',
            gap: 10,
          }}
        >
          <button
            type="button"
            onClick={() => void submit()}
            disabled={grading.kind === 'grading' || text.trim() === ''}
            className="focus-ring motion-press"
            style={{
              ...primaryBtnStyle,
              opacity: grading.kind === 'grading' || text.trim() === '' ? 0.5 : 1,
              cursor: grading.kind === 'grading' || text.trim() === '' ? 'not-allowed' : 'pointer',
            }}
          >
            {grading.kind === 'grading' ? 'Grading…' : 'Get feedback'}
          </button>
          <button
            type="button"
            onClick={() => void saveToNotes()}
            disabled={text.trim() === ''}
            className="focus-ring motion-press"
            style={{
              ...secondaryBtnStyle,
              opacity: text.trim() === '' ? 0.5 : 1,
              cursor: text.trim() === '' ? 'not-allowed' : 'pointer',
            }}
          >
            Save to Notes
          </button>
          {savedNoteFlash && (
            <span
              style={{
                fontSize: 12,
                color: 'var(--ink)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span aria-hidden="true" style={{ display: 'inline-block', width: 5, height: 5, borderRadius: 999, background: 'var(--red)' }} />
              Saved →
            </span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-40)', fontFamily: monoFont }}>
            {wordCount} words
          </span>
        </div>

        {grading.kind === 'error' && (
          <p
            role="alert"
            style={{
              marginTop: 14,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              fontSize: 12,
              color: 'var(--red)',
            }}
          >
            <span aria-hidden="true" style={{ display: 'inline-block', width: 24, height: 1.5, background: 'var(--red)', marginTop: 6, flex: '0 0 auto' }} />
            <span>{grading.message}</span>
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
  // B/W rule: tier через ink-ramp + #FF3B30 для weak (signal). Strong/mid
  // отличаются opacity и label.
  const stripe =
    tier === 'strong' ? 'rgba(255, 255, 255, 0.85)' : tier === 'mid' ? 'rgba(255, 255, 255, 0.55)' : 'var(--red)';
  const label =
    tier === 'strong' ? 'Strong' : tier === 'mid' ? 'OK — some gaps' : 'Needs work';

  return (
    <section
      className="motion-stagger"
      style={{
        marginTop: 32,
        paddingTop: 24,
        borderTop: '1px solid var(--hair)',
      }}
    >
      <div
        style={{
          padding: '14px 16px',
          background: 'transparent',
          border: '1px solid var(--hair-2)',
          borderLeft: `3px solid ${stripe}`,
          borderRadius: 'var(--radius-inner)',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ ...captionMonoTiny, fontSize: 9 }}>OVERALL</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.018em', color: 'var(--ink)' }}>{score}</span>
            <span style={{ fontSize: 12, color: 'var(--ink-40)', fontFamily: monoFont }}>/ 100</span>
            <span style={{ fontSize: 13, color: 'var(--ink-60)', marginLeft: 8 }}>{label}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="focus-ring motion-press"
          style={{
            ...secondaryBtnStyle,
            marginLeft: 'auto',
            padding: '6px 14px',
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
        background: 'transparent',
        border: '1px solid var(--hair-2)',
        borderLeft: `3px solid ${CATEGORY_STRIPE[issue.category]}`,
        borderRadius: 'var(--radius-inner)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <span
          style={{
            ...captionMonoTiny,
            fontSize: 9,
            color: CATEGORY_STRIPE[issue.category],
          }}
        >
          {CATEGORY_LABEL[issue.category]}
        </span>
        <button
          type="button"
          onClick={onApply}
          disabled={!present}
          className="focus-ring motion-press"
          style={{
            ...secondaryBtnStyle,
            marginLeft: 'auto',
            padding: '4px 10px',
            fontSize: 10,
            opacity: present ? 1 : 0.4,
            cursor: present ? 'pointer' : 'not-allowed',
          }}
          title={present ? 'Replace excerpt with suggestion' : 'Excerpt no longer in draft'}
        >
          Apply fix
        </button>
      </div>
      <div
        style={{
          fontSize: 13,
          color: 'var(--ink-60)',
          marginBottom: 6,
          fontStyle: 'italic',
          fontFamily: "'Instrument Serif', ui-serif, Georgia, serif",
        }}
      >
        «{issue.excerpt}»
      </div>
      <div style={{ fontSize: 14, color: 'var(--ink)', marginBottom: 4, lineHeight: 1.5 }}>{issue.suggestion}</div>
      {issue.explanation && (
        <div style={{ fontSize: 12, color: 'var(--ink-40)', lineHeight: 1.55 }}>{issue.explanation}</div>
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

const onFocusBorder = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
  e.currentTarget.style.borderBottomColor = 'var(--ink)';
};
const onBlurBorder = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
  e.currentTarget.style.borderBottomColor = 'var(--hair-2)';
};

const labelStyle: React.CSSProperties = { display: 'block' };
const labelTextStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: monoFont,
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-40)',
  marginBottom: 8,
};
const underlineInput: React.CSSProperties = {
  width: '100%',
  background: 'transparent',
  border: 0,
  borderBottom: '1px solid var(--hair-2)',
  color: 'var(--ink)',
  padding: '8px 0',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
  transition: 'border-color var(--motion-dur-small) var(--motion-ease-decelerate)',
};
const primaryBtnStyle: React.CSSProperties = {
  background: 'var(--ink)',
  border: 0,
  color: 'var(--bg, #000)',
  padding: '9px 18px',
  borderRadius: 'var(--radius-inner)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  transition:
    'background-color var(--motion-dur-small) var(--motion-ease-standard), opacity var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
};
const secondaryBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--hair-2)',
  color: 'var(--ink-60)',
  padding: '8px 16px',
  borderRadius: 'var(--radius-inner)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  transition:
    'background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
};
