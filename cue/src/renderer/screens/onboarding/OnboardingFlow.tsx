// Onboarding orchestrator. The wizard ships four pages:
//
//   1. WelcomeScreen        — brand + tagline + Next
//   2. PermissionsScreen    — C1: pre-prompt CARDS explaining each TCC
//                             dialog BEFORE we trigger it. Solves the
//                             30-50% denial rate from blind prompts.
//   3. InvisibleDemoScreen  — C2: side-by-side "what you see / what
//                             screen-share viewers see" mockup. The whole
//                             point of Cue is stealth and the user
//                             can't appreciate that until they see it
//                             before going live.
//   4. CompleteScreen       — quick hotkey reference + Get Started.
//
// Why a state machine in the parent (not react-router): four routes,
// linear, no deep linking. A 5-line switch + arrow-key/Enter handler
// is half the code of pulling in @reach/router for this surface.
//
// Persisted step: localStorage('cue:onboarding:step') so if the user
// closes the wizard mid-flow and re-opens (or the app crashes), they
// resume where they left off. On full completion we wipe the key.

import { useCallback, useEffect, useRef, useState } from 'react';

import { CompleteScreen } from './CompleteScreen';
import { InvisibleDemoScreen } from './InvisibleDemoScreen';
import { PermissionsScreen } from './PermissionsScreen';
import { WelcomeScreen } from './WelcomeScreen';

export type OnboardingStep = 'welcome' | 'permissions' | 'demo' | 'complete';

const ORDER: ReadonlyArray<OnboardingStep> = ['welcome', 'permissions', 'demo', 'complete'];
const RESUME_KEY = 'cue:onboarding:step';

function readResume(): OnboardingStep {
  try {
    const v = localStorage.getItem(RESUME_KEY);
    if (v === 'welcome' || v === 'permissions' || v === 'demo' || v === 'complete') {
      return v;
    }
  } catch {
    /* SSR / private mode — fall through */
  }
  return 'welcome';
}

export function OnboardingFlow() {
  const [step, setStep] = useState<OnboardingStep>(readResume);
  const containerRef = useRef<HTMLDivElement>(null);

  // Persist the resume marker on every step transition. Avoid writing
  // 'complete' — once we hit the final screen the user is two clicks
  // away from completion + flag, no reason to leave a stale resume key
  // pointing at a screen that exists for thirty more seconds.
  useEffect(() => {
    try {
      if (step === 'complete') {
        localStorage.removeItem(RESUME_KEY);
      } else {
        localStorage.setItem(RESUME_KEY, step);
      }
    } catch {
      /* storage failure → resume just won't work; not fatal */
    }
  }, [step]);

  const idx = ORDER.indexOf(step);
  const goNext = useCallback(() => {
    setStep((cur) => {
      const i = ORDER.indexOf(cur);
      return i < ORDER.length - 1 ? ORDER[i + 1] : cur;
    });
  }, []);
  const goBack = useCallback(() => {
    setStep((cur) => {
      const i = ORDER.indexOf(cur);
      return i > 0 ? ORDER[i - 1] : cur;
    });
  }, []);

  // Keyboard navigation: ←/→ between screens (Enter to advance, Esc as
  // back). We deliberately do NOT intercept space/return inside the
  // permissions screen — clicking "Grant" there fires the real TCC
  // dialog, which traps focus on macOS until the user dismisses it.
  // Putting the listener on the container (and bailing if the active
  // element is a button) keeps focus-trap edge cases out of the picture.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goBack();
      } else if (e.key === 'Enter' && tag !== 'button') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        goBack();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goBack]);

  // Auto-focus the container on mount so arrow keys + Enter work
  // immediately without the user having to click first.
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  const onComplete = useCallback(() => {
    // Fire the main-side IPC, then leave React alone — main will hide
    // the onboarding window and show compact. Catch errors so a stray
    // EACCES on writing the flag doesn't leave the user stuck on the
    // CompleteScreen forever.
    void window.druz9.onboarding.complete().catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[onboarding] complete failed:', err);
    });
  }, []);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="d9-root"
      style={{
        height: '100vh',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--d9-obsidian)',
        color: 'var(--d9-ink)',
        fontFamily: 'var(--d9-font-sans)',
        outline: 'none',
        // Min-width / overflow guards so the flex children don't push the
        // container past the BrowserWindow's fixed 720 width. See
        // + flex-wrap. Min 0 here protects the inner column.
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <StepDots current={idx} total={ORDER.length} />

      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'stretch',
          justifyContent: 'center',
          minWidth: 0,
          minHeight: 0,
          overflow: 'auto',
        }}
      >
        {step === 'welcome' && <WelcomeScreen onNext={goNext} />}
        {step === 'permissions' && (
          <PermissionsScreen onNext={goNext} onBack={goBack} />
        )}
        {step === 'demo' && <InvisibleDemoScreen onNext={goNext} onBack={goBack} />}
        {step === 'complete' && <CompleteScreen onDone={onComplete} onBack={goBack} />}
      </div>

      {/* Step counter / hint — outside the scrollable area so it stays
          pinned regardless of card content length. */}
      <div
        style={{
          padding: '12px 24px 16px',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 16,
          fontSize: 10.5,
          fontFamily: 'var(--d9-font-mono)',
          color: 'var(--d9-ink-ghost)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        <span>{idx + 1} / {ORDER.length}</span>
        <span aria-hidden="true">·</span>
        <span>← → · ↵ дальше</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// StepDots — hairline progress bars, one per step. Filled white for the
// current+past steps, hairline for upcoming. B/W rule: no red here, red
// is reserved for live-signal indicators.
// ─────────────────────────────────────────────────────────────────────────

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        gap: 8,
        padding: '24px 0 0',
        flexWrap: 'wrap',
      }}
    >
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          aria-current={i === current ? 'step' : undefined}
          style={{
            width: 32,
            height: 3,
            borderRadius: 2,
            background:
              i <= current ? 'var(--d9-ink)' : 'var(--d9-hairline-b)',
            transition:
              'background-color var(--motion-dur-medium, 240ms) var(--motion-ease-emphasized, cubic-bezier(.2,.7,.2,1))',
          }}
        />
      ))}
    </div>
  );
}
