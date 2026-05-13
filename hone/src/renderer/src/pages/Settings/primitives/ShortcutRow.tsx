export function ShortcutRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ display: 'inline-flex', gap: 4 }}>
        {keys.map((k, i) => (
          <span key={i} className="kbd mono">
            {k}
          </span>
        ))}
      </span>
      <span style={{ fontSize: 12.5, color: 'var(--ink-60)' }}>{label}</span>
    </div>
  );
}
