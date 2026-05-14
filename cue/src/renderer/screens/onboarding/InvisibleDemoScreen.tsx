// Step 3 — Invisible demo (C2).
//
// The whole product is stealth and the user can't see that until they
// share their screen for the first time. This screen pre-empts that
// "wait, was that supposed to happen?" moment with a side-by-side
// mockup:
//
//   ┌─────────────────────┐    ┌─────────────────────┐
//   │  What you see       │    │  What viewers see   │
//   │                     │    │                     │
//   │  [Cue compact win   │    │  [empty desktop /   │
//   │   visible, with     │    │   IDE — no Cue]     │
//   │   chat history]     │    │                     │
//   └─────────────────────┘    └─────────────────────┘
//
// The mock is drawn entirely in SVG/CSS — no real screenshots so the
// surface stays B/W-clean and we don't ship app-resolution PNGs.
// A tiny "rec" indicator on the right panel signals "this is what
// Zoom/Meet's screen-share API captures". Subtle pulse to imply live
// recording without overdoing it.
//
// Why Option A (side-by-side) over Option B (step-by-step walkthrough):
// the magic of stealth is the contrast. Step-by-step would split the
// "see / not-see" moment across two frames — easier to miss. Side-by-
// side puts both states in the user's visual field simultaneously,
// which is the actual cognitive job we're doing here.

import { useState } from 'react';

import { useT } from '@d9-i18n';
import { Button } from '../../components/primitives';

interface Props {
  onNext: () => void;
  onBack: () => void;
}

export function InvisibleDemoScreen({ onNext, onBack }: Props) {
  const t = useT();
  // Toggle that animates the "viewer" panel between "before share"
  // (Cue visible to viewer) and "stealth on" (Cue gone). Lets the user
  // play with the demo for as long as they want before continuing.
  const [stealthOn, setStealthOn] = useState(true);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 18,
        padding: '12px 28px 4px',
        width: '100%',
        maxWidth: 660,
        minWidth: 0,
      }}
    >
      <header style={{ textAlign: 'center' }}>
        <h2
          style={{
            fontFamily: 'var(--d9-font-sans)',
            fontWeight: 700,
            fontSize: 22,
            margin: '0 0 8px',
            letterSpacing: '-0.018em',
            color: 'var(--d9-ink)',
          }}
        >
          {t('cue.onboarding.invisible.title')}
        </h2>
        <p
          style={{
            fontSize: 12.5,
            lineHeight: 1.5,
            color: 'var(--d9-ink-mute)',
            margin: 0,
            letterSpacing: '-0.005em',
          }}
        >
          {t('cue.onboarding.invisible.body')}
        </p>
      </header>

      <div
        style={{
          display: 'flex',
          gap: 16,
          alignItems: 'stretch',
          minWidth: 0,
          flexWrap: 'wrap',
        }}
      >
        <DemoPane
          label={t('cue.onboarding.invisible.self_label')}
          subtitle={t('cue.onboarding.invisible.self_subtitle')}
          flavor="self"
          showCue
        />
        <DemoPane
          label={t('cue.onboarding.invisible.viewer_label')}
          subtitle={stealthOn
            ? t('cue.onboarding.invisible.viewer_subtitle_on')
            : t('cue.onboarding.invisible.viewer_subtitle_off')}
          flavor="viewer"
          showCue={!stealthOn}
          recording
        />
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          padding: '4px 0',
        }}
      >
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 12,
            color: 'var(--d9-ink-mute)',
            cursor: 'pointer',
            userSelect: 'none',
            letterSpacing: '-0.005em',
          }}
        >
          <DemoToggle on={stealthOn} onChange={setStealthOn} />
          <span>
            {t('cue.onboarding.invisible.stealth_prefix')}{' '}
            <b style={{ color: stealthOn ? 'var(--d9-ink)' : 'var(--d9-accent)' }}>
              {stealthOn ? t('cue.onboarding.invisible.stealth_on') : t('cue.onboarding.invisible.stealth_off')}
            </b>
          </span>
        </label>
        <span
          style={{
            fontSize: 10.5,
            fontFamily: 'var(--d9-font-mono)',
            color: 'var(--d9-ink-ghost)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          {t('cue.onboarding.invisible.settings_note')}
        </span>
      </div>

      <p
        style={{
          fontSize: 11.5,
          lineHeight: 1.5,
          color: 'var(--d9-ink-mute)',
          margin: 0,
          textAlign: 'center',
          letterSpacing: '-0.005em',
        }}
      >
        {t('cue.onboarding.invisible.footer_note')}
      </p>

      <footer
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginTop: 2,
        }}
      >
        <Button variant="ghost" size="sm" onClick={onBack}>
          {t('cue.prep.footer.back').replace('← ', '')}
        </Button>
        <Button variant="primary" size="md" onClick={onNext}>
          {t('cue.onboarding.invisible.cta')}
        </Button>
      </footer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// DemoPane — single panel of the side-by-side mock. `flavor` switches
// the framing: 'self' = your monitor with menubar dock; 'viewer' = a
// stylized Zoom-share frame with REC indicator.
// ─────────────────────────────────────────────────────────────────────────

function DemoPane({
  label,
  subtitle,
  flavor,
  showCue,
  recording = false,
}: {
  label: string;
  subtitle: string;
  flavor: 'self' | 'viewer';
  showCue: boolean;
  recording?: boolean;
}) {
  return (
    <div
      style={{
        flex: '1 1 220px',
        minWidth: 220,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '0 2px',
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontFamily: 'var(--d9-font-mono)',
            color: 'var(--d9-ink-dim)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          {label}
        </span>
        {recording && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 9.5,
              fontFamily: 'var(--d9-font-mono)',
              color: 'var(--d9-accent)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 6,
                height: 6,
                borderRadius: 6,
                background: 'var(--d9-accent)',
                animation: 'druz9-pulse 1.6s ease-in-out infinite',
              }}
            />
            REC
          </span>
        )}
      </div>

      <div
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 160,
          aspectRatio: '4 / 3',
          borderRadius: 10,
          border: flavor === 'viewer' ? '1px solid var(--d9-accent)' : '1px solid var(--d9-hairline-b)',
          background: 'var(--d9-void)',
          overflow: 'hidden',
        }}
      >
        {/* Faux menu bar — black strip + dots */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 14,
            background: 'rgba(255,255,255,0.04)',
            borderBottom: '0.5px solid var(--d9-hairline)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '0 8px',
          }}
        >
          <span style={dotStyle} />
          <span style={dotStyle} />
          <span style={dotStyle} />
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 8,
              fontFamily: 'var(--d9-font-mono)',
              color: 'var(--d9-ink-ghost)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            {flavor === 'viewer' ? 'zoom · sharing' : 'desktop'}
          </span>
        </div>

        {/* Faux IDE-ish content — hairline rows hint at code lines */}
        <div
          style={{
            position: 'absolute',
            top: 22,
            left: 10,
            right: 10,
            bottom: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {LINES.map((w, i) => (
            <span
              key={i}
              style={{
                display: 'block',
                height: 3,
                width: `${w}%`,
                background: 'rgba(255,255,255,0.05)',
                borderRadius: 1,
              }}
            />
          ))}
        </div>

        {/* Cue compact mockup — only shows when stealth is OFF (viewer
            sees it) or always on the self pane. Animated opacity for
            the toggle. */}
        <CueMockup visible={showCue} />
      </div>

      <span
        style={{
          fontSize: 10.5,
          color: 'var(--d9-ink-ghost)',
          letterSpacing: '-0.005em',
          padding: '0 2px',
        }}
      >
        {subtitle}
      </span>
    </div>
  );
}

const dotStyle: React.CSSProperties = {
  width: 5,
  height: 5,
  borderRadius: 5,
  background: 'rgba(255,255,255,0.18)',
};

// Hint of the kind of content a viewer would normally see — mocked
// code-line widths so the panel doesn't look empty when Cue is hidden.
const LINES = [62, 88, 40, 76, 52, 90, 30, 70, 58, 84, 44];

// ─────────────────────────────────────────────────────────────────────────
// CueMockup — a miniature of the compact floating window. Stays in sync
// visually with the real compact (cue/src/renderer/screens/compact) so
// users recognize what they're about to use.
// ─────────────────────────────────────────────────────────────────────────

function CueMockup({ visible }: { visible: boolean }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: 26,
        right: 14,
        width: 116,
        height: 32,
        borderRadius: 8,
        background: '#0a0a0a',
        border: '1px solid var(--d9-hairline-b)',
        boxShadow: '0 4px 12px -4px rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 8px',
        gap: 6,
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(-4px)',
        transition:
          'opacity 360ms cubic-bezier(.2,.7,.2,1), transform 360ms cubic-bezier(.2,.7,.2,1)',
        pointerEvents: 'none',
      }}
    >
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: 4,
          background: 'var(--d9-ink)',
          flex: '0 0 auto',
        }}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span
          style={{
            display: 'block',
            height: 2.5,
            background: 'rgba(255,255,255,0.85)',
            borderRadius: 1,
            width: '70%',
          }}
        />
        <span
          style={{
            display: 'block',
            height: 2,
            background: 'rgba(255,255,255,0.3)',
            borderRadius: 1,
            width: '90%',
          }}
        />
      </div>
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 6,
          background: 'var(--d9-accent)',
          flex: '0 0 auto',
          boxShadow: '0 0 6px rgba(255, 59, 48, 0.6)',
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// DemoToggle — pill switch matching the Settings → Stealth toggle style.
// Inlined here so the wizard doesn't depend on Settings being importable
// from anywhere (settings code paths drag in zustand stores we don't
// want to boot during onboarding).
// ─────────────────────────────────────────────────────────────────────────

function DemoToggle({ on, onChange }: { on: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        position: 'relative',
        background: on ? 'var(--d9-accent)' : 'rgba(255, 255, 255, 0.12)',
        border: 0,
        padding: 0,
        cursor: 'pointer',
        transition:
          'background var(--motion-dur-small, 160ms) var(--motion-ease-standard, cubic-bezier(.2,.7,.2,1))',
        flex: 'none',
        boxShadow: on ? '0 0 12px -2px rgba(255, 59, 48, 0.5)' : 'none',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: 'white',
          boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
          transition:
            'left var(--motion-dur-small, 160ms) var(--motion-ease-standard, cubic-bezier(.2,.7,.2,1))',
        }}
      />
    </button>
  );
}
