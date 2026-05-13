// Shared primitives used across Settings tabs: SectionTitle, Row, Toggle,
// selectStyle and small format/util helpers. Extracted from SettingsScreen
// so individual tabs can import what they need without re-declaring.

import { translate } from '@d9-i18n';

export function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <h2
        style={{
          fontFamily: 'var(--d9-font-sans)',
          fontWeight: 700,
          fontSize: 22,
          letterSpacing: '-0.02em',
          margin: 0,
          color: 'var(--d9-ink)',
          lineHeight: 1.2,
        }}
      >
        {title}
      </h2>
      {subtitle && (
        <p
          style={{
            fontSize: 12.5,
            color: 'var(--d9-ink-mute)',
            margin: '6px 0 0',
            letterSpacing: '-0.005em',
          }}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}

// SettingRow — design/windows.jsx:446-456 SettingRow pattern.
// 180px label column + 1fr control; hairline separator below.
export function Row({
  title,
  hint,
  control,
}: {
  title: string;
  hint?: string;
  control: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '200px 1fr',
        alignItems: 'center',
        gap: 24,
        padding: '14px 0',
        borderBottom: '0.5px solid var(--d9-hairline)',
      }}
    >
      <div>
        <div
          style={{
            fontSize: 12.5,
            color: 'var(--d9-ink)',
            fontWeight: 500,
            letterSpacing: '-0.005em',
          }}
        >
          {title}
        </div>
        {hint && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--d9-ink-ghost)',
              marginTop: 3,
              lineHeight: 1.4,
              letterSpacing: '-0.002em',
            }}
          >
            {hint}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>{control}</div>
    </div>
  );
}

/**
 * Toggle — d9-style pill switch. design/windows.jsx:485-501 Toggle mock.
 */
export function Toggle({ on, onChange }: { on: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        position: 'relative',
        background: on ? 'var(--d9-accent)' : 'rgba(255, 255, 255, 0.1)',
        boxShadow: on ? '0 0 12px -2px var(--d9-accent-glow)' : 'none',
        border: 0,
        padding: 0,
        cursor: 'pointer',
        transition: 'background var(--motion-dur-small) var(--motion-ease-standard)',
        flex: 'none',
      }}
      aria-pressed={on}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: 'white',
          boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
          transition: 'left var(--motion-dur-small) var(--motion-ease-standard)',
        }}
      />
    </button>
  );
}

// Consistent select styling — used across General/Masquerade/Locale rows.
export const selectStyle: React.CSSProperties = {
  height: 30,
  padding: '0 12px',
  fontSize: 12,
  fontFamily: 'inherit',
  color: 'var(--d9-ink)',
  background: 'var(--d9-slate)',
  border: '0.5px solid var(--d9-hairline)',
  borderRadius: 8,
  outline: 'none',
  cursor: 'pointer',
};

export const emptyStyle: React.CSSProperties = {
  padding: '24px 20px',
  textAlign: 'center',
  borderRadius: 'var(--radius-outer)',
  background: 'rgba(255, 255, 255, 0.03)',
  border: '0.5px dashed var(--d9-hairline)',
  color: 'var(--d9-ink-mute)',
  fontSize: 12.5,
  letterSpacing: '-0.005em',
  lineHeight: 1.5,
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
}

export function guessMIME(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'md':
    case 'markdown':
      return 'text/markdown';
    case 'html':
    case 'htm':
      return 'text/html';
    case 'pdf':
      return 'application/pdf';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    default:
      return 'text/plain';
  }
}

export function humanizeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // Surface the server's message verbatim if it's present after the
  // status code, otherwise a generic fallback.
  const parts = msg.split(':');
  return parts[parts.length - 1]?.trim() || translate('cue.settings.documents.err.generic');
}

