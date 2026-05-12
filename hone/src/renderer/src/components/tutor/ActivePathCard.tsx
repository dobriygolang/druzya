// ActivePathCard — Phase K T3 (2026-05-12).
//
// Student-side card surfaced atop TutorAssignments. Shows one curated
// path the tutor pushed: «<Path name> · step N/M · tutor: <name>» +
// hairline progress bar.
//
// Visual rules (b/w only):
//   - Hairline ink-30/50 stroke for the progress bar; no chromatic fill.
//   - var(--red) reserved for the «View next step» 1.5px stripe accent
//     (signals «next action»), not for the progress bar.
//   - No emoji / no chips on coloured backgrounds.

import type { PathAssignment } from '../../api/tutor';

interface Props {
  path: PathAssignment;
  /** Called when the user clicks «View next step». The parent scrolls /
   *  highlights the matching pending assignment in the list below. */
  onFocusStep?: (path: PathAssignment) => void;
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

export function ActivePathCard({ path, onFocusStep }: Props) {
  // Defensive: server may return total=0 for resource-only paths; we
  // already filter them out server-side but UI must never divide by zero.
  const total = path.totalSteps > 0 ? path.totalSteps : path.snapshotResourceIds.length;
  const safeTotal = total > 0 ? total : 1;
  const ratio = Math.min(1, Math.max(0, path.currentStep / safeTotal));
  // step N/M is human-1-indexed (currentStep is 0-based after first
  // assign, before any advance). When currentStep == 0 we render «1/M»
  // — the student hasn't completed anything yet, but they're working
  // on step 1.
  const displayStep = path.currentStep + 1 <= total ? path.currentStep + 1 : total;

  return (
    <article
      style={{
        padding: '14px 16px 12px',
        background: 'transparent',
        border: '1px solid var(--hair-2)',
        borderRadius: 'var(--radius-outer)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ ...captionMonoTiny, marginBottom: -2 }}>
        ACTIVE PATH
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
          {path.pathName || 'curated path'}
        </h3>
        <span
          style={{
            ...captionMonoTiny,
            color: 'var(--ink)',
            flex: '0 0 auto',
            fontSize: 11,
            letterSpacing: '0.04em',
            textTransform: 'none',
          }}
        >
          step {displayStep} / {total}
        </span>
      </div>

      {/* Hairline progress bar — b/w only. */}
      <div
        aria-label={`progress ${Math.round(ratio * 100)} percent`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={path.currentStep}
        style={{
          height: 1.5,
          background: 'var(--hair-2)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${ratio * 100}%`,
            background: 'var(--ink)',
            transition: 'width var(--motion-dur-medium) var(--motion-ease-standard)',
          }}
        />
      </div>

      <div
        className="flex-wrap-row"
        style={{ alignItems: 'center', gap: 12, marginTop: 2 }}
      >
        <span style={{ ...captionMonoTiny, color: 'var(--ink-40)' }}>
          tutor{' '}
          <span style={{ color: 'var(--ink-60)' }}>
            {path.tutorDisplayName || '—'}
          </span>
        </span>
        {onFocusStep && (
          <button
            type="button"
            onClick={() => onFocusStep(path)}
            className="focus-ring motion-press"
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              border: '1px solid var(--hair-2)',
              color: 'var(--ink)',
              padding: '5px 12px',
              borderRadius: 'var(--radius-inner)',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              transition:
                'border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
            }}
          >
            {/* v2 signature — red 1.5px stripe is the «next-action» accent. */}
            <span
              aria-hidden="true"
              style={{
                display: 'inline-block',
                width: 12,
                height: 1.5,
                background: 'var(--red)',
              }}
            />
            View next step
          </button>
        )}
      </div>
    </article>
  );
}
