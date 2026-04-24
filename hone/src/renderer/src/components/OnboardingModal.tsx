// OnboardingModal — show ONCE on first signed-in mount.
//
// Объясняет 4 ключевых жеста: ⌘K, T, F, S. Никаких видео, никакого
// background fetch'а — текст в три карточки, single page. Esc / клик на
// «Got it» закрывает + флаг в localStorage чтобы не возвращаться.
import { Kbd } from './primitives/Kbd';

interface OnboardingModalProps {
  onClose: () => void;
}

export function OnboardingModal({ onClose }: OnboardingModalProps) {
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
          width: 600,
          maxWidth: '90%',
          padding: '40px 44px 36px',
          background: 'rgba(8,8,8,0.96)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16,
        }}
      >
        <div
          className="mono"
          style={{ fontSize: 10, letterSpacing: '.24em', color: 'var(--ink-40)' }}
        >
          WELCOME TO HONE
        </div>
        <h2
          style={{
            margin: '14px 0 8px',
            fontSize: 28,
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
            marginBottom: 28,
          }}
        >
          Hone is keyboard-first. No menus, no toolbars. Esc returns to home.
        </p>

        <Row keyHint="⌘K" title="Command palette">
          One menu, every action. Type to filter — Today, Notes, Stats,
          Daily standup all live here.
        </Row>
        <Row keyHint="T" title="Today">
          AI-generated daily plan from your Skill Atlas. Each item has a
          reason — pick one, hit FOCUS.
        </Row>
        <Row keyHint="F" title="Focus">
          Pomodoro-tracked deep work. ␣ pauses, S stops, after each session
          one quick line: what did you do?
        </Row>
        <Row keyHint="S" title="Stats">
          Quiet numbers — focus heatmap, streak, last 7 days. No vanity
          metrics, no notifications.
        </Row>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginTop: 28,
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
      </div>
    </div>
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
        gap: 18,
        padding: '12px 0',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        alignItems: 'flex-start',
      }}
    >
      <div style={{ paddingTop: 2 }}>
        <Kbd>{keyHint}</Kbd>
      </div>
      <div>
        <div style={{ fontSize: 14, color: 'var(--ink)', marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-60)', lineHeight: 1.55 }}>{children}</div>
      </div>
    </div>
  );
}
