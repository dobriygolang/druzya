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
import { useRef, useState, type ReactNode } from 'react';

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
// Барабан-эффект: viewport фиксирован 30 px высотой, внутренний reel
// (60 px) держит две «полоски» — time и controls. Hover скроллит reel
// вниз на 30 px, time уезжает за нижний край viewport, controls
// приезжают сверху. Транзишн на transform = плавный «оборот барабана».
function TimerArea({ running, mode, mm, ss, onToggleMode, onReset }: TimerAreaProps) {
  const [hover, setHover] = useState(false);
  const ROW = 30;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        width: 128,
        height: ROW,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          // Reel начинается сдвинутым вверх на ROW (controls скрыты сверху,
          // time видна). На hover сдвигаем вниз на ROW — controls
          // въезжают, time уезжает.
          transform: `translateY(${hover ? 0 : -ROW}px)`,
          transition: 'transform 280ms cubic-bezier(0.2, 0.7, 0.2, 1)',
        }}
      >
        {/* Row 0: hover controls (изначально скрыты сверху) */}
        <div
          style={{
            height: ROW,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-around',
            background: 'rgba(255,255,255,0.06)',
            borderRadius: 999,
            margin: '0 9%',
            padding: '0 4px',
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

        {/* Row 1: mode-marker + mm:ss (default visible) */}
        <div
          style={{
            height: ROW,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
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
                background: running ? 'var(--red)' : 'transparent',
                border: `1px solid ${running ? 'var(--red)' : 'var(--ink-40)'}`,
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

// VolumeBtn — кнопка + slider, выезжающий справа за пределы dock-pill'а
// без layout-shift'а. Slider в своём отдельном pill'е (та же эстетика
// что у dock'а) absolute-positioned: левый край прижат к правому краю
// volume-кнопки, разворачивается вправо за границу dock'а. Таймер и
// остальные кнопки не дёргаются.
function VolumeBtn({ vol, onVol }: VolumeBtnProps) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  // hover-bridge: при mouseleave даём 180 ms на «транзит» через 14-px
  // gap к slider'у. mouseenter на slider или btn'е cancel'ит таймер.
  // Без этого slider схлопывается мгновенно когда курсор покидает btn.
  const armClose = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 180);
  };
  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
  };

  return (
    <div
      onMouseLeave={armClose}
      style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
    >
      <div onMouseEnter={cancelClose}>
        <DockBtn onClick={() => setOpen((o) => !o)} title="Volume">
          <Icon name="volume" size={12} />
        </DockBtn>
      </div>
      <div
        onMouseEnter={cancelClose}
        style={{
          position: 'absolute',
          // 14 px gap от правого края volume-кнопки — slider гарантированно
          // не наезжает на остальной dock даже при transform-overshoot.
          left: 'calc(100% + 14px)',
          top: '50%',
          transform: `translateY(-50%) translateX(${open ? '0' : '-8px'})`,
          height: 30,
          width: open ? 140 : 0,
          opacity: open ? 1 : 0,
          padding: open ? '0 14px' : '0',
          display: 'flex',
          alignItems: 'center',
          background: 'rgba(10,10,10,0.85)',
          border: open ? '1px solid rgba(255,255,255,0.07)' : '1px solid transparent',
          borderRadius: 999,
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          overflow: 'hidden',
          zIndex: 11,
          transition:
            'width 220ms cubic-bezier(0.2, 0.7, 0.2, 1),' +
            'opacity 180ms cubic-bezier(0.2, 0.7, 0.2, 1),' +
            'transform 220ms cubic-bezier(0.2, 0.7, 0.2, 1),' +
            'border-color 180ms cubic-bezier(0.2, 0.7, 0.2, 1)',
          pointerEvents: open ? 'auto' : 'none',
        }}
      >
        <input
          type="range"
          min="0"
          max="100"
          value={vol}
          onChange={(e) => onVol(parseInt(e.target.value))}
          tabIndex={open ? 0 : -1}
          style={{
            width: '100%',
            height: 4,
            accentColor: '#fff',
            cursor: 'pointer',
          }}
        />
      </div>
    </div>
  );
}
