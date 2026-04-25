// Dock — the persistent bottom timer pill. Visible on every page; HomePage
// рисует свой большой mm:ss поверх когда running.
//
// Режимы таймера:
//   countdown — pomodoro 25:00 → 0 (default). Auto-end при 0 поднимает
//               reflection prompt.
//   stopwatch — ∞ от 00:00 вверх; никаких auto-end, юзер сам Stop.
//
// Hover на time-area открывает inline-controls: переключение mode +
// reset (как у winter.so).
import { useState, type ReactNode } from 'react';

import { Icon } from './primitives/Icon';

export type TimerMode = 'countdown' | 'stopwatch';

interface DockProps {
  onMenu: () => void;
  running: boolean;
  onToggle: () => void;
  remain: number; // seconds — для countdown «осталось», для stopwatch «прошло»
  mode: TimerMode;
  onToggleMode: () => void;
  onReset: () => void;
  vol: number;
  onVol: (v: number) => void;
}

export function Dock({
  onMenu,
  running,
  onToggle,
  remain,
  mode,
  onToggleMode,
  onReset,
  vol,
  onVol,
}: DockProps) {
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
        // @ts-expect-error — Electron CSS
        WebkitAppRegion: 'no-drag',
      }}
      className="no-select"
    >
      <DockBtn onClick={onMenu} title="Menu (⌘K)">
        <Icon name="menu" size={15} />
      </DockBtn>
      <Divider />
      <TimerArea
        running={running}
        mode={mode}
        mm={mm}
        ss={ss}
        onToggleMode={onToggleMode}
        onReset={onReset}
      />
      <Divider />
      <DockBtn onClick={onToggle} title={running ? 'Pause' : 'Play'}>
        <Icon name={running ? 'pause' : 'play'} size={13} />
      </DockBtn>
      <Divider />
      <VolumeBtn vol={vol} onVol={onVol} />
    </div>
  );
}

interface TimerAreaProps {
  running: boolean;
  mode: TimerMode;
  mm: string;
  ss: string;
  onToggleMode: () => void;
  onReset: () => void;
}

function TimerArea({ running, mode, mm, ss, onToggleMode, onReset }: TimerAreaProps) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: hover ? 6 : 10,
        padding: hover ? '0 6px' : '0 14px',
        transition: 'gap 120ms ease, padding 120ms ease',
      }}
    >
      {hover ? (
        <>
          <DockBtn onClick={onToggleMode} title={mode === 'countdown' ? 'Switch to ∞' : 'Switch to pomodoro'}>
            <Icon name={mode === 'countdown' ? 'infinity' : 'circle'} size={13} />
          </DockBtn>
          <DockBtn onClick={onReset} title="Reset">
            <Icon name="rewind" size={13} />
          </DockBtn>
        </>
      ) : mode === 'stopwatch' ? (
        // ∞ как dock-mode marker, маленький, серый
        <span style={{ color: running ? 'var(--ink-90)' : 'var(--ink-40)', display: 'flex' }}>
          <Icon name="infinity" size={14} />
        </span>
      ) : (
        // обычный pomodoro: red-pulse точка как раньше
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 99,
            background: running ? 'var(--red)' : 'rgba(255,255,255,0.35)',
          }}
          className={running ? 'red-pulse' : ''}
        />
      )}
      <span
        className="mono"
        style={{
          fontSize: 15,
          letterSpacing: '0.02em',
          color: 'var(--ink)',
          minWidth: 56,
          textAlign: 'center',
        }}
      >
        {mm}:{ss}
      </span>
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
        width: 30,
        height: 30,
        borderRadius: 999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--ink-90)',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
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
