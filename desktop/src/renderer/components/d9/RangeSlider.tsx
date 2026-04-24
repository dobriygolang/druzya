// RangeSlider — design-package "RangeMock" made accessible. Keeps a
// hidden native <input type="range"> underneath so keyboard/arrow-keys
// + screen reader work, then paints the custom track + glowing accent
// progress + circular thumb on top.
//
// Design reference: design/windows.jsx RangeMock (lines 473-483).
//
// Usage:
//   <RangeSlider value={70} min={0} max={100} onChange={setV} suffix="%" />

import { useId } from 'react';

interface Props {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (next: number) => void;
  /** Trailing label shown next to the value (e.g. "%", "px"). */
  suffix?: string;
  /** Max track width. Default 320 — matches design SettingRow. */
  width?: number;
  /** Hide the numeric readout on the right. */
  hideReadout?: boolean;
}

export function RangeSlider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  suffix,
  width = 320,
  hideReadout = false,
}: Props) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <label
      htmlFor={id}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        maxWidth: width,
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      <div style={{ flex: 1, position: 'relative', height: 16 }}>
        {/* Track — flat rail */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            height: 3,
            borderRadius: 2,
            background: 'oklch(1 0 0 / 0.08)',
          }}
        />
        {/* Accent progress — glows */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            width: `${pct}%`,
            height: 3,
            borderRadius: 2,
            background: 'var(--d9-accent)',
            boxShadow: '0 0 10px var(--d9-accent-glow)',
            transition: 'width var(--d9-dur-hover) var(--d9-ease)',
          }}
        />
        {/* Thumb — circular handle */}
        <div
          style={{
            position: 'absolute',
            left: `calc(${pct}% - 7px)`,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: 'var(--d9-ink)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
            pointerEvents: 'none',
            transition: 'left var(--d9-dur-hover) var(--d9-ease)',
          }}
        />
        {/* Native input — transparent on top. Accepts keyboard / pointer. */}
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            opacity: 0,
            margin: 0,
            cursor: 'pointer',
          }}
        />
      </div>
      {!hideReadout && (
        <span
          style={{
            fontFamily: 'var(--d9-font-mono)',
            fontSize: 11,
            color: 'var(--d9-ink-mute)',
            minWidth: 38,
            textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
          {suffix}
        </span>
      )}
    </label>
  );
}
