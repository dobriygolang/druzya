// Dock — the persistent bottom timer pill. Visible on every page except
// Focus (where the giant timer takes over). Holds four controls: menu
// opener (⌘K), the mm:ss display with a live-pulse dot, play/pause, and
// a volume sub-popover.
//
// The mm:ss is kept in the App-level store (not here) so the Focus page
// can share the same ticker. Dock is a pure view — all mutations flow
// back through its callbacks.
import { useState, type ReactNode } from 'react';

import { Icon } from './primitives/Icon';

interface DockProps {
  onMenu: () => void;
  running: boolean;
  onToggle: () => void;
  remain: number; // seconds
  vol: number;
  onVol: (v: number) => void;
}

export function Dock({ onMenu, running, onToggle, remain, vol, onVol }: DockProps) {
  const mm = String(Math.floor(remain / 60)).padStart(2, '0');
  const ss = String(remain % 60).padStart(2, '0');
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 36,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: 6,
        borderRadius: 999,
        background: 'rgba(10,10,10,0.72)',
        border: '1px solid rgba(255,255,255,0.08)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        zIndex: 10,
      }}
      className="no-select"
    >
      <DockBtn onClick={onMenu} title="Menu (⌘K)">
        <Icon name="menu" size={15} />
      </DockBtn>
      <Divider />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px' }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 99,
            background: running ? 'var(--red)' : 'rgba(255,255,255,0.35)',
          }}
          className={running ? 'red-pulse' : ''}
        />
        <span className="mono" style={{ fontSize: 15, letterSpacing: '0.02em', color: 'var(--ink)' }}>
          {mm}:{ss}
        </span>
      </div>
      <Divider />
      <DockBtn onClick={onToggle} title={running ? 'Pause' : 'Play'}>
        <Icon name={running ? 'pause' : 'play'} size={13} />
      </DockBtn>
      <Divider />
      <VolumeBtn vol={vol} onVol={onVol} />
    </div>
  );
}

interface DockBtnProps {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
}

function DockBtn({ children, onClick, title }: DockBtnProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="focus-ring"
      style={{
        width: 34,
        height: 34,
        borderRadius: 999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--ink-90)',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.08)' }} />;
}

interface VolumeBtnProps {
  vol: number;
  onVol: (v: number) => void;
}

function VolumeBtn({ vol, onVol }: VolumeBtnProps) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <DockBtn onClick={() => setOpen((o) => !o)} title="Volume">
        <Icon name="volume" size={13} />
      </DockBtn>
      {open && (
        <div
          onMouseLeave={() => setOpen(false)}
          style={{
            position: 'absolute',
            bottom: 46,
            right: -6,
            padding: '10px 12px',
            borderRadius: 10,
            background: 'rgba(10,10,10,0.9)',
            border: '1px solid rgba(255,255,255,0.08)',
            backdropFilter: 'blur(18px)',
          }}
        >
          <input
            type="range"
            min="0"
            max="100"
            value={vol}
            onChange={(e) => onVol(parseInt(e.target.value))}
            style={{ width: 110, accentColor: '#fff' }}
          />
        </div>
      )}
    </div>
  );
}
