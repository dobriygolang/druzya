import React from 'react';

export const monoFont =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

export const shell: React.CSSProperties = {
  // Coach живёт внутри Hone shell (position:fixed inset:0). Чтобы
  // длинный контент scroll'ился, выставляем absolute fill + overflow.
  position: 'absolute',
  inset: 0,
  overflowY: 'auto',
  background: '#000',
  color: 'rgba(255,255,255,0.92)',
  padding: '60px 28px 96px',
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
  letterSpacing: '-0.005em',
};

export const innerWrap: React.CSSProperties = {
  maxWidth: 1280,
  margin: '0 auto',
};

export const headerWrap: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingTop: 8,
  paddingBottom: 20,
  gap: 16,
};

export const headerLeft: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minWidth: 80,
};

export const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(12, 1fr)',
  gap: 16,
  marginBottom: 16,
};

export const heroCard: React.CSSProperties = {
  gridColumn: 'span 8',
  background: '#0a0a0a',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 12,
  padding: 28,
  position: 'relative',
  overflow: 'hidden',
};

export const snapshotCard: React.CSSProperties = {
  gridColumn: 'span 4',
  background: '#0a0a0a',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 12,
  padding: 24,
};

export const forkCard: React.CSSProperties = {
  background: '#0a0a0a',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 12,
  padding: 28,
};

export const feedCard: React.CSSProperties = {
  background: '#0a0a0a',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 12,
  padding: 20,
  marginTop: 16,
};

export const forkGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: 16,
};

export const forkCol: React.CSSProperties = {
  background: '#111',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 10,
  padding: 20,
  position: 'relative',
};

export const leanRing: React.CSSProperties = {
  borderColor: 'rgba(255,255,255,0.18)',
};

export const forkColHead: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  marginBottom: 12,
};

export const leaningBadge: React.CSSProperties = {
  position: 'absolute',
  top: -10,
  left: 16,
  background: '#fff',
  color: '#000',
  fontSize: 10,
  fontFamily: monoFont,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  padding: '3px 8px',
  borderRadius: 4,
};

export const fillTrack: React.CSSProperties = {
  height: 4,
  background: 'rgba(255,255,255,0.07)',
  borderRadius: 2,
  overflow: 'hidden',
};

export const fillFill: React.CSSProperties = {
  height: '100%',
  background: 'rgba(255,255,255,0.7)',
  transition: 'width var(--motion-dur-medium) var(--motion-ease-standard)',
};

export const heroChips: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 18,
};

export const heroTitle: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 600,
  lineHeight: 1.18,
  letterSpacing: '-0.01em',
  color: '#fff',
  margin: '0 0 8px',
};

export const hairline: React.CSSProperties = {
  height: 1,
  background: 'rgba(255,255,255,0.07)',
  margin: '20px 0',
};

export const whyBox: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '32px 1fr',
  gap: 12,
  marginBottom: 24,
};

export const whyLabel: React.CSSProperties = {
  fontSize: 10,
  fontFamily: monoFont,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'rgba(255,255,255,0.3)',
  marginTop: 3,
};

export const heroActions: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
};

export const btnPrimary: React.CSSProperties = {
  background: '#fff',
  color: '#000',
  fontSize: 13,
  fontWeight: 500,
  padding: '8px 16px',
  borderRadius: 6,
  border: 0,
  cursor: 'pointer',
};

export const btnGhost: React.CSSProperties = {
  background: 'transparent',
  color: 'rgba(255,255,255,0.7)',
  fontSize: 13,
  padding: '8px 14px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.07)',
  cursor: 'pointer',
};

export const modeBox: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  padding: 4,
  background: '#111',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 8,
};

export const modeIndicator: React.CSSProperties = {
  position: 'absolute',
  top: 4,
  bottom: 4,
  background: '#161616',
  border: '1px solid rgba(255,255,255,0.12)',
  width: 'calc(33.33% - 2px)',
  borderRadius: 6,
  transition: 'transform var(--motion-dur-medium) var(--motion-ease-standard)',
};

export const modeBtn: React.CSSProperties = {
  position: 'relative',
  zIndex: 1,
  padding: '6px 16px',
  fontSize: 12,
  fontWeight: 500,
  letterSpacing: '0.02em',
  borderRadius: 6,
  minWidth: 92,
  background: 'transparent',
  border: 0,
  cursor: 'pointer',
};

export const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 9px',
  fontSize: 10,
  fontFamily: monoFont,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  background: '#111',
  border: '1px solid rgba(255,255,255,0.07)',
  color: 'rgba(255,255,255,0.7)',
  borderRadius: 4,
};

export const snapRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 0',
  borderBottom: '1px solid rgba(255,255,255,0.07)',
};

// ── styles + animations ─────────────────────────────────────────────────

export const CoachStyles: React.FC = () => (
  <style>{`
@keyframes coachPageFade {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.coach-page-enter { animation: coachPageFade var(--motion-dur-medium) var(--motion-ease-standard) both; }

@keyframes coachFadeUp {
  from { opacity: 0; transform: translateY(9px); }
  to   { opacity: 1; transform: translateY(0); }
}
.coach-stagger > *               { opacity: 0; animation: coachFadeUp var(--motion-dur-xlarge) var(--motion-ease-standard) forwards; }
.coach-stagger > *:nth-child(1)  { animation-delay:  60ms; }
.coach-stagger > *:nth-child(2)  { animation-delay: 130ms; }
.coach-stagger > *:nth-child(3)  { animation-delay: 200ms; }
.coach-stagger > *:nth-child(4)  { animation-delay: 270ms; }
.coach-stagger > *:nth-child(5)  { animation-delay: 340ms; }

@keyframes coachDrawPath {
  from { stroke-dashoffset: 600; opacity: 0.4; }
  to   { stroke-dashoffset: 0;   opacity: 1; }
}
.coach-radar-shape {
  stroke-dasharray: 600;
  animation: coachDrawPath 1.2s cubic-bezier(0.2,0.7,0.2,1) forwards;
  animation-delay: 700ms;
}

@keyframes coachFillBar {
  from { transform: scaleX(0); }
  to   { transform: scaleX(1); }
}
.coach-fill-bar {
  transform-origin: left;
  animation: coachFillBar 1100ms ease-out forwards;
  animation-delay: 240ms;
}
`}</style>
);
