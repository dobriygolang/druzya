// CodeReview — Wave 3.6 of docs/feature/plan.md (Code-review-coaching).
//
// Layout: vertical column.
//   - PR title input (optional)
//   - Diff textarea (mono-font, larger)
//   - Review textarea (where the user writes their PR comments)
//   - "Grade my review" button → LLM round-trip
//   - feedback panel: overall score chip + per-issue rows with category
//     stripes (correctness/completeness/clarity/tone)
//
// Same one-shot pattern as Writing (Wave 4.4) — no persistence, no
// session log. The user keeps their work via copy-paste; if a future
// version wants library/portfolio of past reviews we'll add a table.

import { useCallback, useMemo, useState } from 'react';

import {
  gradeCodeReview,
  type CodeReviewFeedback,
  type CodeReviewIssue,
  type CodeReviewIssueCategory,
} from '../api/codeReview';

type GradingState =
  | { kind: 'idle' }
  | { kind: 'grading' }
  | { kind: 'graded'; feedback: CodeReviewFeedback }
  | { kind: 'error'; message: string };

const CATEGORY_LABEL: Record<CodeReviewIssueCategory, string> = {
  correctness: 'CORRECTNESS',
  completeness: 'COMPLETENESS',
  clarity: 'CLARITY',
  tone: 'TONE',
};

const CATEGORY_STRIPE: Record<CodeReviewIssueCategory, string> = {
  correctness: 'rgb(248, 113, 113)',
  completeness: 'rgb(96, 165, 250)',
  clarity: 'rgb(251, 191, 36)',
  tone: 'rgb(167, 139, 250)',
};

export function CodeReviewPage() {
  const [prTitle, setPrTitle] = useState('');
  const [diff, setDiff] = useState('');
  const [review, setReview] = useState('');
  const [grading, setGrading] = useState<GradingState>({ kind: 'idle' });

  const reviewWords = useMemo(() => {
    const t = review.trim();
    if (!t) return 0;
    return t.split(/\s+/).length;
  }, [review]);

  const submit = useCallback(async () => {
    if (diff.trim() === '') {
      setGrading({ kind: 'error', message: 'Paste a diff first.' });
      return;
    }
    if (review.trim() === '') {
      setGrading({ kind: 'error', message: 'Write your review first.' });
      return;
    }
    setGrading({ kind: 'grading' });
    try {
      const fb = await gradeCodeReview({
        prTitle: prTitle.trim(),
        diffMd: diff,
        reviewMd: review,
      });
      setGrading({ kind: 'graded', feedback: fb });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      setGrading({ kind: 'error', message: msg });
    }
  }, [prTitle, diff, review]);

  const reset = useCallback(() => setGrading({ kind: 'idle' }), []);

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
      <div style={{ width: 880, maxWidth: '94%', margin: '0 auto', padding: '0 24px' }}>
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
            CODE REVIEW · COACH
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
            Practice reviewing
          </h1>
          <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--ink-60)', maxWidth: 620 }}>
            Вставь diff из PR и напиши review как будто ты ревьюишь чужой код.
            AI оценит твою точность, полноту, ясность и тон.
          </p>
        </header>

        <label style={labelStyle}>
          <span style={labelTextStyle}>PR TITLE (optional)</span>
          <input
            type="text"
            value={prTitle}
            onChange={(e) => setPrTitle(e.target.value)}
            placeholder="Add cache eviction to QueryCache"
            style={inputStyle}
            disabled={grading.kind === 'grading'}
          />
        </label>

        <label style={{ ...labelStyle, marginTop: 18 }}>
          <span style={labelTextStyle}>DIFF</span>
          <textarea
            value={diff}
            onChange={(e) => setDiff(e.target.value)}
            placeholder={'diff --git a/foo.go b/foo.go\n@@ -1,3 +1,5 @@\n…'}
            rows={14}
            style={{
              ...inputStyle,
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              fontSize: 12,
              lineHeight: 1.5,
              minHeight: 280,
            }}
            disabled={grading.kind === 'grading'}
          />
        </label>

        <label style={{ ...labelStyle, marginTop: 18 }}>
          <span style={labelTextStyle}>YOUR REVIEW</span>
          <textarea
            value={review}
            onChange={(e) => setReview(e.target.value)}
            placeholder="Line 42: this looks racy — two writers can hit AddItem at the same time. Suggest sync.Mutex around the slice."
            rows={10}
            style={{
              ...inputStyle,
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              fontSize: 13,
              lineHeight: 1.6,
              minHeight: 200,
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
            disabled={grading.kind === 'grading' || diff.trim() === '' || review.trim() === ''}
            style={primaryBtnStyle}
          >
            {grading.kind === 'grading' ? 'Grading…' : 'Grade my review'}
          </button>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-40)' }}>
            {reviewWords} words
          </span>
        </div>

        {grading.kind === 'error' && (
          <p style={{ marginTop: 12, color: 'rgb(248, 113, 113)', fontSize: 12 }}>
            {grading.message}
          </p>
        )}

        {grading.kind === 'graded' && (
          <FeedbackPanel feedback={grading.feedback} onReset={reset} />
        )}
      </div>
    </div>
  );
}

function FeedbackPanel({
  feedback,
  onReset,
}: {
  feedback: CodeReviewFeedback;
  onReset: () => void;
}) {
  const score = feedback.overallScore;
  const tier: 'strong' | 'mid' | 'weak' = score >= 80 ? 'strong' : score >= 50 ? 'mid' : 'weak';
  const stripe =
    tier === 'strong' ? 'rgb(74, 222, 128)' : tier === 'mid' ? 'rgb(251, 191, 36)' : 'rgb(248, 113, 113)';
  const label =
    tier === 'strong' ? 'Strong review' : tier === 'mid' ? 'OK — some gaps' : 'Needs work';

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
          AI didn&apos;t flag anything. Solid review.
        </p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {feedback.issues.map((issue, i) => (
            <li key={i}>
              <IssueRow issue={issue} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function IssueRow({ issue }: { issue: CodeReviewIssue }) {
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
      </div>
      {issue.excerpt && (
        <div
          style={{
            fontSize: 13,
            color: 'var(--ink-60)',
            marginBottom: 4,
            fontStyle: 'italic',
          }}
        >
          «{issue.excerpt}»
        </div>
      )}
      <div style={{ fontSize: 14, color: 'var(--ink)', marginBottom: 4 }}>
        {issue.suggestion}
      </div>
      {issue.explanation && (
        <div style={{ fontSize: 12, color: 'var(--ink-40)', lineHeight: 1.5 }}>
          {issue.explanation}
        </div>
      )}
    </article>
  );
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
