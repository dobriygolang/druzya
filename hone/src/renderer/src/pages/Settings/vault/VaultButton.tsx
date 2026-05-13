export function VaultButton({
  children,
  onClick,
  disabled,
  primary = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="focus-ring"
      style={{
        padding: '7px 14px',
        fontSize: 12.5,
        background: primary ? 'rgba(255,255,255,0.08)' : 'transparent',
        border: '1px solid var(--ink-20)',
        borderRadius: 8,
        color: 'var(--ink-90)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background-color var(--motion-dur-small) var(--motion-ease-standard), opacity var(--motion-dur-small) var(--motion-ease-standard)',
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = 'rgba(255,255,255,0.12)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = primary ? 'rgba(255,255,255,0.08)' : 'transparent';
      }}
    >
      {children}
    </button>
  );
}

export function VaultStatusBadge({ state }: { state: 'none' | 'locked' | 'unlocked' }) {
  const label = state === 'none' ? 'NOT SET UP' : state === 'locked' ? 'LOCKED' : 'UNLOCKED';
  // B/W rule: unlocked → bright ink, locked → dim, none → ghost. No green hue.
  const color = state === 'unlocked' ? 'rgb(var(--ink))' : state === 'locked' ? 'var(--ink-60)' : 'var(--ink-40)';
  return (
    <span
      className="mono"
      style={{
        fontSize: 10,
        letterSpacing: '0.08em',
        padding: '4px 10px',
        borderRadius: 999,
        border: `1px solid ${color}`,
        color,
      }}
    >
      {label}
    </span>
  );
}
