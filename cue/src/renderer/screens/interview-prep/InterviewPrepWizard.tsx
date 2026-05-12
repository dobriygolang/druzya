// InterviewPrepWizard.tsx — Phase J / C6 (P1).
//
// Standalone wizard separate from first-run onboarding (which lives at
// /onboarding and handles permissions+stealth-demo). This one runs
// BEFORE every interview: upload CV → upload JD → review → launch.
//
// Design follows the same B/W rules as the rest of Cue:
//   - hairlines only;
//   - 1.5px red stripe lives elsewhere (focus indicators / status dots);
//   - no gradients / fills / colour beyond #FFF and #000.
//
// Keyboard:
//   - ← / →   move between steps (when current step is "complete enough")
//   - Esc     prompts confirm if dirty, else closes the wizard
//   - Enter   advances when the current step's CTA is enabled

import { useCallback, useEffect } from 'react';

import { UploadCVStep } from './UploadCVStep';
import { UploadJDStep } from './UploadJDStep';
import { ReviewStep } from './ReviewStep';
import { LaunchStep } from './LaunchStep';
import {
  EMPTY_PARSED_CV,
  EMPTY_PARSED_JD,
  useInterviewPrepStore,
  type WizardStep,
} from '../../stores/interview-prep';

const ORDER: ReadonlyArray<WizardStep> = ['cv', 'jd', 'review', 'launch'];
const TITLES: Record<WizardStep, string> = {
  cv: 'Резюме',
  jd: 'Вакансия',
  review: 'Проверь',
  launch: 'Готово',
};

export function InterviewPrepWizard() {
  const step = useInterviewPrepStore((s) => s.step);
  const setStep = useInterviewPrepStore((s) => s.setStep);
  const parsedCV = useInterviewPrepStore((s) => s.parsedCV);
  const parsedJD = useInterviewPrepStore((s) => s.parsedJD);
  const cvText = useInterviewPrepStore((s) => s.cvText);
  const jdText = useInterviewPrepStore((s) => s.jdText);
  const jdURL = useInterviewPrepStore((s) => s.jdURL);
  const bootstrap = useInterviewPrepStore((s) => s.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Step-completion gates. Advancing without these would emit an empty
  // active-prep row that wastes LLM tokens on a useless inject block.
  const cvReady = parsedCV !== EMPTY_PARSED_CV && (parsedCV.summary.trim().length > 0 || parsedCV.topSkills.length > 0 || parsedCV.currentRole.trim().length > 0);
  const jdReady = parsedJD !== EMPTY_PARSED_JD && (parsedJD.role.trim().length > 0 || parsedJD.company.trim().length > 0 || parsedJD.keySkills.length > 0);
  const idx = ORDER.indexOf(step);
  const canGoNext =
    (step === 'cv' && cvReady) ||
    (step === 'jd' && jdReady) ||
    (step === 'review' && cvReady && jdReady) ||
    step === 'launch';

  const goNext = useCallback(() => {
    if (!canGoNext) return;
    const next = ORDER[idx + 1];
    if (next) setStep(next);
  }, [canGoNext, idx, setStep]);

  const goBack = useCallback(() => {
    const prev = ORDER[idx - 1];
    if (prev) setStep(prev);
  }, [idx, setStep]);

  const closeWizard = useCallback(() => {
    // Confirm only when user has typed/uploaded but hasn't started a
    // prep yet. The launch step itself has nothing to lose — it's
    // "Cue is ready" — so close without confirmation there.
    const dirty =
      step !== 'launch' &&
      (cvText.trim().length > 0 ||
        jdText.trim().length > 0 ||
        jdURL.trim().length > 0);
    if (dirty) {
      const ok = window.confirm(
        'Закрыть мастер? Введённые данные не сохранятся.',
      );
      if (!ok) return;
    }
    void window.druz9.windows.hide('interview-prep');
  }, [cvText, jdText, jdURL, step]);

  // Keyboard nav. Skip when the focus is in an input — letting the
  // user type Enter inside a textarea would advance unintentionally.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      const inEditable = tag === 'input' || tag === 'textarea';
      if (e.key === 'ArrowRight') {
        if (inEditable) return;
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft') {
        if (inEditable) return;
        e.preventDefault();
        goBack();
      } else if (e.key === 'Enter') {
        // Allow Enter inside textareas / URL field, advance from buttons.
        if (inEditable && tag !== 'input') return;
        if (inEditable && (document.activeElement as HTMLInputElement)?.type !== 'button') return;
        e.preventDefault();
        goNext();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeWizard();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goBack, closeWizard]);

  return (
    <div
      className="d9-root"
      style={{
        height: '100vh',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--d9-obsidian)',
        color: 'var(--d9-ink)',
        fontFamily: 'var(--d9-font-sans)',
        // Min/max + flex-wrap rule (memory/feedback_responsive_rule.md).
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <Header step={step} idx={idx} total={ORDER.length} onClose={closeWizard} />

      <main
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '24px 32px 32px',
        }}
      >
        {step === 'cv' && <UploadCVStep />}
        {step === 'jd' && <UploadJDStep />}
        {step === 'review' && <ReviewStep />}
        {step === 'launch' && <LaunchStep />}
      </main>

      <Footer
        idx={idx}
        total={ORDER.length}
        canBack={idx > 0 && step !== 'launch'}
        canNext={canGoNext && step !== 'launch'}
        onBack={goBack}
        onNext={goNext}
        step={step}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Header — progress dots + step title + close button.
// ─────────────────────────────────────────────────────────────────────────

function Header({
  step,
  idx,
  total,
  onClose,
}: {
  step: WizardStep;
  idx: number;
  total: number;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '18px 24px 12px',
        borderBottom: '0.5px solid var(--d9-hairline)',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--d9-font-mono)',
          fontSize: 10.5,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--d9-ink-ghost)',
        }}
      >
        Подготовка к интервью
      </span>
      <StepDots current={idx} total={total} />
      <span style={{ flex: 1 }} />
      <span
        style={{
          fontSize: 12,
          color: 'var(--d9-ink-mute)',
          letterSpacing: '-0.005em',
        }}
      >
        {TITLES[step]} ({idx + 1} / {total})
      </span>
      <button
        type="button"
        aria-label="Закрыть"
        onClick={onClose}
        style={{
          width: 26,
          height: 26,
          padding: 0,
          background: 'transparent',
          border: '0.5px solid var(--d9-hairline)',
          borderRadius: 6,
          color: 'var(--d9-ink-mute)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
        }}
      >
        ×
      </button>
    </div>
  );
}

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          aria-current={i === current ? 'step' : undefined}
          style={{
            width: 24,
            height: 2,
            background: i <= current ? 'var(--d9-ink)' : 'var(--d9-hairline-b)',
            borderRadius: 1,
            transition: 'background-color 220ms cubic-bezier(.2,.7,.2,1)',
          }}
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Footer — Back / Next CTA strip. Hidden on the Launch step (which has
// its own primary action).
// ─────────────────────────────────────────────────────────────────────────

function Footer({
  idx,
  total,
  canBack,
  canNext,
  onBack,
  onNext,
  step,
}: {
  idx: number;
  total: number;
  canBack: boolean;
  canNext: boolean;
  onBack: () => void;
  onNext: () => void;
  step: WizardStep;
}) {
  if (step === 'launch') return null;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 24px 18px',
        borderTop: '0.5px solid var(--d9-hairline)',
      }}
    >
      <button
        type="button"
        disabled={!canBack}
        onClick={onBack}
        style={{
          background: 'transparent',
          color: canBack ? 'var(--d9-ink)' : 'var(--d9-ink-ghost)',
          border: '0.5px solid var(--d9-hairline)',
          borderRadius: 7,
          padding: '8px 14px',
          fontSize: 12.5,
          cursor: canBack ? 'pointer' : 'not-allowed',
          fontFamily: 'inherit',
        }}
      >
        ← Назад
      </button>
      <span
        style={{
          flex: 1,
          textAlign: 'center',
          fontSize: 10.5,
          fontFamily: 'var(--d9-font-mono)',
          color: 'var(--d9-ink-ghost)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        ← → · ↵ дальше · esc закрыть
      </span>
      <button
        type="button"
        disabled={!canNext}
        onClick={onNext}
        style={{
          background: canNext ? 'var(--d9-ink)' : 'rgba(255,255,255,0.04)',
          color: canNext ? 'var(--d9-obsidian)' : 'var(--d9-ink-ghost)',
          border: '0.5px solid var(--d9-hairline)',
          borderRadius: 7,
          padding: '8px 16px',
          fontSize: 12.5,
          fontWeight: 600,
          cursor: canNext ? 'pointer' : 'not-allowed',
          fontFamily: 'inherit',
          letterSpacing: '-0.005em',
        }}
      >
        {idx >= total - 2 ? 'Старт ' : 'Дальше '}→
      </button>
    </div>
  );
}
