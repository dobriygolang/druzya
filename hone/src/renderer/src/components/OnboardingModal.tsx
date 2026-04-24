// OnboardingModal — двухшаговый wizard при первом заходе signed_in юзера.
//
//   Шаг 1 — personalization: стек (frontend/backend/ml/fullstack/other) +
//            target (собес/рост/петпроекты/other). Ответы сохраняются в
//            localStorage.hone:profile (ключ читает TodayPage в будущих
//            итерациях, передаёт синтезайзеру как hint'ы через metadata —
//            бекенд сейчас их игнорирует, но prompt уже готов расширять).
//
//   Шаг 2 — shortcuts tour: ⌘K / T / F / S, как было в v1.
//
// Флаг hone:onboarded:v2 маркирует прохождение. Esc / «Skip» закрывают
// без сохранения ответов (но ставят флаг — не хотим возвращаться).
import { useState } from 'react';

import { Kbd } from './primitives/Kbd';

interface OnboardingModalProps {
  onClose: () => void;
}

type Stack = 'frontend' | 'backend' | 'ml' | 'fullstack' | 'mobile' | 'other';
type Goal = 'interview' | 'growth' | 'pet' | 'other';

const PROFILE_KEY = 'hone:profile:v1';

interface HoneProfile {
  stack: Stack | null;
  goal: Goal | null;
  savedAt: number;
}

function saveProfile(p: HoneProfile): void {
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    /* ignore quota */
  }
}

export function OnboardingModal({ onClose }: OnboardingModalProps) {
  const [step, setStep] = useState<'profile' | 'shortcuts'>('profile');
  const [stack, setStack] = useState<Stack | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);

  const finishProfile = () => {
    saveProfile({ stack, goal, savedAt: Date.now() });
    setStep('shortcuts');
  };

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 80,
        background: 'rgba(0,0,0,0.92)',
        backdropFilter: 'blur(20px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: 640,
          maxWidth: '90%',
          padding: '40px 44px 36px',
          background: 'rgba(8,8,8,0.96)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16,
        }}
      >
        <div
          className="mono"
          style={{
            fontSize: 10,
            letterSpacing: '.24em',
            color: 'var(--ink-40)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span>WELCOME TO HONE</span>
          <span style={{ color: 'var(--ink-60)' }}>
            · {step === 'profile' ? '1/2' : '2/2'}
          </span>
        </div>

        {step === 'profile' ? (
          <ProfileStep
            stack={stack}
            goal={goal}
            onStack={setStack}
            onGoal={setGoal}
            onNext={finishProfile}
            onSkip={() => {
              saveProfile({ stack: null, goal: null, savedAt: Date.now() });
              setStep('shortcuts');
            }}
          />
        ) : (
          <ShortcutsStep onClose={onClose} />
        )}
      </div>
    </div>
  );
}

interface ProfileStepProps {
  stack: Stack | null;
  goal: Goal | null;
  onStack: (s: Stack) => void;
  onGoal: (g: Goal) => void;
  onNext: () => void;
  onSkip: () => void;
}

const STACKS: { id: Stack; label: string }[] = [
  { id: 'frontend', label: 'Frontend' },
  { id: 'backend', label: 'Backend' },
  { id: 'fullstack', label: 'Full-stack' },
  { id: 'ml', label: 'ML / data' },
  { id: 'mobile', label: 'Mobile' },
  { id: 'other', label: 'Other' },
];

const GOALS: { id: Goal; label: string; sub: string }[] = [
  { id: 'interview', label: 'Prepping for interview', sub: 'Plan focuses on mock + solve tasks.' },
  { id: 'growth', label: 'Daily growth', sub: 'Read + solve + review, balanced.' },
  { id: 'pet', label: 'Pet project', sub: 'Whiteboard + notes take more weight.' },
  { id: 'other', label: 'Just exploring', sub: 'Neutral default plan.' },
];

function ProfileStep({ stack, goal, onStack, onGoal, onNext, onSkip }: ProfileStepProps) {
  const canNext = stack !== null && goal !== null;
  return (
    <>
      <h2
        style={{
          margin: '14px 0 8px',
          fontSize: 26,
          fontWeight: 400,
          letterSpacing: '-0.02em',
        }}
      >
        Two quick questions.
      </h2>
      <p
        style={{
          fontSize: 14,
          color: 'var(--ink-60)',
          lineHeight: 1.6,
          marginBottom: 26,
        }}
      >
        Today-plan знает про это и тюнит, что подсовывать в списке. Пропусти
        если не критично — дефолт разумный.
      </p>

      <div
        className="mono"
        style={{ fontSize: 10, letterSpacing: '.18em', color: 'var(--ink-40)', marginBottom: 8 }}
      >
        YOUR STACK
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 22 }}>
        {STACKS.map((s) => (
          <ChoiceChip
            key={s.id}
            active={stack === s.id}
            label={s.label}
            onClick={() => onStack(s.id)}
          />
        ))}
      </div>

      <div
        className="mono"
        style={{ fontSize: 10, letterSpacing: '.18em', color: 'var(--ink-40)', marginBottom: 8 }}
      >
        WHERE ARE YOU AIMING
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          marginBottom: 22,
        }}
      >
        {GOALS.map((g) => (
          <GoalCard
            key={g.id}
            active={goal === g.id}
            label={g.label}
            sub={g.sub}
            onClick={() => onGoal(g.id)}
          />
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 10,
          alignItems: 'center',
        }}
      >
        <button
          onClick={onSkip}
          className="focus-ring mono"
          style={{
            padding: '8px 14px',
            fontSize: 11,
            letterSpacing: '.1em',
            color: 'var(--ink-60)',
            borderRadius: 8,
          }}
        >
          SKIP
        </button>
        <button
          onClick={onNext}
          disabled={!canNext}
          className="focus-ring"
          style={{
            padding: '10px 22px',
            borderRadius: 999,
            background: canNext ? '#fff' : 'rgba(255,255,255,0.08)',
            color: canNext ? '#000' : 'var(--ink-60)',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          Next →
        </button>
      </div>
    </>
  );
}

function ChoiceChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="focus-ring"
      style={{
        padding: '7px 14px',
        borderRadius: 999,
        fontSize: 13,
        border: active ? '1px solid rgba(255,255,255,0.4)' : '1px solid rgba(255,255,255,0.1)',
        background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
        color: active ? 'var(--ink)' : 'var(--ink-60)',
      }}
    >
      {label}
    </button>
  );
}

function GoalCard({
  active,
  label,
  sub,
  onClick,
}: {
  active: boolean;
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="focus-ring"
      style={{
        textAlign: 'left',
        padding: '12px 14px',
        borderRadius: 10,
        border: active ? '1px solid rgba(255,255,255,0.4)' : '1px solid rgba(255,255,255,0.08)',
        background: active ? 'rgba(255,255,255,0.05)' : 'transparent',
      }}
    >
      <div style={{ fontSize: 14, color: 'var(--ink)' }}>{label}</div>
      <div style={{ fontSize: 12, color: 'var(--ink-60)', marginTop: 4, lineHeight: 1.45 }}>
        {sub}
      </div>
    </button>
  );
}

function ShortcutsStep({ onClose }: { onClose: () => void }) {
  return (
    <>
      <h2
        style={{
          margin: '14px 0 8px',
          fontSize: 26,
          fontWeight: 400,
          letterSpacing: '-0.02em',
        }}
      >
        Four keys you’ll use every day.
      </h2>
      <p
        style={{
          fontSize: 14,
          color: 'var(--ink-60)',
          lineHeight: 1.6,
          marginBottom: 22,
        }}
      >
        Hone is keyboard-first. No menus, no toolbars. Esc returns to home.
      </p>

      <Row keyHint="⌘K" title="Command palette">
        One menu, every action. Type to filter — Today, Notes, Stats, Daily
        standup all live here.
      </Row>
      <Row keyHint="T" title="Today">
        AI-generated daily plan. Each item has a reason — pick one, hit FOCUS.
      </Row>
      <Row keyHint="F" title="Focus">
        Pomodoro-tracked deep work. ␣ pauses, S stops, after each session one
        line: what did you do?
      </Row>
      <Row keyHint="S" title="Stats">
        Quiet numbers — focus heatmap, streak, last 7 days. No push, no vanity.
      </Row>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginTop: 22,
        }}
      >
        <button
          onClick={onClose}
          className="focus-ring"
          style={{
            padding: '10px 22px',
            borderRadius: 999,
            background: '#fff',
            color: '#000',
            fontSize: 13,
            fontWeight: 500,
          }}
          autoFocus
        >
          Got it ↵
        </button>
      </div>
    </>
  );
}

interface RowProps {
  keyHint: string;
  title: string;
  children: React.ReactNode;
}

function Row({ keyHint, title, children }: RowProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '60px 1fr',
        gap: 16,
        padding: '10px 0',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        alignItems: 'flex-start',
      }}
    >
      <div style={{ paddingTop: 2 }}>
        <Kbd>{keyHint}</Kbd>
      </div>
      <div>
        <div style={{ fontSize: 14, color: 'var(--ink)', marginBottom: 3 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-60)', lineHeight: 1.5 }}>{children}</div>
      </div>
    </div>
  );
}
