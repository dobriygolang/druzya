export function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (b: boolean) => void;
  label: string;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
      aria-pressed={value}
      aria-label={label}
      className="focus-ring"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        cursor: 'pointer',
        padding: 0,
        background: 'transparent',
        border: 'none',
      }}
    >
      <span
        style={{
          position: 'relative',
          width: 38,
          height: 22,
          borderRadius: 999,
          background: value ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.1)',
          border: '1px solid rgba(255,255,255,0.12)',
          transition: 'background-color var(--t-fast)',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: value ? 18 : 2,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: value ? '#000' : '#fff',
            transition: 'left var(--t-base), background-color var(--t-fast)',
          }}
        />
      </span>
      <span style={{ fontSize: 13, color: 'var(--ink-90)' }}>{label}</span>
    </button>
  );
}
