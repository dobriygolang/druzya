// Dock — the persistent bottom timer pill. Visible on every page; HomePage
// рисует свой большой mm:ss поверх когда running.
//
// Режимы таймера:
//   countdown — pomodoro 25:00 → 0 (default). Auto-end при 0 поднимает
//               reflection prompt.
//   stopwatch — ∞ от 00:00 вверх; никаких auto-end, юзер сам Stop.
//
// Hover на time-area:
//   default → mode-marker (⊙ или ∞) + mm:ss
//   hover   → две круглые кнопки (toggle-mode + reset) ВМЕСТО time-area,
//             вписанные в общий mini-pill. Время скрыто. Smooth fade
//             через --t-fast.
import { useState, type ReactNode } from 'react';

import { Icon } from './primitives/Icon';

export type TimerMode = 'countdown' | 'stopwatch';

interface DockProps {
  onMenu: () => void;
  running: boolean;
  onToggle: () => void;
  remain: number;
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
        padding: '6px 10px',
        borderRadius: 999,
        background: 'rgba(10,10,10,0.78)',
        border: '1px solid rgba(255,255,255,0.07)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        zIndex: 10,
        // @ts-expect-error — Electron CSS extension
        WebkitAppRegion: 'no-drag',
      }}
      className="no-select"
    >
      <DockBtn onClick={onMenu} title="Menu (⌘K)">
        <Icon name="menu" size={14} />
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
        <Icon name={running ? 'pause' : 'play'} size={12} />
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

// TimerArea — узкий swap-контейнер с фиксированной шириной чтобы при
// hover-смене контента dock не «дёргался» (layout shift). Время и
// hover-кнопки cross-fade'ятся через position: absolute.
function TimerArea({ running, mode, mm, ss, onToggleMode, onReset }: TimerAreaProps) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        width: 128,
        height: 30,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* default: mode-marker + mm:ss */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 7,
          opacity: hover ? 0 : 1,
          transition: 'opacity var(--t-fast)',
          pointerEvents: hover ? 'none' : 'auto',
        }}
      >
        {mode === 'stopwatch' ? (
          <span
            style={{
              color: running ? 'var(--ink-90)' : 'var(--ink-40)',
              display: 'flex',
              transition: 'color var(--t-fast)',
            }}
          >
            <Icon name="infinity" size={13} />
          </span>
        ) : (
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: 99,
              border: '1px solid var(--ink-40)',
              background: running ? 'var(--red)' : 'transparent',
              borderColor: running ? 'var(--red)' : 'var(--ink-40)',
              transition:
                'background-color var(--t-fast), border-color var(--t-fast)',
            }}
            className={running ? 'red-pulse' : ''}
          />
        )}
        <span
          className="mono"
          style={{
            fontSize: 14,
            letterSpacing: '0.04em',
            color: 'var(--ink)',
          }}
        >
          {mm}:{ss}
        </span>
      </div>

      {/* hover: широкий pill с двумя кнопками, занимает ~85% ширины
           TimerArea — как в winter.so reference */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: '7%',
          right: '7%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-around',
          background: 'rgba(255,255,255,0.06)',
          borderRadius: 999,
          padding: '0 8px',
          opacity: hover ? 1 : 0,
          transform: hover ? 'scale(1)' : 'scale(0.96)',
          transition: 'opacity var(--t-fast), transform var(--t-fast)',
          pointerEvents: hover ? 'auto' : 'none',
        }}
      >
        <DockBtn
          onClick={onToggleMode}
          title={mode === 'countdown' ? 'Switch to ∞' : 'Switch to pomodoro'}
          small
        >
          <Icon name={mode === 'countdown' ? 'infinity' : 'circle'} size={13} />
        </DockBtn>
        <DockBtn onClick={onReset} title="Reset" small>
          <Icon name="rewind" size={13} />
        </DockBtn>
      </div>
    </div>
  );
}

interface DockBtnProps {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  small?: boolean;
}

function DockBtn({ children, onClick, title, small = false }: DockBtnProps) {
  const size = small ? 24 : 28;
  return (
    <button
      onClick={onClick}
      title={title}
      className="focus-ring surface"
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--ink-60)',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
        e.currentTarget.style.color = 'var(--ink)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--ink-60)';
      }}
      onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.94)')}
      onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
    >
      {children}
    </button>
  );
}

function Divider() {
  return (
    <span
      style={{
        width: 1,
        height: 14,
        background: 'rgba(255,255,255,0.08)',
        margin: '0 2px',
      }}
    />
  );
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
        <Icon name="volume" size={12} />
      </DockBtn>
      {open && (
        <div
          onMouseLeave={() => setOpen(false)}
          className="scale-pop"
          style={{
            position: 'absolute',
            bottom: 42,
            right: -6,
            padding: '10px 12px',
            borderRadius: 10,
            background: 'rgba(10,10,10,0.92)',
            border: '1px solid rgba(255,255,255,0.08)',
            backdropFilter: 'blur(20px)',
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
