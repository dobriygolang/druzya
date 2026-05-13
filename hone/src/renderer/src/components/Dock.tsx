// Dock — the persistent bottom timer pill. Visible on every page; HomePage
// рисует свой большой mm:ss поверх когда running.
//
// 6 focus modes (mirrors backend hone_focus_mode_valid CHECK миграция 00067):
//   pomodoro  — 25-min cycles + reflection prompt после finish'а
//   stopwatch — ∞ от 00:00 вверх; auto-end не срабатывает
//   free      — no timer, session tracked без mm:ss (для свободного флоу)
//   plan      — multi-block sequence (50 focus + 10 break × 3 для MVP)
//   pinned    — focus tied к pinned task; ends когда task → done
//   countdown — fixed minutes (configured pomodoroMinutes)
//
// Hover на time-area:
//   default → mode-marker + mm:ss
//   hover   → две круглые кнопки (cycle-mode + reset) ВМЕСТО time-area
//
// Mode pill (после dock'а) — отдельный mini-pill с 6 кружочками; click
// switches mode + resets timer. Сама секция collapse'ится в иконку
// текущего режима после 1.2s idle.
import { memo, useRef, useState, type ReactNode } from 'react';

import { Icon, type IconName } from './primitives/Icon';
import type { FocusMode } from '../stores/prefs';

// Legacy alias — старые callers (App.tsx pomodoro tick loop) знали только
// 'countdown'|'stopwatch'. Оставляем shorthand чтобы не переписывать App
// полностью; внутренне Dock работает с FocusMode (6 значений).
export type TimerMode = FocusMode;

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

// Phase R3 cooldown — Dock displays mm:ss so it must re-render every
// second; memoising the outer Dock itself wouldn't help (remain changes).
// Instead we wrap VolumeBtn (below) in React.memo so the volume slider's
// internal useState (open/closeTimer) doesn't tear down on every parent
// tick. The Dock body is exported normally.
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
        gap: 6,
        padding: '6px 14px',
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
      <DockBtn onClick={onMenu} title="Menu (⌘K)" ariaLabel="Open menu">
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
      <DockBtn
        onClick={onToggle}
        title={running ? 'Pause' : 'Play'}
        ariaLabel={running ? 'Pause timer' : 'Play timer'}
        ariaPressed={running}
      >
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

// MODE_LABEL — короткие подписи для tooltip'ов / aria-label'ов. Порядок
// в массиве задаёт cycle-order для hover toggle.
const MODE_ORDER: FocusMode[] = ['pomodoro', 'countdown', 'stopwatch', 'free', 'plan', 'pinned'];

const MODE_LABEL: Record<FocusMode, string> = {
  pomodoro: 'Pomodoro · 25:00 → 0 + reflection',
  countdown: 'Countdown · фиксированные минуты',
  stopwatch: 'Stopwatch · считает вверх',
  free: 'Free · без таймера, ручной stop',
  plan: 'Plan · 50/10 × 3 sequence',
  pinned: 'Pinned · focus до завершения task',
};

// Renderer для mode-indicator в default-row TimerArea + collapsed mode-pill.
// Возвращает icon name из ./primitives/Icon set'а.
function modeIcon(mode: FocusMode): { name: IconName; size: number } {
  switch (mode) {
    case 'stopwatch':
      return { name: 'infinity', size: 13 };
    case 'free':
      return { name: 'play', size: 11 };
    case 'plan':
      return { name: 'menu', size: 11 };
    case 'pinned':
      return { name: 'rewind', size: 11 };
    case 'pomodoro':
    case 'countdown':
    default:
      return { name: 'circle', size: 11 };
  }
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
  // Free / pinned не показывают mm:ss — для этих режимов рисуем mode-name.
  const showTime = mode === 'pomodoro' || mode === 'countdown' || mode === 'stopwatch';
  // Next mode in cycle — для tooltip'а «куда переключит».
  const idx = MODE_ORDER.indexOf(mode);
  const nextMode = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
  const { name: modeIconName, size: modeIconSize } = modeIcon(mode);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        // Width ужал с 128 → 96. Контент (∞/dot + mm:ss + gap=7) занимает
        // ~80px; больше места дёргало dock в шире чем нужно.
        width: 96,
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
          transition: 'transform var(--motion-dur-large) var(--motion-ease-standard)',
        }}
      >
        {/* Row 0: hover controls (изначально скрыты сверху). Иконки чуть
            крупнее (15→17) и compact gap (раньше distributed space-around
            растягивал их по краям, теперь center+gap=10 кучкует ближе друг
            к другу — как одно visual unit). */}
        <div
          style={{
            height: ROW,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            background: 'rgba(255,255,255,0.06)',
            borderRadius: 999,
            margin: '0 9%',
            padding: '0 4px',
            pointerEvents: hover ? 'auto' : 'none',
          }}
        >
          <DockBtn
            onClick={onToggleMode}
            // Tooltip показывает current + следующий режим в cycle.
            title={`${MODE_LABEL[mode]} · → ${MODE_LABEL[nextMode]}`}
            ariaLabel={`Current: ${mode}. Switch to ${nextMode} mode`}
            ariaPressed={mode !== 'pomodoro'}
            small
          >
            <Icon name={modeIconName} size={Math.max(13, modeIconSize)} />
          </DockBtn>
          <DockBtn onClick={onReset} title="Reset · сбросить таймер" ariaLabel="Reset timer" small>
            <Icon name="rewind" size={15} />
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
          {/* Mode indicator: иконка зависит от режима.
              Для pomodoro/countdown — нейтральный dot (filled когда running).
              Для остальных — соответствующий glyph из Icon set'а. */}
          {mode === 'pomodoro' || mode === 'countdown' ? (
            <span
              title={MODE_LABEL[mode]}
              style={{
                width: 9,
                height: 9,
                borderRadius: 99,
                background: running ? 'rgba(255,255,255,0.55)' : 'transparent',
                border: `1px solid ${running ? 'rgba(255,255,255,0.55)' : 'var(--ink-40)'}`,
                transition:
                  'background-color var(--t-fast), border-color var(--t-fast)',
              }}
            />
          ) : (
            <span
              title={MODE_LABEL[mode]}
              style={{
                color: running ? 'var(--ink-90)' : 'var(--ink-40)',
                display: 'flex',
                transition: 'color var(--t-fast)',
              }}
            >
              <Icon name={modeIconName} size={modeIconSize} />
            </span>
          )}
          {showTime ? (
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
          ) : (
            <span
              className="mono"
              style={{
                fontSize: 11,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--ink-60)',
              }}
            >
              {mode}
            </span>
          )}
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
  ariaLabel?: string;
  ariaPressed?: boolean;
}

function DockBtn({ children, onClick, title, small = false, ariaLabel, ariaPressed }: DockBtnProps) {
  const size = small ? 24 : 28;
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={ariaLabel ?? title}
      aria-pressed={ariaPressed}
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
const VolumeBtn = memo(VolumeBtnImpl);

function VolumeBtnImpl({ vol, onVol }: VolumeBtnProps) {
  const [open, setOpen] = useState(false);
  // preMuteVolRef хранит уровень громкости ПЕРЕД mute'ом — чтобы
  // un-mute click восстанавливал именно его, а не дефолтный 40%. Если
  // юзер был на 65%, кликнул mute → 0; кликнул unmute → обратно 65%.
  const preMuteVolRef = useRef<number>(vol > 0 ? vol : 40);
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

  // Click handler: toggle mute ↔ unmute. Раньше click открывал слайдер,
  // юзер ожидал mute-toggle (как в YouTube/Spotify/macOS). Теперь:
  //   - vol > 0 → save current, set to 0 (mute), икон меняется на strike.
  //   - vol === 0 → restore preMuteVolRef.current, иконка возвращается.
  // Slider открывается hover'ом (как раньше), не click'ом.
  const handleClick = () => {
    if (vol > 0) {
      preMuteVolRef.current = vol;
      onVol(0);
    } else {
      onVol(preMuteVolRef.current > 0 ? preMuteVolRef.current : 40);
    }
  };

  return (
    <div
      onMouseLeave={armClose}
      style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
    >
      {/* Custom track + thumb для volume slider'а. Дефолтный accentColor
          даёт ярко-белую полосу с толстым thumb'ом — юзер хотел тонкую
          едва-видную полоску (rgba 12%) и компактный белый thumb. */}
      <style>{`
        input.hone-vol-slider {
          -webkit-appearance: none;
          appearance: none;
          background: transparent;
          height: 8px;
          margin: 0;
          padding: 0;
        }
        input.hone-vol-slider:focus { outline: none; }
        input.hone-vol-slider::-webkit-slider-runnable-track {
          height: 2px;
          background: rgba(255,255,255,0.14);
          border-radius: 999px;
        }
        input.hone-vol-slider::-moz-range-track {
          height: 2px;
          background: rgba(255,255,255,0.14);
          border-radius: 999px;
          border: none;
        }
        input.hone-vol-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #fff;
          border: none;
          margin-top: -3px;
          cursor: pointer;
        }
        input.hone-vol-slider::-moz-range-thumb {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #fff;
          border: none;
          cursor: pointer;
        }
      `}</style>
      <div onMouseEnter={cancelClose}>
        <DockBtn
          onClick={handleClick}
          title={vol === 0 ? 'Click to unmute' : `Volume ${vol}% · click to mute`}
          ariaLabel={vol === 0 ? 'Unmute volume' : `Mute volume (currently ${vol} percent)`}
          ariaPressed={vol === 0}
        >
          {/* Mute indicator: когда vol=0, иконка меняет цвет на dimmed +
              рисуется diagonal strike-through через absolute-positioned
              span. Раньше юзер не видел разницы между «50%» и «mute»,
              путался почему звука нет. */}
          <span
            style={{
              position: 'relative',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: vol === 0 ? 0.5 : 1,
              transition: 'opacity var(--motion-dur-medium) var(--motion-ease-standard)',
            }}
          >
            <Icon name="volume" size={12} />
            {vol === 0 && (
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'block',
                  pointerEvents: 'none',
                  // Diagonal strike — линия из top-right в bottom-left,
                  // 1.5px белая через linear-gradient на 14px box'е.
                  background:
                    'linear-gradient(45deg, transparent 45%, var(--red) 45%, var(--red) 55%, transparent 55%)',
                  borderRadius: 2,
                }}
              />
            )}
          </span>
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
          height: 20,
          width: open ? 64 : 0,
          opacity: open ? 1 : 0,
          padding: open ? '0 6px' : '0',
          display: 'flex',
          alignItems: 'center',
          background: 'transparent',
          border: 'none',
          overflow: 'visible',
          zIndex: 11,
          transition:
            'width var(--motion-dur-medium) var(--motion-ease-standard),' +
            'opacity var(--motion-dur-medium) var(--motion-ease-standard),' +
            'transform var(--motion-dur-medium) var(--motion-ease-standard),' +
            'border-color var(--motion-dur-medium) var(--motion-ease-standard)',
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
          className="hone-vol-slider"
          style={{
            width: '100%',
            cursor: 'pointer',
          }}
        />
      </div>
    </div>
  );
}
