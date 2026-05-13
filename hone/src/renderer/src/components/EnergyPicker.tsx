// EnergyPicker — small popup для quick energy logging (Phase K Wave 15).
//
// Mounted as a floating widget on Stats / Today (caller passes anchor).
// Five buttons 1..5 with subtle labels («drained», «low», «ok», «high»,
// «peak»). Optional one-line note. Submit → POST /hone/energy.
//
// Identity: B/W only. Active level — slightly brighter ring; no colored
// fills.
import { useState } from 'react';

import { logEnergy, type EnergyLog } from '../api/energy';
import { trackEvent } from '../api/events';

const LABELS = ['drained', 'low', 'ok', 'high', 'peak'];

interface Props {
  onLogged?: (l: EnergyLog) => void;
  compact?: boolean;
}

export function EnergyPicker({ onLogged, compact }: Props): JSX.Element {
  const [picked, setPicked] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (level: number): Promise<void> => {
    setSubmitting(true);
    try {
      const l = await logEnergy(level, note.trim() || undefined);
      setDone(true);
      onLogged?.(l);
      trackEvent('energy_logged', { level });
      window.setTimeout(() => setDone(false), 2000);
      setNote('');
      setPicked(null);
    } catch {
      /* swallow — UI keeps the picker for retry */
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 8,
        padding: compact ? '8px 10px' : '12px 14px',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.02)',
        minWidth: 220,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, letterSpacing: '0.14em', opacity: 0.55 }}>
          ENERGY
        </span>
        {done && (
          <span style={{ fontSize: 10, color: 'var(--ink-60)' }}>logged</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {LABELS.map((lbl, i) => {
          const level = i + 1;
          const active = picked === level;
          return (
            <button
              key={level}
              disabled={submitting}
              onMouseEnter={() => setPicked(level)}
              onMouseLeave={() => setPicked(null)}
              onClick={() => void submit(level)}
              aria-label={`Energy level ${level} — ${lbl}`}
              style={{
                flex: 1,
                height: compact ? 28 : 32,
                background: 'transparent',
                border: `1px solid ${
                  active ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.1)'
                }`,
                color: 'var(--ink)',
                borderRadius: 6,
                cursor: submitting ? 'wait' : 'pointer',
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: 12,
                transition: 'border-color 120ms ease-out',
              }}
            >
              {level}
            </button>
          );
        })}
      </div>
      <input
        type="text"
        placeholder="optional note…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        style={{
          background: 'transparent',
          border: 'none',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          padding: '4px 0',
          fontSize: 11,
          color: 'var(--ink)',
          outline: 'none',
        }}
      />
      {picked !== null && (
        <div style={{ fontSize: 10, opacity: 0.5 }}>{LABELS[picked - 1]}</div>
      )}
    </div>
  );
}
