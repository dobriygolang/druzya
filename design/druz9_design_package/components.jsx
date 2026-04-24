// components.jsx — Druz9 shared UI atoms.
// Loaded after React + tokens.css. Exports to window for cross-file use.

const { useState, useRef, useEffect, useCallback, useMemo } = React;

// ─────────────────────────────────────────────────────────────
// Desktop backdrop — a faux macOS desktop with a busy, colorful
// background so heavy-glass windows reveal something underneath.
// Users can pick which backdrop per artboard to prove readability.
// ─────────────────────────────────────────────────────────────
function Backdrop({ variant = 'aurora', children, style }) {
  const bgs = {
    // Editorial aurora — warm sunset blending into violet night
    aurora: `
      radial-gradient(1200px 600px at 10% 10%, oklch(0.85 0.18 60 / 0.9), transparent 60%),
      radial-gradient(900px 700px at 85% 30%, oklch(0.72 0.22 340 / 0.85), transparent 55%),
      radial-gradient(1100px 800px at 60% 90%, oklch(0.45 0.18 260 / 0.9), transparent 55%),
      linear-gradient(180deg, oklch(0.18 0.04 275), oklch(0.08 0.03 280))`,
    // Code editor — busy, so glass is stress-tested
    code: `
      linear-gradient(180deg, oklch(0.16 0.02 250), oklch(0.10 0.02 260))`,
    // Meeting grid — Zoom-like tile wall
    meeting: `
      linear-gradient(180deg, oklch(0.08 0.01 250), oklch(0.04 0.005 250))`,
    // Plain dark
    dark: `linear-gradient(180deg, oklch(0.14 0.02 275), oklch(0.08 0.02 275))`,
  };
  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '100%',
      background: bgs[variant] || bgs.dark,
      overflow: 'hidden',
      ...style,
    }}>
      {variant === 'code' && <CodeBackdrop />}
      {variant === 'meeting' && <MeetingBackdrop />}
      {children}
    </div>
  );
}

function CodeBackdrop() {
  // Faux code editor to simulate the actual user context
  const lines = [
    { t: 'import', c: 'kw' }, { t: ' ', c: '' }, { t: '{ useState, useEffect }', c: 'id' },
    { t: ' from ', c: 'kw' }, { t: "'react'", c: 'str' },
  ];
  const snippet = `function quickSort(arr, lo = 0, hi = arr.length - 1) {
  if (lo < hi) {
    const p = partition(arr, lo, hi);
    quickSort(arr, lo, p - 1);
    quickSort(arr, p + 1, hi);
  }
  return arr;
}

// Lomuto partition scheme — returns pivot index after placing
// pivot element at its correct sorted position.
function partition(arr, lo, hi) {
  const pivot = arr[hi];
  let i = lo - 1;
  for (let j = lo; j < hi; j++) {
    if (arr[j] <= pivot) {
      i += 1;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
  [arr[i + 1], arr[hi]] = [arr[hi], arr[i + 1]];
  return i + 1;
}`;
  return (
    <div style={{
      position: 'absolute', inset: 0,
      padding: '32px 28px',
      fontFamily: 'var(--d9-font-mono)',
      fontSize: 13, lineHeight: 1.6,
      color: 'oklch(0.6 0.04 260)',
      whiteSpace: 'pre',
      overflow: 'hidden',
    }}>
      {snippet}
      {'\n\n'}{snippet}
    </div>
  );
}

function MeetingBackdrop() {
  // Two faux webcam tiles
  const tile = (grad, initials) => (
    <div style={{
      flex: 1,
      background: grad,
      position: 'relative',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      borderRight: '2px solid #000',
    }}>
      <div style={{
        width: 64, height: 64, borderRadius: '50%',
        background: 'rgba(0,0,0,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'rgba(255,255,255,0.8)', fontSize: 22, fontWeight: 600,
        letterSpacing: '0.02em',
      }}>{initials}</div>
      <div style={{
        position: 'absolute', bottom: 12, left: 14,
        fontSize: 11, color: 'rgba(255,255,255,0.75)',
        background: 'rgba(0,0,0,0.35)', padding: '3px 8px', borderRadius: 4,
        fontFamily: 'var(--d9-font-sans)',
      }}>Interviewer</div>
    </div>
  );
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
      {tile('linear-gradient(135deg, oklch(0.35 0.08 40), oklch(0.22 0.06 20))', 'MP')}
      {tile('linear-gradient(135deg, oklch(0.28 0.10 260), oklch(0.18 0.05 270))', 'AV')}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Brand-mark — the druz9 "9" glyph inside a gradient pill.
// Takes a persona prop which sets the gradient.
// ─────────────────────────────────────────────────────────────
function BrandMark({ persona = 'sysdesign', size = 28 }) {
  const gradCls = `d9-grad-${persona}`;
  return (
    <div className={gradCls} style={{
      width: size, height: size, borderRadius: size * 0.32,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow:
        'inset 0 0.5px 0 rgba(255,255,255,0.3), ' +
        'inset 0 -0.5px 0 rgba(0,0,0,0.15), ' +
        '0 1px 2px rgba(0,0,0,0.35), ' +
        `0 0 14px -4px currentColor`,
      color: 'inherit',
      fontFamily: 'var(--d9-font-display)',
      fontStyle: 'italic',
      fontSize: size * 0.6,
      fontWeight: 500,
      lineHeight: 1,
      letterSpacing: '-0.04em',
      textShadow: '0 0.5px 0 rgba(0,0,0,0.25)',
      color: 'rgba(255,255,255,0.97)',
      userSelect: 'none',
      flex: 'none',
    }}>
      <span style={{ transform: 'translateY(1px)' }}>9</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// IconButton — ghost, hover-tinted, 32px hit target.
// ─────────────────────────────────────────────────────────────
function IconButton({ children, active, tone = 'ghost', size = 28, title, onClick }) {
  const [h, setH] = useState(false);
  const [p, setP] = useState(false);
  const bg =
    tone === 'accent'
      ? (p ? 'var(--d9-accent-lo)' : 'var(--d9-accent)')
      : active
        ? 'oklch(1 0 0 / 0.10)'
        : h ? 'oklch(1 0 0 / 0.07)' : 'transparent';
  return (
    <button
      onMouseEnter={() => setH(true)} onMouseLeave={() => { setH(false); setP(false); }}
      onMouseDown={() => setP(true)} onMouseUp={() => setP(false)}
      onClick={onClick}
      title={title}
      style={{
        width: size, height: size, borderRadius: 8,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: bg,
        color: tone === 'accent' ? 'white' : 'var(--d9-ink-dim)',
        transition: `background var(--d9-dur-hover) var(--d9-ease), color var(--d9-dur-hover)`,
        flex: 'none',
      }}
    >{children}</button>
  );
}

// ─────────────────────────────────────────────────────────────
// Kbd — keyboard chip (for hotkey hints)
// ─────────────────────────────────────────────────────────────
function Kbd({ children, size = 'md' }) {
  const h = size === 'sm' ? 18 : 22;
  const px = size === 'sm' ? 5 : 7;
  const fs = size === 'sm' ? 10 : 11;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minWidth: h, height: h, padding: `0 ${px}px`,
      borderRadius: 5,
      background: 'linear-gradient(180deg, oklch(1 0 0 / 0.09), oklch(1 0 0 / 0.04))',
      boxShadow: 'var(--d9-shadow-key)',
      color: 'var(--d9-ink-dim)',
      fontFamily: 'var(--d9-font-mono)',
      fontSize: fs,
      fontWeight: 500,
      lineHeight: 1,
      letterSpacing: '0.02em',
    }}>{children}</span>
  );
}

// ─────────────────────────────────────────────────────────────
// StatusDot — idle / thinking / streaming / error
// ─────────────────────────────────────────────────────────────
function StatusDot({ state = 'idle', size = 6 }) {
  const colors = {
    idle:      { c: 'var(--d9-ink-mute)', pulse: false },
    ready:     { c: 'var(--d9-ok)',       pulse: false },
    thinking:  { c: 'var(--d9-accent)',   pulse: true  },
    streaming: { c: 'var(--d9-accent-hi)',pulse: true  },
    error:     { c: 'var(--d9-err)',      pulse: false },
  };
  const cfg = colors[state] || colors.idle;
  return (
    <span style={{
      position: 'relative',
      width: size, height: size, borderRadius: '50%',
      background: cfg.c,
      boxShadow: `0 0 6px ${cfg.c}`,
      flex: 'none',
    }}>
      {cfg.pulse && (
        <span style={{
          position: 'absolute', inset: -3, borderRadius: '50%',
          border: `1px solid ${cfg.c}`,
          opacity: 0.5,
          animation: 'd9pulse 1.4s ease-out infinite',
        }} />
      )}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// PersonaChip — picker chip in compact + active state in expanded
// ─────────────────────────────────────────────────────────────
const PERSONAS = [
  { id: 'react',     label: 'React',          sub: 'Frontend · React 19', grad: 'd9-grad-react',    hot: '1' },
  { id: 'sysdesign', label: 'System Design',  sub: 'HLD · scaling',        grad: 'd9-grad-sysdesign',hot: '2' },
  { id: 'sre',       label: 'Go / SRE',       sub: 'Go · K8s · reliability',grad: 'd9-grad-sre',    hot: '3' },
  { id: 'behav',     label: 'Behavioral',     sub: 'STAR · leadership',    grad: 'd9-grad-behav',   hot: '4' },
  { id: 'dsa',       label: 'DSA',            sub: 'Algorithms · LC',      grad: 'd9-grad-dsa',     hot: '5' },
];
const PERSONA = Object.fromEntries(PERSONAS.map(p => [p.id, p]));

function PersonaChip({ personaId = 'sysdesign', compact = false }) {
  const p = PERSONA[personaId] || PERSONA.sysdesign;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: compact ? '2px 8px 2px 4px' : '4px 10px 4px 5px',
      height: compact ? 22 : 26,
      borderRadius: 999,
      background: 'oklch(1 0 0 / 0.06)',
      border: '0.5px solid var(--d9-hairline)',
      color: 'var(--d9-ink-dim)',
      fontSize: compact ? 11 : 12,
      fontWeight: 500,
      letterSpacing: '-0.005em',
    }}>
      <span className={p.grad} style={{
        width: compact ? 14 : 16, height: compact ? 14 : 16, borderRadius: '50%',
        boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.3), 0 0 8px -2px currentColor',
      }} />
      <span>{p.label}</span>
      <Caret />
    </span>
  );
}

function Caret() {
  return (
    <svg width="8" height="5" viewBox="0 0 8 5" fill="none" style={{ opacity: 0.5 }}>
      <path d="M1 1L4 4L7 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Icons — line-based, one stroke weight, feather-ish without being feather.
const Icon = {
  camera: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="4" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
      <circle cx="8" cy="8.5" r="2.4" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M5.5 4L6.5 2.5H9.5L10.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    </svg>
  ),
  settings: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M8 1.5v1.7M8 12.8v1.7M14.5 8h-1.7M3.2 8H1.5M12.6 3.4l-1.2 1.2M4.6 11.4l-1.2 1.2M12.6 12.6l-1.2-1.2M4.6 4.6L3.4 3.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  ),
  arrow: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <path d="M8 2.5V13.5M8 2.5L4 6.5M8 2.5L12 6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  close: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 12 12" fill="none">
      <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  ),
  expand: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <path d="M3 10V13H6M13 6V3H10M13 3L9 7M3 13L7 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  collapse: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <path d="M6 3V6H3M10 13V10H13M10 10L13 13M6 6L3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  copy: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 14 14" fill="none">
      <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.1"/>
      <path d="M10 3.5V2.5C10 2 9.5 1.5 9 1.5H3C2.5 1.5 2 2 2 2.5V8.5C2 9 2.5 9.5 3 9.5H4" stroke="currentColor" strokeWidth="1.1"/>
    </svg>
  ),
  send: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <path d="M3 8L13 3L10 13L8 9L3 8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="currentColor" fillOpacity="0.15"/>
    </svg>
  ),
  sparkle: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 12 12" fill="none">
      <path d="M6 1L7 5L11 6L7 7L6 11L5 7L1 6L5 5L6 1Z" stroke="currentColor" strokeWidth="1" fill="currentColor" fillOpacity="0.15" strokeLinejoin="round"/>
    </svg>
  ),
  mic: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <rect x="6" y="2" width="4" height="7" rx="2" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M3.5 8C3.5 10.5 5.5 12 8 12M8 12C10.5 12 12.5 10.5 12.5 8M8 12V14.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  ),
  check: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 12 12" fill="none">
      <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
};

// ─────────────────────────────────────────────────────────────
// Kbd-stack — inline row of keys
// ─────────────────────────────────────────────────────────────
function Kbds({ keys, size = 'md', sep }) {
  const parts = [];
  keys.forEach((k, i) => {
    if (i > 0) parts.push(<span key={`s${i}`} style={{
      color: 'var(--d9-ink-ghost)', fontSize: size === 'sm' ? 9 : 10, margin: '0 1px',
    }}>{sep ?? '+'}</span>);
    parts.push(<Kbd key={k+i} size={size}>{k}</Kbd>);
  });
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>{parts}</span>;
}

// ─────────────────────────────────────────────────────────────
// MessageBubble — user (right, tinted) / assistant (left, prose)
// ─────────────────────────────────────────────────────────────
function MessageBubble({ role, children, thumb, streaming, density = 'comfy' }) {
  if (role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: density === 'compact' ? 10 : 16 }}>
        <div style={{
          maxWidth: '78%',
          padding: '10px 14px',
          borderRadius: '14px 14px 4px 14px',
          background: 'linear-gradient(180deg, oklch(0.38 0.18 298), oklch(0.30 0.20 295))',
          color: 'var(--d9-ink)',
          fontSize: 13.5,
          lineHeight: 1.5,
          letterSpacing: '-0.005em',
          boxShadow:
            'inset 0 0.5px 0 oklch(1 0 0 / 0.15),' +
            '0 1px 2px rgba(0,0,0,0.3)',
        }}>
          {thumb && (
            <div style={{
              marginBottom: 8,
              padding: 2,
              borderRadius: 8,
              background: 'rgba(0,0,0,0.25)',
            }}>
              <div style={{
                height: 62,
                borderRadius: 6,
                background: thumb === 'code'
                  ? 'repeating-linear-gradient(135deg, oklch(0.22 0.04 280), oklch(0.22 0.04 280) 6px, oklch(0.18 0.04 280) 6px, oklch(0.18 0.04 280) 12px)'
                  : 'linear-gradient(135deg, oklch(0.35 0.10 40), oklch(0.25 0.08 20))',
                display: 'flex', alignItems: 'flex-end', padding: 6,
                fontFamily: 'var(--d9-font-mono)', fontSize: 9,
                color: 'oklch(1 0 0 / 0.5)',
              }}>
                <span>{thumb === 'code' ? '/Users/m/problems/two-sum.ts · 1280×220' : 'screen · 1440×380'}</span>
              </div>
            </div>
          )}
          {children}
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', marginBottom: density === 'compact' ? 12 : 20, gap: 10 }}>
      <div style={{ width: 22, flex: 'none', paddingTop: 2 }}>
        <div style={{
          width: 18, height: 18, borderRadius: 5,
          background: 'var(--d9-slate)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--d9-ink-dim)',
        }}>
          {Icon.sparkle(10)}
        </div>
      </div>
      <div style={{
        flex: 1,
        fontSize: 13.5,
        lineHeight: 1.65,
        letterSpacing: '-0.002em',
        color: 'var(--d9-ink)',
      }}>
        {children}
        {streaming && <span className="d9-caret" />}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// CodeBlock — flat mono, language chip, copy button
// ─────────────────────────────────────────────────────────────
function CodeBlock({ lang = 'ts', children, filename }) {
  return (
    <div style={{
      margin: '8px 0 12px',
      borderRadius: 10,
      background: 'oklch(0.11 0.03 280 / 0.75)',
      border: '0.5px solid var(--d9-hairline)',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center',
        padding: '6px 8px 6px 12px',
        borderBottom: '0.5px solid var(--d9-hairline)',
        background: 'oklch(1 0 0 / 0.02)',
      }}>
        <span style={{
          fontFamily: 'var(--d9-font-mono)',
          fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase',
          color: 'var(--d9-ink-ghost)',
        }}>{lang}</span>
        {filename && (
          <span style={{
            marginLeft: 10, fontFamily: 'var(--d9-font-mono)', fontSize: 11,
            color: 'var(--d9-ink-mute)',
          }}>{filename}</span>
        )}
        <span style={{ flex: 1 }} />
        <button style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '3px 7px', borderRadius: 5,
          color: 'var(--d9-ink-mute)', fontSize: 10.5, letterSpacing: '0.02em',
        }}>
          {Icon.copy(11)} Copy
        </button>
      </div>
      <pre style={{
        margin: 0, padding: '10px 12px 12px',
        fontFamily: 'var(--d9-font-mono)',
        fontSize: 12, lineHeight: 1.65,
        color: 'var(--d9-ink-dim)',
        whiteSpace: 'pre',
        overflow: 'auto',
      }}>{children}</pre>
    </div>
  );
}

// Syntax-color spans — minimal, tasteful, not VS Code.
const S = {
  kw: (s) => <span style={{ color: 'oklch(0.78 0.14 300)' }}>{s}</span>,
  fn: (s) => <span style={{ color: 'oklch(0.85 0.12 200)' }}>{s}</span>,
  str:(s) => <span style={{ color: 'oklch(0.82 0.13 70)' }}>{s}</span>,
  num:(s) => <span style={{ color: 'oklch(0.80 0.15 150)' }}>{s}</span>,
  cm: (s) => <span style={{ color: 'var(--d9-ink-ghost)', fontStyle: 'italic' }}>{s}</span>,
  id: (s) => <span style={{ color: 'var(--d9-ink)' }}>{s}</span>,
};

// ─────────────────────────────────────────────────────────────
// QuotaMeter — compact bar, tabular numerics
// ─────────────────────────────────────────────────────────────
function QuotaMeter({ used = 38, cap = 100, label = 'Requests', tone = 'accent' }) {
  const pct = Math.min(100, (used / cap) * 100);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
      <span style={{
        fontFamily: 'var(--d9-font-mono)', fontSize: 10,
        color: 'var(--d9-ink-ghost)', letterSpacing: '0.04em',
      }}>{label.toUpperCase()}</span>
      <div style={{
        flex: 1, height: 3, borderRadius: 2,
        background: 'oklch(1 0 0 / 0.08)', overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: pct + '%',
          background: 'linear-gradient(90deg, var(--d9-accent-lo), var(--d9-accent-hi))',
          boxShadow: `0 0 6px var(--d9-accent-glow)`,
        }} />
      </div>
      <span style={{
        fontFamily: 'var(--d9-font-mono)', fontSize: 10,
        color: 'var(--d9-ink-dim)', fontVariantNumeric: 'tabular-nums',
      }}>{used}<span style={{ color: 'var(--d9-ink-ghost)' }}>/{cap}</span></span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// WindowShell — heavy-glass container with variable shape.
// Used for compact, expanded, area-hint, etc.
// ─────────────────────────────────────────────────────────────
function WindowShell({ width, height, radius = 18, children, style, glass = 'heavy' }) {
  const bg = glass === 'heavy'
    ? 'linear-gradient(180deg, oklch(0.16 0.04 278 / 0.72), oklch(0.12 0.035 278 / 0.82))'
    : glass === 'medium'
    ? 'linear-gradient(180deg, oklch(0.16 0.04 278 / 0.88), oklch(0.12 0.035 278 / 0.94))'
    : 'linear-gradient(180deg, oklch(0.17 0.04 278), oklch(0.12 0.035 278))';
  return (
    <div style={{
      width, height, borderRadius: radius,
      background: bg,
      backdropFilter: glass !== 'opaque' ? 'var(--d9-glass-blur)' : 'none',
      WebkitBackdropFilter: glass !== 'opaque' ? 'var(--d9-glass-blur)' : 'none',
      boxShadow: 'var(--d9-shadow-win)',
      color: 'var(--d9-ink)',
      fontFamily: 'var(--d9-font-sans)',
      position: 'relative',
      overflow: 'hidden',
      ...style,
    }}>
      {/* Inner hairline highlight */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: 'inherit',
        border: '0.5px solid var(--d9-hairline-b)', pointerEvents: 'none',
      }} />
      {children}
    </div>
  );
}

// Export to window so other babel scripts can use
Object.assign(window, {
  Backdrop, BrandMark, IconButton, Kbd, Kbds, StatusDot, PersonaChip, Caret,
  Icon, MessageBubble, CodeBlock, S, QuotaMeter, WindowShell, PERSONAS, PERSONA,
});
