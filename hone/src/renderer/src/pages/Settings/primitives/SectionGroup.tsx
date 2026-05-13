export function SectionGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ margin: '0 0 56px' }}>
      <h2
        style={{
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: '-0.01em',
          color: 'var(--ink)',
          margin: '0 0 4px',
        }}
      >
        {title}
      </h2>
      <div
        aria-hidden
        style={{
          height: 1,
          background: 'rgba(255,255,255,0.08)',
          margin: '0 0 28px',
        }}
      />
      {children}
    </div>
  );
}

export function SectionHead({ label }: { label: string }) {
  return (
    <div className="mono" style={{ fontSize: 10, letterSpacing: '0.08em', color: 'var(--ink-40)' }}>
      {label}
    </div>
  );
}

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ margin: '0 0 44px' }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.08em', color: 'var(--ink-60)' }}>
        {title}
      </div>
      {hint && (
        <div style={{ fontSize: 12, color: 'var(--ink-40)', margin: '6px 0 16px' }}>{hint}</div>
      )}
      <div style={{ marginTop: hint ? 0 : 14 }}>{children}</div>
    </section>
  );
}
