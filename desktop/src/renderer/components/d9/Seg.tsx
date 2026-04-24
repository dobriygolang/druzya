// Seg — segmented control. Design-package design/windows.jsx Seg
// (lines 458-471). Pill with a subdued background, an inner-raised
// active segment, and soft hover states.
//
// Usage:
//   <Seg options={['Dark','Midnight','System']} value="Midnight" onChange={setV} />

interface Props<T extends string> {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
}

export function Seg<T extends string>({ options, value, onChange }: Props<T>) {
  return (
    <div
      style={{
        display: 'inline-flex',
        padding: 2,
        borderRadius: 8,
        background: 'oklch(1 0 0 / 0.05)',
        border: '0.5px solid var(--d9-hairline)',
      }}
    >
      {options.map((o) => {
        const active = o === value;
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            style={{
              padding: '5px 12px',
              fontSize: 12,
              fontFamily: 'inherit',
              letterSpacing: '-0.005em',
              borderRadius: 6,
              border: 0,
              cursor: 'pointer',
              background: active ? 'oklch(1 0 0 / 0.08)' : 'transparent',
              color: active ? 'var(--d9-ink)' : 'var(--d9-ink-mute)',
              boxShadow: active ? 'inset 0 0.5px 0 rgba(255,255,255,0.1)' : 'none',
              transition:
                'background var(--d9-dur-hover) var(--d9-ease), color var(--d9-dur-hover) var(--d9-ease)',
            }}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}
