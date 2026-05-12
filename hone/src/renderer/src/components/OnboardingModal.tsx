// OnboardingModal v2 — Phase 6 4-step wizard (Sergey 2026-05-04).
//
// Step 1: pick stack (Go / ML / DE / English / Other-explore)
// Step 2: pick mode (Explore / Commit / Deep) — shapes coach behavior
// Step 3: shortcuts tour (⌘K / T / C / F / N)
// Step 4: free vs pro — soft tier exposure (no push, юзер всегда может skip)
//
// Storage:
//   - localStorage.hone:profile:v2 — { stack, mode, savedAt }
//   - localStorage.hone:onboarded:v2 = '1' (gate в App.tsx)
//
// Recovery: «Open onboarding again» в Settings → стирает onboarded flag.
import { useState } from 'react';

import { Kbd } from './primitives/Kbd';
import { Modal } from './primitives/Modal';
import { motion as motionTokens } from '../lib/design-tokens';

interface OnboardingModalProps {
  onClose: () => void;
}

// Identity 2026-05-04 (Phase 4.1): ML-track выпилен. Specialization
// сохранена внутри dev_senior. 'ml' оставлен в union только для legacy
// localStorage migration (см saveProfile read-back).
type Stack = 'go' | 'ml' | 'de' | 'english' | 'other';
type Mode = 'explore' | 'commit' | 'deep';

const PROFILE_KEY = 'hone:profile:v2';

interface HoneProfile {
  stack: Stack | null;
  mode: Mode | null;
  savedAt: number;
}

function saveProfile(p: HoneProfile): void {
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    /* ignore quota */
  }
}

// 'ml' option выпилен из onboarding selection (Phase 4.1, identity 2026-05-04).
// ML-материалы остаются специализацией внутри dev_senior — onboarding не
// предлагает их как отдельный трек.
const STACKS: { k: Stack; l: string; d: string; g: string }[] = [
  { k: 'go', l: 'Go senior', d: 'concurrency · runtime · profiling', g: 'go' },
  { k: 'de', l: 'Data engineering', d: 'pipelines · CDC · streaming', g: '☷' },
  { k: 'english', l: 'English', d: 'B1 → B2+ for tech professionals', g: 'en' },
  { k: 'other', l: 'Other / explore', d: 'figure out which fits — 6w fork track', g: '?' },
];

const MODES: { k: Mode; l: string; d: string; trail: string }[] = [
  { k: 'explore', l: 'Explore', d: 'try multiple tracks, pick one in 4-6 weeks', trail: 'fork analysis weekly' },
  { k: 'commit', l: 'Commit', d: 'one track, build depth · 3-6 months', trail: 'milestone tracking' },
  { k: 'deep', l: 'Deep', d: 'interview prep · 2-4 weeks intensive', trail: 'daily mock dispatch' },
];

const SHORTCUTS: { k: string; l: string; d: string }[] = [
  { k: '⌘K', l: 'palette', d: 'jump anywhere · search · run command' },
  { k: 'T', l: 'today', d: 'main daily surface · plan + focus blocks' },
  { k: 'C', l: 'coach', d: 'ai companion · single next action · fork view' },
  { k: 'F', l: 'focus', d: 'start 25-min pomodoro on pinned task' },
  { k: 'N', l: 'new note', d: 'capture anywhere · auto-link to atlas' },
];

type Step = 1 | 2 | 3 | 4;

export function OnboardingModal({ onClose }: OnboardingModalProps) {
  const [open, setOpen] = useState(true);
  const [step, setStep] = useState<Step>(1);
  const [stack, setStack] = useState<Stack | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);

  // Smooth exit: flip open → Modal plays exit anim → parent unmounts after dur.medium.
  function close() {
    setOpen(false);
    window.setTimeout(onClose, motionTokens.dur.medium);
  }

  function finish() {
    saveProfile({ stack, mode, savedAt: Date.now() });
    close();
  }

  return (
    <Modal open={open} onClose={close} size="lg">
      <StepHeader step={step} />
      <div style={{ padding: '24px 0 4px' }}>
        {step === 1 && <StackPicker selected={stack} onPick={setStack} />}
        {step === 2 && <ModePicker selected={mode} onPick={setMode} />}
        {step === 3 && <ShortcutsTour />}
        {step === 4 && <TierTour />}
      </div>
      <Footer
        step={step}
        canNext={step === 1 ? !!stack : step === 2 ? !!mode : true}
        onBack={() => setStep((s) => (s > 1 ? ((s - 1) as Step) : s))}
        onNext={() => setStep((s) => (s < 4 ? ((s + 1) as Step) : s))}
        onSkip={close}
        onFinish={finish}
      />
    </Modal>
  );
}

function StepHeader({ step }: { step: Step }) {
  const titles = ['pick stack', 'pick mode', 'shortcuts tour', 'free vs pro'];
  return (
    <div style={{ paddingBottom: 12, borderBottom: '1px solid var(--hair)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 10 }}>
        <span className="mono" style={mono10}>step {step} of 4</span>
        <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
        <div style={{ display: 'flex', gap: 5 }}>
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: i === step ? '#fff' : i < step ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.15)',
              }}
            />
          ))}
        </div>
      </div>
      <h2 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em', margin: '4px 0 16px' }}>
        {titles[step - 1]}
      </h2>
    </div>
  );
}

function StackPicker({ selected, onPick }: { selected: Stack | null; onPick: (s: Stack) => void }) {
  return (
    <div>
      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', marginBottom: 16 }}>
        what are you preparing for? pick one — you can always change later in settings.
      </p>
      <div role="radiogroup" aria-label="Stack" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        {STACKS.map((s) => (
          <button
            key={s.k}
            onClick={() => onPick(s.k)}
            role="radio"
            aria-checked={selected === s.k}
            aria-pressed={selected === s.k}
            style={pickStyle(selected === s.k)}
          >
            <div style={glyphStyle()}>{s.g}</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: selected === s.k ? '#fff' : 'rgba(255,255,255,0.92)' }}>
                {s.l}
              </div>
              <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>{s.d}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ModePicker({ selected, onPick }: { selected: Mode | null; onPick: (m: Mode) => void }) {
  return (
    <div>
      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', marginBottom: 16 }}>
        mode shapes coach behavior · daily UI · what gets pinned to today.
      </p>
      <div role="radiogroup" aria-label="Mode" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        {MODES.map((m) => (
          <button
            key={m.k}
            onClick={() => onPick(m.k)}
            role="radio"
            aria-checked={selected === m.k}
            aria-pressed={selected === m.k}
            style={{
              ...pickStyle(selected === m.k),
              flexDirection: 'column' as const,
              alignItems: 'flex-start',
              gap: 4,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: selected === m.k ? '#fff' : 'rgba(255,255,255,0.92)' }}>
              {m.l}
            </div>
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.4 }}>{m.d}</div>
            <div className="mono" style={{ ...mono10, paddingTop: 6, marginTop: 6, borderTop: '1px solid rgba(255,255,255,0.07)', width: '100%' }}>
              {m.trail}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ShortcutsTour() {
  return (
    <div>
      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', marginBottom: 16 }}>
        hone is keyboard-first. these cover ~80% of daily use.
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {SHORTCUTS.map((s) => (
          <li
            key={s.k}
            style={{
              display: 'grid',
              gridTemplateColumns: '52px 1fr',
              alignItems: 'center',
              gap: 14,
              padding: '10px 14px',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 6,
              background: 'rgba(255,255,255,0.02)',
            }}
          >
            <Kbd>{s.k}</Kbd>
            <div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.92)', fontWeight: 500 }}>{s.l}</div>
              <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>{s.d}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// TierTour — soft exposure of free vs pro tiers. Sergey 2026-05-12: «pro
// tier — текст в Settings который никто не открывает». Onboarding step 4
// показывает что разблокирует Pro, без push: stay on free — кнопка primary,
// «activate pro» — secondary external link на /profile в web.
//
// Free / Pro списки — соответствуют memory/feedback_monetization.md tier matrix.
// Source of truth для cents/currency живёт в backend subscription service;
// здесь UI value-prop, не actual price processor.
const FREE_FEATURES = [
  'AI-coach с памятью · unlimited',
  'Atlas curation + Codex opinion',
  'Hone focus cockpit + offline outbox',
  'Cue 20 suggestions / day',
  'Reflection grading + activity log',
];

const PRO_FEATURES = [
  'AI-mock unlimited · 5-stage pipeline',
  'Cue unlimited LLM · premium personas',
  'Deep analytics + readiness predictions',
  'Google Calendar sync + tutor scheduling',
  'Priority Cerebras / Groq routing',
];

function TierTour() {
  return (
    <div>
      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', marginBottom: 16 }}>
        free covers learning. pro covers evaluation — interview prep, deep
        analytics, unlimited mock. byok escape: activate pro features for free
        by bringing your own LLM key.
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
        }}
      >
        <TierColumn title="free" tag="default" features={FREE_FEATURES} accent={false} />
        <TierColumn title="pro" tag="990 ₽ / mo · or byok" features={PRO_FEATURES} accent />
      </div>
      <p
        style={{
          fontSize: 11.5,
          color: 'rgba(255,255,255,0.5)',
          marginTop: 14,
          lineHeight: 1.5,
        }}
      >
        no credit card required to start. activate pro later from Settings →
        Subscription, or skip — you can use Hone fully on free.
      </p>
    </div>
  );
}

function TierColumn({
  title,
  tag,
  features,
  accent,
}: {
  title: string;
  tag: string;
  features: ReadonlyArray<string>;
  accent: boolean;
}) {
  return (
    <div
      style={{
        padding: '14px 14px',
        background: 'rgba(255,255,255,0.02)',
        border: accent ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(255,255,255,0.07)',
        borderRadius: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{title}</span>
        <span className="mono" style={{ ...mono10, color: 'rgba(255,255,255,0.5)' }}>{tag}</span>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {features.map((f) => (
          <li
            key={f}
            style={{
              fontSize: 12,
              color: 'rgba(255,255,255,0.78)',
              lineHeight: 1.4,
              paddingLeft: 14,
              position: 'relative',
            }}
          >
            <span
              aria-hidden
              style={{
                position: 'absolute',
                left: 0,
                top: '0.55em',
                width: 4,
                height: 4,
                borderRadius: 999,
                background: 'rgba(255,255,255,0.5)',
              }}
            />
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Footer({
  step,
  canNext,
  onBack,
  onNext,
  onSkip,
  onFinish,
}: {
  step: Step;
  canNext: boolean;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  onFinish: () => void;
}) {
  return (
    <div
      style={{
        marginTop: 16,
        paddingTop: 14,
        borderTop: '1px solid var(--hair)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
      }}
    >
      <button onClick={onSkip} className="mono" style={btnGhost()}>
        skip
      </button>
      <span style={{ flex: 1 }} />
      {step > 1 && (
        <button onClick={onBack} className="mono" style={btnGhost()}>
          back
        </button>
      )}
      {step < 4 ? (
        <button onClick={onNext} disabled={!canNext} className="mono" style={btnPrimary(!canNext)}>
          next →
        </button>
      ) : (
        <button onClick={onFinish} className="mono" style={btnPrimary(false)}>
          stay on free
        </button>
      )}
    </div>
  );
}

const mono10 = {
  fontSize: 10,
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
  color: 'rgba(255,255,255,0.4)',
  fontFamily: "'JetBrains Mono', monospace",
};

function pickStyle(selected: boolean): React.CSSProperties {
  return {
    padding: '14px 14px',
    background: selected ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
    border: selected ? '1px solid rgba(255,255,255,0.3)' : '1px solid rgba(255,255,255,0.07)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.92)',
    cursor: 'pointer',
    textAlign: 'left' as const,
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    fontFamily: 'inherit',
    transition: 'border-color var(--motion-dur-small) var(--motion-ease-standard)',
  };
}

function glyphStyle(): React.CSSProperties {
  return {
    flexShrink: 0,
    width: 28,
    height: 28,
    borderRadius: 5,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.07)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.85)',
  };
}

function btnGhost(): React.CSSProperties {
  return {
    padding: '6px 12px',
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.12)',
    color: 'rgba(255,255,255,0.6)',
    borderRadius: 5,
    fontSize: 11,
    letterSpacing: '.08em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    fontFamily: 'inherit',
  };
}

function btnPrimary(disabled: boolean): React.CSSProperties {
  return {
    padding: '6px 14px',
    background: '#fff',
    color: '#000',
    border: 'none',
    borderRadius: 5,
    fontSize: 11,
    letterSpacing: '.08em',
    textTransform: 'uppercase',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    fontFamily: 'inherit',
  };
}
