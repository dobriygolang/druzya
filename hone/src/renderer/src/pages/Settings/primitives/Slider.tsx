export function Slider({
  min,
  max,
  step,
  value,
  onChange,
  unit,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  unit: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        style={{ flex: 1, height: 4, accentColor: '#fff', cursor: 'pointer' }}
      />
      <span
        className="mono"
        style={{ fontSize: 12, color: 'var(--ink)', minWidth: 64, textAlign: 'right' }}
      >
        {value} {unit}
      </span>
    </div>
  );
}
